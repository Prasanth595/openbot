import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { isBoolean, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import type { ChatMessage } from "./chat-messages";
import type { ImageDimensions } from "./image-dimensions";

/** Where an outbox message goes. */
export type OutboxTarget = { kind: "agent"; serverId: string; agentId: string };

/**
 * `waiting` has not reached the host: the server is offline, or an earlier message of the chat
 * goes first. `sent` has a host receipt and stays until the chat draws the host's own row.
 */
type OutboxState = "waiting" | "sending" | "failed" | "sent";

/** A file of an outbox message. Its bytes are in a file of this phone, named `fileName`. */
export interface OutboxFile {
  /** Starts with `mobile-draft-attachment-`, so a preview reads the local file and never the host. */
  id: string;
  name: string;
  mimeType: string;
  size: number;
  fileName: string;
  dimensions?: ImageDimensions;
}

export interface OutboxMessage {
  clientMessageId: string;
  target: OutboxTarget;
  text: string;
  replyToMessageId: string | null;
  files: OutboxFile[];
  createdAt: string;
  /** When the first request that can store the message started. Null: the host never received it. */
  firstAttemptAt: string | null;
  /** Whether the host answers a repeat of that request with its first receipt and stores nothing. */
  repeatSafe: boolean;
  state: OutboxState;
  /** The host's id for a sent message. */
  messageId: string | null;
  /** Why the last attempt failed, in the reader's language. */
  error: string | null;
  /** The person stopped its upload. The chat puts it back in the composer. */
  returned: boolean;
}

/**
 * How long Retry of a message stays safe. The host answers a repeated `clientMessageId` for a day
 * after it stored the message; half of that leaves room for a clock that differs from the host's.
 */
export const OUTBOX_RETRY_WINDOW_MS = 12 * 60 * 60 * 1000;

/** The prefix of a pending row's id. The host never stored this id, so the row has no actions. */
const OUTBOX_ROW_PREFIX = "outbox:";

export function outboxRowId(message: Pick<OutboxMessage, "clientMessageId">): string {
  return `${OUTBOX_ROW_PREFIX}${message.clientMessageId}`;
}

/** The row a message draws in its chat until the host's own row replaces it. */
export function outboxChatMessage(
  message: OutboxMessage,
  previewUri: (file: OutboxFile) => string | null,
): Extract<ChatMessage, { kind: "message" }> {
  return {
    id: outboxRowId(message),
    kind: "message",
    author: "user",
    body: message.text,
    streaming: false,
    replyToMessageId: message.replyToMessageId,
    attachments: message.files.map((file) => {
      const image = file.mimeType.startsWith("image/");
      return {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size,
        kind: image ? "image" : "file",
        previewKind: "none",
        previewUrl: image ? previewUri(file) : null,
      };
    }),
  };
}

/** One chat's key. The order of messages with the same key is their send order. */
export function outboxChatKey(target: { kind: "agent"; serverId: string; id: string }): string {
  return `${target.kind}:${target.serverId}:${target.id}`;
}

export function outboxTargetKey(target: OutboxTarget): string {
  return outboxChatKey({ kind: target.kind, serverId: target.serverId, id: target.agentId });
}

/** Whether a send of this message cannot store it twice. */
export function outboxRetrySafe(message: OutboxMessage, now: number): boolean {
  if (message.firstAttemptAt === null) return true;
  if (!message.repeatSafe) return false;
  return now - Date.parse(message.firstAttemptAt) < OUTBOX_RETRY_WINDOW_MS;
}

/** The file this phone keeps. A message that the host may have stored is gone from it on load. */
export interface PersistedOutbox {
  version: 1;
  messages: OutboxMessage[];
}

/** The messages of a saved outbox that this phone can read, and whether it dropped any. */
export interface DecodedOutbox {
  messages: OutboxMessage[];
  dropped: boolean;
}

export function decodePersistedOutbox(value: unknown): DecodedOutbox {
  if (!isDynamicRecord(value) || value.version !== 1 || !Array.isArray(value.messages))
    return { messages: [], dropped: true };
  const messages = value.messages.flatMap((item) => {
    const message = decodeOutboxMessage(item);
    return message ? [message] : [];
  });
  return { messages, dropped: messages.length !== value.messages.length };
}

function isOutboxState(value: unknown): value is OutboxState {
  return value === "waiting" || value === "sending" || value === "failed" || value === "sent";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isTimestamp(value: unknown): value is string {
  return isString(value) && Number.isFinite(Date.parse(value));
}

/** A message that an older app version saved for a channel is not readable, so the list is kept aside. */
function decodeTarget(value: unknown): OutboxTarget | null {
  if (!isDynamicRecord(value) || !isString(value.serverId) || !value.serverId) return null;
  if (value.kind === "agent" && isString(value.agentId) && value.agentId)
    return { kind: "agent", serverId: value.serverId, agentId: value.agentId };
  return null;
}

function decodeDimensions(value: unknown): ImageDimensions | undefined | null {
  if (value === undefined) return undefined;
  if (
    !isDynamicRecord(value) ||
    typeof value.width !== "number" ||
    typeof value.height !== "number" ||
    !(value.width > 0) ||
    !(value.height > 0)
  )
    return null;
  return { width: value.width, height: value.height };
}

function decodeFile(value: unknown): OutboxFile | null {
  if (
    !isDynamicRecord(value) ||
    !isString(value.id) ||
    !value.id.startsWith("mobile-draft-attachment-") ||
    !isString(value.name) ||
    !isString(value.mimeType) ||
    typeof value.size !== "number" ||
    !Number.isFinite(value.size) ||
    value.size < 0 ||
    !isString(value.fileName) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/u.test(value.fileName) ||
    value.fileName.includes("..")
  )
    return null;
  const dimensions = decodeDimensions(value.dimensions);
  if (dimensions === null) return null;
  return {
    id: value.id,
    name: value.name,
    mimeType: value.mimeType,
    size: value.size,
    fileName: value.fileName,
    ...(dimensions ? { dimensions } : {}),
  };
}

function decodeOutboxMessage(value: unknown): OutboxMessage | null {
  if (
    !isDynamicRecord(value) ||
    !isString(value.clientMessageId) ||
    !/^[a-zA-Z0-9_-]{1,128}$/u.test(value.clientMessageId) ||
    !isString(value.text) ||
    !isNullableString(value.replyToMessageId) ||
    !Array.isArray(value.files) ||
    value.files.length > INPUT_LIMITS.attachments ||
    !isTimestamp(value.createdAt) ||
    !(value.firstAttemptAt === null || isTimestamp(value.firstAttemptAt)) ||
    !isBoolean(value.repeatSafe) ||
    !isOutboxState(value.state) ||
    !isNullableString(value.messageId) ||
    !isNullableString(value.error) ||
    !isBoolean(value.returned)
  )
    return null;
  const target = decodeTarget(value.target);
  const files = value.files.map(decodeFile);
  if (!target || files.some((file) => file === null)) return null;
  return {
    clientMessageId: value.clientMessageId,
    target,
    text: value.text,
    replyToMessageId: value.replyToMessageId,
    files: files.filter((file) => file !== null),
    createdAt: value.createdAt,
    firstAttemptAt: value.firstAttemptAt,
    repeatSafe: value.repeatSafe,
    state: value.state,
    messageId: value.messageId,
    error: value.error,
    returned: value.returned,
  };
}
