// The desktop notification switches and the event main sends when the user clicks a notification.

export interface NotificationPreference {
  desktopNotifications: boolean;
  /** Show the start of the agent's reply, question or command instead of a fixed text. */
  messagePreview: boolean;
}

// The conversation a clicked notification was about. The renderer opens it.
export interface NotificationOpenedEvent {
  serverId: string;
  agentId: string;
  threadId: string | null;
}

/** Local display receipts contain no display text or account data. */
export const RECEIPT_PRESENTATIONS = ["toast", "banner", "confirmation_dialog", "native_error_box"] as const;
export const RECEIPT_OPERATIONS = [
  "turn",
  "provider",
  "attachment",
  "routine",
  "auth",
  "update",
  "agent",
  "queue",
  "browser",
  "settings",
  "team",
  "search",
  "marketplace",
  "memory",
  "voice",
  "maintenance",
  "other",
] as const;
export const RECEIPT_CAUSES = [
  "invalid_upload_request",
  "authentication",
  "permission",
  "rate_limit",
  "usage_limit",
  "billing",
  "network",
  "timeout",
  "storage",
  "not_found",
  "conflict",
  "provider_unavailable",
  "attachment_type_unsupported",
  "attachment_too_large",
  "attachment_upload_failed",
  "cancelled",
  "unknown",
] as const;
export interface ErrorReceiptInput {
  presentation: (typeof RECEIPT_PRESENTATIONS)[number];
  operation: (typeof RECEIPT_OPERATIONS)[number];
  cause: (typeof RECEIPT_CAUSES)[number];
}
export interface ErrorReceipt extends ErrorReceiptInput {
  id: string;
  cursor: string;
  timestamp: number;
}
export interface ErrorReceiptQuery {
  after?: string;
  limit?: number;
}
export interface ErrorReceiptBatch {
  records: ErrorReceipt[];
  cursor: string;
  gap: boolean;
  hasMore: boolean;
}
export const RECEIPT_ID_PATTERN = /^rcpt_[0-9a-f-]{36}$/u;
export const RECEIPT_CURSOR_PATTERN = /^[0-9a-f-]{36}:[0-9]{1,15}$/u;
