import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { parseBrowserSecretResponse } from "@openbot/contracts/ipc";
import type {
  AgentConversationActionInput,
  AgentConversationListInput,
  CreateAgentConversationInput,
  ReadAgentConversationInput,
  SearchAgentConversationInput,
  SendAgentConversationInput,
  UpdateAgentConversationInput,
} from "@openbot/contracts/ipc-agent-conversations";
import { AGENT_CONVERSATION_LIMITS, isAgentConversationIdentifier } from "@openbot/contracts/ipc-agent-conversations";
import { decodeQueueEditRequest } from "@openbot/contracts/team-protocol/queue-edit-v1";
import {
  parseApprovalResponse,
  parseBrowserTakeoverResponse,
  parseMessageReaction,
  parsePromptResponse,
  parseReadConversationPage,
  parseReorderQueue,
  parseSearchConversationMessages,
  parseSendMessage,
} from "./agent-inputs";
import { isObject, requireString } from "./validation";

function object(value: unknown) {
  if (!isObject(value) || Buffer.byteLength(JSON.stringify(value), "utf8") > AGENT_CONVERSATION_LIMITS.inputBytes)
    throw new Error("Invalid local conversation request.");
  return value;
}
function identifier(value: unknown, field: string): string {
  const parsed = requireString(value, field, INPUT_LIMITS.identifier);
  if (!isAgentConversationIdentifier(parsed)) throw new Error(`${field} is invalid.`);
  return parsed;
}
function target(value: unknown) {
  const input = object(value);
  return {
    agentId: identifier(input.agentId, "agentId"),
    threadId: identifier(input.threadId, "threadId"),
  };
}
function label(value: unknown): string {
  const text = requireString(value, "label", AGENT_CONVERSATION_LIMITS.label).trim();
  if (!text || text.includes("\0")) throw new Error("Invalid conversation label.");
  return text;
}
export function parseConversationList(value: unknown): AgentConversationListInput {
  const input = object(value);
  if (input.archived !== undefined && typeof input.archived !== "boolean") throw new Error("Invalid archive filter.");
  return {
    agentId: identifier(input.agentId, "agentId"),
    ...(input.query === undefined
      ? {}
      : {
          query:
            typeof input.query === "string" && input.query.length <= AGENT_CONVERSATION_LIMITS.query
              ? input.query
              : (() => {
                  throw new Error("Invalid conversation filter.");
                })(),
        }),
    ...(input.cursor === undefined ? {} : { cursor: identifier(input.cursor, "cursor") }),
    ...(input.archived === undefined ? {} : { archived: input.archived }),
  };
}
export function parseConversationCreate(value: unknown): CreateAgentConversationInput {
  const input = object(value);
  return { agentId: identifier(input.agentId, "agentId"), label: label(input.label) };
}
export function parseConversationUpdate(value: unknown): UpdateAgentConversationInput {
  const input = object(value);
  if (input.label !== undefined && input.archived === undefined) return { ...target(input), label: label(input.label) };
  if (typeof input.archived === "boolean" && input.label === undefined)
    return { ...target(input), archived: input.archived };
  throw new Error("Invalid conversation change.");
}
export function parseConversationRead(value: unknown): ReadAgentConversationInput {
  return { ...parseReadConversationPage(object(value)), ...target(value) };
}
export function parseConversationSearch(value: unknown): SearchAgentConversationInput {
  return { ...parseSearchConversationMessages(object(value)), ...target(value) };
}
export function parseConversationSend(value: unknown): SendAgentConversationInput {
  return { ...parseSendMessage(object(value)), ...target(value) };
}
export function parseConversationAction(value: unknown): AgentConversationActionInput {
  const input = object(value);
  const scope = target(input);
  switch (input.action) {
    case "stop":
      return { ...scope, action: "stop", turnId: identifier(input.turnId, "turnId") };
    case "cancel":
      return {
        ...scope,
        action: "cancel",
        deliveryId: identifier(input.deliveryId, "deliveryId"),
      };
    case "steer":
      return {
        ...scope,
        action: "steer",
        deliveryId: identifier(input.deliveryId, "deliveryId"),
        expectedTurnId: identifier(input.expectedTurnId, "turnId"),
      };
    case "reorder":
      return { ...scope, action: "reorder", deliveryIds: parseReorderQueue(input).deliveryIds };
    case "edit":
      return { ...scope, action: "edit", edit: decodeQueueEditRequest(input.edit) };
    case "reaction":
      return { ...scope, action: "reaction", ...parseMessageReaction(input) };
    case "secret":
      return {
        ...scope,
        action: "secret",
        turnId: identifier(input.turnId, "turnId"),
        ...parseBrowserSecretResponse(input),
      };
    case "mark-read":
      return {
        ...scope,
        action: "mark-read",
        throughMessageId: input.throughMessageId === null ? null : identifier(input.throughMessageId, "messageId"),
      };
    case "prompt":
      return {
        ...scope,
        action: "prompt",
        turnId: identifier(input.turnId, "turnId"),
        ...parsePromptResponse(input),
      };
    case "approval":
      return {
        ...scope,
        action: "approval",
        turnId: identifier(input.turnId, "turnId"),
        ...parseApprovalResponse(input),
      };
    case "takeover":
      return {
        ...scope,
        action: "takeover",
        turnId: identifier(input.turnId, "turnId"),
        ...parseBrowserTakeoverResponse(input),
      };
    default:
      throw new Error("Invalid conversation action.");
  }
}
