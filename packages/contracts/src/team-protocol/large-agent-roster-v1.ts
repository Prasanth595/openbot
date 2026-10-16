// An additive roster contract. The released v1-v7 codecs still accept at most 100 roster entries.
// This capability uses distinct event names and the released v7 record projection, with the
// existing 1 MiB HTTPS event budget instead of a product count cap.
import { AGENT_ROSTER_BYTES_LIMIT, AGENT_ROSTER_ITEMS_LIMIT, fitsAgentRosterBudget } from "../agent-roster-limits";
import { type AgentEvent, isAgentEvent } from "../ipc-agent-events";
import { isDynamicRecord, isNumber, isString } from "../runtime-values";
import { toCurrentAgentKeys, toWireAgentKeys } from "./current-agent-keys";
import {
  decodeTeamProtocolV7BaseEvent,
  type TeamProtocolV7BaseJsonObject,
  type TeamProtocolV7BaseJsonValue,
} from "./v7-base";

export const LARGE_AGENT_ROSTER_CAPABILITY = "large-agent-roster-v1";

/** A byte refusal is distinct from invalid known wire fields. */
export class LargeAgentRosterBudgetExceeded extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LargeAgentRosterBudgetExceeded";
  }
}

export type LargeAgentRosterEvent =
  | { type: "large-agents-changed"; bots: TeamProtocolV7BaseJsonObject[] }
  | { type: "large-runtime-snapshot"; snapshot: TeamProtocolV7BaseJsonObject };

const RUNTIME_ARRAYS = ["bots", "activeTurns", "latestMessages", "failedTurns"] as const;
const RELEASED_ROSTER_COUNT = 100;

/** Usage holds are defined by this new optional contract; frozen runtime snapshots omit them. */
function projectedUsageLimits(value: unknown): TeamProtocolV7BaseJsonObject[] {
  if (!Array.isArray(value) || value.length > AGENT_ROSTER_ITEMS_LIMIT)
    throw new Error("Invalid large runtime usage holds.");
  return value.map((hold) => {
    if (
      !isDynamicRecord(hold) ||
      (hold.resetsAt !== null && (!isNumber(hold.resetsAt) || !Number.isFinite(hold.resetsAt) || hold.resetsAt < 0))
    )
      throw new Error("Invalid large runtime usage hold.");
    const decoded = releasedEvent({
      type: "runtime-snapshot",
      snapshot: {
        bots: [],
        activeTurns: [],
        work: [],
        latestMessages: [],
        attentionComplete: true,
        pendingPrompts: [],
        pendingApprovals: [],
        pendingBrowserTakeovers: [],
        failedTurns: [{ botId: hold.botId, turnId: "usage-hold" }],
      },
    });
    if (!isDynamicRecord(decoded.snapshot) || !Array.isArray(decoded.snapshot.failedTurns))
      throw new Error("Invalid large runtime usage hold.");
    const turn = decoded.snapshot.failedTurns[0];
    if (!isDynamicRecord(turn) || !isString(turn.botId)) throw new Error("Invalid large runtime usage hold.");
    return { botId: turn.botId, resetsAt: hold.resetsAt };
  });
}

function releasedEvent(value: unknown): TeamProtocolV7BaseJsonObject {
  const decoded = decodeTeamProtocolV7BaseEvent(value);
  if (decoded.kind !== "known") throw new Error("Invalid large agent roster event.");
  const projected: TeamProtocolV7BaseJsonObject = JSON.parse(JSON.stringify(decoded.event));
  return projected;
}

export function projectedLargeAgentRoster(value: unknown): TeamProtocolV7BaseJsonObject[] {
  if (!Array.isArray(value) || value.length > AGENT_ROSTER_ITEMS_LIMIT) throw new Error("Invalid large agent roster.");
  const roster: TeamProtocolV7BaseJsonObject[] = [];
  let bytes = 2;
  for (let index = 0; index < value.length; index += RELEASED_ROSTER_COUNT) {
    const projected = releasedEvent({ type: "bots-changed", bots: value.slice(index, index + RELEASED_ROSTER_COUNT) });
    if (!Array.isArray(projected.bots)) throw new Error("Invalid large agent roster.");
    bytes += new TextEncoder().encode(JSON.stringify(projected.bots)).byteLength - 2 + (roster.length ? 1 : 0);
    if (bytes > AGENT_ROSTER_BYTES_LIMIT)
      throw new LargeAgentRosterBudgetExceeded("Large agent roster exceeds its transport budget.");
    for (const entry of projected.bots) {
      if (!isDynamicRecord(entry)) throw new Error("Invalid large agent roster entry.");
      roster.push(entry);
    }
  }
  return roster;
}

function projectedRuntime(value: unknown): TeamProtocolV7BaseJsonObject {
  if (!isDynamicRecord(value)) throw new Error("Invalid large runtime snapshot.");
  const empty = { ...value, ...Object.fromEntries(RUNTIME_ARRAYS.map((key) => [key, []])) };
  const projected = releasedEvent({ type: "runtime-snapshot", snapshot: empty });
  if (!isDynamicRecord(projected.snapshot)) throw new Error("Invalid large runtime snapshot.");
  const result: TeamProtocolV7BaseJsonObject = { ...projected.snapshot };
  for (const key of RUNTIME_ARRAYS) {
    const entries = value[key];
    if (!Array.isArray(entries) || entries.length > AGENT_ROSTER_ITEMS_LIMIT)
      throw new Error("Invalid large runtime roster.");
    const output: TeamProtocolV7BaseJsonValue[] = [];
    for (let index = 0; index < entries.length; index += RELEASED_ROSTER_COUNT) {
      const part = releasedEvent({
        type: "runtime-snapshot",
        snapshot: { ...empty, [key]: entries.slice(index, index + RELEASED_ROSTER_COUNT) },
      });
      if (!isDynamicRecord(part.snapshot) || !Array.isArray(part.snapshot[key]))
        throw new Error("Invalid large runtime roster.");
      output.push(...part.snapshot[key]);
    }
    result[key] = output;
  }
  if (value.usageLimits !== undefined) result.usageLimits = projectedUsageLimits(value.usageLimits);
  return result;
}

/** Returns null for another event type. A malformed known event fails closed. */
export function largeAgentRosterEvent(value: unknown): LargeAgentRosterEvent | null {
  if (!isDynamicRecord(value)) return null;
  if (value.type !== "large-agents-changed" && value.type !== "large-runtime-snapshot") return null;
  if (!fitsAgentRosterBudget(value))
    throw new LargeAgentRosterBudgetExceeded("Large agent event exceeds its transport budget.");
  return value.type === "large-agents-changed"
    ? { type: value.type, bots: projectedLargeAgentRoster(value.bots) }
    : { type: value.type, snapshot: projectedRuntime(value.snapshot) };
}

/** Only a peer that negotiated the capability receives these distinct wire events. */
export function encodeLargeAgentRosterEvent(event: AgentEvent): string | null {
  if (event.type !== "agents-changed" && event.type !== "runtime-snapshot") return null;
  const current: TeamProtocolV7BaseJsonValue = JSON.parse(JSON.stringify(event));
  const wire = toWireAgentKeys(current);
  if (!isDynamicRecord(wire)) return null;
  const projected: LargeAgentRosterEvent =
    event.type === "agents-changed"
      ? { type: "large-agents-changed", bots: projectedLargeAgentRoster(wire.bots) }
      : { type: "large-runtime-snapshot", snapshot: projectedRuntime(wire.snapshot) };
  if (!fitsAgentRosterBudget(projected))
    throw new LargeAgentRosterBudgetExceeded("Large agent event exceeds its transport budget.");
  return JSON.stringify(projected);
}

/** Translation belongs at the transport boundary, after the frozen record validation. */
export function largeAgentRosterEventToCurrent(event: LargeAgentRosterEvent): AgentEvent {
  const wire: TeamProtocolV7BaseJsonValue = {
    ...event,
    type: event.type === "large-agents-changed" ? "bots-changed" : "runtime-snapshot",
  };
  const current = toCurrentAgentKeys(wire);
  if (!isAgentEvent(current)) throw new Error("Invalid large agent event projection.");
  return current;
}
