import { useQuery } from "@tanstack/react-query";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import {
  type MobileAgent,
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { showsOnline } from "@/features/workspace/model/server-status";

/** Uses the same host model catalog and cache as the provider settings. */
export function useAgentModelLabel(agent: MobileAgent | undefined): string | undefined {
  const workspace = useMobileWorkspaceActions();
  const scope = useQueryScope();
  const serverId = agent?.serverId ?? "";
  const online = useMobileWorkspaceSelector((current) =>
    current.servers.some((server) => server.id === serverId && showsOnline(server)),
  );
  const models = useQuery({
    queryKey: queryKeys.agentModels(scope, serverId),
    queryFn: () => workspace.loadAgentModels(serverId),
    enabled: online && Boolean(agent?.model),
    staleTime: 60_000,
    retry: false,
  });
  return (
    models.data?.find((model) => model.id === agent?.model && (!agent?.provider || model.provider === agent?.provider))
      ?.name ?? agent?.model
  );
}
