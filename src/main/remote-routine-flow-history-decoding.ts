import { guardedDecoder } from "@openbot/contracts/ipc-decoding";
import { isRoutineFlowHistoryPage, isRoutineFlowHistoryRunPage } from "@openbot/contracts/ipc-routine-flow-history";

export const decodeRemoteRoutineFlowHistoryPage = guardedDecoder(
  isRoutineFlowHistoryPage,
  "remote routine history page",
);
export const decodeRemoteRoutineFlowHistoryRun = guardedDecoder(
  isRoutineFlowHistoryRunPage,
  "remote routine history run",
);
