import { parseListAgentMcpTools, parseSetAgentMcpGrants } from "@openbot/contracts/ipc";
import { AGENT_MCP_CAPABILITY, AGENT_MCP_ROUTES } from "@openbot/contracts/team-protocol/agent-mcp-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, requireVisibleBodyAgent, stringField } from "./request-helpers";

/** Only an owner or admin can inspect tool names or change an agent's MCP scope. */
export async function routeAgentMcp(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, protocol, capabilities, member, request, json } = context;
  if (method !== "POST" || !Object.values(AGENT_MCP_ROUTES).some((path) => path === url.pathname)) return "unmatched";
  if (protocol < 7 || !admin?.agentMcp || !capabilities.has(AGENT_MCP_CAPABILITY))
    throw new HttpError(400, sourceText("error.mcp.agentUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  requireVisibleBodyAgent(body, hiddenAgentIds);
  if (url.pathname === AGENT_MCP_ROUTES.read)
    return json(200, admin.agentMcp.readAgentMcpSettings(stringField(body, "agentId")));
  if (url.pathname === AGENT_MCP_ROUTES.set)
    return json(200, await runCauseEffect(admin.agentMcp.setAgentMcpGrants(parseSetAgentMcpGrants(body))));
  return json(200, await runCauseEffect(admin.agentMcp.listAgentMcpTools(parseListAgentMcpTools(body))));
}
