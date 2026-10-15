import {
  ROUTINE_FLOW_HISTORY_CAPABILITY,
  ROUTINE_FLOW_HISTORY_ROUTES,
} from "@openbot/contracts/team-protocol/routine-flow-history-v1";
import { sourceText } from "@openbot/i18n/source";
import type { Effect } from "effect";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { RoutineFlowsHandle } from "../../backend/routine-flows/routine-flows";
import type { ResponseDecoder } from "../remote-host-decoding";
import {
  decodeRemoteRoutineFlowHistoryPage,
  decodeRemoteRoutineFlowHistoryRun,
} from "../remote-routine-flow-history-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import type { RemoteWorkflowError } from "../remote-service-effects";
import type { IpcGroupHandlers } from "./define-ipc-group";

interface RoutineFlowHistoryRemoteServers {
  supportsCapability(serverId: string, capability: typeof ROUTINE_FLOW_HISTORY_CAPABILITY): boolean;
  request<T>(
    serverId: string,
    path: string,
    decoder: ResponseDecoder<T>,
    init?: RemoteRequestInit,
  ): Effect.Effect<T, RemoteWorkflowError>;
}

import { parseRoutineFlowHistory, parseRoutineFlowHistoryRun } from "./routine-flow-history-inputs";
import { scopedHandler } from "./scoped-handler";

interface RoutineFlowHistoryIpcDependencies {
  routineFlows: Pick<RoutineFlowsHandle, "historyPage" | "historyRun">;
  remoteServers: RoutineFlowHistoryRemoteServers;
}

export function routineFlowHistoryIpcHandlers({
  routineFlows,
  remoteServers,
}: RoutineFlowHistoryIpcDependencies): Pick<IpcGroupHandlers, "routineFlowHistory"> {
  const available = (serverId: string) => {
    if (!remoteServers.supportsCapability(serverId, ROUTINE_FLOW_HISTORY_CAPABILITY))
      throw new Error(sourceText("error.team.routineFlowHistoryUnsupported"));
  };
  return {
    routineFlowHistory: {
      page: scopedHandler(parseRoutineFlowHistory, {
        local: (input) => runCauseEffect(routineFlows.historyPage(input)),
        remote: (input, serverId) => {
          available(serverId);
          return runCauseEffect(
            remoteServers.request(serverId, ROUTINE_FLOW_HISTORY_ROUTES.page, decodeRemoteRoutineFlowHistoryPage, {
              method: "POST",
              body: input,
            }),
          );
        },
      }),
      run: scopedHandler(parseRoutineFlowHistoryRun, {
        local: (input) => runCauseEffect(routineFlows.historyRun(input)),
        remote: (input, serverId) => {
          available(serverId);
          return runCauseEffect(
            remoteServers.request(serverId, ROUTINE_FLOW_HISTORY_ROUTES.run, decodeRemoteRoutineFlowHistoryRun, {
              method: "POST",
              body: input,
            }),
          );
        },
      }),
    },
  };
}
