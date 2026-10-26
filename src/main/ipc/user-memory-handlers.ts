// The user memories: what every agent of this computer knows about the user. Local only: no Team API
// carries them, so no handler here routes to a remote server.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentMemorySelectionChange,
  SetUserMemoryInclusionInput,
  UpdateUserMemoryInput,
} from "@openbot/contracts/ipc";
import type { AgentService } from "../../backend/agent-service";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { isObject, requireString, stringPayload } from "./validation";

interface UserMemoryIpcDependencies {
  service: AgentService;
}

export function userMemoryIpcHandlers({ service }: UserMemoryIpcDependencies): Pick<IpcGroupHandlers, "userMemories"> {
  return {
    userMemories: {
      list: handler(() => service.listUserMemories()),
      getSelection: handler(() => service.getUserMemorySelection()),
      setInclusion: payloadHandler(parseSetUserMemoryInclusion, (input) => service.setUserMemoryInclusion(input)),
      create: payloadHandler(stringPayload("text", INPUT_LIMITS.agentMemoryText), (text) =>
        service.createUserMemory(text),
      ),
      update: payloadHandler(parseUpdateUserMemory, (input) => service.updateUserMemory(input)),
      delete: payloadHandler(stringPayload("memoryId"), (memoryId) => service.deleteUserMemory(memoryId)),
      clear: handler(() => service.clearUserMemories()),
    },
  };
}

export function parseUpdateUserMemory(value: unknown): UpdateUserMemoryInput {
  if (!isObject(value)) throw new Error("Invalid memory update request.");
  return {
    memoryId: requireString(value.memoryId, "memoryId", INPUT_LIMITS.identifier),
    text: requireString(value.text, "text", INPUT_LIMITS.agentMemoryText),
  };
}

export function parseSetUserMemoryInclusion(value: unknown): SetUserMemoryInclusionInput {
  if (!isObject(value) || !Array.isArray(value.changes) || value.changes.length === 0 || value.changes.length > 25)
    throw new Error("Invalid memory inclusion request.");
  const changes = value.changes.map((change): AgentMemorySelectionChange => {
    if (
      !isObject(change) ||
      (change.inclusion !== "essential" && change.inclusion !== "searchable" && change.inclusion !== "automatic") ||
      typeof change.expectedRevision !== "number" ||
      !Number.isSafeInteger(change.expectedRevision) ||
      change.expectedRevision < 0
    )
      throw new Error("Invalid memory inclusion change.");
    return {
      memoryId: requireString(change.memoryId, "memoryId", INPUT_LIMITS.identifier),
      inclusion: change.inclusion,
      expectedRevision: change.expectedRevision,
    };
  });
  if (new Set(changes.map((change) => change.memoryId)).size !== changes.length)
    throw new Error("Duplicate memory inclusion change.");
  return { changes };
}
