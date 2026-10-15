import { randomUUID } from "node:crypto";
import { AGENT_MCP_LIMITS, type AgentMcpGrants, agentMcpWithinBytes, isAgentMcpGrants } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { databaseRow, requiredStringColumn } from "./database/database-rows";
import { McpServerError } from "./mcp-server-store";
import type { OpenBotDatabase } from "./openbot-database";

/** Owns the agent-mcp aggregate. Grants contain IDs and tool names, never MCP credentials. */
export class AgentMcpGrantStore {
  constructor(private readonly database: OpenBotDatabase) {}

  read(agentId: string): AgentMcpGrants {
    const row = databaseRow(
      this.database.connection
        .prepare(
          "SELECT payload_json FROM orchestration_events WHERE aggregate_type = 'agent-mcp' AND aggregate_id = ? ORDER BY sequence DESC LIMIT 1",
        )
        .get(agentId),
    );
    if (!row) return null;
    const grants = JSON.parse(requiredStringColumn(row, "payload_json"));
    if (!isAgentMcpGrants(grants)) throw new Error("Invalid saved agent MCP grants.");
    return grants;
  }

  write(agentId: string, grants: AgentMcpGrants): void {
    if (!agentMcpWithinBytes(grants, AGENT_MCP_LIMITS.grantsBytes))
      throw new McpServerError(sourceText("error.backend.agentMcpSelectionTooLarge"));
    this.database.dispatch(
      randomUUID(),
      [
        {
          aggregateType: "agent-mcp",
          aggregateId: agentId,
          eventType: "agent-mcp.grants-set",
          payload: grants,
        },
      ],
      () => null,
    );
  }

  /** Used only for metadata owned by a new agent whose creation failed. */
  forget(agentId: string): void {
    const db = this.database.connection;
    const ownsTransaction = !db.isTransaction;
    if (ownsTransaction) db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "DELETE FROM orchestration_command_receipts WHERE command_id IN (SELECT command_id FROM orchestration_events WHERE aggregate_type = 'agent-mcp' AND aggregate_id = ?)",
      ).run(agentId);
      db.prepare("DELETE FROM orchestration_events WHERE aggregate_type = 'agent-mcp' AND aggregate_id = ?").run(
        agentId,
      );
      if (ownsTransaction) db.exec("COMMIT");
    } catch (error) {
      if (ownsTransaction && db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }
}
