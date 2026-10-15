import { INPUT_LIMITS } from "./input-limits";
import type { AgentEvent } from "./ipc-agent-events";
import type { ConversationPageAnchor, SendMessageInput } from "./ipc-conversations";
import type { QueueEditRequest } from "./team-protocol/queue-edit-v1";

/** Local desktop only. No Team capability or released codec carries these subjects. */
export interface AgentConversationTarget {
  agentId: string;
  threadId: string;
}
export interface AgentConversationSummary extends AgentConversationTarget {
  main: boolean;
  label: string | null;
  archivedAt: string | null;
  updatedAt: string;
  activeTurnId: string | null;
  queuedCount: number;
  requiresInput: boolean;
}
export interface AgentConversationListInput {
  agentId: string;
  query?: string;
  cursor?: string;
  archived?: boolean;
}
export interface AgentConversationList {
  conversations: AgentConversationSummary[];
  cursor: string | null;
}
export interface CreateAgentConversationInput {
  agentId: string;
  label: string;
}
export type UpdateAgentConversationInput = AgentConversationTarget & ({ label: string } | { archived: boolean });
export interface ReadAgentConversationInput extends AgentConversationTarget {
  anchor?: ConversationPageAnchor;
  limit?: number;
}
export interface AgentConversationQueue extends AgentConversationTarget {
  snapshot: import("./ipc-queue").QueueSnapshot;
}
export interface AgentConversationRead {
  summary: AgentConversationSummary;
  page: import("./ipc-conversations").ConversationPage;
  queue: import("./ipc-queue").QueueSnapshot;
  attention: AgentEvent[];
}
export interface SearchAgentConversationInput extends AgentConversationTarget {
  query: string;
  cursor?: string;
  limit?: number;
}
export type SendAgentConversationInput = SendMessageInput & { threadId: string };
export type AgentConversationActionInput = AgentConversationTarget &
  (
    | { action: "stop"; turnId: string }
    | { action: "cancel"; deliveryId: string }
    | { action: "steer"; deliveryId: string; expectedTurnId: string }
    | { action: "reorder"; deliveryIds: string[] }
    | { action: "edit"; edit: QueueEditRequest }
    | { action: "reaction"; messageId: string; emoji: import("./ipc-conversation-messages").MessageReaction | null }
    | ({ action: "secret"; turnId: string } & import("./ipc-browser-secret").RespondToBrowserSecretInput)
    | { action: "mark-read"; throughMessageId: string | null }
    | { action: "prompt"; turnId: string; requestId: string | number; answers: Record<string, string[]> }
    | { action: "approval"; turnId: string; requestId: string | number; decision: "accept" | "decline" }
    | { action: "takeover"; turnId: string; requestId: string | number; decision: "complete" | "cancel" }
  );
export type AgentConversationEvent =
  | { type: "list-changed"; agentId: string }
  | { type: "conversation-event"; agentId: string; threadId: string; event: AgentEvent };
export const AGENT_CONVERSATION_LIMITS = {
  label: 160,
  query: 160,
  rows: 51,
  inputBytes: 192 * 1024,
  replyBytes: 8 * 1024 * 1024,
} as const;

/** The same bounded destination field at both sides of the local desktop boundary. */
export function isAgentConversationIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= INPUT_LIMITS.identifier && !value.includes("\0")
  );
}
