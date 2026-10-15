import type { OpenBotDesktopApi, Routine, RoutineFlowStep, RoutineRun } from "@openbot/contracts/ipc";
import {
  ROUTINE_FLOW_HISTORY_RUNS_LIMIT,
  ROUTINE_FLOW_HISTORY_STEPS_LIMIT,
  ROUTINE_FLOW_HISTORY_TEXT_BYTES,
  type RoutineFlowHistoryCursor,
  type RoutineFlowHistoryRun,
  type RoutineFlowHistoryStep,
} from "@openbot/contracts/ipc-routine-flow-history";
import { sourceText } from "@openbot/i18n/source";

interface MockRoutineFlowHistorySource {
  routines: Map<string, Routine[]>;
  routineRuns: Map<string, RoutineRun[]>;
  steps?: RoutineFlowStep[] | undefined;
}

function summary(run: RoutineRun): RoutineFlowHistoryRun {
  return {
    id: run.id,
    agentId: run.agentId,
    routineId: run.routineId,
    kind: run.kind,
    status: run.status,
    scheduledFor: run.scheduledFor,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}
const newer = (left: { createdAt: string; id: string }, right: { createdAt: string; id: string }) =>
  left.createdAt > right.createdAt || (left.createdAt === right.createdAt && left.id > right.id);
const older = (entry: { createdAt: string; id: string }, cursor?: RoutineFlowHistoryCursor) =>
  !cursor || newer(cursor, entry);
const encoder = new TextEncoder();
function text(value: string | null): { value: string | null; truncated: boolean } {
  if (value === null) return { value, truncated: false };
  if (encoder.encode(value).byteLength <= ROUTINE_FLOW_HISTORY_TEXT_BYTES) return { value, truncated: false };
  return { value: "", truncated: true };
}
function storedStep(step: RoutineFlowStep): RoutineFlowHistoryStep {
  const input = text(step.input);
  const output = text(step.output);
  const error = text(step.error);
  return {
    id: step.id,
    runId: step.runId,
    agentId: step.agentId,
    status: step.status,
    createdAt: step.createdAt,
    updatedAt: step.updatedAt,
    input: input.value ?? "",
    output: output.value,
    error: error.value,
    truncated: { input: input.truncated, output: output.truncated, error: error.truncated },
  };
}

/** The preview reads seeded history. It never starts or repeats a routine. */
export function mockRoutineFlowHistory(source: MockRoutineFlowHistorySource): OpenBotDesktopApi["routineFlowHistory"] {
  const requireRoutine = (agentId: string, routineId: string) => {
    if (!(source.routines.get(agentId) ?? []).some((routine) => routine.id === routineId))
      throw new Error(sourceText("error.backend.routineFlowHistoryGone"));
  };
  return {
    page: async ({ agentId, routineId, cursor }) => {
      requireRoutine(agentId, routineId);
      const rows = (source.routineRuns.get(routineId) ?? [])
        .filter((run) => run.agentId === agentId && run.routineId === routineId && older(run, cursor))
        .toSorted((a, b) => (newer(a, b) ? -1 : newer(b, a) ? 1 : 0));
      const runs = rows.slice(0, ROUTINE_FLOW_HISTORY_RUNS_LIMIT).map(summary);
      const last = runs.at(-1);
      return {
        agentId,
        routineId,
        runs,
        nextCursor: rows.length > runs.length && last ? { createdAt: last.createdAt, id: last.id } : null,
      };
    },
    run: async ({ agentId, routineId, runId, cursor }) => {
      requireRoutine(agentId, routineId);
      const run = (source.routineRuns.get(routineId) ?? []).find(
        (entry) => entry.id === runId && entry.agentId === agentId && entry.routineId === routineId,
      );
      if (!run) throw new Error(sourceText("error.backend.routineFlowHistoryGone"));
      const rows = (source.steps ?? [])
        .filter((step) => step.runId === runId && (!cursor || newer(step, cursor)))
        .toSorted((a, b) => (newer(a, b) ? 1 : newer(b, a) ? -1 : 0));
      const steps = rows.slice(0, ROUTINE_FLOW_HISTORY_STEPS_LIMIT).map(storedStep);
      const last = steps.at(-1);
      return {
        run: summary(run),
        steps,
        nextCursor: rows.length > steps.length && last ? { createdAt: last.createdAt, id: last.id } : null,
      };
    },
  };
}
