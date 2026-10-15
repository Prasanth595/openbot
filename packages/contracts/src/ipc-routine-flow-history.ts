import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { ROUTINE_FLOW_STEP_STATUSES, type RoutineFlowStepStatus } from "./ipc-routine-flows";
import type { RoutineRunStatus } from "./ipc-routines";
import { type DynamicRecord, isBoolean, isDynamicRecord, isOneOf } from "./runtime-values";

export const ROUTINE_FLOW_HISTORY_RUNS_LIMIT = 20;
export const ROUTINE_FLOW_HISTORY_STEPS_LIMIT = 10;
export const ROUTINE_FLOW_HISTORY_TEXT_BYTES = 4_096;
export const ROUTINE_FLOW_HISTORY_RESPONSE_BYTES = 128 * 1_024;

export interface RoutineFlowHistoryCursor {
  createdAt: string;
  id: string;
}

export interface RoutineFlowHistoryInput {
  agentId: string;
  routineId: string;
  cursor?: RoutineFlowHistoryCursor;
}

export interface RoutineFlowHistoryRunInput extends RoutineFlowHistoryInput {
  runId: string;
}

/** Run metadata only. Instructions, webhook payloads and delivery identifiers do not cross. */
export interface RoutineFlowHistoryRun {
  id: string;
  agentId: string;
  routineId: string;
  kind: "scheduled" | "manual";
  status: RoutineRunStatus;
  scheduledFor: string;
  createdAt: string;
  updatedAt: string;
}

export interface RoutineFlowHistoryPage {
  agentId: string;
  routineId: string;
  runs: RoutineFlowHistoryRun[];
  nextCursor: RoutineFlowHistoryCursor | null;
}

export interface RoutineFlowHistoryStep {
  id: string;
  runId: string;
  agentId: string;
  status: RoutineFlowStepStatus;
  input: string;
  output: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  truncated: { input: boolean; output: boolean; error: boolean };
}

export interface RoutineFlowHistoryRunPage {
  run: RoutineFlowHistoryRun;
  steps: RoutineFlowHistoryStep[];
  nextCursor: RoutineFlowHistoryCursor | null;
}

const RUN_STATUSES = [
  "queued",
  "running",
  "needs-attention",
  "succeeded",
  "failed",
  "interrupted",
  "cancelled",
] as const;
const encoder = new TextEncoder();
const timestamp = (value: unknown): value is string => isBoundedString(value, 64) && Number.isFinite(Date.parse(value));
const text = (value: unknown): value is string =>
  isBoundedString(value, ROUTINE_FLOW_HISTORY_TEXT_BYTES) &&
  encoder.encode(value).byteLength <= ROUTINE_FLOW_HISTORY_TEXT_BYTES;
const nullableText = (value: unknown): value is string | null => value === null || text(value);
const keys = (value: DynamicRecord, allowed: readonly string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));

export function isRoutineFlowHistoryCursor(value: unknown): value is RoutineFlowHistoryCursor {
  return (
    isDynamicRecord(value) && keys(value, ["createdAt", "id"]) && timestamp(value.createdAt) && isIdentifier(value.id)
  );
}

export function isRoutineFlowHistoryInput(value: unknown): value is RoutineFlowHistoryInput {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.agentId) &&
    isIdentifier(value.routineId) &&
    (value.cursor === undefined || isRoutineFlowHistoryCursor(value.cursor))
  );
}

export function isRoutineFlowHistoryRunInput(value: unknown): value is RoutineFlowHistoryRunInput {
  return isRoutineFlowHistoryInput(value) && isDynamicRecord(value) && isIdentifier(value.runId);
}

function run(value: unknown): value is RoutineFlowHistoryRun {
  return (
    isDynamicRecord(value) &&
    keys(value, ["id", "agentId", "routineId", "kind", "status", "scheduledFor", "createdAt", "updatedAt"]) &&
    isIdentifier(value.id) &&
    isIdentifier(value.agentId) &&
    isIdentifier(value.routineId) &&
    isOneOf(["scheduled", "manual"] as const, value.kind) &&
    isOneOf(RUN_STATUSES, value.status) &&
    timestamp(value.scheduledFor) &&
    timestamp(value.createdAt) &&
    timestamp(value.updatedAt)
  );
}

function step(value: unknown): value is RoutineFlowHistoryStep {
  return (
    isDynamicRecord(value) &&
    keys(value, [
      "id",
      "runId",
      "agentId",
      "status",
      "input",
      "output",
      "error",
      "createdAt",
      "updatedAt",
      "truncated",
    ]) &&
    isIdentifier(value.id) &&
    isIdentifier(value.runId) &&
    isIdentifier(value.agentId) &&
    isOneOf(ROUTINE_FLOW_STEP_STATUSES, value.status) &&
    text(value.input) &&
    nullableText(value.output) &&
    nullableText(value.error) &&
    timestamp(value.createdAt) &&
    timestamp(value.updatedAt) &&
    isDynamicRecord(value.truncated) &&
    keys(value.truncated, ["input", "output", "error"]) &&
    isBoolean(value.truncated.input) &&
    isBoolean(value.truncated.output) &&
    isBoolean(value.truncated.error)
  );
}

function bounded(serialized: string): boolean {
  return encoder.encode(serialized).byteLength <= ROUTINE_FLOW_HISTORY_RESPONSE_BYTES;
}

export function isRoutineFlowHistoryPage(value: unknown): value is RoutineFlowHistoryPage {
  return (
    isDynamicRecord(value) &&
    keys(value, ["agentId", "routineId", "runs", "nextCursor"]) &&
    isIdentifier(value.agentId) &&
    isIdentifier(value.routineId) &&
    Array.isArray(value.runs) &&
    value.runs.length <= ROUTINE_FLOW_HISTORY_RUNS_LIMIT &&
    value.runs.every((entry) => run(entry) && entry.agentId === value.agentId && entry.routineId === value.routineId) &&
    (value.nextCursor === null || isRoutineFlowHistoryCursor(value.nextCursor)) &&
    bounded(JSON.stringify(value))
  );
}

export function isRoutineFlowHistoryRunPage(value: unknown): value is RoutineFlowHistoryRunPage {
  if (
    !isDynamicRecord(value) ||
    !keys(value, ["run", "steps", "nextCursor"]) ||
    !run(value.run) ||
    !Array.isArray(value.steps) ||
    value.steps.length > ROUTINE_FLOW_HISTORY_STEPS_LIMIT ||
    !(value.nextCursor === null || isRoutineFlowHistoryCursor(value.nextCursor))
  )
    return false;
  const runId = value.run.id;
  return value.steps.every((entry) => step(entry) && entry.runId === runId) && bounded(JSON.stringify(value));
}
