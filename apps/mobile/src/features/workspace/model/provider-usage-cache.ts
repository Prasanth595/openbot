import { type AccountUsage, type AgentEvent, isAccountUsage, type TeamRealtimeEvent } from "@openbot/contracts/ipc";
import type { QueryClient } from "@tanstack/react-query";
import { type QueryScope, queryKeys } from "./query-keys";

/** A confirmed local sign-in, key or account change makes both cached readings old. */
export function invalidateProviderUsageQueries(queryClient: QueryClient, scope: QueryScope, serverId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.providerUsage(scope, serverId), exact: true });
  void queryClient.invalidateQueries({ queryKey: queryKeys.providerAccountUsage(scope, serverId), exact: true });
}

/** Usage replies broadcast progressive events: update the reading without feeding a new request back. */
export function syncProviderUsageQueries(
  queryClient: QueryClient,
  scope: QueryScope,
  serverId: string,
  event: AgentEvent | TeamRealtimeEvent,
): void {
  if (event.type === "usage-changed" && isAccountUsage(event.usage)) {
    queryClient.setQueryData<AccountUsage>(queryKeys.providerUsage(scope, serverId), (current) => {
      if (event.usage.limits.length === 0) return event.usage;
      const limits = new Map(
        (current?.limits ?? []).map((limit) => [`${limit.id}:${limit.accountId ?? "default"}`, limit]),
      );
      for (const limit of event.usage.limits) limits.set(`${limit.id}:${limit.accountId ?? "default"}`, limit);
      return { limits: [...limits.values()] };
    });
  }
  // Quota reads can emit status, and each message can emit agents-changed. Neither event identifies
  // an account change in the released protocol. Keep the five-minute cache fresh across them;
  // actual usage events, visible polling and manual refresh supply the next reading.
}
