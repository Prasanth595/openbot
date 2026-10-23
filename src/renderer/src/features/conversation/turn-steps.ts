import type { AgentMessage } from "@openbot/ui/data";
import type { AgentStep } from "@openbot/ui/features/conversation/AgentSteps";
import { silentAgentAnswer } from "@openbot/ui/features/conversation/new-message-tally";
import { createMemo } from "solid-js";
import type { TurnStepLines } from "./turn-step-lines";

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
  // When this window first saw each thought. A progress line has its own time, and the two are
  // ordered by them, so a line shows between the thoughts it came between.
  const seenAt = new Map<string, number>();
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
      const at = seenAt.get(id) ?? now;
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
    /** The steps of the running turn, for the activity line. */
    activeSteps: createMemo(() => stepsOf(deps.activeTurnId())),
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
