import { randomUUID } from "node:crypto";
import type { AgentConversationSummary } from "@openbot/contracts/ipc-agent-conversations";
import { sourceText } from "@openbot/i18n/source";
import { type DatabaseCore, LOWERCASE_FUNCTION } from "../database/database-core";
import { databaseRow, databaseRows, requiredStringColumn } from "../database/database-rows";

/** Owns private user-conversation metadata and destination reads. Never imports the database facade. */
export class AgentConversationStore {
  readonly #core: DatabaseCore;
  constructor(core: DatabaseCore) {
    this.#core = core;
  }

  isUserThread(threadId: string): boolean {
    return (
      databaseRow(
        this.#core.connection
          .prepare("SELECT thread_id FROM agent_conversations WHERE thread_id = ? AND kind = 'user'")
          .get(threadId),
      ) !== null
    );
  }

  threads(agentId: string): string[] {
    return databaseRows(
      this.#core.connection
        .prepare(`SELECT t.thread_id FROM agent_conversations c
      JOIN projection_threads t USING(thread_id) WHERE t.agent_id = ? AND c.kind = 'user' ORDER BY t.thread_id`)
        .all(agentId),
    ).map((row) => requiredStringColumn(row, "thread_id"));
  }

  requireTarget(agentId: string, threadId: string, allowArchived = false): void {
    const row = databaseRow(
      this.#core.connection
        .prepare(`SELECT t.agent_id, c.archived_at,
      a.thread_id AS main_thread_id FROM projection_threads t LEFT JOIN agent_conversations c USING(thread_id)
      LEFT JOIN projection_agents a ON a.agent_id = t.agent_id WHERE t.thread_id = ?`)
        .get(threadId),
    );
    if (!row || row.agent_id !== agentId || (row.main_thread_id !== threadId && !this.isUserThread(threadId)))
      throw new Error(sourceText("error.agent.conversationUnavailable"));
    if (!allowArchived && row.archived_at !== null && row.archived_at !== undefined)
      throw new Error(sourceText("error.agent.conversationArchived"));
  }

  deliveryThread(deliveryId: string): string | null {
    const row = databaseRow(
      this.#core.connection
        .prepare("SELECT thread_id FROM agent_conversation_deliveries WHERE delivery_id = ?")
        .get(deliveryId),
    );
    return row ? requiredStringColumn(row, "thread_id") : null;
  }

  deliveryThreads(): Map<string, string> {
    return new Map(
      databaseRows(
        this.#core.connection.prepare("SELECT delivery_id, thread_id FROM agent_conversation_deliveries").all(),
      ).map((row) => [requiredStringColumn(row, "delivery_id"), requiredStringColumn(row, "thread_id")]),
    );
  }

  summary(agentId: string, threadId: string): AgentConversationSummary {
    this.requireTarget(agentId, threadId, true);
    const row = databaseRow(
      this.#core.connection
        .prepare(`SELECT t.updated_at, t.active_turn_id, c.label, c.archived_at, c.kind
      FROM projection_threads t LEFT JOIN agent_conversations c USING(thread_id) WHERE t.thread_id = ?`)
        .get(threadId),
    );
    if (!row) throw new Error(sourceText("error.agent.conversationUnavailable"));
    return {
      agentId,
      threadId,
      main: row.kind !== "user",
      label: typeof row.label === "string" ? row.label : null,
      archivedAt: typeof row.archived_at === "string" ? row.archived_at : null,
      updatedAt: requiredStringColumn(row, "updated_at"),
      activeTurnId: typeof row.active_turn_id === "string" ? row.active_turn_id : null,
      queuedCount: 0,
      requiresInput: false,
    };
  }

  list(
    agentId: string,
    mainThreadId: string,
    query = "",
    after = "",
    archived = false,
  ): { conversations: AgentConversationSummary[]; cursor: string | null } {
    const pattern = `%${query.toLocaleLowerCase().replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    const rows = databaseRows(
      this.#core.connection
        .prepare(`SELECT t.thread_id, c.label, c.archived_at,
      t.updated_at, t.active_turn_id FROM agent_conversations c JOIN projection_threads t USING(thread_id)
      WHERE t.agent_id = ? AND c.kind = 'user' AND (c.archived_at IS NOT NULL) = ? AND ${LOWERCASE_FUNCTION}(c.label) LIKE ? ESCAPE '\\'
        AND t.thread_id > ? ORDER BY t.thread_id LIMIT 51`)
        .all(agentId, archived ? 1 : 0, pattern, after),
    );
    const selected = rows.slice(0, 50).map(
      (row): AgentConversationSummary => ({
        agentId,
        threadId: requiredStringColumn(row, "thread_id"),
        label: requiredStringColumn(row, "label"),
        main: false,
        archivedAt: typeof row.archived_at === "string" ? row.archived_at : null,
        updatedAt: requiredStringColumn(row, "updated_at"),
        activeTurnId: typeof row.active_turn_id === "string" ? row.active_turn_id : null,
        queuedCount: 0,
        requiresInput: false,
      }),
    );
    if (!archived && !after)
      selected.unshift({
        agentId,
        threadId: mainThreadId,
        label: this.mainLabel(mainThreadId),
        main: true,
        archivedAt: null,
        updatedAt: "",
        activeTurnId: null,
        queuedCount: 0,
        requiresInput: false,
      });
    return { conversations: selected, cursor: rows.length > 50 ? (selected.at(-1)?.threadId ?? null) : null };
  }

  mainLabel(threadId: string): string | null {
    const row = databaseRow(
      this.#core.connection
        .prepare("SELECT label FROM agent_conversations WHERE thread_id = ? AND kind = 'main'")
        .get(threadId),
    );
    return row ? requiredStringColumn(row, "label") : null;
  }

  #requireLabel(label: string): void {
    if (!label.trim() || label.length > 160 || label.includes("\0")) throw new Error("Invalid conversation label.");
  }

  create(agentId: string, label: string): string {
    this.#requireLabel(label);
    const threadId = `openbot-conversation-${randomUUID()}`;
    const now = new Date().toISOString();
    this.#core.dispatch(
      `conversation-create:${randomUUID()}`,
      [
        {
          aggregateType: "agent-conversation",
          aggregateId: threadId,
          eventType: "agent-conversation.created",
          payload: { agentId, label },
        },
      ],
      (db, sequences) => {
        if (!databaseRow(db.prepare("SELECT agent_id FROM projection_agents WHERE agent_id = ?").get(agentId)))
          throw new Error(sourceText("error.agent.conversationUnavailable"));
        db.prepare(`INSERT INTO projection_threads (thread_id, agent_id, title, active_turn_id, created_at, updated_at, last_event_sequence)
        VALUES (?, ?, ?, NULL, ?, ?, ?)`).run(threadId, agentId, label, now, now, sequences[0] ?? 0);
        db.prepare(
          "INSERT INTO agent_conversations(thread_id, label, archived_at, last_event_sequence) VALUES (?, ?, NULL, ?)",
        ).run(threadId, label, sequences[0] ?? 0);
        return null;
      },
    );
    return threadId;
  }

  update(agentId: string, threadId: string, change: { label: string } | { archived: boolean }): void {
    this.requireTarget(agentId, threadId, true);
    const main = !this.isUserThread(threadId);
    if (main && "archived" in change) throw new Error(sourceText("error.agent.mainConversationFixed"));
    if ("label" in change) this.#requireLabel(change.label);
    this.#core.dispatch(
      `conversation-update:${randomUUID()}`,
      [
        {
          aggregateType: "agent-conversation",
          aggregateId: threadId,
          eventType: "agent-conversation.updated",
          payload: change,
        },
      ],
      (db, sequences) => {
        this.requireTarget(agentId, threadId, true);
        if ("archived" in change && change.archived) {
          const busy = databaseRow(
            db
              .prepare(`SELECT thread_id FROM projection_threads WHERE thread_id = ? AND active_turn_id IS NOT NULL
          UNION ALL SELECT b.thread_id FROM agent_conversation_deliveries b JOIN projection_deliveries d USING(delivery_id)
          WHERE b.thread_id = ? AND d.status IN ('queued', 'starting', 'running') LIMIT 1`)
              .get(threadId, threadId),
          );
          if (busy) throw new Error(sourceText("error.agent.conversationBusy"));
        }
        if (main && "label" in change) {
          db.prepare(
            "INSERT INTO agent_conversations(thread_id, kind, label, archived_at, last_event_sequence) VALUES (?, 'main', ?, NULL, ?) ON CONFLICT(thread_id) DO UPDATE SET label = excluded.label, last_event_sequence = excluded.last_event_sequence",
          ).run(threadId, change.label, sequences[0] ?? 0);
          return null;
        }
        if ("label" in change) {
          db.prepare("UPDATE agent_conversations SET label = ?, last_event_sequence = ? WHERE thread_id = ?").run(
            change.label,
            sequences[0] ?? 0,
            threadId,
          );
          db.prepare("UPDATE projection_threads SET title = ?, updated_at = ? WHERE thread_id = ?").run(
            change.label,
            new Date().toISOString(),
            threadId,
          );
        } else
          db.prepare("UPDATE agent_conversations SET archived_at = ?, last_event_sequence = ? WHERE thread_id = ?").run(
            change.archived ? new Date().toISOString() : null,
            sequences[0] ?? 0,
            threadId,
          );
        return null;
      },
    );
  }
}
