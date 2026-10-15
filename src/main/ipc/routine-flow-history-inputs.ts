import {
  isRoutineFlowHistoryInput,
  isRoutineFlowHistoryRunInput,
  type RoutineFlowHistoryInput,
  type RoutineFlowHistoryRunInput,
} from "@openbot/contracts/ipc-routine-flow-history";

export function parseRoutineFlowHistory(value: unknown): RoutineFlowHistoryInput {
  if (!isRoutineFlowHistoryInput(value)) throw new Error("Invalid routine history request.");
  return {
    agentId: value.agentId,
    routineId: value.routineId,
    ...(value.cursor ? { cursor: { createdAt: value.cursor.createdAt, id: value.cursor.id } } : {}),
  };
}

export function parseRoutineFlowHistoryRun(value: unknown): RoutineFlowHistoryRunInput {
  if (!isRoutineFlowHistoryRunInput(value)) throw new Error("Invalid routine history run request.");
  return { ...parseRoutineFlowHistory(value), runId: value.runId };
}
