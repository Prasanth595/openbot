import { createHash, randomUUID } from "node:crypto";
import {
  type AgentMemoryDirectoryMetadata,
  MEMORY_DIRECTORY_LIMITS,
  type MemoryDirectoryAnnotation,
  type MemoryDirectoryEntry,
  type MemoryDirectoryPage,
  type MemoryDirectoryRead,
  memoryDirectoryAnnotationBytes,
  normalizeMemoryDirectoryQuery,
  type SetAgentMemoryDirectoryInput,
} from "@openbot/contracts/agent-memory-directory";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentMemory } from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { Schema } from "effect";
import { databaseRow, requiredNumberColumn, requiredStringColumn } from "./database/database-rows";
import type { OpenBotDatabase } from "./openbot-database";

const EVENT_TYPE = "agent-memory.directory-set.v1";
const identifier = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(INPUT_LIMITS.identifier));
const revision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const annotationSchema = Schema.Struct({
  title: Schema.NullOr(Schema.String.check(Schema.isMaxLength(MEMORY_DIRECTORY_LIMITS.title))),
  aliases: Schema.Array(Schema.String.check(Schema.isMaxLength(MEMORY_DIRECTORY_LIMITS.alias))).check(
    Schema.isMaxLength(MEMORY_DIRECTORY_LIMITS.aliases),
  ),
});
const storedAnnotationSchema = Schema.Struct({
  title: Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MEMORY_DIRECTORY_LIMITS.title))),
  aliases: Schema.Array(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MEMORY_DIRECTORY_LIMITS.alias)),
  ).check(Schema.isMaxLength(MEMORY_DIRECTORY_LIMITS.aliases)),
});
const annotationEventSchema = Schema.Struct({
  version: Schema.Literal(1),
  agentId: identifier,
  memoryId: identifier,
  memoryUpdatedAt: Schema.String,
  memoryTextDigest: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
  memoryRevisionAtWrite: revision,
  title: storedAnnotationSchema.fields.title,
  aliases: storedAnnotationSchema.fields.aliases,
  actor: Schema.Literals(["user", "agent"]),
  annotationSourceTurnId: Schema.NullOr(Schema.String),
});
type AnnotationEvent = typeof annotationEventSchema.Type;

export class AgentMemoryDirectoryError extends Schema.TaggedError<AgentMemoryDirectoryError>()(
  "AgentMemoryDirectoryError",
  {
    code: Schema.Literals(["conflict", "user-controlled", "query", "invalid", "missing", "budget"]),
    message: Schema.String,
  },
) {}

interface DirectoryRecord {
  memory: AgentMemory;
  inclusion: "essential" | "searchable";
  userControlled: boolean;
  memoryRevision: number;
  annotation: AnnotationEvent | null;
  annotationRevision: number | null;
}

/** Owns private hints for current facts, through the existing memory aggregate and transaction. */
export class AgentMemoryDirectory {
  constructor(readonly database: OpenBotDatabase) {}

  metadata(agentId: string, memoryId: string, redact = redactText): AgentMemoryDirectoryMetadata | null {
    const record = this.#get(agentId, memoryId);
    if (!record) return null;
    return {
      ...this.#entry(record, redact),
      annotationRevision: record.annotationRevision,
      actor: record.annotation?.title ? record.annotation.actor : null,
      annotationUserControlled: record.annotation?.actor === "user" && record.annotation.title !== null,
    };
  }

  /** Current token includes a stale label or a removed label, for staged and editor writes. */
  annotationRevision(agentId: string, memoryId: string): number | null {
    return this.#get(agentId, memoryId)?.annotationRevision ?? null;
  }

  set(
    input: SetAgentMemoryDirectoryInput,
    actor: "user" | "agent",
    sourceTurnId: string | null,
  ): AgentMemoryDirectoryMetadata {
    const record = this.#get(input.agentId, input.memoryId);
    if (!record) throw directoryError("missing");
    if (
      record.memoryRevision !== input.expectedMemoryRevision ||
      record.annotationRevision !== input.expectedAnnotationRevision
    )
      throw directoryError("conflict");
    if (actor === "agent" && record.annotation?.actor === "user" && record.annotation.title !== null)
      throw directoryError("user-controlled");
    this.#write(record, input, actor, sourceTurnId);
    const saved = this.metadata(input.agentId, input.memoryId);
    if (!saved) throw directoryError("missing");
    return saved;
  }

  /** Called before the fact mutation, so any conflict leaves the fact and its hints unchanged. */
  checkAutomatic(
    agentId: string,
    memoryId: string,
    expectedAnnotationRevision: number | null,
    annotation: MemoryDirectoryAnnotation,
    merging: boolean,
  ): void {
    const record = this.#get(agentId, memoryId);
    if (!record || record.annotationRevision !== expectedAnnotationRevision) throw directoryError("conflict");
    if (record.annotation?.actor === "user" && record.annotation.title !== null)
      throw directoryError("user-controlled");
    if (
      merging &&
      record.annotation?.title !== null &&
      record.annotation &&
      JSON.stringify({ title: record.annotation.title, aliases: record.annotation.aliases }) !==
        JSON.stringify(annotation)
    )
      throw directoryError("conflict");
  }

  checkMerge(agentId: string, sourceId: string, targetId: string): void {
    const source = this.#get(agentId, sourceId);
    const target = this.#get(agentId, targetId);
    if (!source || !target) throw directoryError("conflict");
    if (source.annotation?.actor === "user" && source.annotation.title !== null)
      throw directoryError("user-controlled");
    if (
      this.#isCurrent(source) &&
      this.#isCurrent(target) &&
      source.annotation?.title &&
      target.annotation?.title &&
      JSON.stringify({ title: source.annotation.title, aliases: source.annotation.aliases }) !==
        JSON.stringify({ title: target.annotation.title, aliases: target.annotation.aliases })
    )
      throw directoryError("conflict");
  }

  /** The enclosing memory transaction owns atomicity and passes the actual deduplicated ID. */
  annotateAutomatic(
    agentId: string,
    memoryId: string,
    annotation: MemoryDirectoryAnnotation,
    sourceTurnId: string,
  ): void {
    const record = this.#get(agentId, memoryId);
    if (!record) throw directoryError("missing");
    if (record.annotation?.actor === "user" && record.annotation.title !== null)
      throw directoryError("user-controlled");
    this.#write(record, annotation, "agent", sourceTurnId);
  }

  copyCurrent(sourceAgentId: string, sourceMemoryId: string, targetAgentId: string, targetMemoryId: string): void {
    const source = this.#get(sourceAgentId, sourceMemoryId);
    const target = this.#get(targetAgentId, targetMemoryId);
    if (!source || !target || !this.#isCurrent(source) || !source.annotation?.title) return;
    this.#write(
      target,
      { title: source.annotation.title, aliases: source.annotation.aliases },
      source.annotation.actor,
      null,
    );
  }

  list(agentId: string, query = "", cursor: string | null = null, redact = redactText): MemoryDirectoryPage {
    if (query.length > MEMORY_DIRECTORY_LIMITS.query) throw directoryError("query");
    const normalizedQuery = normalizeMemoryDirectoryQuery(query);
    const after = cursor === null ? null : decodeCursor(agentId, normalizedQuery, cursor);
    const scanLimit = normalizedQuery ? MEMORY_DIRECTORY_LIMITS.filteredScan : MEMORY_DIRECTORY_LIMITS.scan;
    const records = this.#rows(agentId, after, scanLimit);
    const count = databaseRow(
      this.database.connection
        .prepare(
          `SELECT COUNT(*) AS count FROM projection_agent_memories m JOIN agent_memory_selections s
       ON s.memory_id = m.memory_id WHERE m.agent_id = ? AND s.inclusion = 'searchable'`,
        )
        .get(agentId),
    );
    const result: MemoryDirectoryPage = {
      entries: [],
      searchableCount: Number(count?.count ?? 0),
      scanned: 0,
      hasMore: false,
      nextCursor: null,
    };
    let examined = after;
    for (const record of records) {
      result.scanned += 1;
      const entry = this.#entry(record, redact);
      const matches =
        !normalizedQuery ||
        [entry.title, ...entry.aliases].some((hint) => normalizeMemoryDirectoryQuery(hint).includes(normalizedQuery));
      const nextCursor = encodeCursor(agentId, normalizedQuery, record.memory.id);
      const candidate = {
        ...result,
        entries: matches ? [...result.entries, entry] : result.entries,
        hasMore: true,
        nextCursor,
      };
      if (Buffer.byteLength(redact(JSON.stringify(candidate)), "utf8") > MEMORY_DIRECTORY_LIMITS.responseBytes) {
        if (examined === after) throw directoryError("budget");
        // This row was inspected, but its ID stays after the cursor until its entry fits.
        result.hasMore = true;
        break;
      }
      if (matches) result.entries.push(entry);
      examined = record.memory.id;
    }
    if (!result.hasMore && examined !== null) {
      result.hasMore =
        this.database.connection
          .prepare(
            `SELECT 1 FROM projection_agent_memories m JOIN agent_memory_selections s ON s.memory_id = m.memory_id
         WHERE m.agent_id = ? AND s.inclusion = 'searchable' AND m.memory_id > ? LIMIT 1`,
          )
          .get(agentId, examined) !== undefined;
    }
    result.nextCursor = result.hasMore && examined !== null ? encodeCursor(agentId, normalizedQuery, examined) : null;
    if (Buffer.byteLength(redact(JSON.stringify(result)), "utf8") > MEMORY_DIRECTORY_LIMITS.responseBytes)
      throw directoryError("budget");
    return result;
  }

  read(
    agentId: string,
    memoryId: string,
    expectedMemoryRevision: number,
    expectedDirectoryRevision: number | null,
  ): MemoryDirectoryRead {
    const record = this.#get(agentId, memoryId);
    if (!record) return { status: "missing" };
    const entry = this.#entry(record, redactText);
    if (record.memoryRevision !== expectedMemoryRevision || entry.directoryRevision !== expectedDirectoryRevision)
      return { status: "stale" };
    return {
      status: "ok",
      memory: record.memory,
      inclusion: record.inclusion,
      userControlled: record.userControlled,
      memoryRevision: record.memoryRevision,
      directoryRevision: entry.directoryRevision,
    };
  }

  #write(
    record: DirectoryRecord,
    annotation: MemoryDirectoryAnnotation,
    actor: "user" | "agent",
    sourceTurnId: string | null,
  ): void {
    const payload: AnnotationEvent = {
      version: 1,
      agentId: record.memory.agentId,
      memoryId: record.memory.id,
      memoryUpdatedAt: record.memory.updatedAt,
      memoryTextDigest: textDigest(record.memory.text),
      memoryRevisionAtWrite: record.memoryRevision,
      title: annotation.title,
      aliases: annotation.aliases,
      actor,
      annotationSourceTurnId: sourceTurnId,
    };
    this.database.dispatch(
      `agent-memory:directory:${randomUUID()}`,
      [
        {
          aggregateType: "agent-memory",
          aggregateId: record.memory.id,
          eventType: EVENT_TYPE,
          payload,
        },
      ],
      () => null,
    );
  }

  #isCurrent(record: DirectoryRecord): boolean {
    return (
      record.annotation !== null &&
      record.annotation.memoryUpdatedAt === record.memory.updatedAt &&
      record.annotation.memoryTextDigest === textDigest(record.memory.text)
    );
  }

  #entry(record: DirectoryRecord, redact: (value: string) => string): MemoryDirectoryEntry {
    const explicit = this.#isCurrent(record) && record.annotation?.title !== null;
    return {
      memoryId: record.memory.id,
      memoryRevision: record.memoryRevision,
      directoryRevision: explicit ? record.annotationRevision : null,
      title: hintText(
        redact(explicit && record.annotation ? (record.annotation.title ?? "") : record.memory.text),
        MEMORY_DIRECTORY_LIMITS.title,
      ),
      titleKind: explicit ? "explicit" : "current-text-excerpt",
      aliases:
        explicit && record.annotation
          ? record.annotation.aliases.map((alias) => hintText(redact(alias), MEMORY_DIRECTORY_LIMITS.alias))
          : [],
    };
  }

  #get(agentId: string, memoryId: string): DirectoryRecord | null {
    const row = databaseRow(
      this.database.connection.prepare(`${ROW_SQL} WHERE m.agent_id = ? AND m.memory_id = ?`).get(agentId, memoryId),
    );
    return row ? directoryRecord(row, agentId) : null;
  }

  *#rows(agentId: string, after: string | null, scanLimit: number): IterableIterator<DirectoryRecord> {
    const rows = this.database.connection
      .prepare(
        `${ROW_SQL} WHERE m.agent_id = ? AND s.inclusion = 'searchable' AND (? IS NULL OR m.memory_id > ?)
       ORDER BY m.memory_id LIMIT ?`,
      )
      .iterate(agentId, after, after, scanLimit);
    for (const value of rows) {
      const row = databaseRow(value);
      if (!row) throw new Error("Invalid SQLite directory row.");
      yield directoryRecord(row, agentId);
    }
  }
}

const ROW_SQL = `SELECT m.memory_id, m.text, m.origin, m.source_turn_id, m.created_at, m.updated_at,
 s.inclusion, s.user_controlled, s.revision, e.sequence AS directory_sequence, e.payload_json AS directory_payload
 FROM projection_agent_memories m JOIN agent_memory_selections s ON s.memory_id = m.memory_id
 LEFT JOIN orchestration_events e ON e.sequence = (
   SELECT sequence FROM orchestration_events INDEXED BY orchestration_events_aggregate
   WHERE aggregate_type = 'agent-memory' AND aggregate_id = m.memory_id AND event_type = '${EVENT_TYPE}'
   ORDER BY sequence DESC LIMIT 1
 )`;

function directoryRecord(row: Parameters<typeof requiredStringColumn>[0], agentId: string): DirectoryRecord {
  const origin = requiredStringColumn(row, "origin");
  const inclusion = requiredStringColumn(row, "inclusion");
  if (origin !== "automatic" && origin !== "manual") throw new Error("Invalid memory origin.");
  if (inclusion !== "essential" && inclusion !== "searchable") throw new Error("Invalid memory inclusion.");
  const sourceTurnId = row.source_turn_id;
  if (sourceTurnId !== null && !isString(sourceTurnId)) throw new Error("Invalid memory save-turn locator.");
  const memory: AgentMemory = {
    agentId,
    id: requiredStringColumn(row, "memory_id"),
    text: requiredStringColumn(row, "text"),
    origin,
    sourceTurnId,
    createdAt: requiredStringColumn(row, "created_at"),
    updatedAt: requiredStringColumn(row, "updated_at"),
  };
  const payload = row.directory_payload;
  let annotation: AnnotationEvent | null = null;
  if (payload !== null) {
    try {
      annotation = Schema.decodeUnknownSync(annotationEventSchema)(
        JSON.parse(requiredStringColumn(row, "directory_payload")),
      );
    } catch {
      throw new Error("Invalid saved memory directory annotation.");
    }
  }
  if (annotation && (annotation.agentId !== agentId || annotation.memoryId !== memory.id))
    throw new Error("Invalid memory directory owner.");
  return {
    memory,
    inclusion,
    userControlled: requiredNumberColumn(row, "user_controlled") === 1,
    memoryRevision: requiredNumberColumn(row, "revision"),
    annotation,
    annotationRevision: annotation ? requiredNumberColumn(row, "directory_sequence") : null,
  };
}

/** Decode once at the write boundary, then store the normalized validated annotation. */
export function parseMemoryDirectoryAnnotation(value: unknown): MemoryDirectoryAnnotation {
  let parsed: typeof annotationSchema.Type;
  try {
    parsed = Schema.decodeUnknownSync(annotationSchema)(value);
  } catch {
    throw directoryError("invalid");
  }
  const title = parsed.title?.trim() || null;
  const aliases = [...new Map(parsed.aliases.map((alias) => [normalizeMemoryDirectoryQuery(alias), alias.trim()]))]
    .filter(([normalized]) => normalized.length > 0)
    .map(([, alias]) => alias);
  const annotation = { title, aliases };
  if (
    (title === null && aliases.length > 0) ||
    memoryDirectoryAnnotationBytes(annotation) > MEMORY_DIRECTORY_LIMITS.annotationBytes
  )
    throw directoryError("invalid");
  return annotation;
}

function directoryError(code: AgentMemoryDirectoryError["code"]): AgentMemoryDirectoryError {
  const key =
    code === "query"
      ? "error.backend.memoryDirectoryCursor"
      : code === "invalid"
        ? "error.backend.memoryDirectoryAnnotation"
        : code === "missing"
          ? "error.backend.memoryGone"
          : code === "user-controlled"
            ? "error.backend.memoryDirectoryUserControlled"
            : code === "budget"
              ? "error.backend.memoryOperationFailed"
              : "error.backend.memoryDirectoryConflict";
  return new AgentMemoryDirectoryError({ code, message: sourceText(key) });
}

function textDigest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
function cursorScope(agentId: string, query: string): string {
  return textDigest(JSON.stringify([agentId, query]));
}
function encodeCursor(agentId: string, query: string, after: string): string {
  return `1.${cursorScope(agentId, query)}.${Buffer.from(after, "utf8").toString("base64url")}`;
}
function decodeCursor(agentId: string, query: string, cursor: string): string {
  if (cursor.length > MEMORY_DIRECTORY_LIMITS.cursor) throw directoryError("query");
  const [version, scope, encoded, extra] = cursor.split(".");
  if (version !== "1" || scope !== cursorScope(agentId, query) || !encoded || extra !== undefined)
    throw directoryError("query");
  const after = Buffer.from(encoded, "base64url").toString("utf8");
  if (!after || after.length > INPUT_LIMITS.identifier || encodeCursor(agentId, query, after) !== cursor)
    throw directoryError("query");
  return after;
}
function hintText(value: string, maxLength: number): string {
  let result = "";
  for (const point of value.replace(/\s+/gu, " ").trim()) {
    if (result.length + point.length > maxLength) break;
    result += point;
  }
  return result;
}
