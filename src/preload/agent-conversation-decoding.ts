import type {
  AgentConversationEvent,
  AgentConversationList,
  AgentConversationQueue,
  AgentConversationRead,
  AgentConversationTarget,
} from "@openbot/contracts/ipc-agent-conversations";
import { AGENT_CONVERSATION_LIMITS, isAgentConversationIdentifier } from "@openbot/contracts/ipc-agent-conversations";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { decodeScopedAgentEvent } from "./agent-event-decoding";
import { decodeConversationPageFromMain, decodeQueue } from "./conversation-decoding";

/**
 * Added agent conversations are local desktop DTOs. They have no Team route or Host wire shape.
 * These decoders therefore name the local boundary explicitly and have no remote decoder twin.
 * Shared nested page and event types retain their existing main-process validation.
 */
function bounded(value: unknown): void {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > AGENT_CONVERSATION_LIMITS.replyBytes)
    throw new Error("Conversation reply is too large.");
}
export function decodeLocalAgentConversationTarget(value: unknown): AgentConversationTarget {
  if (
    !isDynamicRecord(value) ||
    !isAgentConversationIdentifier(value.agentId) ||
    !isAgentConversationIdentifier(value.threadId)
  )
    throw new Error("Invalid conversation destination.");
  return { agentId: value.agentId, threadId: value.threadId };
}
export function decodeLocalAgentConversationList(value: unknown): AgentConversationList {
  bounded(value);
  if (
    !isDynamicRecord(value) ||
    !Array.isArray(value.conversations) ||
    value.conversations.length > AGENT_CONVERSATION_LIMITS.rows ||
    (value.cursor !== null && !isAgentConversationIdentifier(value.cursor))
  )
    throw new Error("Invalid conversation list.");
  const ids = new Set<string>();
  const conversations = value.conversations.map((row: unknown) => {
    const scope = decodeLocalAgentConversationTarget(row);
    if (
      !isDynamicRecord(row) ||
      typeof row.main !== "boolean" ||
      (row.label === null
        ? !row.main
        : typeof row.label !== "string" ||
          row.label.length < 1 ||
          row.label.length > AGENT_CONVERSATION_LIMITS.label) ||
      (row.main && row.archivedAt !== null) ||
      (row.archivedAt !== null && (typeof row.archivedAt !== "string" || row.archivedAt.length > 64)) ||
      typeof row.updatedAt !== "string" ||
      row.updatedAt.length > 64 ||
      (row.activeTurnId !== null && !isAgentConversationIdentifier(row.activeTurnId)) ||
      typeof row.queuedCount !== "number" ||
      !Number.isSafeInteger(row.queuedCount) ||
      row.queuedCount < 0 ||
      row.queuedCount > Number.MAX_SAFE_INTEGER ||
      typeof row.requiresInput !== "boolean" ||
      ids.has(scope.threadId)
    )
      throw new Error("Invalid conversation summary.");
    ids.add(scope.threadId);
    return {
      ...scope,
      main: row.main,
      label: typeof row.label === "string" ? row.label : null,
      archivedAt: typeof row.archivedAt === "string" ? row.archivedAt : null,
      updatedAt: row.updatedAt,
      activeTurnId: typeof row.activeTurnId === "string" ? row.activeTurnId : null,
      queuedCount: row.queuedCount,
      requiresInput: row.requiresInput,
    };
  });
  return { conversations, cursor: value.cursor };
}
export function decodeLocalAgentConversationEvent(value: unknown): AgentConversationEvent {
  bounded(value);
  if (!isDynamicRecord(value) || !isAgentConversationIdentifier(value.agentId))
    throw new Error("Invalid conversation event.");
  if (value.type === "list-changed") return { type: "list-changed", agentId: value.agentId };
  const scope = decodeLocalAgentConversationTarget(value);
  if (value.type !== "conversation-event") throw new Error("Invalid scoped conversation event.");
  const event = decodeScopedAgentEvent({ serverId: "local", event: value.event }).event;
  const eventAgentId =
    event.type === "conversation"
      ? event.snapshot.agentId
      : event.type === "conversation-page"
        ? event.page.agentId
        : event.type === "queue-changed"
          ? event.snapshot.agentId
          : event.type === "approval"
            ? event.approval.agentId
            : event.type === "browser-takeover-requested"
              ? event.request.agentId
              : "agentId" in event
                ? event.agentId
                : null;
  const threadId =
    event.type === "conversation"
      ? event.snapshot.threadId
      : event.type === "conversation-page"
        ? event.page.threadId
        : event.type === "approval"
          ? event.approval.threadId
          : event.type === "browser-takeover-requested"
            ? event.request.threadId
            : "threadId" in event
              ? event.threadId
              : scope.threadId;
  if (eventAgentId !== scope.agentId || threadId !== scope.threadId)
    throw new Error("Conversation event owner mismatch.");
  return { type: "conversation-event", ...scope, event };
}

export function decodeLocalAgentConversationRead(value: unknown): AgentConversationRead {
  bounded(value);
  if (!isDynamicRecord(value) || !Array.isArray(value.attention) || value.attention.length > 32)
    throw new Error("Invalid conversation state.");
  const page = decodeConversationPageFromMain(value.page);
  const summaries = decodeLocalAgentConversationList({ conversations: [value.summary], cursor: null });
  const summary = summaries.conversations[0];
  if (!summary || summary.agentId !== page.agentId || summary.threadId !== page.threadId)
    throw new Error("Conversation summary owner mismatch.");
  if (
    page.messages.length > 100 ||
    Object.keys(page.references).length > 100 ||
    !isAgentConversationIdentifier(page.threadId) ||
    !isAgentConversationIdentifier(page.agentId)
  )
    throw new Error("Invalid conversation page bounds.");
  const queue = decodeQueue(value.queue);
  if (queue.agentId !== page.agentId || queue.deliveries.length > 1024)
    throw new Error("Invalid conversation queue bounds.");
  const attention = value.attention.map((event: unknown) => {
    const decoded = decodeLocalAgentConversationEvent({
      type: "conversation-event",
      agentId: page.agentId,
      threadId: page.threadId,
      event,
    });
    if (
      decoded.type !== "conversation-event" ||
      !["prompt", "approval", "browser-takeover-requested"].includes(decoded.event.type)
    )
      throw new Error("Invalid conversation attention.");
    return decoded.event;
  });
  return { summary, page, queue, attention };
}

export function decodeLocalAgentConversationQueue(value: unknown): AgentConversationQueue {
  bounded(value);
  const scope = decodeLocalAgentConversationTarget(value);
  if (!isDynamicRecord(value)) throw new Error("Invalid conversation queue.");
  const snapshot = decodeQueue(value.snapshot);
  if (snapshot.agentId !== scope.agentId || snapshot.deliveries.length > 1024)
    throw new Error("Invalid conversation queue owner or bounds.");
  return { ...scope, snapshot };
}
