import type { AgentMessage } from "@openbot/ui/data";
import type { AgentStep } from "@openbot/ui/features/conversation/AgentSteps";
import { silentAgentAnswer } from "@openbot/ui/features/conversation/new-message-tally";
import { createMemo } from "solid-js";
import type { TurnStepLines } from "./turn-step-lines";

const NO_STEPS: AgentStep[] = [];

function sameSteps(left: readonly AgentStep[], right: readonly AgentStep[]): boolean {
  return (
    left.length === right.length &&
    left.every((step, index) => {
      const other = right[index];
      if (other?.id !== step.id || other.kind !== step.kind) return false;
      if (step.kind === "memory" && other.kind === "memory" && other.change.action !== step.change.action) return false;
      return stepText(other) === stepText(step);
    })
  );
}

function stepText(step: AgentStep): string {
  return step.kind === "memory" ? step.change.text : step.text;
}

/** A message that the chat draws as the agent's answer, which the steps of its turn stand above. */
export function isTurnAnswer(message: AgentMessage): boolean {
  return message.author === "agent" && message.kind === "text" && !silentAgentAnswer(message);
}

/**
 * The steps of each turn of a chat: its thoughts, the host's progress lines and its memory changes.
 * The thoughts and the memory changes are stored messages; the progress lines are in memory only,
 * so after a restart a turn has only the first two.
 */
export function createTurnSteps(deps: {
  messages: () => readonly AgentMessage[];
  lines: () => TurnStepLines | undefined;
  activeTurnId: () => string | null | undefined;
}) {
  // A thought is ordered by when the host wrote it, and a progress line by when this window got it,
  // so a line shows between the thoughts it came between. A thought with no time (from a client
  // that does not send one) uses the time this window first saw it.
  const seenAt = new Map<string, number>();
  const lists = new Map<string, AgentStep[]>();
  const sources = createMemo(() => {
    const thinking = new Map<string, AgentMessage>();
    const memory = new Map<string, AgentMessage>();
    const answers = new Map<string, string>();
    for (const message of deps.messages()) {
      const turnId = message.turnId;
      if (!turnId) continue;
      if (message.kind === "thinking") thinking.set(turnId, message);
      else if (message.kind === "memory-changes") memory.set(turnId, message);
      else if (isTurnAnswer(message) && !answers.has(turnId)) answers.set(turnId, message.id);
    }
    // The caches keep only what the chat still holds, so another page or chat frees them.
    const thoughtIds = new Set([...thinking.values()].flatMap((message) => message.itemIds ?? []));
    for (const id of seenAt.keys()) if (!thoughtIds.has(id)) seenAt.delete(id);
    const lines = deps.lines() ?? {};
    for (const turnId of lists.keys())
      if (!thinking.has(turnId) && !memory.has(turnId) && !lines[turnId]) lists.delete(turnId);
    return { thinking, memory, answers };
  });

  function stepsOf(turnId: string | null | undefined): AgentStep[] {
    if (!turnId) return [];
    const { thinking, memory } = sources();
    const now = Date.now();
    const thoughts = thinking.get(turnId);
    const timed: Array<{ step: AgentStep; at: number }> = [];
    for (const [index, text] of (thoughts?.items ?? []).entries()) {
      if (!text.trim()) continue;
      const id = thoughts?.itemIds?.[index] ?? `${thoughts?.id}:${index}`;
      const written = Date.parse(thoughts?.itemCreatedAt?.[index] ?? "");
      const at = Number.isFinite(written) ? written : (seenAt.get(id) ?? now);
      seenAt.set(id, at);
      timed.push({ step: { id, kind: "thinking", text }, at });
    }
    for (const line of deps.lines()?.[turnId] ?? []) {
      timed.push({ step: { id: line.id, kind: "progress", text: line.text }, at: line.at });
    }
    // A stable sort keeps the thoughts in their order when they share a time.
    const steps = timed.sort((left, right) => left.at - right.at).map(({ step }) => step);
    const changes = memory.get(turnId);
    if (changes?.memoryChanges) {
      for (const [index, change] of changes.memoryChanges.entries())
        steps.push({ id: `${changes.id}:${index}`, kind: "memory", change });
    } else if (changes) {
      steps.push({ id: changes.id, kind: "memory-summary", text: changes.body });
    }
    // Each streamed word changes the messages. A turn whose steps did not change keeps its list, so
    // its row does not draw again.
    const previous = lists.get(turnId);
    if (previous && sameSteps(previous, steps)) return previous;
    lists.set(turnId, steps);
    return steps;
  }

  /** The finished turn whose steps show above this message: the first answer of the turn. */
  const turnOfAnswer = createMemo(() => {
    const active = deps.activeTurnId();
    const turns = new Map<string, string>();
    for (const [turnId, messageId] of sources().answers) if (turnId !== active) turns.set(messageId, turnId);
    return turns;
  });

  return {
    /**
     * The steps of the running turn, for the activity line. None once the turn writes its answer: the
     * activity line is under the answer, and the steps then show above it when the turn ends.
     */
    activeSteps: createMemo(() => {
      const turnId = deps.activeTurnId();
      return turnId && sources().answers.has(turnId) ? NO_STEPS : stepsOf(turnId);
    }),
    /**
     * The steps of the channel turns that run, while they have no answer. A channel runs several turns
     * at once and has no single running turn.
     */
    workingSteps(turnIds: readonly string[]): AgentStep[] {
      const { answers } = sources();
      const turns = turnIds.filter((turnId) => !answers.has(turnId));
      return turns.length === 0 ? NO_STEPS : turns.flatMap(stepsOf);
    },
    /** The steps above an answer, or undefined for a message that has none. */
    stepsAbove(messageId: string | undefined): AgentStep[] | undefined {
      const turnId = messageId === undefined ? undefined : turnOfAnswer().get(messageId);
      const steps = stepsOf(turnId);
      return steps.length > 0 ? steps : undefined;
    },
    /** The steps of the turn of a memory-changes message that has no answer to stand above. */
    stepsOfTurn(turnId: string | undefined): AgentStep[] {
      return stepsOf(turnId);
    },
  };
}
