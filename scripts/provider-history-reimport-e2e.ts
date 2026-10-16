import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { AgentProviderId } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { isRecord } from "../src/backend/protocol";
import type { ProviderHistoryFragment, ReadProviderHistory } from "../src/backend/provider-history";
import { importProviderHistory, type ProviderHistoryImportResult } from "../src/backend/provider-history-import";

const REPORT_NAME = "provider-history-reimport-report.json";
const SENTINEL_TIME = "1970-01-01T00:00:00.000Z";

interface Report {
  schemaVersion: 1;
  generatedAt: string;
  command: string;
  imports: Record<string, ProviderHistoryImportResult>;
  acceptance: Record<string, boolean>;
}

/**
 * Imports the same provider history more than once into a real database, as each start does, and
 * records that only new or changed turns are written again.
 */
async function runProviderHistoryReimportCheck(outputPath: string): Promise<Report> {
  const databaseRoot = await mkdtemp(join(tmpdir(), "openbot-provider-history-reimport-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "openbot-provider-history-reimport-home-"));
  const database = new OpenBotDatabase(databaseRoot);
  const agentStore = new AgentStore(databaseRoot, homeRoot, database);
  const agentId = "provider-history-reimport-agent";
  try {
    await runCauseEffect(agentStore.initialize());
    const agent = await runCauseEffect(
      agentStore.getOrCreate(agentId, "Provider history reimport", "Provider history reimport"),
    );
    const threadId = await runCauseEffect(agentStore.ensureThreadId(agent.id));

    const runImport = (sessionId: string, provider: AgentProviderId, fragments: readonly ProviderHistoryFragment[]) => {
      const readHistory: ReadProviderHistory = (_request, consume) =>
        Effect.gen(function* () {
          for (const fragment of fragments) if (!(yield* consume(fragment))) return;
        });
      return Effect.runPromise(
        importProviderHistory({
          database,
          readHistory,
          sessionId,
          provider,
          externalSessionId: `${sessionId}-external`,
          agentId,
          publicThreadId: threadId,
          findDelivery: () => null,
          findMessageDelivery: () => null,
          quietRoutineDelivery: () => false,
        }),
      );
    };
    const stampStaging = () =>
      database.connection.prepare("UPDATE provider_history_staging SET updated_at = ?").run(SENTINEL_TIME);
    const stagingRewritten = () =>
      count(database, "SELECT COUNT(*) AS count FROM provider_history_staging WHERE updated_at <> ?", SENTINEL_TIME);
    const events = () => count(database, "SELECT COUNT(*) AS count FROM orchestration_events");
    const messageTexts = () => database.readConversation(agentId, threadId).messages.map((message) => message.text);

    const codexTurns = [turn("codex-turn-1", 1), turn("codex-turn-2", 2), turn("codex-turn-3", 3)];
    const recordsOnlyTurn: ProviderHistoryFragment = { ...turn("codex-records-only", 4), recordsOnly: true };
    const codexHistory = [...codexTurns, recordsOnlyTurn];

    const first = await runImport("codex-session", "codex", codexHistory);
    const messagesAfterFirst = messageTexts();

    stampStaging();
    const eventsBeforeRepeat = events();
    const repeat = await runImport("codex-session", "codex", codexHistory);
    const repeatWroteNoItem = stagingRewritten() === 0;
    const repeatWroteNoEvent = events() === eventsBeforeRepeat;
    const repeatKeptMessages = JSON.stringify(messageTexts()) === JSON.stringify(messagesAfterFirst);

    // A start that stops after it staged unchanged turns must not move the time of the last full read.
    database.connection
      .prepare("UPDATE provider_history_imports SET updated_at = ? WHERE session_id = ?")
      .run(SENTINEL_TIME, "codex-session");
    database.ensureProviderHistoryImport({
      sessionId: "codex-session",
      threadId,
      provider: "codex",
      externalSessionId: "codex-session-external",
    });
    for (const fragment of codexHistory)
      database.stageProviderHistoryFragment({ sessionId: "codex-session", fragment });
    const partialRead = database.providerHistoryImport("codex-session");

    const editedHistory = [codexTurns[0], turn("codex-turn-2", 2, "edited"), codexTurns[2], recordsOnlyTurn].flatMap(
      (fragment) => (fragment ? [fragment] : []),
    );
    const edited = await runImport("codex-session", "codex", editedHistory);
    const messagesAfterEdit = messageTexts();

    const appended = await runImport("codex-session", "codex", [...editedHistory, turn("codex-turn-5", 5)]);
    const messagesAfterAppend = messageTexts();

    const claudeHistory = [turn("claude-turn-1", 6), turn("claude-turn-2", 7)];
    const claudeFirst = await runImport("claude-session", "claude", claudeHistory);
    const claudeRepeat = await runImport("claude-session", "claude", claudeHistory);

    const report: Report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      command: process.argv.join(" "),
      imports: { first, repeat, edited, appended, claudeFirst, claudeRepeat },
      acceptance: {
        firstImportsEveryTurn: first.turns === codexHistory.length && messagesAfterFirst.length === 6,
        repeatImportsNoTurn: repeat.turns === 0 && repeat.messages === 0,
        repeatWritesNoStagedItem: repeatWroteNoItem,
        repeatWritesNoConversationEvent: repeatWroteNoEvent,
        repeatKeepsMessages: repeatKeptMessages,
        partialReadKeepsLastFullReadTime: partialRead?.state === "complete" && partialRead.updatedAt === SENTINEL_TIME,
        editImportsOnlyChangedTurn: edited.turns === 1 && edited.messages === 2,
        editUpdatesMessage: messagesAfterEdit.includes("Answer 2 edited") && !messagesAfterEdit.includes("Answer 2"),
        appendImportsOnlyNewTurn: appended.turns === 1 && messagesAfterAppend.includes("Answer 5"),
        claudeRepeatImportsNoTurn: claudeFirst.turns === 2 && claudeRepeat.turns === 0,
        importCompleted: database.providerHistoryImport("codex-session")?.state === "complete",
      },
    };
    await mkdir(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    return report;
  } finally {
    database.close();
    await rm(databaseRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
}

function turn(turnId: string, startedAt: number, suffix?: string): ProviderHistoryFragment {
  const text = (label: string) => (suffix ? `${label} ${startedAt} ${suffix}` : `${label} ${startedAt}`);
  return {
    turnId,
    status: "completed",
    startedAt,
    itemOffset: 0,
    complete: true,
    items: [
      { type: "agentMessage", id: `${turnId}-commentary`, text: text("Commentary"), phase: "commentary" },
      { type: "agentMessage", id: `${turnId}-answer`, text: text("Answer"), status: "completed" },
    ],
  };
}

function count(database: OpenBotDatabase, sql: string, ...parameters: string[]): number {
  const row = database.connection.prepare(sql).get(...parameters);
  if (!isRecord(row) || typeof row.count !== "number") throw new Error("The reimport check read an invalid count.");
  return row.count;
}

if (import.meta.main) {
  const outputPath = resolve(process.cwd(), ".openbot-build", REPORT_NAME);
  const report = await runProviderHistoryReimportCheck(outputPath);
  const failed = Object.entries(report.acceptance).flatMap(([name, passed]) => (passed ? [] : [name]));
  if (failed.length > 0) throw new Error(`Provider history reimport check failed: ${failed.join(", ")}. ${outputPath}`);
  process.stdout.write(`Provider history reimport check passed. Wrote ${outputPath}.\n`);
}
