import type { RoutineFlowHistoryInput, RoutineFlowHistoryRunInput } from "@openbot/contracts/ipc-routine-flow-history";
import {
  ROUTINE_FLOW_HISTORY_CAPABILITY,
  ROUTINE_FLOW_HISTORY_ROUTES,
} from "@openbot/contracts/team-protocol/routine-flow-history-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { RoutineFlowError } from "../../backend/routine-flows/routine-flow-store";
import { parseRoutineFlowHistory, parseRoutineFlowHistoryRun } from "../ipc/routine-flow-history-inputs";
import type { TeamApiAgents, TeamApiRoutineFlows } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson } from "./request-helpers";

type RoutineFlowHistoryOperation =
  | { kind: "page"; input: RoutineFlowHistoryInput }
  | { kind: "run"; input: RoutineFlowHistoryRunInput };

/** Caller visibility comes from the authenticated host context. It is never accepted from the request body. */
export async function routeRoutineFlowHistory(
  context: TeamApiRequestContext,
  routineFlows: TeamApiRoutineFlows | undefined,
  agents: Pick<TeamApiAgents, "listAgents">,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  const path = url.pathname;
  if (method !== "POST" || (path !== ROUTINE_FLOW_HISTORY_ROUTES.page && path !== ROUTINE_FLOW_HISTORY_ROUTES.run))
    return "unmatched";
  if (!routineFlows || !capabilities.has(ROUTINE_FLOW_HISTORY_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.routineFlowHistoryUnsupported"));
  const body = await readJson(request);
  const visible = new Set(
    agents
      .listAgents()
      .filter((agent) => !hiddenAgentIds.has(agent.id))
      .map((agent) => agent.id),
  );
  let operation: RoutineFlowHistoryOperation;
  try {
    operation =
      path === ROUTINE_FLOW_HISTORY_ROUTES.page
        ? { kind: "page", input: parseRoutineFlowHistory(body) }
        : { kind: "run", input: parseRoutineFlowHistoryRun(body) };
  } catch {
    throw new HttpError(400, "Invalid routine history request.");
  }
  if (!visible.has(operation.input.agentId))
    throw new HttpError(404, sourceText("error.backend.routineFlowHistoryGone"));
  try {
    return operation.kind === "run"
      ? json(200, await runCauseEffect(routineFlows.historyRun(operation.input, visible)))
      : json(200, await runCauseEffect(routineFlows.historyPage(operation.input, visible)));
  } catch (error) {
    if (error instanceof RoutineFlowError)
      throw new HttpError(
        error.message === sourceText("error.backend.routineFlowHistoryTooLarge") ? 413 : 404,
        error.message,
      );
    throw error;
  }
}
