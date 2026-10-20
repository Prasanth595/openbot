import type { AgentTask } from "@openbot/contracts/ipc";
import { useQueries } from "@tanstack/react-query";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";

export interface ServerTasks {
  /** The agents whose tasks the host shows to this member. */
  agents: MobileAgent[];
  tasks: AgentTask[];
  online: boolean;
  /** The host serves `agent-tasks-v1`. */
  supported: boolean;
  /** Each list loaded or failed. */
  ready: boolean;
  /** Reads the failed lists again; `null` when none failed. */
  retry: (() => void) | null;
}

/**
 * The tasks of the agents of a server, or of one agent. Each agent has its own read, the one that the
 * task events of `agent-tasks-v1` write (see `applyTaskEvent`), so every screen shares the same lists.
 * `enabled: false` reads nothing, for a drawer that is closed.
 */
export function useServerTasks(serverId: string, options: { agentId?: string; enabled?: boolean } = {}): ServerTasks {
  const { agentId, enabled = true } = options;
  const queryScope = useQueryScope();
  const { servers, agents, activeServer, hiddenAgents, canUseTasks, loadAgentTasks } = useMobileWorkspace();
  const online = servers.some((server) => server.id === serverId && server.state === "online");
  const supported = canUseTasks(serverId);
  // The host answers 404 for the tasks of an agent that it hides from this member.
  const hiddenIds = serverId === activeServer.id ? new Set(hiddenAgents.map((agent) => agent.id)) : null;
  const serverAgents = agents.filter(
    (agent) => agent.serverId === serverId && !hiddenIds?.has(agent.id) && (!agentId || agent.id === agentId),
  );
  const lists = useQueries({
    queries: serverAgents.map((agent) => ({
      queryKey: queryKeys.agentTasks(queryScope, serverId, agent.id),
      enabled: enabled && online && supported,
      retry: false,
      queryFn: () => loadAgentTasks(agent.id, serverId),
    })),
  });
  const known = new Set(serverAgents.map((agent) => agent.id));
  const failed = lists.filter((list) => list.isError);
  return {
    agents: serverAgents,
    tasks: lists.flatMap((list) => list.data?.tasks ?? []).filter((task) => known.has(task.agentId)),
    online,
    supported,
    ready: lists.every((list) => list.data !== undefined || list.isError),
    retry:
      failed.length > 0
        ? () => {
            for (const list of failed) void list.refetch();
          }
        : null,
  };
}
