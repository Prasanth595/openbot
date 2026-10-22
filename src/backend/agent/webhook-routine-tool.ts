import { type EventFilter, type EventRoutine, isEventFilter } from "@openbot/contracts/ipc-events";
import { type DynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { WEBHOOK_DELIVERY_BODY_BYTES_LIMIT } from "@openbot/contracts/signal-protocol/messages";
import {
  WEBHOOK_DELIVERY_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from "@openbot/contracts/signal-protocol/webhook-route";
import { RoutineInputError } from "@openbot/team-client/routine-schedule";
import type { Effect } from "effect";
import type { RoutineOperationFailed } from "./routine-scheduler";

export const CREATE_WEBHOOK_ROUTINE_TOOL = "create_webhook_routine";

export const CREATE_WEBHOOK_ROUTINE_ARGUMENTS = [
  "agentId",
  "name",
  "instruction",
  "eventType",
  "filters",
  "active",
  "timezone",
  "limitPolicy",
] as const;

/** What a sender must send, as `docs/webhooks.md` describes it. The agent passes it on to the user. */
const WEBHOOK_REQUEST_FORMAT = {
  method: "POST",
  contentType: "application/json",
  body: '{ "type": string, "occurredAt"?: ISO 8601 date-time, "data"?: any JSON value }',
  bodyLimitBytes: WEBHOOK_DELIVERY_BODY_BYTES_LIMIT,
  headers: {
    [WEBHOOK_TIMESTAMP_HEADER]: "Unix time in seconds. It must be within 5 minutes of the host clock.",
    [WEBHOOK_DELIVERY_ID_HEADER]:
      "A unique ID for each event: letters, digits, '.', '_', ':' or '-', up to 256 characters. A repeat of an ID is a duplicate.",
    [WEBHOOK_SIGNATURE_HEADER]:
      "sha256=<hex HMAC-SHA256 of '<timestamp>.<delivery ID>.<exact body bytes>', keyed with the signing secret>",
  },
  responses: { "202": "accepted", "200": "duplicate", "401": "bad signature or stale timestamp" },
};

/**
 * Makes a webhook routine through the main process, which owns the signing secret, the route limit
 * and the relay route. The secret never comes back here: the model must not see it.
 */
export interface WebhookRoutineCreator {
  create(input: {
    agentId: string;
    name: string;
    instruction: string;
    active: boolean;
    timezone: string;
    eventType: string | null;
    filters: EventFilter[];
    limitPolicy?: EventRoutine["limitPolicy"];
  }): Effect.Effect<EventRoutine, RoutineOperationFailed>;
}

/** The trigger fields of a tool call. The store checks the bounds again. */
export function webhookToolTrigger(args: DynamicRecord): { eventType: string | null; filters: EventFilter[] } {
  const { eventType = null, filters = [] } = args;
  if (eventType !== null && (!isString(eventType) || !eventType.trim())) {
    throw new RoutineInputError("eventType must be a non-empty string or null.");
  }
  if (!Array.isArray(filters) || !filters.every(isEventFilter)) {
    throw new RoutineInputError('filters must be a list of { "pointer": JSON Pointer, "value": scalar }.');
  }
  return { eventType, filters };
}

/**
 * The tool result. `cardInChat` is false when the routine belongs to another agent: its chat, not
 * this one, has the record, and that record has no card.
 */
export function webhookRoutineToolResult(routine: EventRoutine, cardInChat: boolean) {
  const trigger = routine.trigger.kind === "webhook" ? routine.trigger : null;
  return {
    routineId: routine.id,
    name: routine.name,
    active: routine.active,
    eventType: trigger?.eventType ?? null,
    filters: trigger?.filters ?? [],
    url: trigger?.url ?? null,
    ...(trigger?.url ? {} : { urlPending: "The URL is not ready. The routine settings show it when it is." }),
    request: WEBHOOK_REQUEST_FORMAT,
    secret: cardInChat
      ? "OpenBot shows the user a card in this chat with the URL and a button that shows the signing secret. Tell the user to copy the secret from there. You do not have it."
      : "Tell the user to open this routine in the agent's Routines settings to get the signing secret. You do not have it.",
  };
}
