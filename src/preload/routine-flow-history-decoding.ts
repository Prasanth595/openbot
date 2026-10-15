import { guardedDecoder } from "@openbot/contracts/ipc-decoding";
import { isRoutineFlowHistoryPage, isRoutineFlowHistoryRunPage } from "@openbot/contracts/ipc-routine-flow-history";

export const decodeRoutineFlowHistoryPage = guardedDecoder(isRoutineFlowHistoryPage, "routine history page response");
export const decodeRoutineFlowHistoryRun = guardedDecoder(isRoutineFlowHistoryRunPage, "routine history run response");
