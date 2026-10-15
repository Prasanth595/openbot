import { INPUT_LIMITS } from "./input-limits";
import { isDynamicRecord, isOneOf } from "./runtime-values";

/** A current desktop read. Provider labels, paths, tool names and payloads never cross this boundary. */
export const CONTEXT_CATEGORY_LIMIT = 32;
export const CONTEXT_CATEGORY_BYTES_LIMIT = 8 * 1024;
export const CONTEXT_CATEGORY_LABELS = [
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
] as const;
export type ContextCategoryLabel = (typeof CONTEXT_CATEGORY_LABELS)[number];
export type ContextCategoryKind = "used" | "free" | "buffer" | "deferred";

export interface ContextCategoryEstimate {
  label: ContextCategoryLabel;
  tokens: number;
  /** Native stable kind only. Summary colors and names do not establish a kind. */
  kind: ContextCategoryKind | null;
  /** Summary metadata only. Native reports use kind instead. */
  isDeferred: boolean | null;
}

export interface ContextCategoryUsage {
  source: "native" | "summary";
  usedTokens: number;
  windowTokens: number;
  categories: ContextCategoryEstimate[] | null;
  truncated: boolean;
}

export interface ReadContextCategoriesInput {
  agentId: string;
  threadId: string;
}

export interface AgentContextCategoryUsage extends ContextCategoryUsage, ReadContextCategoriesInput {}

function identifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= INPUT_LIMITS.identifier;
}

export function isReadContextCategoriesInput(value: unknown): value is ReadContextCategoriesInput {
  return isDynamicRecord(value) && identifier(value.agentId) && identifier(value.threadId);
}

export function parseReadContextCategoriesInput(value: unknown): ReadContextCategoriesInput {
  if (!isReadContextCategoriesInput(value)) throw new Error("Invalid context categories request.");
  return { agentId: value.agentId, threadId: value.threadId };
}

function tokens(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function total(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isCategory(value: unknown, source: ContextCategoryUsage["source"]): value is ContextCategoryEstimate {
  if (!isDynamicRecord(value) || !isOneOf(CONTEXT_CATEGORY_LABELS, value.label) || !tokens(value.tokens)) return false;
  return source === "native"
    ? isOneOf(["used", "free", "buffer", "deferred"] as const, value.kind) && value.isDeferred === null
    : value.kind === null && (value.isDeferred === null || typeof value.isDeferred === "boolean");
}

export function isAgentContextCategoryUsage(value: unknown): value is AgentContextCategoryUsage {
  if (
    !isDynamicRecord(value) ||
    !isReadContextCategoriesInput(value) ||
    !isOneOf(["native", "summary"] as const, value.source)
  )
    return false;
  const source = value.source;
  return (
    total(value.usedTokens) &&
    total(value.windowTokens) &&
    value.windowTokens > 0 &&
    typeof value.truncated === "boolean" &&
    (value.categories === null
      ? !value.truncated
      : Array.isArray(value.categories) &&
        value.categories.length <= CONTEXT_CATEGORY_LIMIT &&
        value.categories.every((row) => isCategory(row, source)))
  );
}

/** Copy only the bounded public fields. Extra host fields cannot become renderer data. */
export function decodeContextCategoryUsage(value: unknown): AgentContextCategoryUsage | null {
  if (value === null) return null;
  if (!isAgentContextCategoryUsage(value)) throw new Error("Invalid context categories response.");
  return {
    agentId: value.agentId,
    threadId: value.threadId,
    source: value.source,
    usedTokens: value.usedTokens,
    windowTokens: value.windowTokens,
    truncated: value.truncated,
    categories:
      value.categories?.map((row) => ({
        label: row.label,
        tokens: row.tokens,
        kind: row.kind,
        isDeferred: row.isDeferred,
      })) ?? null,
  };
}
