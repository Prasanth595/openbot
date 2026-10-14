import {
  type AgentMemoryDirectoryMetadata,
  type GetAgentMemoryDirectoryInput,
  isAgentMemoryDirectoryMetadata,
  type SetAgentMemoryDirectoryInput,
} from "@openbot/contracts/agent-memory-directory";
import {
  MEMORY_DIRECTORY_METADATA_ROUTE,
  MEMORY_DIRECTORY_SET_ROUTE,
} from "@openbot/contracts/team-protocol/memory-directory-v1";
import { Effect } from "effect";
import type { AgentMemoriesRequest } from "./team-api-requests";

function metadata(value: unknown): AgentMemoryDirectoryMetadata {
  if (!isAgentMemoryDirectoryMetadata(value)) throw new Error("The host returned invalid memory directory metadata.");
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

export const readAgentMemoryDirectoryMetadata = Effect.fn("TeamClient.readAgentMemoryDirectoryMetadata")(function* <E>(
  request: AgentMemoriesRequest<E>,
  input: GetAgentMemoryDirectoryInput,
  supported: boolean,
  decodeMetadata: (value: unknown) => AgentMemoryDirectoryMetadata = metadata,
): Effect.fn.Return<AgentMemoryDirectoryMetadata | null, E> {
  if (!supported) return null;
  return yield* request(
    "POST",
    MEMORY_DIRECTORY_METADATA_ROUTE,
    (value) => {
      if (value === null) return null;
      const result = decodeMetadata(value);
      if (result.memoryId !== input.memoryId) throw new Error("The host returned metadata for a different memory.");
      return result;
    },
    { agentId: input.agentId, memoryId: input.memoryId },
  );
});

export const setAgentMemoryDirectoryMetadata = Effect.fn("TeamClient.setAgentMemoryDirectoryMetadata")(function* <E>(
  request: AgentMemoriesRequest<E>,
  input: SetAgentMemoryDirectoryInput,
  decodeMetadata: (value: unknown) => AgentMemoryDirectoryMetadata = metadata,
): Effect.fn.Return<AgentMemoryDirectoryMetadata, E> {
  return yield* request(
    "POST",
    MEMORY_DIRECTORY_SET_ROUTE,
    (value) => {
      const result = decodeMetadata(value);
      if (result.memoryId !== input.memoryId) throw new Error("The host returned metadata for a different memory.");
      return result;
    },
    {
      agentId: input.agentId,
      memoryId: input.memoryId,
      expectedMemoryRevision: input.expectedMemoryRevision,
      expectedAnnotationRevision: input.expectedAnnotationRevision,
      title: input.title,
      aliases: [...input.aliases],
    },
  );
});
