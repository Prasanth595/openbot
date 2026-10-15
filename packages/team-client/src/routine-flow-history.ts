import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { guardedDecoder } from "@openbot/contracts/ipc-decoding";
import { isRoutineFlowHistoryPage, isRoutineFlowHistoryRunPage } from "@openbot/contracts/ipc-routine-flow-history";
import { ROUTINE_FLOW_HISTORY_ROUTES } from "@openbot/contracts/team-protocol/routine-flow-history-v1";
import { decodeTeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import type { TeamApiRequest } from "./team-api-requests";

export type TeamRoutineFlowHistoryApi = OpenBotDesktopApi["routineFlowHistory"];
const page = guardedDecoder(isRoutineFlowHistoryPage, "routine history page");
const run = guardedDecoder(isRoutineFlowHistoryRunPage, "routine history run");

export function teamRoutineFlowHistoryApi(request: TeamApiRequest): TeamRoutineFlowHistoryApi {
  return {
    page: (input) => request("POST", ROUTINE_FLOW_HISTORY_ROUTES.page, page, decodeTeamProtocolV2Json(input)),
    run: (input) => request("POST", ROUTINE_FLOW_HISTORY_ROUTES.run, run, decodeTeamProtocolV2Json(input)),
  };
}
