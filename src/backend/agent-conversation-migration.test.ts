// @vitest-environment node
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { databaseRows, requiredStringColumn } from "./database/database-rows";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Protect old conversation identity, history and queue state. A failed upgrade must leave no
// partial metadata, destination, trigger or marker. New destinations must keep their owner.
const databases: DatabaseSync[] = [];
const STAMP = "2026-10-01T07:00:00.000Z";
const UPGRADE_STAMP = "2026-10-02T08:00:00.000Z";
const TEXT = 'History 界 "quote" \\ survives.';
const NEW_TABLES = { agent_conversations: [], agent_conversation_deliveries: [] };
type TableRows = Record<string, Record<string, SQLOutputValue>[]>;

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function databaseAt(version: number): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  migrateUpTo(db, version);
  return db;
}

function migrateUpTo(db: DatabaseSync, version: number): void {
  db.exec(`CREATE TEMP TRIGGER stop_at_version BEFORE INSERT ON schema_migrations WHEN new.version > ${version}
    BEGIN SELECT RAISE(ABORT, 'fixture stop'); END;`);
  expect(() => migrateOpenBotDatabase(db, { appliedAt: STAMP })).toThrow(`migration to version ${version + 1} failed`);
  db.exec("DROP TRIGGER stop_at_version");
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version });
}

/** Inserts synthetic rows in the columns supported by the selected released schema. */
function seedRow(db: DatabaseSync, table: string, values: Readonly<Record<string, SQLInputValue>>): void {
  const columns = Object.keys(values);
  db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(
    ...Object.values(values),
  );
}

function seedThread(db: DatabaseSync, threadId: string, agentId: string): void {
  seedRow(db, "projection_threads", {
    thread_id: threadId,
    agent_id: agentId,
    title: TEXT,
    active_turn_id: threadId === "thread-main" ? "turn-main" : null,
    created_at: STAMP,
    updated_at: STAMP,
    last_event_sequence: 1,
  });
  seedRow(db, "projection_thread_messages", {
    thread_id: threadId,
    message_id: "same-message-id",
    turn_id: threadId === "thread-main" ? "turn-main" : null,
    author: "assistant",
    status: "completed",
    item_type: null,
    created_at: STAMP,
    ordinal: 0,
    message_json: JSON.stringify({ id: "same-message-id", text: TEXT, threadId }),
    last_event_sequence: 1,
  });
  seedRow(db, "projection_thread_reads", {
    thread_id: threadId,
    member_id: "synthetic-member",
    through_message_id: "same-message-id",
    updated_at: STAMP,
  });
  seedRow(db, "projection_thread_read_baselines", {
    thread_id: threadId,
    through_message_id: "same-message-id",
    initialized_at: STAMP,
  });
}

function seedDelivery(db: DatabaseSync, deliveryId: string, recipientAgentId: string): void {
  seedRow(db, "projection_mailbox_messages", {
    message_id: `message-${deliveryId}`,
    sender_kind: "user",
    sender_agent_id: null,
    text: TEXT,
    reply_to_message_id: null,
    created_at: STAMP,
    message_json: JSON.stringify({ id: `message-${deliveryId}`, text: TEXT }),
    last_event_sequence: 1,
  });
  seedRow(db, "projection_deliveries", {
    delivery_id: deliveryId,
    message_id: `message-${deliveryId}`,
    recipient_agent_id: recipientAgentId,
    status: "queued",
    turn_id: null,
    error: null,
    created_at: STAMP,
    delivery_json: JSON.stringify({ id: deliveryId, recipientAgentId, status: "queued" }),
    last_event_sequence: 1,
  });
}

function seed(db: DatabaseSync, version: number): void {
  seedRow(db, "orchestration_events", {
    sequence: 1,
    event_id: "synthetic-event",
    command_id: "synthetic-command",
    aggregate_type: "thread",
    aggregate_id: "thread-main",
    event_type: "thread.created",
    occurred_at: STAMP,
    payload_json: JSON.stringify({ threadId: "thread-main", text: TEXT }),
  });
  seedRow(db, "orchestration_command_receipts", {
    command_id: "synthetic-command",
    accepted_at: STAMP,
    first_sequence: 1,
    last_sequence: 1,
    result_json: JSON.stringify({ id: "thread-main" }),
  });
  seedThread(db, "thread-main", "chief");
  seedThread(db, "thread-other", "other-agent");
  seedThread(db, "thread-execution", "chief");
  for (const { agentId, threadId } of [
    { agentId: "chief", threadId: "thread-main" },
    { agentId: "other-agent", threadId: "thread-other" },
  ]) {
    seedRow(db, "projection_agents", {
      agent_id: agentId,
      thread_id: threadId,
      model: "synthetic-model",
      updated_at: STAMP,
      sort_order: agentId === "chief" ? 0 : 1,
      agent_json: JSON.stringify({ id: agentId, threadId, provider: "codex", name: TEXT }),
      last_event_sequence: 1,
    });
  }
  for (const { id, provider, state } of [
    { id: "session-main", provider: "codex", state: "inactive" },
    { id: "session-previous", provider: "claude", state: "failed" },
  ]) {
    seedRow(db, "projection_provider_sessions", {
      id,
      thread_id: "thread-main",
      provider,
      external_session_id: `synthetic-${id}`,
      model: "synthetic-model",
      effort: "medium",
      state,
      created_at: STAMP,
      updated_at: STAMP,
      resume_cursor: `synthetic-cursor-${id}`,
      last_event_sequence: 1,
    });
  }
  seedRow(db, "projection_turns", {
    turn_id: "turn-main",
    thread_id: "thread-main",
    provider_session_id: "session-main",
    status: "running",
    started_at: STAMP,
    completed_at: null,
    last_event_sequence: 1,
  });
  seedRow(db, "projection_thread_activities", {
    activity_id: "activity-main",
    thread_id: "thread-main",
    turn_id: "turn-main",
    activity_type: "command",
    payload_json: JSON.stringify({ text: TEXT }),
    created_at: STAMP,
    last_event_sequence: 1,
  });
  seedRow(db, "projection_thread_summaries", {
    summary_id: "summary-main",
    thread_id: "thread-main",
    through_message_id: "same-message-id",
    summary_text: TEXT,
    estimated_tokens: 12,
    created_at: STAMP,
    last_event_sequence: 1,
  });
  seedDelivery(db, "delivery-main", "chief");
  seedDelivery(db, "delivery-next", "chief");
  seedDelivery(db, "delivery-other", "other-agent");
  seedRow(db, "projection_queue_state", {
    agent_id: "chief",
    paused: 1,
    metadata_json: JSON.stringify({ reason: TEXT, queuedDeliveryIds: ["delivery-main", "delivery-next"] }),
    last_event_sequence: 1,
  });
  seedRow(db, "projection_attachments", {
    attachment_id: "attachment-main",
    owner_kind: "message",
    owner_id: "same-message-id",
    name: "Synthetic 界.txt",
    path: "/synthetic/attachments/fixture.txt",
    metadata_json: JSON.stringify({ mimeType: "text/plain", size: 12, threadId: "thread-main" }),
    created_at: STAMP,
    last_event_sequence: 1,
  });
  seedUnrelatedRows(db, version);
}

function seedUnrelatedRows(db: DatabaseSync, version: number): void {
  seedRow(db, "projection_agent_memories", {
    memory_id: "memory-old",
    agent_id: "chief",
    text: TEXT,
    normalized_text: TEXT.toLowerCase(),
    origin: "manual",
    source_turn_id: "turn-main",
    created_at: STAMP,
    updated_at: STAMP,
    last_event_sequence: 1,
  });
  seedRow(db, "projection_agent_routines", {
    routine_id: "routine-old",
    agent_id: "chief",
    name: TEXT,
    instruction: TEXT,
    active: 1,
    timezone: "UTC",
    created_at: STAMP,
    updated_at: STAMP,
    last_event_sequence: 1,
  });
  seedRow(db, "projection_routine_triggers", {
    trigger_id: "trigger-old",
    routine_id: "routine-old",
    schedule_json: JSON.stringify({ kind: "cron", cron: "0 7 * * *" }),
    next_run_at: UPGRADE_STAMP,
    created_at: STAMP,
    updated_at: STAMP,
    last_event_sequence: 1,
  });
  seedRow(db, "projection_routine_runs", {
    run_id: "run-old",
    routine_id: "routine-old",
    agent_id: "chief",
    trigger_id: "trigger-old",
    run_kind: "scheduled",
    scheduled_for: STAMP,
    routine_name: TEXT,
    instruction: TEXT,
    delivery_id: "delivery-main",
    status: "succeeded",
    error: null,
    created_at: STAMP,
    updated_at: STAMP,
    last_event_sequence: 1,
  });
  seedRow(db, "projection_direct_threads", {
    thread_id: "direct-old",
    member_a_id: "synthetic-a",
    member_b_id: "synthetic-b",
    created_at: STAMP,
    updated_at: STAMP,
    last_message_id: "direct-message-old",
    last_event_sequence: 1,
  });
  seedRow(db, "projection_direct_messages", {
    message_id: "direct-message-old",
    thread_id: "direct-old",
    sender_member_id: "synthetic-a",
    recipient_member_id: "synthetic-b",
    text: TEXT,
    created_at: STAMP,
    message_json: JSON.stringify({ id: "direct-message-old", text: TEXT }),
    last_event_sequence: 1,
  });
  seedRow(db, "projection_direct_reads", {
    thread_id: "direct-old",
    member_id: "synthetic-b",
    last_read_sequence: 1,
    updated_at: STAMP,
  });
  seedRow(db, "file_deletion_outbox", {
    id: "deletion-old",
    path: "/synthetic/attachments/deleted.txt",
    reason: TEXT,
    created_at: STAMP,
    attempts: 2,
    last_error: "Synthetic failed removal",
  });
  if (version >= 15) {
    seedRow(db, "agent_usage_records", {
      agent_id: "chief",
      record_id: "usage-old",
      session_id: "session-main",
      turn_id: "turn-main",
      provider: "codex",
      model: "synthetic-model",
      occurred_at: STAMP,
      tokens_json: JSON.stringify({ input: 12, output: 6 }),
      estimated_cost_usd: 0.001,
      rate_basis: "synthetic",
      recorded_at: STAMP,
    });
  }
  if (version >= 18) {
    seedRow(db, "projection_channels", {
      channel_id: "channel-old",
      channel_json: JSON.stringify({ id: "channel-old", name: TEXT }),
    });
    seedRow(db, "projection_channel_contexts", {
      channel_id: "channel-old",
      agent_id: "chief",
      thread_id: "thread-execution",
      session_id: null,
      through_sequence: 1,
      summary_version: 0,
    });
  }
  if (version >= 19) {
    seedRow(db, "projection_channel_memories", {
      memory_id: "channel-memory-old",
      channel_id: "channel-old",
      text: TEXT,
      normalized_text: TEXT.toLowerCase(),
      origin: "manual",
      source_turn_id: "turn-main",
      created_at: STAMP,
      updated_at: STAMP,
      last_event_sequence: 1,
    });
  }
  if (version >= 20) {
    seedRow(db, "projection_mcp_servers", {
      mcp_server_id: "mcp-old",
      name: "synthetic-mcp",
      transport: "stdio",
      enabled: 0,
      command: "synthetic-command",
      args_json: "[]",
      env_json: "{}",
      env_passthrough_json: "[]",
      working_directory: "/synthetic/workspace",
      url: "",
      headers_json: "{}",
      position: 0,
      created_at: STAMP,
      updated_at: STAMP,
    });
  }
  if (version >= 25) seedSharedMessagingThread(db);
  if (version >= 29) seedProviderHistory(db);
  if (version >= 30) {
    seedRow(db, "projection_routine_webhooks", {
      routine_id: "routine-old",
      route_id: "synthetic-route",
      event_type: "synthetic-event",
      filters_json: "[]",
      secret_ciphertext: "synthetic-ciphertext",
      url: null,
      created_at: STAMP,
      updated_at: STAMP,
      last_event_sequence: 1,
    });
  }
  if (version >= 31) {
    seedRow(db, "routine_flow_links", {
      link_id: "flow-old",
      routine_id: "routine-old",
      from_agent_id: "chief",
      to_agent_id: "other-agent",
      instruction: TEXT,
      created_at: STAMP,
    });
  }
  if (version >= 34) {
    seedRow(db, "agent_waits", {
      wait_id: "wait-old",
      agent_id: "chief",
      request_delivery_id: "delivery-main",
      request_text: TEXT,
      note: TEXT,
      routine_id: "routine-old",
      created_at: STAMP,
      woken_at: null,
      wake_delivery_id: null,
    });
  }
  if (version >= 36) {
    seedRow(db, "projection_messaging_memories", {
      memory_id: "messaging-memory-old",
      connection_id: "connection-old",
      text: TEXT,
      normalized_text: TEXT.toLowerCase(),
      origin: "manual",
      source_turn_id: "turn-main",
      created_at: STAMP,
      updated_at: STAMP,
      last_event_sequence: 1,
    });
  }
  if (version >= 37) {
    seedRow(db, "routine_result_destinations", {
      routine_id: "routine-old",
      connection_id: "connection-old",
      platform: "slack",
      connection_name: TEXT,
      place_id: "synthetic-place",
      place_name: TEXT,
      updated_at: STAMP,
    });
    seedRow(db, "routine_result_deliveries", {
      run_id: "run-old",
      routine_id: "routine-old",
      agent_id: "chief",
      connection_id: "connection-old",
      platform: "slack",
      connection_name: TEXT,
      place_id: "synthetic-place",
      place_name: TEXT,
      text: TEXT,
      status: "sent",
      reason: null,
      attempts: 1,
      next_attempt_at: null,
      expires_at: null,
      sent_at: STAMP,
      created_at: STAMP,
      updated_at: STAMP,
    });
  }
}

function seedSharedMessagingThread(db: DatabaseSync): void {
  seedRow(db, "projection_messaging_connections", {
    connection_id: "connection-old",
    platform: "slack",
    workspace_id: "synthetic-workspace",
    workspace_name: TEXT,
    enabled: 1,
    bot_user_id: "synthetic-app-user",
    app_id: "synthetic-app",
    orchestrator_agent_id: "chief",
    last_error_code: null,
    created_at: STAMP,
    updated_at: STAMP,
  });
  // Main #2120 keeps an already shared main/messaging history. The new registry must not split it.
  seedRow(db, "projection_messaging_threads", {
    link_id: "messaging-link-old",
    connection_id: "connection-old",
    agent_id: "chief",
    platform_channel_id: "synthetic-place",
    thread_key: "synthetic-thread-key",
    is_direct: 1,
    thread_id: "thread-main",
    title: TEXT,
    history_cursor: "synthetic-history-cursor",
    created_at: STAMP,
    updated_at: STAMP,
  });
}

function seedProviderHistory(db: DatabaseSync): void {
  seedRow(db, "provider_history_imports", {
    session_id: "history-old",
    thread_id: "thread-main",
    provider: "codex",
    external_session_id: "synthetic-history-session",
    cursor_json: JSON.stringify({ cursor: "synthetic-page", complete: false }),
    state: "failed",
    created_at: STAMP,
    updated_at: STAMP,
  });
  seedRow(db, "provider_history_turns", {
    session_id: "history-old",
    turn_id: "history-turn-old",
    turn_status: "completed",
    turn_started_at: 1,
    complete: 1,
    imported: 0,
    updated_at: STAMP,
  });
  seedRow(db, "provider_history_staging", {
    session_id: "history-old",
    turn_id: "history-turn-old",
    item_key: "history-item-old",
    item_index: 0,
    item_json: JSON.stringify({ id: "history-item-old", text: TEXT }),
    imported: 0,
    updated_at: STAMP,
  });
}

/** Includes all old tables, FTS rows and shadow tables, and the AUTOINCREMENT state. */
function contents(db: DatabaseSync): TableRows {
  const tables = databaseRows(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name <> 'schema_migrations' ORDER BY name").all(),
  ).map((row) => requiredStringColumn(row, "name"));
  return Object.fromEntries(
    tables.map((table) => [table, db.prepare(`SELECT * FROM "${table.replaceAll('"', '""')}"`).all()]),
  );
}

function schemaObjects(db: DatabaseSync) {
  return db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").all();
}

/** Earlier released migrations add columns. Every seeded value and row must still be present. */
function preservedRows(before: TableRows, after: TableRows): void {
  for (const [table, oldRows] of Object.entries(before)) {
    const currentRows = after[table];
    if (!currentRows) throw new Error(`Fixture table ${table} disappeared.`);
    const oldColumns = new Set(oldRows.flatMap((row) => Object.keys(row)));
    expect(
      currentRows.map((row) => Object.fromEntries(Object.entries(row).filter(([column]) => oldColumns.has(column)))),
      `Released rows in ${table}`,
    ).toEqual(oldRows);
  }
}

function markers(db: DatabaseSync) {
  return db.prepare("SELECT * FROM schema_migrations ORDER BY version").all();
}

function healthy(db: DatabaseSync): void {
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

function databaseAtWithSeed(version: number): DatabaseSync {
  const db = databaseAt(version);
  seed(db, version);
  return db;
}

function register(db: DatabaseSync, threadId: string): void {
  db.prepare(
    "INSERT INTO agent_conversations(thread_id, kind, label, archived_at, last_event_sequence) VALUES (?, 'user', ?, NULL, 1)",
  ).run(threadId, TEXT);
}

function bind(db: DatabaseSync, deliveryId: string, threadId: string): void {
  db.prepare("INSERT INTO agent_conversation_deliveries(delivery_id, thread_id) VALUES (?, ?)").run(
    deliveryId,
    threadId,
  );
}

describe("agent conversation migration", () => {
  it.each(Array.from({ length: 30 }, (_, index) => index + 8))(
    "keeps every old row and thread identity from released schema %i",
    (version) => {
      const db = databaseAtWithSeed(version);
      const original = contents(db);
      if (version < 37) migrateUpTo(db, 37);
      preservedRows(original, contents(db));
      const before = contents(db);
      const beforeMarkers = markers(db);
      migrateOpenBotDatabase(db, { appliedAt: UPGRADE_STAMP });
      expect(contents(db)).toEqual({ ...before, ...NEW_TABLES });
      expect(markers(db)).toEqual([...beforeMarkers, { version: 38, applied_at: UPGRADE_STAMP }]);
      healthy(db);
      // A repeated startup does not allocate a new identity, destination or event sequence.
      migrateOpenBotDatabase(db, { appliedAt: "2026-10-03T08:00:00.000Z" });
      expect(contents(db)).toEqual({ ...before, ...NEW_TABLES });
      expect(markers(db)).toEqual([...beforeMarkers, { version: 38, applied_at: UPGRADE_STAMP }]);
    },
  );

  it("rolls back all DDL, old data and the marker after a late failure, then retries", () => {
    const db = databaseAtWithSeed(37);
    const before = contents(db);
    const beforeSchema = schemaObjects(db);
    const beforeMarkers = markers(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=38
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 38 failed");
    expect(contents(db)).toEqual(before);
    expect(schemaObjects(db)).toEqual(beforeSchema);
    expect(markers(db)).toEqual(beforeMarkers);
    healthy(db);
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db, { appliedAt: UPGRADE_STAMP });
    expect(contents(db)).toEqual({ ...before, ...NEW_TABLES });
    expect(markers(db)).toEqual([...beforeMarkers, { version: 38, applied_at: UPGRADE_STAMP }]);
    healthy(db);
  });

  it.each([39, 40])("refuses newer version %i before it changes schema or data", (version) => {
    const db = databaseAtWithSeed(37);
    db.prepare("INSERT INTO schema_migrations VALUES (?, ?)").run(version, STAMP);
    const before = contents(db);
    const beforeSchema = schemaObjects(db);
    const beforeMarkers = markers(db);
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    expect(contents(db)).toEqual(before);
    expect(schemaObjects(db)).toEqual(beforeSchema);
    expect(markers(db)).toEqual(beforeMarkers);
  });

  it.each([8, 20, 36])("refuses missing history version %i before it changes schema or data", (version) => {
    const db = databaseAtWithSeed(37);
    db.prepare("DELETE FROM schema_migrations WHERE version=?").run(version);
    const before = contents(db);
    const beforeSchema = schemaObjects(db);
    const beforeMarkers = markers(db);
    expect(() => migrateOpenBotDatabase(db)).toThrow(`missing version ${version}`);
    expect(contents(db)).toEqual(before);
    expect(schemaObjects(db)).toEqual(beforeSchema);
    expect(markers(db)).toEqual(beforeMarkers);
  });

  it("rolls back DDL and its marker for an old foreign-key violation, then retries after repair", () => {
    const db = databaseAtWithSeed(37);
    db.exec("PRAGMA foreign_keys=OFF");
    db.prepare("UPDATE projection_provider_sessions SET thread_id='missing-thread' WHERE id='session-previous'").run();
    db.exec("PRAGMA foreign_keys=ON");
    const before = contents(db);
    const beforeSchema = schemaObjects(db);
    const beforeMarkers = markers(db);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toHaveLength(1);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 38 failed");
    expect(contents(db)).toEqual(before);
    expect(schemaObjects(db)).toEqual(beforeSchema);
    expect(markers(db)).toEqual(beforeMarkers);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.prepare("UPDATE projection_provider_sessions SET thread_id='thread-main' WHERE id='session-previous'").run();
    const repaired = contents(db);
    migrateOpenBotDatabase(db);
    expect(contents(db)).toEqual({ ...repaired, ...NEW_TABLES });
    healthy(db);
  });

  it("refuses startup for an actual CHECK violation without changing the old data, then accepts repair", () => {
    const db = databaseAtWithSeed(37);
    db.exec("PRAGMA ignore_check_constraints=ON");
    db.prepare("UPDATE projection_agent_routines SET active=2 WHERE routine_id='routine-old'").run();
    db.exec("PRAGMA ignore_check_constraints=OFF");
    const before = contents(db);
    expect(db.prepare("PRAGMA quick_check").get()).not.toEqual({ quick_check: "ok" });
    expect(() => migrateOpenBotDatabase(db)).toThrow("failed its integrity check");
    // The stable boundary checks integrity after commit. It rejects startup and retains old rows.
    expect(contents(db)).toEqual({ ...before, ...NEW_TABLES });
    expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 38 });
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.prepare("UPDATE projection_agent_routines SET active=1 WHERE routine_id='routine-old'").run();
    migrateOpenBotDatabase(db);
    healthy(db);
  });

  it("refuses missing thread and event references without changing existing history", () => {
    const db = databaseAtWithSeed(37);
    migrateOpenBotDatabase(db);
    const before = contents(db);
    expect(() => register(db, "missing-thread")).toThrow("FOREIGN KEY constraint failed");
    expect(() =>
      db.prepare("INSERT INTO agent_conversations VALUES ('thread-main', 'user', 'Synthetic', NULL, 99)").run(),
    ).toThrow("FOREIGN KEY constraint failed");
    expect(contents(db)).toEqual(before);
    healthy(db);
  });

  it("keeps accepted destinations immutable and refuses foreign delivery and thread owners", () => {
    const db = databaseAtWithSeed(37);
    migrateOpenBotDatabase(db);
    register(db, "thread-main");
    bind(db, "delivery-main", "thread-main");
    const before = contents(db);
    expect(() => bind(db, "delivery-other", "thread-main")).toThrow("Conversation delivery owner mismatch");
    expect(() => bind(db, "delivery-next", "thread-other")).toThrow("Conversation delivery owner mismatch");
    expect(() => bind(db, "delivery-next", "missing-thread")).toThrow("Conversation delivery owner mismatch");
    expect(() => bind(db, "missing-delivery", "thread-main")).toThrow("Conversation delivery owner mismatch");
    expect(() => db.prepare("UPDATE agent_conversation_deliveries SET thread_id='thread-execution'").run()).toThrow(
      "Conversation delivery destination is immutable",
    );
    expect(() => db.prepare("UPDATE agent_conversation_deliveries SET delivery_id='delivery-next'").run()).toThrow(
      "Conversation delivery destination is immutable",
    );
    expect(() =>
      db
        .prepare("UPDATE projection_deliveries SET recipient_agent_id='other-agent' WHERE delivery_id='delivery-main'")
        .run(),
    ).toThrow("Conversation delivery owner mismatch");
    expect(() =>
      db.prepare("UPDATE projection_threads SET agent_id='other-agent' WHERE thread_id='thread-main'").run(),
    ).toThrow("Conversation delivery owner mismatch");
    db.prepare("UPDATE projection_deliveries SET recipient_agent_id='chief' WHERE delivery_id='delivery-main'").run();
    db.prepare("UPDATE projection_threads SET agent_id='chief' WHERE thread_id='thread-main'").run();
    db.prepare("UPDATE agent_conversation_deliveries SET thread_id=thread_id, delivery_id=delivery_id").run();
    expect(contents(db)).toEqual(before);
    healthy(db);
  });

  it("cascades only destination metadata when a delivery or its mailbox message is deleted", () => {
    const db = databaseAtWithSeed(37);
    migrateOpenBotDatabase(db);
    register(db, "thread-main");
    bind(db, "delivery-main", "thread-main");
    bind(db, "delivery-next", "thread-main");
    const threads = db.prepare("SELECT * FROM projection_threads ORDER BY thread_id").all();
    const messages = db.prepare("SELECT * FROM projection_thread_messages ORDER BY thread_id, message_id").all();
    db.prepare("DELETE FROM projection_deliveries WHERE delivery_id='delivery-main'").run();
    expect(db.prepare("SELECT * FROM agent_conversation_deliveries").all()).toEqual([
      { delivery_id: "delivery-next", thread_id: "thread-main" },
    ]);
    db.prepare("DELETE FROM projection_mailbox_messages WHERE message_id='message-delivery-next'").run();
    expect(db.prepare("SELECT * FROM agent_conversation_deliveries").all()).toEqual([]);
    expect(db.prepare("SELECT * FROM projection_threads ORDER BY thread_id").all()).toEqual(threads);
    expect(db.prepare("SELECT * FROM projection_thread_messages ORDER BY thread_id, message_id").all()).toEqual(
      messages,
    );
    expect(db.prepare("SELECT thread_id FROM agent_conversations").all()).toEqual([{ thread_id: "thread-main" }]);
    expect(db.prepare("SELECT delivery_id FROM projection_deliveries").all()).toEqual([
      { delivery_id: "delivery-other" },
    ]);
    healthy(db);
  });

  it("cascades a deleted user thread's metadata without deleting accepted mailbox data or another thread", () => {
    const db = databaseAtWithSeed(37);
    migrateOpenBotDatabase(db);
    seedThread(db, "thread-user", "chief");
    register(db, "thread-user");
    register(db, "thread-other");
    bind(db, "delivery-main", "thread-user");
    bind(db, "delivery-other", "thread-other");
    const deliveries = db.prepare("SELECT * FROM projection_deliveries ORDER BY delivery_id").all();
    const mailbox = db.prepare("SELECT * FROM projection_mailbox_messages ORDER BY message_id").all();
    const otherMessages = db.prepare("SELECT * FROM projection_thread_messages WHERE thread_id='thread-other'").all();
    db.prepare("DELETE FROM projection_threads WHERE thread_id='thread-user'").run();
    expect(db.prepare("SELECT thread_id FROM agent_conversations").all()).toEqual([{ thread_id: "thread-other" }]);
    expect(db.prepare("SELECT * FROM agent_conversation_deliveries").all()).toEqual([
      { delivery_id: "delivery-other", thread_id: "thread-other" },
    ]);
    expect(db.prepare("SELECT * FROM projection_thread_messages WHERE thread_id='thread-user'").all()).toEqual([]);
    expect(db.prepare("SELECT * FROM projection_thread_reads WHERE thread_id='thread-user'").all()).toEqual([]);
    expect(db.prepare("SELECT * FROM projection_thread_read_baselines WHERE thread_id='thread-user'").all()).toEqual(
      [],
    );
    expect(db.prepare("SELECT * FROM projection_thread_messages WHERE thread_id='thread-other'").all()).toEqual(
      otherMessages,
    );
    expect(db.prepare("SELECT * FROM projection_deliveries ORDER BY delivery_id").all()).toEqual(deliveries);
    expect(db.prepare("SELECT * FROM projection_mailbox_messages ORDER BY message_id").all()).toEqual(mailbox);
    healthy(db);
  });
});
