import type { RoutineCalendarRoutine, RoutineCalendarRun, RoutineCalendarRunStatus } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import {
  addCalendarDays,
  type CalendarDay,
  calendarDayDate,
  calendarDayOf,
  calendarDays,
  calendarWeekStart,
  clockChangeDay,
} from "@openbot/team-client/routine-calendar-dates";
import { useQueries } from "@tanstack/react-query";
import { router } from "expo-router";
import { Button, Typography } from "heroui-native";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import ClockAlert from "lucide-react-native/icons/clock-alert";
import { type ReactNode, useEffect, useState } from "react";
import { RefreshControl, View } from "react-native";
import { useCSSVariable, useUniwind } from "uniwind";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useChannels } from "@/features/channels/components/use-channels";
import { DAY_STRIP_LENGTH, DayStrip } from "@/features/servers/components/day-strip";
import { type CalendarStatus, RoutineCalendarRow } from "@/features/servers/components/routine-calendar-row";
import { WorkScreen } from "@/features/servers/components/work-screen";
import { routineScheduleSummary } from "@/features/servers/model/routine-schedule-summary";
import { useWorkTabServer } from "@/features/servers/model/use-work-tab-server";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { MenuView } from "@/shared/components/menu-view";
import { NativeSegmentedControl } from "@/shared/components/native-segmented-control";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

const DAY = 86_400_000;
/** As on desktop: a week day shows this many runs. The rest are one step away, in the day view. */
const WEEK_DAY_LIMIT = 4;
const UPCOMING_LIMIT = 6;

type CalendarView = "week" | "day";

/** As on desktop: `active` or `paused` before a run, `completed` or `failed` after it. */
type RunStatus = CalendarStatus;

const STATUS_LABEL = {
  active: "mobile.server.routines.status.active",
  paused: "mobile.server.routines.status.paused",
  failed: "mobile.server.routines.status.failed",
  completed: "mobile.server.routines.status.completed",
  cancelled: "mobile.server.routines.status.cancelled",
} as const satisfies Record<RunStatus, MobileTextKey>;

interface Entry {
  run: RoutineCalendarRun;
  routine: RoutineCalendarRoutine;
  status: RunStatus;
  day: CalendarDay;
  agents: MobileAgent[];
  owner: string | undefined;
}

/** Before a run, the routine state says what happens; after it, the outcome does. */
function runStatus(status: RoutineCalendarRunStatus, routineActive: boolean): RunStatus {
  switch (status) {
    case "scheduled":
      return routineActive ? "active" : "paused";
    case "queued":
    case "running":
      return "active";
    case "succeeded":
      return "completed";
    case "cancelled":
      return "cancelled";
    case "failed":
    case "interrupted":
    case "needs-attention":
      return "failed";
  }
}

/**
 * The runs of the shown days in instants. A calendar day in the viewer's zone can start up to 14 hours
 * either side of UTC midnight, so each end takes one more day; the list drops the days it does not show.
 */
function rangeAround(first: CalendarDay, last: CalendarDay) {
  return {
    from: new Date(Date.parse(first) - DAY).toISOString(),
    to: new Date(Date.parse(last) + 2 * DAY).toISOString(),
  };
}

export function ServerRoutinesScreen() {
  const text = useText();
  const { t, format } = text;
  const { theme } = useUniwind();
  const foreground = String(useCSSVariable("--openbot-text-primary"));
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const warning = String(useCSSVariable("--openbot-warning-text"));
  const serverId = useWorkTabServer();
  const queryScope = useQueryScope();
  const { servers, agents, loadRoutineCalendar } = useMobileWorkspace();
  const { channels } = useChannels(serverId);
  const server = servers.find((item) => item.id === serverId);
  const online = server?.state === "online";
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [now, setNow] = useState(() => new Date());
  const today = calendarDayOf(now, timeZone);
  const [view, setView] = useState<CalendarView>("day");
  const [tab, setTab] = useState<"schedule" | "routines">("schedule");
  const [anchor, setAnchor] = useState(today);
  // The first of the seven days on screen. A swipe stops on any day, not only on a Monday.
  const [start, setStart] = useState(() => calendarWeekStart(today, 1));
  const shownDays = calendarDays(start, DAY_STRIP_LENGTH);
  const lastDay = shownDays.at(-1) ?? start;
  const days = view === "week" ? shownDays : [anchor];

  // Runs load by calendar week, so a swipe of one day asks the host only when it reaches a new week.
  // The weeks on each side load too, so their days are marked before the swipe reaches them.
  const firstWeek = calendarWeekStart(start, 1);
  const lastWeek = calendarWeekStart(lastDay, 1);
  const neededWeeks = firstWeek === lastWeek ? [firstWeek] : [firstWeek, lastWeek];
  const loadedWeeks = [addCalendarDays(firstWeek, -7), ...neededWeeks, addCalendarDays(lastWeek, 7)];
  const weeks = useQueries({
    queries: loadedWeeks.map((weekStart) => {
      const range = rangeAround(weekStart, addCalendarDays(weekStart, 6));
      return {
        queryKey: queryKeys.serverRoutines(queryScope, serverId, range.from, range.to),
        enabled: online,
        retry: false,
        // Host events refresh a week; a swipe back to a loaded week does not ask the host again.
        staleTime: 60_000,
        queryFn: () => loadRoutineCalendar(range, serverId),
      };
    }),
  });
  const needed = weeks.slice(1, 1 + neededWeeks.length);
  const neededData = needed.flatMap((week) => (week.data ? [week.data] : []));
  const ready = neededData.length === needed.length;

  // A planned run that passes without a result keeps its place; the clock only moves "now".
  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(clock);
  }, []);

  const serverAgents = new Map(agents.filter((agent) => agent.serverId === serverId).map((agent) => [agent.id, agent]));
  const channelById = new Map(channels.map((channel) => [channel.id, channel]));
  const ownerAgents = (routine: RoutineCalendarRoutine) => {
    const owner = routine.owner;
    const ids =
      owner.kind === "agent"
        ? [owner.agentId]
        : (channelById.get(owner.channelId)?.members.map((member) => member.agentId) ?? []);
    return ids.flatMap((id) => serverAgents.get(id) ?? []);
  };
  const ownerName = (routine: RoutineCalendarRoutine) =>
    routine.owner.kind === "agent"
      ? serverAgents.get(routine.owner.agentId)?.name
      : channelById.get(routine.owner.channelId)?.name;

  // A few weeks of runs: building the list on each render costs less than keeping it in step.
  const entries = (() => {
    const routines = new Map<string, RoutineCalendarRoutine>();
    const runs: RoutineCalendarRun[] = [];
    // Each loaded range reaches into the next week, so a run counts only in the week of its own day.
    loadedWeeks.forEach((weekStart, index) => {
      const data = weeks[index]?.data;
      if (!data) return;
      for (const routine of data.routines) routines.set(routine.id, routine);
      const ownDays = new Set(calendarDays(weekStart, 7));
      for (const run of data.runs) if (ownDays.has(calendarDayOf(new Date(run.at), timeZone))) runs.push(run);
    });
    return runs
      .flatMap((run): Entry[] => {
        const routine = routines.get(run.routineId);
        if (!routine) return [];
        return [
          {
            run,
            routine,
            status: runStatus(run.status, routine.active),
            day: calendarDayOf(new Date(run.at), timeZone),
            agents: ownerAgents(routine),
            owner: ownerName(routine),
          },
        ];
      })
      .sort((left, right) => Date.parse(left.run.at) - Date.parse(right.run.at));
  })();

  const entriesByDay = new Map<CalendarDay, Entry[]>();
  for (const entry of entries) {
    const list = entriesByDay.get(entry.day);
    if (list) list.push(entry);
    else entriesByDay.set(entry.day, [entry]);
  }
  const countByDay = new Map([...entriesByDay].map(([day, list]) => [day, list.length]));
  const marksByDay = new Map(
    [...entriesByDay].map(([day, list]) => [day, list.map((entry) => ({ id: entry.run.id, status: entry.status }))]),
  );
  const upcoming = entries
    .filter((entry) => entry.status === "active" && Date.parse(entry.run.at) >= now.getTime())
    .slice(0, UPCOMING_LIMIT);

  const dayText = (day: CalendarDay, options: Intl.DateTimeFormatOptions) =>
    format.date(calendarDayDate(day), { ...options, timeZone: "UTC" });
  const longDay = (day: CalendarDay) => dayText(day, { weekday: "long", month: "long", day: "numeric" });
  const dayTitle = (day: CalendarDay) =>
    day === today ? t("mobile.server.routines.todayTitle", { day: longDay(day) }) : longDay(day);
  const timeText = (at: string) => format.date(new Date(at), { hour: "numeric", minute: "2-digit", timeZone });
  const upcomingWhen = (entry: Entry) => {
    const time = timeText(entry.run.at);
    if (entry.day === today) return t("mobile.server.routines.todayAt", { time });
    if (entry.day === addCalendarDays(today, 1)) return t("mobile.server.routines.tomorrowAt", { time });
    return t("mobile.server.routines.dayAt", {
      day: dayText(entry.day, { weekday: "short", month: "short", day: "numeric" }),
      time,
    });
  };
  const rangeLabel = t("mobile.server.routines.range", {
    start: dayText(start, { month: "short", day: "numeric" }),
    end: dayText(lastDay, { month: "short", day: "numeric", year: "numeric" }),
  });

  function openRoutine(routine: RoutineCalendarRoutine, run?: RoutineCalendarRun) {
    const owner = routine.owner;
    if (owner.kind === "agent") {
      router.push({
        pathname: "/server-routines/agent-routine",
        params: {
          agentId: owner.agentId,
          serverId,
          recordId: routine.id,
          ...(run && run.status !== "scheduled" ? { runId: run.id } : {}),
        },
      });
    } else {
      router.push({
        pathname: "/server-routines/channel-routine",
        params: { channelId: owner.channelId, serverId, recordId: routine.id },
      });
    }
  }

  function selectDay(day: CalendarDay, nextView: CalendarView = view) {
    void haptics.selection();
    setAnchor(day);
    setView(nextView);
  }

  /** Moves the days on screen. The open day keeps its place among them. */
  function moveStart(next: CalendarDay) {
    const shift = Math.round((Date.parse(next) - Date.parse(start)) / DAY);
    setStart(next);
    setAnchor((day) => addCalendarDays(day, shift));
  }

  function showToday() {
    setAnchor(today);
    if (!shownDays.includes(today)) setStart(calendarWeekStart(today, 1));
  }

  const exactStatus = (entry: Entry) => {
    switch (entry.run.status) {
      case "queued":
        return t("mobile.server.routines.status.queued");
      case "running":
        return t("mobile.server.routines.status.running");
      case "cancelled":
        return t("mobile.server.routines.status.cancelled");
      case "interrupted":
        return t("mobile.server.routines.status.interrupted");
      case "needs-attention":
        return t("mobile.server.routines.status.needsAttention");
      default:
        return t(STATUS_LABEL[entry.status]);
    }
  };
  const renderEntry = (entry: Entry, when: string, cadence = false) => (
    <RoutineCalendarRow
      key={entry.run.id}
      title={entry.routine.name}
      subtitle={`${when} · ${cadence ? routineScheduleSummary(entry.routine.schedule, text) : exactStatus(entry)}${entry.owner ? ` · ${entry.owner}` : ""}`}
      status={entry.status}
      agents={entry.agents}
      onPress={() => openRoutine(entry.routine, entry.run)}
    />
  );
  const catalog = neededData[0]?.routines ?? [];
  const clockChange = clockChangeDay(shownDays, timeZone);
  const title = t("mobile.app.route.routines");
  const note = (key: MobileTextKey) => (
    <Typography.Paragraph className="text-grouped-secondary" style={typeScale.marketDescription}>
      {t(key)}
    </Typography.Paragraph>
  );

  const [pullRefreshing, setPullRefreshing] = useState(false);
  const refreshFromPull = async () => {
    if (!online || pullRefreshing) return;
    setPullRefreshing(true);
    try {
      await Promise.all(weeks.map((week) => week.refetch()));
    } finally {
      setPullRefreshing(false);
    }
  };

  return (
    <WorkScreen
      title={title}
      subtitle={t("mobile.server.routines.timeZone", { zone: timeZone.replaceAll("_", " ") })}
      refreshControl={
        <RefreshControl refreshing={pullRefreshing} enabled={online} onRefresh={() => void refreshFromPull()} />
      }
    >
      {!server ? (
        note("mobile.server.unavailable")
      ) : (
        <>
          <NativeSegmentedControl
            options={[
              { value: "schedule", label: t("mobile.server.routines.schedule") },
              { value: "routines", label: t("mobile.app.route.routines") },
            ]}
            value={tab}
            onChange={(value) => {
              void haptics.selection();
              setTab(value);
            }}
          />
          {tab === "schedule" ? (
            <>
              {clockChange ? (
                <View
                  className="flex-row gap-2.5 border border-warning/25 bg-warning/10"
                  style={{ paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14 }}
                >
                  <ClockAlert size={18} color={warning} />
                  <Typography.Paragraph
                    className="min-w-0 flex-1 text-warning-text"
                    style={typeScale.marketDescription}
                  >
                    {t("mobile.server.routines.clockChange", {
                      day: longDay(clockChange),
                      zone: timeZone.replaceAll("_", " "),
                    })}
                  </Typography.Paragraph>
                </View>
              ) : null}
              <View style={{ gap: 10 }}>
                <View className="flex-row items-center gap-1">
                  <Button
                    isIconOnly
                    variant="ghost"
                    className="size-11 rounded-full"
                    accessibilityLabel={t("mobile.server.routines.previousWeek")}
                    onPress={() => moveStart(addCalendarDays(start, -7))}
                  >
                    <ChevronLeft size={18} color={muted} />
                  </Button>
                  <View className="min-w-0 flex-1">
                    <MenuView
                      colorScheme={theme === "dark" ? "dark" : "light"}
                      actions={[
                        {
                          id: "today",
                          title: t("mobile.server.routines.today"),
                          attributes: { disabled: days.includes(today) },
                        },
                        { id: "day", title: t("mobile.server.routines.viewDay"), state: view === "day" ? "on" : "off" },
                        {
                          id: "week",
                          title: t("mobile.server.routines.viewWeek"),
                          state: view === "week" ? "on" : "off",
                        },
                      ]}
                      onPressAction={({ nativeEvent }) => {
                        if (nativeEvent.event === "today") showToday();
                        if (nativeEvent.event === "day") selectDay(anchor, "day");
                        if (nativeEvent.event === "week") selectDay(anchor, "week");
                      }}
                    >
                      <View
                        className="min-h-11 flex-row items-center justify-center gap-1"
                        accessible
                        accessibilityRole="adjustable"
                        accessibilityLabel={`${rangeLabel}. ${t("mobile.server.routines.view")}`}
                        accessibilityLiveRegion="polite"
                        accessibilityActions={[
                          { name: "decrement", label: t("mobile.server.routines.previousWeek") },
                          { name: "increment", label: t("mobile.server.routines.nextWeek") },
                        ]}
                        onAccessibilityAction={(event) =>
                          moveStart(addCalendarDays(start, event.nativeEvent.actionName === "increment" ? 7 : -7))
                        }
                      >
                        <Typography.Paragraph weight="semibold" align="center" style={typeScale.teamPreview}>
                          {rangeLabel}
                        </Typography.Paragraph>
                        <ChevronDown size={14} color={foreground} />
                      </View>
                    </MenuView>
                  </View>
                  <Button
                    isIconOnly
                    variant="ghost"
                    className="size-11 rounded-full"
                    accessibilityLabel={t("mobile.server.routines.nextWeek")}
                    onPress={() => moveStart(addCalendarDays(start, 7))}
                  >
                    <ChevronRight size={18} color={muted} />
                  </Button>
                </View>
                <DayStrip
                  start={start}
                  today={today}
                  selected={view === "day" ? anchor : null}
                  counts={countByDay}
                  marks={marksByDay}
                  weekdayText={(day) => dayText(day, { weekday: "short" })}
                  dayNumberText={(day) => format.number(Number(day.slice(-2)))}
                  dayLabel={(day, count) => t("mobile.server.routines.dayLabel", { day: longDay(day), count })}
                  onSelectDay={(day) => selectDay(day, "day")}
                  onStartChange={moveStart}
                />
              </View>
            </>
          ) : null}
          {!online && !ready ? (
            note("mobile.server.routines.offline")
          ) : needed.some((week) => week.isError) ? (
            <View className="gap-2">
              {note("mobile.server.routines.loadFailed")}
              <Button
                variant="ghost"
                onPress={() => {
                  for (const week of needed) if (week.isError) void week.refetch();
                }}
              >
                <Button.Label>{t("common.retry")}</Button.Label>
              </Button>
            </View>
          ) : !ready ? (
            note("mobile.server.routines.loading")
          ) : catalog.length === 0 ? (
            note("mobile.server.routines.empty")
          ) : tab === "routines" ? (
            <View className="gap-2">
              {catalog.map((routine) => {
                const name = ownerName(routine);
                return (
                  <RoutineCalendarRow
                    key={routine.id}
                    title={routine.name}
                    subtitle={`${routineScheduleSummary(routine.schedule, text)} · ${t(routine.active ? "mobile.server.routines.status.active" : "mobile.server.routines.status.paused")}${name ? ` · ${name}` : ""}`}
                    status={routine.active ? "active" : "paused"}
                    agents={ownerAgents(routine)}
                    onPress={() => openRoutine(routine)}
                  />
                );
              })}
            </View>
          ) : (
            <>
              {(view === "week" ? shownDays : [anchor]).map((day) => {
                const dayEntries = entriesByDay.get(day) ?? [];
                const visible = view === "week" ? dayEntries.slice(0, WEEK_DAY_LIMIT) : dayEntries;
                const hidden = dayEntries.length - visible.length;
                return (
                  <RoutineSection key={day} title={dayTitle(day)}>
                    {visible.length
                      ? visible.map((entry) => renderEntry(entry, timeText(entry.run.at)))
                      : note("mobile.server.routines.dayEmpty")}
                    {hidden > 0 ? (
                      <Button
                        variant="ghost"
                        accessibilityLabel={t("mobile.server.routines.showAll", {
                          count: dayEntries.length,
                          day: longDay(day),
                        })}
                        onPress={() => selectDay(day, "day")}
                      >
                        <Button.Label>{t("mobile.server.routines.more", { count: hidden })}</Button.Label>
                      </Button>
                    ) : null}
                  </RoutineSection>
                );
              })}
              {view === "day" && anchor === today ? (
                <RoutineSection title={t("mobile.server.routines.upcomingRuns")}>
                  {upcoming.length
                    ? upcoming.map((entry) => renderEntry(entry, upcomingWhen(entry), true))
                    : note("mobile.server.routines.upcomingEmpty")}
                </RoutineSection>
              ) : null}
            </>
          )}
        </>
      )}
    </WorkScreen>
  );
}

function RoutineSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-2">
      <Typography.Paragraph
        className="px-1 text-grouped-secondary"
        style={{
          ...typeScale.teamMeta,
          textTransform: "uppercase",
        }}
      >
        {title}
      </Typography.Paragraph>
      {children}
    </View>
  );
}
