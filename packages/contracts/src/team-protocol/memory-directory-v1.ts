// Frozen optional memory-directory-v1 metadata routes. Facts and their released routes stay unchanged.
import {
  adminRoute,
  boolean,
  count,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const MEMORY_DIRECTORY_CAPABILITY = "memory-directory-v1";
export const MEMORY_DIRECTORY_METADATA_ROUTE = "/v1/agent-memory-directory/metadata";
export const MEMORY_DIRECTORY_SET_ROUTE = "/v1/agent-memory-directory/set";

const metadata = fields({
  memoryId: identifier,
  memoryRevision: count,
  directoryRevision: nullable(count),
  annotationRevision: nullable(count),
  title: string(96),
  titleKind: oneOf("explicit", "current-text-excerpt"),
  aliases: list(string(64), 4),
  actor: nullable(oneOf("user", "agent")),
  annotationUserControlled: boolean,
});

export const MEMORY_DIRECTORY_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    MEMORY_DIRECTORY_METADATA_ROUTE,
    adminRoute(fields({ agentId: identifier, memoryId: identifier }), nullable(metadata)),
  ],
  [
    MEMORY_DIRECTORY_SET_ROUTE,
    adminRoute(
      fields({
        agentId: identifier,
        memoryId: identifier,
        expectedMemoryRevision: count,
        expectedAnnotationRevision: nullable(count),
        title: nullable(string(96)),
        aliases: list(string(64), 4),
      }),
      metadata,
    ),
  ],
]);
