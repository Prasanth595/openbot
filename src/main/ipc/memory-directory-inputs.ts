import type {
  GetAgentMemoryDirectoryInput,
  SetAgentMemoryDirectoryInput,
} from "@openbot/contracts/agent-memory-directory";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { parseMemoryDirectoryAnnotation } from "../../backend/agent-memory-directory";
import { isObject, requireString } from "./validation";

export function parseGetAgentMemoryDirectory(value: unknown): GetAgentMemoryDirectoryInput {
  if (!isObject(value)) throw new Error("Invalid memory directory request.");
  return {
    agentId: requireString(value.agentId, "agentId", INPUT_LIMITS.identifier),
    memoryId: requireString(value.memoryId, "memoryId", INPUT_LIMITS.identifier),
  };
}

export function parseSetAgentMemoryDirectory(value: unknown): SetAgentMemoryDirectoryInput {
  const owner = parseGetAgentMemoryDirectory(value);
  if (
    !isObject(value) ||
    typeof value.expectedMemoryRevision !== "number" ||
    !Number.isSafeInteger(value.expectedMemoryRevision) ||
    value.expectedMemoryRevision < 0 ||
    (value.expectedAnnotationRevision !== null &&
      (typeof value.expectedAnnotationRevision !== "number" ||
        !Number.isSafeInteger(value.expectedAnnotationRevision) ||
        value.expectedAnnotationRevision < 0))
  )
    throw new Error("Invalid memory directory revisions.");
  return {
    ...owner,
    ...parseMemoryDirectoryAnnotation(value),
    expectedMemoryRevision: value.expectedMemoryRevision,
    expectedAnnotationRevision: value.expectedAnnotationRevision,
  };
}
