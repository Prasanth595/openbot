import type { QueryClient } from "@tanstack/react-query";
import { type QueryScope, queryKeys } from "./query-keys";

export interface MarketAgentInstall {
  listingId: string;
  agentId: string;
  /** Local monotonic time; a list request already in flight cannot disprove this receipt. */
  installedAt: number;
}

export const marketAgentInstallsKey = (scope: QueryScope, serverId: string) => [
  ...queryKeys.agentInfo(scope, serverId),
  "market-install-receipts",
];

/** Only a complete read started after installation can disprove a missing installed agent. */
export function reconcileMarketAgentInstalls(
  client: QueryClient,
  scope: QueryScope,
  serverId: string,
  agents: readonly { id: string }[],
  readStartedAt: number,
) {
  const available = new Set(agents.map((agent) => agent.id));
  client.setQueryData<MarketAgentInstall[]>(marketAgentInstallsKey(scope, serverId), (current) => {
    if (!current) return current;
    const retained = current.filter(
      (receipt) => available.has(receipt.agentId) || receipt.installedAt >= readStartedAt,
    );
    return retained.length === current.length ? current : retained;
  });
}
