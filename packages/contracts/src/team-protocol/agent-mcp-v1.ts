// Frozen optional agent MCP grant contract. It does not change released agent roster payloads.
import { isDynamicRecord } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  string,
} from "./admin-wire";

export const AGENT_MCP_CAPABILITY = "agent-mcp-v1";
export const AGENT_MCP_ROUTES = {
  read: "/v1/admin/agents/mcp",
  set: "/v1/admin/agents/mcp/set",
  tools: "/v1/admin/agents/mcp/tools",
} as const;
/** Only this optional codec raises it; released request error mapping stays unchanged. */
export class AgentMcpPayloadTooLarge extends Error {
  constructor() {
    super("Agent MCP payload is too large. Select fewer tools or filter the tool list.");
  }
}
const tool: AdminDecoder = (value) => {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) throw new Error("Invalid MCP tool name.");
  return value;
};
const bounded =
  (maximum: number, decode: AdminDecoder): AdminDecoder =>
  (value) => {
    const decoded = decode(value);
    if (new TextEncoder().encode(JSON.stringify(decoded)).byteLength > maximum) throw new AgentMcpPayloadTooLarge();
    return decoded;
  };
const grants = bounded(
  128 * 1024,
  nullable(list(fields({ mcpServerId: identifier, tools: nullable(list(tool, 10000)) }), 34)),
);
const settings = bounded(
  192 * 1024,
  fields({
    agentId: identifier,
    grants,
    servers: list(fields({ id: identifier, name: string(80), enabled: boolean }), 34),
  }),
);
const exact =
  (names: readonly string[], decode: AdminDecoder): AdminDecoder =>
  (value) => {
    if (!isDynamicRecord(value) || Object.keys(value).some((key) => !names.includes(key)))
      throw new Error("Invalid agent MCP request.");
    return decode(value);
  };
export const AGENT_MCP_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_MCP_ROUTES.read, adminRoute(exact(["agentId"], fields({ agentId: identifier })), settings)],
  [
    AGENT_MCP_ROUTES.set,
    adminRoute(bounded(192 * 1024, exact(["agentId", "grants"], fields({ agentId: identifier, grants }))), settings),
  ],
  [
    AGENT_MCP_ROUTES.tools,
    adminRoute(
      exact(
        ["agentId", "mcpServerId", "query"],
        fields({ agentId: identifier, mcpServerId: identifier }, { query: string(256) }),
      ),
      bounded(192 * 1024, list(fields({ name: tool, description: string(512) }), 1000)),
    ),
  ],
]);
