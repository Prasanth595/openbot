import {
  type AgentContextCategoryUsage,
  decodeContextCategoryUsage,
  type ReadContextCategoriesInput,
} from "@openbot/contracts/ipc";

/** Host-to-main boundary, separate from the preload decoder. */
export function decodeContextCategoriesFromHost(value: unknown): AgentContextCategoryUsage | null {
  return decodeContextCategoryUsage(value);
}

export function assertContextCategoryScope(value: AgentContextCategoryUsage | null, input: ReadContextCategoriesInput) {
  if (value && (value.agentId !== input.agentId || value.threadId !== input.threadId))
    throw new Error("Context categories do not match the requested conversation.");
  return value;
}
