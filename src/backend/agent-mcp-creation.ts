import type { AgentMcpGrantStore } from "./agent-mcp-grant-store";
import type { AgentCreationInitializer } from "./agent-store";

/** Capture the caller's scope before creation waits. Store it before the child enters the roster. */
export function agentMcpCreationInitializer(
  store: AgentMcpGrantStore,
  sourceAgentId: string,
): AgentCreationInitializer {
  const grants = store.read(sourceAgentId);
  return (agentId) => {
    if (grants === null) return;
    store.write(agentId, grants);
    return () => store.forget(agentId);
  };
}
