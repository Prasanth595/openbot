import { z } from "zod";

const TASK_AGENT_STORAGE_KEY = "openbot:task-agent:v1";

type TaskAgentStorage = Pick<Storage, "getItem" | "setItem">;

const selectionSchema = z.record(z.string().min(1), z.string().min(1).nullable().catch(null));

/** The agent last chosen on the Tasks page of each server, kept apart from the chat agent selection. */
export function readTaskAgentSelection(storage?: TaskAgentStorage): Record<string, string> {
  try {
    const value = (storage ?? window.localStorage).getItem(TASK_AGENT_STORAGE_KEY);
    const parsed = selectionSchema.safeParse(JSON.parse(value ?? "{}"));
    if (!parsed.success) return {};
    return Object.fromEntries(
      Object.entries(parsed.data).flatMap(([serverId, agentId]) => (agentId ? [[serverId, agentId]] : [])),
    );
  } catch {
    return {};
  }
}

export function writeTaskAgentSelection(serverId: string, agentId: string, storage?: TaskAgentStorage): void {
  try {
    const target = storage ?? window.localStorage;
    const selections = readTaskAgentSelection(target);
    if (agentId) selections[serverId] = agentId;
    else delete selections[serverId];
    target.setItem(TASK_AGENT_STORAGE_KEY, JSON.stringify(selections));
  } catch {
    // A local display preference must not block a task start.
  }
}
