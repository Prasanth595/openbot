// Frozen optional context-categories-v1: one visible agent's exact Main conversation.
// A read returns only the cached Claude total/window and safe category IDs. It starts no provider
// session or SDK request. Unsupported providers, unloaded sessions and stale targets return null.
// Labels and native kinds are separate: a name never establishes occupied-window arithmetic.
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  count,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
} from "./admin-wire";

export const CONTEXT_CATEGORIES_CAPABILITY = "context-categories-v1";
export const CONTEXT_CATEGORIES_ROUTE = "/v1/agent-context/categories";

const total: AdminDecoder = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("Invalid context total.");
  return value;
};
const window: AdminDecoder = (value) => {
  const result = total(value);
  if (result === 0) throw new Error("Invalid context window.");
  return result;
};
const category = fields({
  label: oneOf(
    "system-prompt",
    "system-tools",
    "mcp-tools",
    "memory",
    "messages",
    "agents",
    "skills",
    "free",
    "buffer",
    "other",
  ),
  tokens: count,
  kind: nullable(oneOf("used", "free", "buffer", "deferred")),
  isDeferred: nullable(boolean),
});
const result = nullable(
  fields({
    agentId: identifier,
    threadId: identifier,
    source: oneOf("native", "summary"),
    usedTokens: total,
    windowTokens: window,
    categories: nullable(list(category, 32)),
    truncated: boolean,
  }),
);
const response: AdminDecoder = (value) => {
  const decoded = result(value);
  if (decoded === null) return null;
  // Fields above produce a JSON record. These checks retain native and summary metadata meaning.
  if (typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("Invalid context categories.");
  if (decoded.categories === null && decoded.truncated) throw new Error("Invalid context category truncation.");
  if (Array.isArray(decoded.categories)) {
    for (const row of decoded.categories) {
      if (row === null || typeof row !== "object" || Array.isArray(row)) throw new Error("Invalid context category.");
      if (decoded.source === "native" ? row.kind === null || row.isDeferred !== null : row.kind !== null)
        throw new Error("Invalid context category kind.");
    }
  }
  if (new TextEncoder().encode(JSON.stringify(decoded)).length > 8192)
    throw new Error("Context categories are too large.");
  return decoded;
};

export const CONTEXT_CATEGORIES_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [CONTEXT_CATEGORIES_ROUTE, adminRoute(fields({ agentId: identifier, threadId: identifier }), response)],
]);
