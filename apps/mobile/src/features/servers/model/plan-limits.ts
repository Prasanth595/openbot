import { agentProviderName } from "@openbot/contracts/ipc";
import {
  type PlanLimitRow,
  type PlanLimits,
  type PlanLimitWindow,
  planLimitRows,
  planLimitWindowKind,
} from "@openbot/team-client/plan-limits";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import type { MobileText } from "@/shared/lib/text";

type Translate = MobileText["t"];

/** As on desktop: the host pushes the providers' own sign-ins, and the accounts after the first are read again. */
const PLAN_LIMITS_REFRESH_MS = 5 * 60_000;

/**
 * The limits of the server's providers. An owner or admin also gets the accounts after the first. While
 * the server is offline, the last reading stays, so the header button does not come and go with the
 * connection.
 */
export function usePlanLimits(serverId: string) {
  const workspace = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const online = useMobileWorkspaceSelector(
    (current) => current.servers.find((server) => server.id === serverId)?.state === "online",
  );
  // Not in the key: the role check needs an online server, so the key would change when it goes offline.
  const accounts = useMobileWorkspaceSelector((current) => current.canManageProviderAccounts(serverId));
  const limits = useQuery({
    queryKey: queryKeys.planLimits(queryScope, serverId),
    queryFn: () => workspace.loadPlanLimits(serverId, accounts),
    enabled: online,
    refetchInterval: PLAN_LIMITS_REFRESH_MS,
    retry: false,
  });
  const rows = useMemo(() => planLimitRows(limits.data?.usage), [limits.data]);
  return { rows, accounts: limits.data?.accounts ?? null, online, loading: online && limits.isPending };
}

/** The provider, and the account when the provider has more than one. */
export function planLimitName(row: PlanLimitRow, accounts: PlanLimits["accounts"], t: Translate): string {
  const provider = agentProviderName(row.provider);
  const list = accounts?.find((entry) => entry.provider === row.provider)?.accounts ?? [];
  if (list.length < 2) return provider;
  const index = Math.max(
    0,
    list.findIndex((account) => account.id === (row.accountId ?? list[0]?.id)),
  );
  const account = list[index];
  const name = account?.label || account?.email || t("mobile.agent.runtime.accountNumbered", { number: index + 1 });
  return `${provider} · ${name}`;
}

/** The identity of a window in a reading: a provider reports each window length once. */
export function planLimitWindowKey(window: PlanLimitWindow): string {
  return `${window.durationMins ?? "limit"}-${window.resetsAt ?? ""}`;
}

/** The name of a limit window, as desktop names it: 5-hour, Weekly, Monthly. */
export function planLimitWindowLabel(durationMins: number | null, t: Translate): string {
  const window = planLimitWindowKind(durationMins);
  switch (window.kind) {
    case "limit":
      return t("mobile.server.planLimits.window.limit");
    case "weekly":
      return t("mobile.server.planLimits.window.weekly");
    case "monthly":
      return t("mobile.server.planLimits.window.monthly");
    case "daily":
      return t("mobile.server.planLimits.window.daily");
    case "fiveHour":
      return t("mobile.server.planLimits.window.fiveHour");
    case "hours":
      return t("mobile.server.planLimits.window.hours", { count: window.hours });
    case "minutes":
      return t("mobile.server.planLimits.window.minutes", { minutes: window.minutes });
  }
}
