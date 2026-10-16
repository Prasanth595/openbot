// Feeds completed tool items, in the shapes that Claude, Codex, the ACP agents and MCP tools send,
// through the loop guard, and reads real settings files through the loop guard preference store.
// It checks when the guard warns, when it stops, and what ends a streak. It also imports provider
// history that holds the guard's note, as at a restart, into a real database in a temporary
// directory, and checks the stop marker that the desktop chat draws. Writes
// .openbot-build/loop-guard-e2e/report.json. Run: `bun scripts/loop-guard-e2e.ts`.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type ConversationMessage,
  isLoopGuardStopMarker,
  LOOP_GUARD_STOP_ITEM_TYPE,
  type QueueDelivery,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import {
  DEFAULT_LOOP_GUARD_SETTINGS,
  LoopGuard,
  type LoopGuardSettings,
  type LoopGuardVerdict,
  loopGuardWarning,
  toolStep,
} from "../src/backend/agent/loop-guard";
import { toolUsage } from "../src/backend/agent/thread-items";
import { AgentStore } from "../src/backend/agent-store";
import { claudeHistoryFromMessages } from "../src/backend/claude-history";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { DeliveryContext } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import type { ThreadItem } from "../src/backend/protocol";
import type { ReadProviderHistory } from "../src/backend/provider-history";
import { importProviderHistory } from "../src/backend/provider-history-import";
import { LoopGuardPreferenceStore } from "../src/main/loop-guard-preference-store";

const OUT = resolve(import.meta.dirname, "../.openbot-build/loop-guard-e2e");

interface Check {
  name: string;
  passed: boolean;
  detail: unknown;
}

const checks: Check[] = [];
const check = (name: string, passed: boolean, detail: unknown = null) => checks.push({ name, passed, detail });
const warnAndStop: LoopGuardSettings = { enabled: true, warnAt: 3, stopAt: 6 };

/** The verdicts of a series of items in one turn, `null` for none. */
function run(
  items: ThreadItem[],
  settings = warnAndStop,
  turnIds?: string[],
): Array<LoopGuardVerdict["action"] | null> {
  const guard = new LoopGuard();
  return items.map(
    (item, index) => guard.observe("agent-1", turnIds?.[index] ?? "turn-1", item, settings)?.action ?? null,
  );
}

// Claude's Bash tool after this change: the input, the end of the result and `failed` for `is_error`.
const claudeBash = (attempt: number, isError = true, output = "Error: Cannot find module 'left-pad'"): ThreadItem => ({
  id: `toolu_${attempt}`,
  type: "toolCall",
  name: "Bash",
  status: isError ? "failed" : "completed",
  // Claude often writes another description for the same command.
  arguments: { command: "npm test", description: `Run the tests, attempt ${attempt}` },
  result: `${output} (after ${attempt * 137} ms)`,
});
const claudeRead: ThreadItem = {
  id: "toolu_read",
  type: "toolCall",
  name: "Read",
  status: "completed",
  arguments: { file_path: "/w/package.json" },
  result: "{}",
};
const codexCommand = (exitCode: number, output = "make: *** [build] Error 2"): ThreadItem => ({
  id: "item-1",
  type: "commandExecution",
  command: "make build",
  status: exitCode === 0 ? "completed" : "failed",
  exitCode,
  aggregatedOutput: output,
});
const acpExecute: ThreadItem = {
  id: "call-1",
  type: "toolCall",
  name: "Run cargo test",
  toolKind: "execute",
  status: "failed",
  arguments: { command: "cargo test" },
  result: { stderr: "error[E0425]: cannot find value `x`" },
};
const mcpCall = (args: { repo: string; title: string }): ThreadItem => ({
  id: "mcp-1",
  type: "mcpToolCall",
  server: "github",
  tool: "create_issue",
  status: "failed",
  arguments: args,
  error: { message: "403 Forbidden" },
});

const times = <T>(count: number, make: (index: number) => T) =>
  Array.from({ length: count }, (_, index) => make(index));

let verdicts = run(times(3, (index) => claudeBash(index)));
check("Claude Bash warns at the third identical failure", verdicts.join() === ",,warn", verdicts);

verdicts = run(times(7, (index) => claudeBash(index)));
check("Claude Bash stops at the sixth and is quiet after it", verdicts.join() === ",,warn,,,stop,", verdicts);

verdicts = run([claudeBash(1), claudeRead, claudeBash(2), claudeRead, claudeBash(3)]);
check("a call between two tries does not end the streak", verdicts.at(-1) === "warn", verdicts);

verdicts = run([claudeBash(1), claudeBash(2), claudeBash(3, false), claudeBash(4), claudeBash(5)]);
check(
  "a success of the same call ends the streak",
  verdicts.every((verdict) => verdict === null),
  verdicts,
);

verdicts = run([claudeBash(1), claudeBash(2), claudeBash(3, true, "Error: tests failed: 2"), claudeBash(4)]);
check(
  "another failure output ends the streak",
  verdicts.every((verdict) => verdict === null),
  verdicts,
);

verdicts = run(times(3, () => codexCommand(2)));
check("a Codex command with a non-zero exit code warns", verdicts.at(-1) === "warn", verdicts);

verdicts = run(times(4, () => codexCommand(0)));
check(
  "a command that succeeds never counts",
  verdicts.every((verdict) => verdict === null),
  verdicts,
);

verdicts = run(times(3, () => acpExecute));
check("an ACP execute tool warns", verdicts.at(-1) === "warn", verdicts);

verdicts = run([
  mcpCall({ repo: "a", title: "b" }),
  mcpCall({ title: "b", repo: "a" }),
  mcpCall({ repo: "a", title: "b" }),
]);
check("an MCP call with the same arguments in another order is the same call", verdicts.at(-1) === "warn", verdicts);

verdicts = run(times(3, () => ({ ...codexCommand(1), status: "declined" })));
check(
  "a declined call never counts",
  verdicts.every((verdict) => verdict === null),
  verdicts,
);

verdicts = run(times(3, () => ({ id: "toolu_x", type: "toolCall", name: "Bash", status: "completed" })));
check(
  "an item without its input is not compared",
  verdicts.every((verdict) => verdict === null),
  verdicts,
);

verdicts = run(
  times(3, (index) => claudeBash(index)),
  { ...warnAndStop, enabled: false },
);
check(
  "a disabled guard does nothing",
  verdicts.every((verdict) => verdict === null),
  verdicts,
);

verdicts = run(
  times(3, (index) => claudeBash(index)),
  warnAndStop,
  ["turn-1", "turn-1", "turn-2"],
);
check(
  "a new turn starts the count again",
  verdicts.every((verdict) => verdict === null),
  verdicts,
);

verdicts = run(
  times(50, (index) => claudeBash(index)),
  DEFAULT_LOOP_GUARD_SETTINGS,
);
check(
  "the defaults warn once and never stop",
  verdicts.filter((verdict) => verdict === "warn").length === 1 && !verdicts.includes("stop"),
  verdicts.filter(Boolean),
);

const guard = new LoopGuard();
let warning: LoopGuardVerdict | null = null;
for (const item of times(3, (index) => claudeBash(index)))
  warning = guard.observe("agent-1", "turn-1", item, warnAndStop);
const text = warning ? loopGuardWarning(warning) : "";
check("the warning names the command and the count", text.includes("npm test") && text.includes("3 times"), text);

const usage = toolUsage(claudeBash(1));
check("tool analytics see a failed Claude call", usage?.failed === true, usage);

// Claude's Write holds the whole file: the guard keeps a hash of the call, not its input.
const claudeWrite = (content: string): ThreadItem => ({
  id: "toolu_write",
  type: "toolCall",
  name: "Write",
  status: "failed",
  arguments: { file_path: "/w/big.txt", content },
  result: "EACCES: permission denied",
});
const bigFile = "x".repeat(1_000_000);
const writeStep = toolStep(claudeWrite(bigFile));
check("a call signature is a SHA-256 hash, not the call's input", /^[0-9a-f]{64}$/u.test(writeStep?.signature ?? ""), {
  signatureLength: writeStep?.signature.length,
});
verdicts = run(times(3, () => claudeWrite(bigFile)));
check("the same large Write call still warns at the third failure", verdicts.at(-1) === "warn", verdicts);
verdicts = run([claudeWrite(bigFile), claudeWrite(`${bigFile}y`), claudeWrite(bigFile)]);
check(
  "a Write call with other content is another call",
  verdicts.every((verdict) => verdict === null),
  verdicts,
);

// The stop note is the system marker that the desktop chat draws and localizes (see the
// "Loop guard stopped a turn" story), not an agent message.
const stopMessage: ConversationMessage = {
  id: "loop-guard-1",
  turnId: "turn-1",
  author: "system",
  source: "system",
  text: sourceText("status.agent.loopGuardStopped", { count: 6, call: "npm test" }),
  createdAt: new Date().toISOString(),
  status: "completed",
  itemType: LOOP_GUARD_STOP_ITEM_TYPE,
};
check(
  "the stop note is a loop guard stop marker",
  isLoopGuardStopMarker(stopMessage) && !isLoopGuardStopMarker({ ...stopMessage, author: "assistant" }),
  stopMessage,
);

const root = mkdtempSync(join(tmpdir(), "openbot-loop-guard-e2e-"));
try {
  const read = async (content: string | null) => {
    const path = join(root, `settings-${checks.length}.json`);
    if (content !== null) writeFileSync(path, content);
    const store = new LoopGuardPreferenceStore(path);
    await Effect.runPromise(store.load());
    return store.get();
  };
  let settings = await read(null);
  check(
    "a missing settings file gives the defaults",
    JSON.stringify(settings) === JSON.stringify(DEFAULT_LOOP_GUARD_SETTINGS),
    settings,
  );
  settings = await read('{ "version": 1, "enabled": true, "warnAt": 3, "stopAt": 6 }');
  check("a settings file sets stopAt", settings.stopAt === 6 && settings.warnAt === 3 && settings.enabled, settings);
  settings = await read('{ "version": 1, "enabled": false, "warnAt": 1, "stopAt": 5000 }');
  check(
    "out-of-range values keep their defaults",
    !settings.enabled && settings.warnAt === 3 && settings.stopAt === null,
    settings,
  );
  settings = await read("not json");
  check("a file that is not JSON gives the defaults", settings.enabled && settings.stopAt === null, settings);
} finally {
  rmSync(root, { recursive: true, force: true });
}

// The note goes into the turn as a user message with no delivery. After a restart, the history
// import must not show it as text that the user wrote.
const note = loopGuardWarning({ action: "warn", count: 3, call: "npm test" });
const promptDeliveryId = "11111111-1111-4111-8111-111111111111";
const promptDelivery = {
  delivery: {
    id: promptDeliveryId,
    messageId: "message-1",
    recipientAgentId: "agent-1",
    sender: { kind: "user" },
    text: "Run the tests",
    attachments: [],
    replyToMessageId: null,
    status: "completed",
    position: null,
    turnId: "turn-1",
    error: null,
    createdAt: new Date(1_700_000_000_000).toISOString(),
  } satisfies QueueDelivery,
  managedAttachments: [],
} satisfies DeliveryContext;
const historyRoot = mkdtempSync(join(tmpdir(), "openbot-loop-guard-e2e-history-"));
try {
  let imports = 0;
  /** The messages that a restart imports from provider history, as `author: text`. */
  const imported = async (provider: "claude" | "codex", readHistory: ReadProviderHistory) => {
    imports += 1;
    const root = join(historyRoot, `import-${imports}`);
    mkdirSync(join(root, "home"), { recursive: true });
    const database = new OpenBotDatabase(root);
    const store = new AgentStore(root, join(root, "home"), database);
    try {
      await runCauseEffect(store.initialize());
      const agent = await runCauseEffect(store.getOrCreate("agent-1", "Agent", "Agent"));
      const threadId = await runCauseEffect(store.ensureThreadId(agent.id));
      await Effect.runPromise(
        importProviderHistory({
          database,
          readHistory,
          sessionId: "session-1",
          provider,
          externalSessionId: "external-1",
          agentId: agent.id,
          publicThreadId: threadId,
          findDelivery: (id) => (id === promptDeliveryId ? promptDelivery : null),
          findMessageDelivery: () => null,
          quietRoutineDelivery: () => false,
        }),
      );
      return database
        .readConversationPage(agent.id, threadId, { type: "latest" }, 100)
        .messages.map((message) => `${message.author}: ${message.text.split("\n")[0]}`);
    } finally {
      database.close();
    }
  };
  const shownNote = (rows: string[]) => rows.some((row) => row.includes("[OpenBot loop guard]"));

  // Claude keeps the steer under the `clientUserMessageId` it was sent with, which no delivery has.
  const claudeMessage = (type: "user" | "assistant", content: unknown, uuid: string) => ({
    type,
    uuid,
    session_id: "external-1",
    message: { role: type, content },
    parent_tool_use_id: null,
    parent_agent_id: null,
    timestamp: new Date(1_700_000_000_000).toISOString(),
  });
  const claudeSession = [
    claudeMessage("user", "Run the tests", promptDeliveryId),
    ...[1, 2, 3].flatMap((attempt) => [
      claudeMessage(
        "assistant",
        [{ type: "tool_use", id: `toolu_${attempt}`, name: "Bash", input: { command: "npm test" } }],
        `22222222-2222-4222-8222-00000000000${attempt}`,
      ),
      claudeMessage(
        "user",
        [{ type: "tool_result", tool_use_id: `toolu_${attempt}`, is_error: true, content: "Cannot find module" }],
        `33333333-3333-4333-8333-00000000000${attempt}`,
      ),
    ]),
    claudeMessage("user", note, "44444444-4444-4444-8444-444444444444"),
    claudeMessage(
      "assistant",
      [{ type: "text", text: "The module is missing. I will check package.json." }],
      "55555555-5555-4555-8555-555555555555",
    ),
  ];
  let rows = await imported(
    "claude",
    claudeHistoryFromMessages(async () => claudeSession),
  );
  check(
    "a Claude history import after a restart does not show the note as a user message",
    !shownNote(rows) && rows.includes("user: Run the tests") && rows.some((row) => row.startsWith("assistant: ")),
    rows,
  );

  // Codex keeps the steer in the turn's items, with or without its client ID.
  const codexHistory =
    (items: ThreadItem[]): ReadProviderHistory =>
    (_request, consume) =>
      Effect.asVoid(
        consume({
          turnId: "turn-1",
          status: "completed",
          startedAt: 1_700_000_000,
          itemOffset: 0,
          complete: true,
          items,
        }),
      );
  const codexPrompt: ThreadItem = {
    id: "item-prompt",
    type: "userMessage",
    clientId: promptDeliveryId,
    content: [{ type: "text", text: "Run the tests" }],
  };
  rows = await imported(
    "codex",
    codexHistory([
      codexPrompt,
      codexCommand(2),
      {
        id: "item-note",
        type: "userMessage",
        clientId: "66666666-6666-4666-8666-666666666666",
        content: [{ type: "text", text: note }],
      },
      { id: "item-note-2", type: "userMessage", content: [{ type: "text", text: note }] },
      { id: "item-answer", type: "agentMessage", text: "The build fails. I will read the Makefile." },
    ]),
  );
  check(
    "a Codex history import after a restart does not show the note as a user message",
    !shownNote(rows) && rows.includes("user: Run the tests") && rows.some((row) => row.startsWith("assistant: ")),
    rows,
  );

  // A message the user sent keeps its delivery, so it shows even when it starts as the note does.
  rows = await imported("codex", codexHistory([{ ...codexPrompt, content: [{ type: "text", text: note }] }]));
  check("a message the user sent is still shown", rows.length === 1 && rows[0] === "user: Run the tests", rows);
} finally {
  rmSync(historyRoot, { recursive: true, force: true });
}

mkdirSync(OUT, { recursive: true });
const failed = checks.filter((item) => !item.passed);
writeFileSync(join(OUT, "report.json"), `${JSON.stringify({ passed: failed.length === 0, checks }, null, 2)}\n`);
for (const item of checks) process.stdout.write(`${item.passed ? "ok" : "FAILED"} ${item.name}\n`);
assert.equal(failed.length, 0, `${failed.length} checks failed; see ${join(OUT, "report.json")}`);
