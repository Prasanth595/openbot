import {
  type AgentMemoryDirectoryMetadata,
  isAgentMemoryDirectoryMetadata,
} from "@openbot/contracts/agent-memory-directory";

export function decodeMemoryDirectoryMetadataFromMain(value: unknown): AgentMemoryDirectoryMetadata {
  if (!isAgentMemoryDirectoryMetadata(value)) throw new Error("Invalid memory directory metadata from main.");
  return {
    memoryId: value.memoryId,
    memoryRevision: value.memoryRevision,
    directoryRevision: value.directoryRevision,
    annotationRevision: value.annotationRevision,
    title: value.title,
    titleKind: value.titleKind,
    aliases: [...value.aliases],
    actor: value.actor,
    annotationUserControlled: value.annotationUserControlled,
  };
}

export function decodeOptionalMemoryDirectoryMetadataFromMain(value: unknown): AgentMemoryDirectoryMetadata | null {
  return value === null ? null : decodeMemoryDirectoryMetadataFromMain(value);
}
