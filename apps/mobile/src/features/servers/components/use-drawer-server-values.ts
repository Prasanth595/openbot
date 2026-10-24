import { isAgentTaskOpen, taskNeedsYou } from "@openbot/team-client/agent-tasks";
import { addCalendarDays, calendarDayOf } from "@openbot/team-client/routine-calendar-dates";
import { useQuery } from "@tanstack/react-query";
import { lastUsageDays } from "@/features/agents/components/usage-range-picker";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useServerTasks } from "@/features/servers/model/use-server-tasks";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import type { MobileServer } from "@/features/workspace/model/workspace-types";
import { useText } from "@/shared/lib/text";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** The drawer looks this far ahead for the next routine run. */
const ROUTINE_LOOKAHEAD_DAYS = 8;

export interface DrawerServerValues {
  /** `null` on a host without `agent-tasks-v1`: the drawer has no Tasks row then. */
  tasks: { value: string | null; needsYou: boolean } | null;
  /** When the next routine runs, such as "Tomorrow at 8:00". */
  nextRoutine: string | null;
  /** The estimated cost of the Usage screen's default period. */
  usage: string | null;
  members: string | null;
  memberCount: number | null;
}

/**
 * The values beside the server rows of the drawer. They come from the host, read when the drawer
 * opens and refreshed by its events. The member count comes from the host's presence event, not
 * from the account service.
 */
export function useDrawerServerValues(server: MobileServer | undefined, open: boolean): DrawerServerValues {
  const { t, format } = useText();
  const queryScope = useQueryScope();
  const { loadRoutineCalendar, loadHostAnalytics } = useMobileWorkspaceActions();
  const serverId = server?.id ?? "";
  const memberCount = useMobileWorkspaceSelector((current) => current.memberCountByServer[serverId] ?? null);
  const enabled = open && server?.state === "online";

  // The range starts at the hour, so the key stays the same while the drawer opens and closes.
  const start = Math.floor(Date.now() / HOUR) * HOUR;
  const from = new Date(start).toISOString();
  const to = new Date(start + ROUTINE_LOOKAHEAD_DAYS * DAY).toISOString();
  const serverTasks = useServerTasks(serverId, { enabled });
  const routines = useQuery({
    queryKey: queryKeys.serverRoutines(queryScope, serverId, from, to),
    queryFn: () => loadRoutineCalendar({ from, to }, serverId),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
  const range = lastUsageDays();
  const usage = useQuery({
    queryKey: queryKeys.serverUsage(queryScope, serverId, range, undefined),
    queryFn: () => loadHostAnalytics(range, serverId),
    enabled,
    retry: false,
    staleTime: 60_000,
  });

  const now = Date.now();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let nextRoutine: string | null = null;
  if (routines.data) {
    const active = new Set(
      routines.data.routines.filter((routine) => routine.active && routine.owner.kind === "agent").map((r) => r.id),
    );
    const next = routines.data.runs
      .filter(
        (run) =>
          (run.status === "scheduled" || run.status === "queued") &&
          active.has(run.routineId) &&
          Date.parse(run.at) >= now,
      )
      .sort((left, right) => Date.parse(left.at) - Date.parse(right.at))[0];
    if (next) {
      const at = new Date(next.at);
      const day = calendarDayOf(at, timeZone);
      const today = calendarDayOf(new Date(now), timeZone);
      const time = format.date(at, { hour: "numeric", minute: "2-digit", timeZone });
      nextRoutine =
        day === today
          ? t("mobile.server.routines.todayAt", { time })
          : day === addCalendarDays(today, 1)
            ? t("mobile.server.routines.tomorrowAt", { time })
            : t("mobile.server.routines.dayAt", {
                day: format.date(at, { weekday: "short", timeZone }),
                time,
              });
    }
  }
  const cost = usage.data?.totals.estimatedCostUsd ?? null;
  // A large amount drops its cents: the row has room for a short value.
  const digits = cost !== null && cost >= 100 ? 0 : 2;
  // As the prototype: the tasks that need the person, else the tasks that run.
  const openTasks = serverTasks.tasks.filter(isAgentTaskOpen);
  const needsYou = openTasks.filter(taskNeedsYou).length;
  const working = openTasks.filter((task) => task.state === "running").length;
  return {
    tasks: serverTasks.supported
      ? {
          value: needsYou
            ? t("mobile.server.drawer.tasksNeedYou", { count: needsYou })
            : working
              ? t("mobile.server.drawer.tasksWorking", { count: working })
              : null,
          needsYou: needsYou > 0,
        }
      : null,
    nextRoutine,
    usage:
      cost === null ? null : format.currencyUsd(cost, { minimumFractionDigits: digits, maximumFractionDigits: digits }),
    members: memberCount === null ? null : format.number(memberCount),
    memberCount,
  };
}
