import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";
import type { AgentConversationTarget } from "@openbot/contracts/ipc-agent-conversations";
import type { createAgentConversationsController } from "./agent-conversations-controller";
import type { ConversationRuntime } from "./conversation-runtime";
/** Adapts existing composer actions to one captured local subject. No caller reads current selection after an await. */
export function agentConversationRuntime(
  base: ConversationRuntime,
  api: OpenBotDesktopApi["agentConversations"],
  controller: ReturnType<typeof createAgentConversationsController>,
  target: AgentConversationTarget,
): ConversationRuntime {
  const secretRequests = (controller.state.views[target.threadId]?.attention ?? []).flatMap((event) =>
    event.type === "browser-takeover-requested" && event.request.turnId
      ? [{ requestId: event.request.requestId, turnId: event.request.turnId }]
      : [],
  );
  return {
    ...base,
    agent: {
      ...base.agent,
      editQueuedMessage: async (input, serverId) => {
        if (input.agentId !== target.agentId || (serverId !== undefined && serverId !== "local"))
          throw new Error("Queue editor destination mismatch.");
        const { agentId: _agentId, ...edit } = input;
        await api.action({ ...target, action: "edit", edit });
        const reply = await api.queue(target);
        if (reply.agentId !== target.agentId || reply.threadId !== target.threadId)
          throw new Error("Queue reply destination mismatch.");
        return reply.snapshot;
      },
      setMessageReaction: async (input, serverId) => {
        if (input.agentId !== target.agentId || (serverId !== undefined && serverId !== "local"))
          throw new Error("Reaction destination mismatch.");
        await api.action({ ...target, action: "reaction", messageId: input.messageId, emoji: input.emoji });
      },
      respondToBrowserSecret: async (input, serverId) => {
        if (input.agentId !== target.agentId || (serverId !== undefined && serverId !== "local"))
          throw new Error("Secret input destination mismatch.");
        const pending = secretRequests.find((request) => request.requestId === input.requestId);
        if (!pending) throw new Error("The secret input is no longer current.");
        await api.action({ ...input, ...target, action: "secret", turnId: pending.turnId });
      },
    },
  };
}
