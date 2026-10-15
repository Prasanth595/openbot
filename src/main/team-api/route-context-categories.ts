import { parseReadContextCategoriesInput } from "@openbot/contracts/ipc";
import {
  CONTEXT_CATEGORIES_CAPABILITY,
  CONTEXT_CATEGORIES_ROUTE,
} from "@openbot/contracts/team-protocol/context-categories-v1";
import { sourceText } from "@openbot/i18n/source";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson } from "./request-helpers";

/** Any member can read these safe estimates for an agent the member can already see. */
export async function routeContextCategories(
  context: TeamApiRequestContext,
  agents: Pick<TeamApiAgents, "readContextCategories" | "listAgents">,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (method !== "POST" || url.pathname !== CONTEXT_CATEGORIES_ROUTE) return "unmatched";
  if (!capabilities.has(CONTEXT_CATEGORIES_CAPABILITY)) return json(200, null);
  const input = parseReadContextCategoriesInput(await readJson(request));
  const agent = agents.listAgents().find((candidate) => candidate.id === input.agentId);
  if (hiddenAgentIds.has(input.agentId) || !agent) throw new HttpError(404, sourceText("error.team.agentNotFound"));
  // Added local subjects have no remote list in the current conversation capability.
  if (agent.threadId !== input.threadId) return json(200, null);
  return json(200, agents.readContextCategories?.(input) ?? null);
}
