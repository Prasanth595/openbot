import { skipToken, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { type MarketAgentInstall, marketAgentInstallsKey } from "@/features/workspace/model/market-install-receipts";
import { queryKeys } from "@/features/workspace/model/query-keys";

/** Keep a successful receipt until the host's agent event includes the source identity. */
export function useMarketInstalledAgents(serverId: string) {
  const workspace = useMobileWorkspace();
  const scope = useQueryScope();
  const client = useQueryClient();
  const key = marketAgentInstallsKey(scope, serverId);
  const receipts = useQuery({
    queryKey: key,
    queryFn: skipToken,
    initialData: (): MarketAgentInstall[] => [],
  });
  const pendingReceipts = receipts.data ?? [];
  const agents = workspace.agents.filter((agent) => agent.serverId === serverId);
  const installed = new Set(
    agents.flatMap((agent) => (agent.marketplaceListingId ? [agent.marketplaceListingId] : [])),
  );
  const confirmed = new Set(agents.filter((agent) => agent.marketplaceListingId).map((agent) => agent.id));
  const settled = pendingReceipts.some((receipt) => confirmed.has(receipt.agentId));
  useEffect(() => {
    if (!settled) return;
    client.setQueryData<MarketAgentInstall[]>(marketAgentInstallsKey(scope, serverId), (current) =>
      current?.filter((receipt) => !confirmed.has(receipt.agentId)),
    );
  }, [client, confirmed, scope, serverId, settled]);
  for (const receipt of pendingReceipts) {
    if (!confirmed.has(receipt.agentId)) installed.add(receipt.listingId);
  }
  return installed;
}

/** Share host records with agent settings, including uninstall and change invalidation. */
export function useMarketInstalledSkills(serverId: string, agentIds: string[], enabled: boolean) {
  const workspace = useMobileWorkspace();
  const scope = useQueryScope();
  return useQueries({
    queries: agentIds.map((agentId) => ({
      queryKey: queryKeys.agentSkills(scope, serverId, agentId, true),
      queryFn: () => workspace.loadAgentSkills(agentId, serverId, true),
      enabled,
      retry: false,
    })),
  });
}
