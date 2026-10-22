import { type AccountUsage, type AgentEvent, isAccountUsage, type TeamRealtimeEvent } from "@openbot/contracts/ipc";
import type { QueryClient } from "@tanstack/react-query";
import { type QueryScope, queryKeys } from "./query-keys";

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
  if (event.type === "status" || event.type === "agents-changed") {
    // Starting a provider to read its quota can also emit status. The next visible poll or manual
    // refresh can read stale data; the event itself must not start another quota read.
    void queryClient.invalidateQueries({ queryKey: queryKeys.providerUsage(scope, serverId), refetchType: "none" });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.providerAccountUsage(scope, serverId),
      refetchType: "none",
    });
  }
}
