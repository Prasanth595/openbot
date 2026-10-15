import type { AgentContextCategoryUsage } from "@openbot/contracts/ipc";
import { createEffect, createSignal, onCleanup } from "solid-js";
import { ContextCategoryReader, type ContextCategoryTarget } from "./context-category-reader";
import { conversationRuntime } from "./conversation-runtime";
import type { ConversationProps } from "./conversation-types";

/** The existing selected conversation and runtime snapshots invalidate this cached read. No polling. */
export function createContextCategoryState(props: ConversationProps) {
  const [cached, setCached] = createSignal<{ value: AgentContextCategoryUsage; target: ContextCategoryTarget } | null>(
    null,
  );
  const usage = () => {
    const item = cached();
    const agent = props.agent;
    const target = props.contextCategoryTarget;
    return item &&
      agent?.provider === "claude" &&
      item.target.serverId === (props.server?.id ?? "local") &&
      item.target.agentId === agent.id &&
      item.target.threadId === agent.threadId &&
      item.target.model === agent.model &&
      (!target || (target.agentId === agent.id && target.threadId === agent.threadId))
      ? item.value
      : null;
  };
  const reader = new ContextCategoryReader(
    (input, serverId) =>
      conversationRuntime(props).agent.readContextCategories?.(input, serverId) ?? Promise.resolve(null),
    (value, target) => setCached(value && target ? { value, target } : null),
  );
  createEffect(
    () => ({
      captured:
        !props.contextCategoryTarget ||
        (props.contextCategoryTarget.agentId === props.agent?.id &&
          props.contextCategoryTarget.threadId === props.agent?.threadId),
      agentId: props.contextCategoryTarget?.agentId ?? props.agent?.id,
      threadId: props.contextCategoryTarget?.threadId ?? props.agent?.threadId,
      provider: props.agent?.provider,
      model: props.agent?.model,
      updatedAt: props.agent?.updatedAt,
      serverId: props.server?.id,
      activeTurnId: props.activeTurnId,
      used: props.contextState?.usage?.usedTokens,
      window: props.contextState?.usage?.windowTokens,
      compactionId: props.contextState?.compaction?.id,
      compactionStatus: props.contextState?.compaction?.status,
      revision: props.contextCategoryRevision,
      status: props.agentStatus.providers?.find((provider) => provider.id === "claude")?.state,
    }),
    (target, previous) => {
      if (previous && (target.updatedAt !== previous.updatedAt || target.status !== previous.status))
        reader.select(null);
      reader.select(
        target.captured &&
          target.provider === "claude" &&
          target.agentId &&
          target.threadId &&
          target.compactionStatus !== "running"
          ? {
              agentId: target.agentId,
              threadId: target.threadId,
              serverId: target.serverId ?? "local",
              model: target.model,
            }
          : null,
      );
    },
  );
  onCleanup(() => reader.dispose());
  return { usage, refresh: () => void reader.refresh() };
}
