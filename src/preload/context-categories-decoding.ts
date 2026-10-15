import { type AgentContextCategoryUsage, decodeContextCategoryUsage } from "@openbot/contracts/ipc";

/** Main-to-renderer boundary. The decoder copies only safe fields. */
export function decodeContextCategoriesFromMain(value: unknown): AgentContextCategoryUsage | null {
  return decodeContextCategoryUsage(value);
}
