import { chatTagReferences } from "@openbot/contracts/chat-tag-references";
import type { AgentTask } from "@openbot/contracts/ipc";
import { isAgentTaskOpen } from "@openbot/ui/features/conversation/AgentTasks";

/** The closed tasks that the Tasks page shows before "Show all". */
export const TASKS_CLOSED_SHOWN = 2;

export type TasksSectionId = "needsYou" | "working" | "waiting" | "closed";

export interface TasksSection {
  id: TasksSectionId;
  /** The shown tasks. */
  tasks: AgentTask[];
  /** All tasks of the section, also the closed tasks that "Show all" hides. */
  count: number;
}

/** A task the user must look at: its last turn ended, as an answer, a failure or a stop. */
export const taskNeedsYou = (task: AgentTask) => task.state === "idle" && task.outcome !== null;

const taskWaits = (task: AgentTask) => task.state === "queued" || (task.state === "idle" && task.outcome === null);

const newestFirst = (a: AgentTask, b: AgentTask) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt);

/** The tasks by what they need: needs you, working, waiting, then the newest closed tasks. */
export function taskSections(tasks: readonly AgentTask[], showAllClosed: boolean): TasksSection[] {
  const open = tasks.filter(isAgentTaskOpen).sort(newestFirst);
  const closed = tasks
    .filter((task) => !isAgentTaskOpen(task))
    .sort((a, b) => Date.parse(b.closedAt ?? b.updatedAt) - Date.parse(a.closedAt ?? a.updatedAt));
  const section = (id: TasksSectionId, shown: AgentTask[], count = shown.length): TasksSection => ({
    id,
    tasks: shown,
    count,
  });
  return [
    section("needsYou", open.filter(taskNeedsYou)),
    section(
      "working",
      open.filter((task) => task.state === "running"),
    ),
    section("waiting", open.filter(taskWaits)),
    section("closed", showAllClosed ? closed : closed.slice(0, TASKS_CLOSED_SHOWN), closed.length),
  ];
}

/** The color of a task's state on the page. */
export function taskTone(task: AgentTask): "working" | "danger" | "attention" | undefined {
  if (task.state === "running") return "working";
  if (task.state === "idle" && (task.outcome === "failed" || task.outcome === "interrupted")) return "danger";
  return taskNeedsYou(task) ? "attention" : undefined;
}

/**
 * The text of a task as its title shows it: no agent mention at the start, and the plain name of each
 * other tag. Empty when the text has nothing to do.
 */
export function plainTaskTitle(text: string): string {
  let title = "";
  let cursor = 0;
  for (const tag of chatTagReferences(text)) {
    title += text.slice(cursor, tag.start);
    if (tag.kind !== "agent" || title.trim()) title += tag.name;
    cursor = tag.end;
  }
  return (title + text.slice(cursor))
    .replace(/^[\s,:]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}
