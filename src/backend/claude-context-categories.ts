import {
  CONTEXT_CATEGORY_LIMIT,
  type ContextCategoryEstimate,
  type ContextCategoryLabel,
  type ContextCategoryUsage,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isOneOf } from "@openbot/contracts/runtime-values";

/** Exact public category names only. A different name gets a generic label and never leaves the adapter. */
const LABELS: ReadonlyMap<string, ContextCategoryLabel> = new Map([
  ["System prompt", "system-prompt"],
  ["System tools", "system-tools"],
  ["MCP tools", "mcp-tools"],
  ["MCP tools (deferred)", "mcp-tools"],
  ["Memory files", "memory"],
  ["Messages", "messages"],
  ["Custom agents", "agents"],
  ["Agents", "agents"],
  ["Skills", "skills"],
  ["Free space", "free"],
  ["Autocompact buffer", "buffer"],
  ["Compaction buffer", "buffer"],
]);

function tokens(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Reads category rows only. Drilldown arrays, colors and provider text are not retained or logged. */
export function claudeContextCategories(
  value: unknown,
  source: ContextCategoryUsage["source"],
): ContextCategoryUsage | null {
  if (!isDynamicRecord(value)) return null;
  const usedTokens = source === "native" ? value.total_tokens : value.totalTokens;
  const windowTokens = source === "native" ? value.raw_max_tokens : value.rawMaxTokens;
  if (
    typeof usedTokens !== "number" ||
    !Number.isFinite(usedTokens) ||
    usedTokens < 0 ||
    typeof windowTokens !== "number" ||
    !Number.isFinite(windowTokens) ||
    windowTokens <= 0
  )
    return null;
  const totalOnly: ContextCategoryUsage = { source, usedTokens, windowTokens, categories: null, truncated: false };
  if (!Array.isArray(value.categories)) return totalOnly;
  const categories: ContextCategoryEstimate[] = [];
  // The input array can be large. Read at most the public row limit and use length only for truncation.
  for (const row of value.categories.slice(0, CONTEXT_CATEGORY_LIMIT)) {
    if (!isDynamicRecord(row) || !tokens(row.tokens) || typeof row.name !== "string") return totalOnly;
    const label = row.name.length <= 64 ? (LABELS.get(row.name) ?? "other") : "other";
    if (source === "native") {
      if (!isOneOf(["used", "free", "buffer", "deferred"] as const, row.kind)) return totalOnly;
      categories.push({ label, tokens: row.tokens, kind: row.kind, isDeferred: null });
    } else {
      if (row.isDeferred !== undefined && typeof row.isDeferred !== "boolean") return totalOnly;
      categories.push({ label, tokens: row.tokens, kind: null, isDeferred: row.isDeferred ?? null });
    }
  }
  return { source, usedTokens, windowTokens, categories, truncated: value.categories.length > CONTEXT_CATEGORY_LIMIT };
}
