/** Private local conversation identity and atomic mailbox destinations. No released wire changes. */
export const AGENT_CONVERSATION_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS agent_conversations (
    thread_id TEXT PRIMARY KEY REFERENCES projection_threads(thread_id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'user' CHECK(kind IN ('user', 'main')),
    label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 160),
    archived_at TEXT,
    last_event_sequence INTEGER NOT NULL REFERENCES orchestration_events(sequence)
  );
  CREATE TABLE IF NOT EXISTS agent_conversation_deliveries (
    delivery_id TEXT PRIMARY KEY REFERENCES projection_deliveries(delivery_id) ON DELETE CASCADE,
    thread_id TEXT NOT NULL REFERENCES projection_threads(thread_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS agent_conversation_destination ON agent_conversation_deliveries(thread_id);
  CREATE TRIGGER IF NOT EXISTS agent_conversation_delivery_owner
  BEFORE INSERT ON agent_conversation_deliveries
  WHEN NOT EXISTS (
    SELECT 1 FROM projection_deliveries d JOIN projection_threads t
      ON t.agent_id = d.recipient_agent_id
    WHERE d.delivery_id = NEW.delivery_id AND t.thread_id = NEW.thread_id
  ) BEGIN SELECT RAISE(ABORT, 'Conversation delivery owner mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS agent_conversation_thread_owner_update
  BEFORE UPDATE OF agent_id ON projection_threads
  WHEN EXISTS(SELECT 1 FROM agent_conversation_deliveries b JOIN projection_deliveries d USING(delivery_id)
    WHERE b.thread_id = NEW.thread_id AND d.recipient_agent_id IS NOT NEW.agent_id)
  BEGIN SELECT RAISE(ABORT, 'Conversation delivery owner mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS agent_conversation_recipient_update
  BEFORE UPDATE OF recipient_agent_id ON projection_deliveries
  WHEN EXISTS(SELECT 1 FROM agent_conversation_deliveries b JOIN projection_threads t USING(thread_id)
    WHERE b.delivery_id = NEW.delivery_id AND t.agent_id IS NOT NEW.recipient_agent_id)
  BEGIN SELECT RAISE(ABORT, 'Conversation delivery owner mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS agent_conversation_delivery_owner_update
  BEFORE UPDATE ON agent_conversation_deliveries
  WHEN NEW.thread_id IS NOT OLD.thread_id OR NEW.delivery_id IS NOT OLD.delivery_id
  BEGIN SELECT RAISE(ABORT, 'Conversation delivery destination is immutable'); END;
`;
