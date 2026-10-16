import { AGENT_ROSTER_BYTES_LIMIT, fitsAgentRosterBudget, INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentRuntimeRosterEntry, AgentSummary } from "@openbot/contracts/ipc";
import { encodeLargeAgentRosterEvent, LargeAgentRosterBudgetExceeded } from "@openbot/contracts/team-protocol";
import { sourceText } from "@openbot/i18n/source";
import { stableThreadId } from "../openbot-database";

/** The last runtime reduction keeps every id, notification choice and date. */
export function compactRuntimeRosterEntry(agent: AgentRuntimeRosterEntry): AgentRuntimeRosterEntry {
  return {
    id: agent.id,
    name: agent.name.slice(0, 40),
    notifications: agent.notifications,
    preview: "",
    updatedAt: agent.updatedAt,
    avatarSeed: agent.id,
    avatarHue: agent.avatarHue,
    avatarUrl: null,
  };
}

export class AgentRosterBudgetExceeded extends Error {
  constructor() {
    super(sourceText("error.agent.rosterBudget"));
    this.name = "AgentRosterBudgetExceeded";
  }
}

function rosterAndRuntime(agents: readonly AgentSummary[]) {
  const roster = agents.map((agent) => ({ ...agent, threadId: agent.threadId ?? stableThreadId(agent.id) }));
  // Provider turn ids are opaque bounded strings. JSON can require six bytes per code unit.
  // Reserve the states runtime fitting retains, including simultaneous start/failure bookkeeping.
  const turnId = "\u0001".repeat(INPUT_LIMITS.identifier);
  const snapshot = {
    agents: roster.map(compactRuntimeRosterEntry),
    activeTurns: roster.map((agent) => ({ agentId: agent.id, threadId: agent.threadId, turnId })),
    failedTurns: roster.map((agent) => ({ agentId: agent.id, turnId })),
    usageLimits: roster.map((agent) => ({ agentId: agent.id, resetsAt: Number.MAX_VALUE })),
    work: [],
    latestMessages: [],
    attentionComplete: false,
    pendingPrompts: [],
    pendingApprovals: [],
    pendingBrowserTakeovers: [],
  };
  return { roster, snapshot };
}

/** A repair reduces total excess. Fitting envelopes may grow only within their existing budget. */
export function reducesAgentRosterBudget(previous: readonly AgentSummary[], next: readonly AgentSummary[]): boolean {
  function footprint(agents: readonly AgentSummary[]): [number, number] {
    const { roster, snapshot } = rosterAndRuntime(agents);
    // The large event names reserve their extra envelope bytes. Current agent keys are at least as
    // long as their wire bot keys, so this also bounds both local IPC and the frozen wire fields.
    return [
      Buffer.byteLength(JSON.stringify({ type: "large-agents-changed", agents: roster })),
      Buffer.byteLength(JSON.stringify({ type: "large-runtime-snapshot", snapshot })),
    ];
  }
  const [previousRoster, previousRuntime] = footprint(previous);
  const [nextRoster, nextRuntime] = footprint(next);
  const excess = (bytes: number) => Math.max(0, bytes - AGENT_ROSTER_BYTES_LIMIT);
  const withinRepairBound = (before: number, after: number) => after <= Math.max(before, AGENT_ROSTER_BYTES_LIMIT);
  return (
    withinRepairBound(previousRoster, nextRoster) &&
    withinRepairBound(previousRuntime, nextRuntime) &&
    excess(nextRoster) + excess(nextRuntime) < excess(previousRoster) + excess(previousRuntime)
  );
}

/** Full wire envelopes are measured, including the thread id a new profile will get later. */
export function requireAgentRosterBudget(agents: readonly AgentSummary[]): void {
  try {
    const { roster, snapshot } = rosterAndRuntime(agents);
    if (!fitsAgentRosterBudget({ type: "large-agents-changed", agents: roster })) throw new AgentRosterBudgetExceeded();
    encodeLargeAgentRosterEvent({ type: "agents-changed", agents: roster });
    if (!fitsAgentRosterBudget({ type: "large-runtime-snapshot", snapshot })) throw new AgentRosterBudgetExceeded();
    encodeLargeAgentRosterEvent({ type: "runtime-snapshot", snapshot });
  } catch (error) {
    if (error instanceof LargeAgentRosterBudgetExceeded) throw new AgentRosterBudgetExceeded();
    throw error;
  }
}
