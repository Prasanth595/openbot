import type { AgentModelOption, AgentSummary, UpdateAgentInput } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import type { DynamicToolCallParams } from "../protocol";
import { requestedRuntime } from "./model-tools";
import {
  profileToolErrorMessage,
  profileToolPayload,
  updateAgentsToolSchema,
  widensAgentSettings,
} from "./profile-tools";
import { type OpenBotToolResponse, openBotToolResult } from "./routine-tools";
import { ToolOperationFailed, toolStep } from "./tool-operation";

const logger = createOpenBotLogger("update-agents-tool");

export interface UpdateAgentsHooks {
  listAgents(): AgentSummary[];
  listModels(): AgentModelOption[];
  /** `initiatingAgentId` is the calling agent, recorded with a model change. */
  updateAgent(input: UpdateAgentInput, initiatingAgentId: string): Effect.Effect<AgentSummary, ToolOperationFailed>;
  redactMcp(text: string): string;
}

type AgentResult =
  | { agentId: string; ok: true; profile: ReturnType<typeof profileToolPayload> }
  | { agentId: string; ok: false; error: string };

/**
 * `update_agents`: the settings of `update_profile` that a coordinator sets on many agents at once.
 * Each agent gets the same checks and its own write, in order, so a failure for one agent leaves the
 * others to go on and the result names it.
 */
export const handleUpdateAgentsTool = Effect.fn("UpdateAgentsTool.handle")(
  function* (
    params: DynamicToolCallParams,
    senderAgentId: string,
    hooks: UpdateAgentsHooks,
  ): Effect.fn.Return<OpenBotToolResponse, ToolOperationFailed> {
    const { agentIds, provider, model, reasoningEffort, access, computerUse, notifications } =
      updateAgentsToolSchema.parse(params.arguments, { reportInput: true });
    const runtimeRequest = { provider, model, reasoningEffort };
    if ([provider, model, reasoningEffort, access, computerUse, notifications].every((value) => value === undefined)) {
      throw new Error("At least one setting is required.");
    }
    if (!hooks.listAgents().some((agent) => agent.id === senderAgentId)) {
      throw new Error("The calling agent no longer exists.");
    }
    const models = hooks.listModels();
    const failed = (agentId: string, message: string): AgentResult => ({ agentId, ok: false, error: message });
    const failure = (agentId: string, cause: unknown) =>
      Effect.sync(() => {
        const message = hooks.redactMcp(profileToolErrorMessage(cause));
        logger.warn("An agent in update_agents was not updated.", { agentId, error: message });
        return failed(agentId, message);
      });

    const results = yield* Effect.forEach(agentIds, (agentId) =>
      Effect.gen(function* () {
        const target = hooks.listAgents().find((agent) => agent.id === agentId);
        if (!target) return failed(agentId, sourceText("error.agent.unknown", { id: agentId }));
        if (widensAgentSettings(target, access, computerUse)) {
          return failed(agentId, sourceText("error.agent.onlyUserWidensSettings"));
        }
        const runtime = yield* toolStep(() => requestedRuntime(target, runtimeRequest, models));
        const updated = yield* hooks.updateAgent(
          {
            agentId,
            ...(notifications === undefined ? {} : { notifications }),
            ...runtime,
            // Only a restriction is written, so a user change between the check and this write is never undone.
            ...(access === "workspace" ? { access } : {}),
            ...(computerUse === false ? { computerUse } : {}),
          },
          senderAgentId,
        );
        return { agentId, ok: true, profile: profileToolPayload(updated) } satisfies AgentResult;
      }).pipe(
        Effect.catch((error) => failure(agentId, error.cause)),
        Effect.catchDefect((defect) => failure(agentId, defect)),
      ),
    );
    const updatedCount = results.filter((result) => result.ok).length;
    return openBotToolResult({ updated: updatedCount, failed: results.length - updatedCount, results });
  },
  Effect.catchDefect((cause) => Effect.fail(new ToolOperationFailed({ cause }))),
  Effect.uninterruptible,
);
