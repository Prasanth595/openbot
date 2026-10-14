import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import type { PendingApproval } from "@/features/workspace/model/pending-approvals";

/**
 * The notification categories of an approval. `NotificationService.swift` sets the first when the
 * text shows all that Approve allows, and the second for every other approval.
 */
export const APPROVAL_CATEGORY = "openbot.approval";
export const APPROVAL_DENY_CATEGORY = "openbot.approval.deny";
export const APPROVE_ACTION = "approve";
export const DENY_ACTION = "deny";

/** A button of an approval notification, which the app answers in the background. */
export interface NotificationApprovalAnswer {
  /** The notification. iOS can give the app the same response again. */
  responseId: string;
  serverId: string;
  agentId: string;
  threadId: string | null;
  requestId: string | number;
  turnId: string;
  decision: "accept" | "decline";
  /** The agent name, which the notification shows as its title. */
  title: string;
}

/** The answer of a notification button, or `null` for a tap or a notification of another kind. */
export function notificationApprovalAnswer(
  responseId: string,
  actionIdentifier: string,
  categoryIdentifier: string | null,
  data: unknown,
  title: string,
): NotificationApprovalAnswer | null {
  // The category decides which buttons iOS showed, so Approve counts only where the text showed it all.
  const decision =
    actionIdentifier === APPROVE_ACTION && categoryIdentifier === APPROVAL_CATEGORY
      ? "accept"
      : actionIdentifier === DENY_ACTION &&
          (categoryIdentifier === APPROVAL_CATEGORY || categoryIdentifier === APPROVAL_DENY_CATEGORY)
        ? "decline"
        : null;
  if (!decision || !isDynamicRecord(data) || !isDynamicRecord(data.approval)) return null;
  const { serverId, agentId, threadId } = data;
  const { requestId, turnId } = data.approval;
  if (!isString(serverId) || !serverId || !isString(agentId) || !agentId || !isString(turnId) || !turnId) return null;
  if (threadId !== null && !isString(threadId)) return null;
  if (!isString(requestId) && !(typeof requestId === "number" && Number.isFinite(requestId))) return null;
  return { responseId, serverId, agentId, threadId, requestId, turnId, decision, title };
}

/**
 * True when the host waits on the request of the notification. A provider can count its request IDs
 * from the start again after the host restarts, so the agent, the chat and the turn must match too.
 */
export function answersApproval(approval: PendingApproval, answer: NotificationApprovalAnswer): boolean {
  return (
    String(approval.requestId) === String(answer.requestId) &&
    approval.agentId === answer.agentId &&
    approval.turnId === answer.turnId &&
    (answer.threadId === null || approval.threadId === answer.threadId)
  );
}
