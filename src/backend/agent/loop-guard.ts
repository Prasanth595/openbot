import { createHash } from "node:crypto";
import { isNumber, isString } from "@openbot/contracts/runtime-values";
import { getArray, getString, isRecord, type ThreadItem } from "../protocol";

/**
 * The loop guard: an agent that runs the same tool call again and again, and gets the same failure
 * each time, is told so in its turn, and with `stopAt` its turn is stopped.
 */
export interface LoopGuardSettings {
  enabled: boolean;
  /** Identical failures in a row before the agent is told to change its approach. */
  warnAt: number;
  /** Identical failures in a row before the turn is stopped. `null`: the guard never stops a turn. */
  stopAt: number | null;
}

export const LOOP_GUARD_LIMITS = { min: 2, max: 1000 } as const;

/**
 * A stop is off by default: a wait that fails until something is ready, such as `curl -f` against a
 * server that still starts, fails the same way many times and is correct.
 */
export const DEFAULT_LOOP_GUARD_SETTINGS: LoopGuardSettings = { enabled: true, warnAt: 3, stopAt: null };

export interface LoopGuardVerdict {
  action: "warn" | "stop";
  /** Identical failures in a row, this one included. */
  count: number;
  /** The command or the tool name, for the note. It can hold secrets: redact it before it is shown. */
  call: string;
}

/** The calls that one turn remembers. The oldest goes first: a loop repeats a recent call. */
const CALLS_PER_TURN = 200;
/** The end of a failure's output that is compared. The start often repeats the command. */
const FAILURE_TAIL = 400;
/** The longest call text that is kept for the note. */
const CALL_TEXT = 200;

interface Streak {
  failure: string;
  count: number;
}

interface TurnCalls {
  turnId: string;
  streaks: Map<string, Streak>;
}

/**
 * Counts identical failures of each tool call in an agent's current turn. A call is the same when
 * its command, or its tool and arguments, are the same. Its streak ends when the same call
 * succeeds or fails with other output, so a turn that runs its tests again after each edit until
 * they pass is left alone. Other calls in between do not end it: a loop often reads a file
 * between two tries. The state is in memory only and a new turn starts it again.
 */
export class LoopGuard {
  readonly #turns = new Map<string, TurnCalls>();

  /** The action for a completed item, or null. Each streak warns once and stops once. */
  observe(agentId: string, turnId: string, item: ThreadItem, settings: LoopGuardSettings): LoopGuardVerdict | null {
    if (!settings.enabled) return null;
    const step = toolStep(item);
    if (!step) return null;
    let turn = this.#turns.get(agentId);
    if (turn?.turnId !== turnId) {
      turn = { turnId, streaks: new Map() };
      this.#turns.set(agentId, turn);
    }
    const previous = turn.streaks.get(step.signature);
    turn.streaks.delete(step.signature);
    if (step.failure === null) return null;
    const count = previous?.failure === step.failure ? previous.count + 1 : 1;
    turn.streaks.set(step.signature, { failure: step.failure, count });
    if (turn.streaks.size > CALLS_PER_TURN) {
      const oldest = turn.streaks.keys().next().value;
      if (oldest !== undefined) turn.streaks.delete(oldest);
    }
    if (settings.stopAt !== null && count === settings.stopAt) return { action: "stop", count, call: step.call };
    if (count === settings.warnAt && (settings.stopAt === null || count < settings.stopAt))
      return { action: "warn", count, call: step.call };
    return null;
  }
}

interface ToolStep {
  /**
   * What makes two calls the same call, as a SHA-256 hash: the input of a `Write` or `Edit` call
   * holds a whole file, and a turn keeps up to 200 of them.
   */
  signature: string;
  call: string;
  /** The normalized failure, or null when the call succeeded. */
  failure: string | null;
}

/**
 * A completed tool item as a call and its result, or null for an item that is not a tool call, a
 * call without its input (it cannot be compared), or a call that the user declined.
 */
export function toolStep(item: ThreadItem): ToolStep | null {
  const status = getString(item, "status");
  if (status === "declined" || status === "inProgress" || status === "in_progress") return null;
  const identity = callIdentity(item);
  if (!identity) return null;
  const exitCode = isNumber(item.exitCode) ? item.exitCode : null;
  const failed = status === "failed" || (exitCode !== null && exitCode !== 0);
  return {
    signature: createHash("sha256").update(identity.signature).digest("hex"),
    call: identity.call.length > CALL_TEXT ? `${identity.call.slice(0, CALL_TEXT - 1)}…` : identity.call,
    failure: failed ? `${exitCode ?? ""}|${normalizedOutput(item)}` : null,
  };
}

function callIdentity(item: ThreadItem): { signature: string; call: string } | null {
  const args = item.arguments;
  // A shell command is the same call whatever its description says: Claude's Bash tool and an ACP
  // `execute` tool carry the command in their input, Codex and Muse in the item.
  const command = getString(item, "command") ?? (isRecord(args) ? getString(args, "command") : null);
  if (command?.trim()) return { signature: `command:${command.trim()}`, call: command.trim() };
  if (args === undefined) return null;
  const tool =
    item.type === "mcpToolCall"
      ? `${getString(item, "server") ?? "mcp"}/${getString(item, "tool") ?? ""}`
      : item.type === "dynamicToolCall"
        ? `${getString(item, "namespace") ?? ""}/${getString(item, "tool") ?? ""}`
        : item.type === "toolCall"
          ? (getString(item, "toolKind") ?? getString(item, "name"))
          : null;
  if (!tool) return null;
  return { signature: `tool:${tool}:${stableJson(args)}`, call: tool };
}

/** The output of a failed call, with numbers and white space made equal, so a time or a PID does not count. */
function normalizedOutput(item: ThreadItem): string {
  const parts = [
    getString(item, "aggregatedOutput"),
    textOf(item.result),
    textOf(item.error),
    ...getArray(item, "contentItems").map((content) => getString(content, "text")),
  ].filter(isString);
  const text = parts.join("\n").replace(/\d+/gu, "0").replace(/\s+/gu, " ").trim();
  return text.slice(-FAILURE_TAIL);
}

function textOf(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return isString(value) ? value : stableJson(value);
}

/** JSON with sorted keys, so the same input in another key order is the same call. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, part: unknown) =>
    isRecord(part) && !Array.isArray(part)
      ? Object.fromEntries(Object.entries(part).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)))
      : part,
  );
}

/**
 * The start of the note that goes into the turn. The provider keeps the note in its history as a
 * user message with no delivery, so the history import finds it by this start and leaves it out.
 */
const LOOP_GUARD_NOTE_PREFIX = "[OpenBot loop guard] ";

/** Whether a user message in provider history is the loop guard's note, not text the user wrote. */
export function isLoopGuardNote(text: string): boolean {
  return text.startsWith(LOOP_GUARD_NOTE_PREFIX);
}

/** The text that goes into the turn. The agent reads it as a note from OpenBot, not from the user. */
export function loopGuardWarning(verdict: LoopGuardVerdict): string {
  return [
    `${LOOP_GUARD_NOTE_PREFIX}This call failed ${verdict.count} times in a row with the same result: ${verdict.call}`,
    "Do not run it again unchanged. Read the error, try a different approach, or stop and tell the user what blocks you.",
  ].join("\n");
}
