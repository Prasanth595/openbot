import {
  MEMORY_DIRECTORY_CAPABILITY,
  MEMORY_DIRECTORY_METADATA_ROUTE,
  MEMORY_DIRECTORY_SET_ROUTE,
} from "@openbot/contracts/team-protocol/memory-directory-v1";
import { sourceText } from "@openbot/i18n/source";
import { AgentMemoryDirectoryError } from "../../backend/agent-memory-directory";
import { parseGetAgentMemoryDirectory, parseSetAgentMemoryDirectory } from "../ipc/memory-directory-inputs";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson } from "./request-helpers";

/** Owns optional metadata reads and edits with the existing visible-agent memory permissions. */
export async function routeMemoryDirectory(
  context: TeamApiRequestContext,
  agents: Pick<TeamApiAgents, "listAgents" | "getMemoryDirectoryMetadata" | "setMemoryDirectoryMetadata">,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (
    method === "POST" &&
    capabilities.has(MEMORY_DIRECTORY_CAPABILITY) &&
    (url.pathname === MEMORY_DIRECTORY_METADATA_ROUTE || url.pathname === MEMORY_DIRECTORY_SET_ROUTE)
  ) {
    const body = await readJson(request);
    let input: ReturnType<typeof parseGetAgentMemoryDirectory>;
    try {
      input = parseGetAgentMemoryDirectory(body);
    } catch {
      throw new HttpError(400, "Invalid memory directory request.");
    }
    if (hiddenAgentIds.has(input.agentId) || !agents.listAgents().some((agent) => agent.id === input.agentId))
      throw new HttpError(404, sourceText("error.team.agentNotFound"));
    if (url.pathname === MEMORY_DIRECTORY_METADATA_ROUTE) return json(200, agents.getMemoryDirectoryMetadata(input));
    let edit: ReturnType<typeof parseSetAgentMemoryDirectory>;
    try {
      edit = parseSetAgentMemoryDirectory(body);
    } catch {
      throw new HttpError(400, sourceText("error.backend.memoryDirectoryAnnotation"));
    }
    try {
      return json(200, agents.setMemoryDirectoryMetadata(edit));
    } catch (error) {
      if (error instanceof AgentMemoryDirectoryError)
        throw new HttpError(error.code === "missing" ? 404 : 409, error.message);
      throw error;
    }
  }
  return "unmatched";
}
