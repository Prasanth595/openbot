import {
  AGENT_MCP_LIMITS,
  type AgentMcpSettings,
  type AgentMcpTool,
  agentMcpWithinBytes,
  type ListAgentMcpToolsInput,
  type McpServerConfig,
  type SetAgentMcpGrantsInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { AgentMcpGrantStore } from "./agent-mcp-grant-store";
import type { AgentMcpRelay } from "./agent-mcp-relay";
import { type McpOperationError, mcpSync } from "./mcp-effects";
import { McpServerError } from "./mcp-server-store";

export interface AgentMcpAccessOptions {
  grants: AgentMcpGrantStore;
  relay: AgentMcpRelay;
  agentExists(agentId: string): boolean;
  servers(): readonly McpServerConfig[];
  changed(agentId: string): Effect.Effect<void, McpOperationError>;
  edit<A>(agentId: string, operation: Effect.Effect<A, McpOperationError>): Effect.Effect<A, McpOperationError>;
}

/** Owns admin grant reads and writes. Provider calls use the relay, which checks the same saved grants. */
export class AgentMcpAccess {
  constructor(private readonly options: AgentMcpAccessOptions) {}

  read(agentId: string): AgentMcpSettings {
    this.#requireAgent(agentId);
    return {
      agentId,
      grants: this.options.grants.read(agentId),
      servers: this.options.servers().map(({ id, name, enabled }) => ({ id, name, enabled })),
    };
  }

  readonly set = Effect.fn("AgentMcpAccess.set")(function* (this: AgentMcpAccess, input: SetAgentMcpGrantsInput) {
    // Reject oversized trusted callers before retiring their current provider or entering an edit lane.
    yield* mcpSync(() => {
      if (
        !agentMcpWithinBytes(input.grants, AGENT_MCP_LIMITS.grantsBytes) ||
        !agentMcpWithinBytes(input, AGENT_MCP_LIMITS.payloadBytes)
      )
        throw new McpServerError(sourceText("error.backend.agentMcpSelectionTooLarge"));
    });
    return yield* this.options.edit(
      input.agentId,
      Effect.gen({ self: this }, function* () {
        yield* mcpSync(() => {
          this.#requireAgent(input.agentId);
          this.options.grants.write(input.agentId, input.grants);
        });
        yield* this.options.changed(input.agentId);
        return yield* mcpSync(() => this.read(input.agentId));
      }),
    );
  });

  readonly tools = Effect.fn("AgentMcpAccess.tools")(function* (
    this: AgentMcpAccess,
    input: ListAgentMcpToolsInput,
  ): Effect.fn.Return<AgentMcpTool[], McpOperationError> {
    yield* mcpSync(() => this.#requireAgent(input.agentId));
    return yield* this.options.relay.tools(input.agentId, input.mcpServerId, input.query);
  });

  #requireAgent(agentId: string): void {
    if (!this.options.agentExists(agentId)) throw new McpServerError(sourceText("error.agent.selectedGone"));
  }
}
