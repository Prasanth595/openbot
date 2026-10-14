import { INPUT_LIMITS } from "./input-limits";
import { isDynamicRecord } from "./runtime-values";

/** Null follows the host's enabled servers. An explicit list grants only its named servers. */
export interface AgentMcpServerGrant {
  mcpServerId: string;
  /** Null grants all tools. An empty list grants no tools. Names are exact MCP tool names. */
  tools: string[] | null;
}
export type AgentMcpGrants = AgentMcpServerGrant[] | null;
export interface AgentMcpSettings {
  agentId: string;
  grants: AgentMcpGrants;
  servers: Array<{ id: string; name: string; enabled: boolean }>;
}
export interface SetAgentMcpGrantsInput {
  agentId: string;
  grants: AgentMcpGrants;
}
export interface ListAgentMcpToolsInput {
  agentId: string;
  mcpServerId: string;
  query?: string;
}
export interface AgentMcpTool {
  name: string;
  description: string;
}
/** Leaves room for the existing Team envelope and server summary without changing native MCP. */
export const AGENT_MCP_LIMITS = {
  grantsBytes: 128 * 1024,
  payloadBytes: 192 * 1024,
  toolsCount: 1000,
  descriptionChars: 512,
  queryChars: 256,
} as const;
export function agentMcpWithinBytes(value: unknown, maximum: number): boolean {
  try {
    const text = JSON.stringify(value);
    return text !== undefined && new TextEncoder().encode(text).byteLength <= maximum;
  } catch {
    return false;
  }
}
const identifier = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 128;
const toolName = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 256;

export function isAgentMcpGrants(value: unknown): value is AgentMcpGrants {
  return (
    value === null ||
    (Array.isArray(value) &&
      value.length <= INPUT_LIMITS.mcpServers + 2 &&
      value.every(
        (grant) =>
          isDynamicRecord(grant) &&
          Object.keys(grant).every((key) => key === "mcpServerId" || key === "tools") &&
          identifier(grant.mcpServerId) &&
          (grant.tools === null ||
            (Array.isArray(grant.tools) &&
              grant.tools.length <= INPUT_LIMITS.mcpToolCount &&
              grant.tools.every(toolName) &&
              new Set(grant.tools).size === grant.tools.length)),
      ) &&
      new Set(value.map((grant) => grant.mcpServerId)).size === value.length &&
      agentMcpWithinBytes(value, AGENT_MCP_LIMITS.grantsBytes))
  );
}
export function parseSetAgentMcpGrants(value: unknown): SetAgentMcpGrantsInput {
  if (
    isDynamicRecord(value) &&
    value.grants !== undefined &&
    !agentMcpWithinBytes(value.grants, AGENT_MCP_LIMITS.grantsBytes)
  )
    throw new Error("Agent MCP selection is too large. Select fewer tools or use All tools.");
  if (
    !isDynamicRecord(value) ||
    Object.keys(value).some((key) => key !== "agentId" && key !== "grants") ||
    !identifier(value.agentId) ||
    !isAgentMcpGrants(value.grants) ||
    !agentMcpWithinBytes(value, AGENT_MCP_LIMITS.payloadBytes)
  )
    throw new Error("Invalid agent MCP grants.");
  return { agentId: value.agentId, grants: value.grants };
}
export function parseListAgentMcpTools(value: unknown): ListAgentMcpToolsInput {
  if (
    !isDynamicRecord(value) ||
    Object.keys(value).some((key) => key !== "agentId" && key !== "mcpServerId" && key !== "query") ||
    !identifier(value.agentId) ||
    !identifier(value.mcpServerId) ||
    (value.query !== undefined && (typeof value.query !== "string" || value.query.length > AGENT_MCP_LIMITS.queryChars))
  )
    throw new Error("Invalid agent MCP tools request.");
  return {
    agentId: value.agentId,
    mcpServerId: value.mcpServerId,
    ...(value.query !== undefined ? { query: value.query } : {}),
  };
}
export function isAgentMcpSettings(value: unknown): value is AgentMcpSettings {
  return (
    isDynamicRecord(value) &&
    identifier(value.agentId) &&
    isAgentMcpGrants(value.grants) &&
    Array.isArray(value.servers) &&
    value.servers.length <= INPUT_LIMITS.mcpServers + 2 &&
    value.servers.every(
      (server) =>
        isDynamicRecord(server) &&
        identifier(server.id) &&
        typeof server.name === "string" &&
        server.name.length <= INPUT_LIMITS.mcpServerName &&
        typeof server.enabled === "boolean",
    ) &&
    agentMcpWithinBytes(value, AGENT_MCP_LIMITS.payloadBytes)
  );
}
export function isAgentMcpTools(value: unknown): value is AgentMcpTool[] {
  return (
    Array.isArray(value) &&
    value.length <= AGENT_MCP_LIMITS.toolsCount &&
    value.every(
      (tool) =>
        isDynamicRecord(tool) &&
        toolName(tool.name) &&
        typeof tool.description === "string" &&
        tool.description.length <= AGENT_MCP_LIMITS.descriptionChars,
    ) &&
    agentMcpWithinBytes(value, AGENT_MCP_LIMITS.payloadBytes)
  );
}
export function agentMcpServerAllowed(grants: AgentMcpGrants, mcpServerId: string): boolean {
  return grants === null || grants.some((grant) => grant.mcpServerId === mcpServerId);
}
export function agentMcpToolAllowed(grants: AgentMcpGrants, mcpServerId: string, name: string): boolean {
  if (grants === null) return true;
  const grant = grants.find((candidate) => candidate.mcpServerId === mcpServerId);
  return grant !== undefined && (grant.tools === null || grant.tools.includes(name));
}
