// Checks a queued account handover through the real agent service and Codex client on a temporary
// profile. A fake app-server holds a turn until the control file releases it. The next queued
// message must use the chosen account. Returning to the running account clears the queued choice.
// Run: bun scripts/agent-pending-runtime-service-e2e.ts.
// Writes .openbot-build/agent-pending-runtime-service-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-pending-runtime-service-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-pending-runtime-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const logPath = join(root, "protocol.jsonl");
const controlPath = join(root, "control.json");
const fakeCodex = join(root, "codex");
const defaultHome = join(home, ".codex");

// Before the service modules load: the Codex process and the stores read the home folder.
process.env.HOME = home;
process.env.CODEX_HOME = defaultHome;
process.env.OPENBOT_CODEX_PATH = fakeCodex;
process.env.OPENBOT_FAKE_CODEX_LOG = logPath;
process.env.OPENBOT_FAKE_CODEX_CONTROL = controlPath;
mkdirSync(defaultHome, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { ProviderAccountStore } = await import("../src/backend/agent/provider-account-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

// A Codex app-server that saves a rollout in its `CODEX_HOME` when a turn completes, and answers
// `thread/turns/list` as Codex 0.163.0 does: from the rollout, or from a thread loaded in this
// process, else with `thread not loaded`. The control file makes it refuse `turn/start`.
const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.163.0\\n");
  process.exit(0);
}
const codexHome = process.env.CODEX_HOME;
const rolloutsPath = path.join(codexHome, "fake-rollouts.json");
// The saved turns, as { threadId, turnId }.
const rollouts = () => { try { return JSON.parse(fs.readFileSync(rolloutsPath, "utf8")); } catch { return []; } };
const hasRollout = (threadId) => rollouts().some((turn) => turn.threadId === threadId);
const control = () => { try { return JSON.parse(fs.readFileSync(process.env.OPENBOT_FAKE_CODEX_CONTROL, "utf8")); } catch { return {}; } };
const log = (entry) => fs.appendFileSync(process.env.OPENBOT_FAKE_CODEX_LOG, JSON.stringify({ pid: process.pid, codexHome, ...entry }) + "\\n");
log({ start: true });
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
const loaded = new Set();
let buffer = "";
let threads = 0;
let turns = 0;
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const answer = (message) => {
  const params = message.params || {};
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: codexHome === ${JSON.stringify(defaultHome)} ? "codex@example.com" : "second@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: [{ model: "gpt-5.5", displayName: "GPT-5.5" }] } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": return write({ id: message.id, result: config });
    case "config/batchWrite": return write({ id: message.id, result: {} });
    case "thread/start": {
      const id = "thread-" + process.pid + "-" + (++threads);
      loaded.add(id);
      return write({ id: message.id, result: { thread: { id, turns: [] } } });
    }
    case "thread/resume":
      if (!loaded.has(params.threadId) && !hasRollout(params.threadId))
        return write({ id: message.id, error: { code: -32600, message: "no rollout found for thread id " + params.threadId } });
      loaded.add(params.threadId);
      return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "unsubscribed" } });
    case "thread/archive": return write({ id: message.id, result: {} });
    case "thread/turns/list":
      if (!loaded.has(params.threadId) && !hasRollout(params.threadId))
        return write({ id: message.id, error: { code: -32600, message: "thread not loaded: " + params.threadId } });
      return write({ id: message.id, result: {
        data: rollouts().filter((turn) => turn.threadId === params.threadId).reverse().map((turn) => ({ id: turn.turnId, status: "completed" })),
        nextCursor: null,
      } });
    case "thread/items/list": {
      const item = { type: "agentMessage", id: "message-" + params.turnId, text: "Done.", phase: "final_answer" };
      return write({ id: message.id, result: { data: [{ turnId: params.turnId, item }], nextCursor: null } });
    }
    case "turn/start": {
      if (control().refuseTurns) return write({ id: message.id, error: { code: -32603, message: "Fake turn refusal." } });
      if (!loaded.has(params.threadId))
        return write({ id: message.id, error: { code: -32600, message: "thread not found: " + params.threadId } });
      const turnId = "turn-" + process.pid + "-" + (++turns);
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      const finish = () => {
        fs.writeFileSync(rolloutsPath, JSON.stringify([...rollouts(), { threadId: params.threadId, turnId }]));
        const item = { type: "agentMessage", id: "message-" + turnId, text: "Done.", phase: "final_answer" };
        write({ method: "item/completed", params: { threadId: params.threadId, turnId, item } });
        write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status: "completed" } } });
      };
      if (control().hold) {
        const watcher = fs.watch(path.dirname(process.env.OPENBOT_FAKE_CODEX_CONTROL), () => {
          if (!control().hold) { watcher.close(); finish(); }
        });
        if (!control().hold) { watcher.close(); finish(); }
      } else setImmediate(finish);
      return;
    }
    default:
      return write({ id: message.id, error: { code: -32601, message: "Method not found: " + message.method } });
  }
};
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line) {
      const message = JSON.parse(line);
      log({ method: message.method ?? null, threadId: (message.params || {}).threadId ?? null, model: (message.params || {}).model ?? null });
      if (message.method && message.id !== undefined) answer(message);
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

interface ProtocolLine {
  pid: number;
  codexHome: string;
  method?: string | null;
  threadId?: string | null;
}
const report: { passed: boolean; checks: string[]; error?: string } = { passed: false, checks: [] };
const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
};
function protocol(): ProtocolLine[] {
  try {
    return readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}
async function waitFor<T>(label: string, read: () => T | null | undefined | false): Promise<T> {
  const deadline = Date.now() + 15000;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}
await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
const providerAccounts = new ProviderAccountStore(join(userData, "accounts.json"), join(root, "accounts"));
await runCauseEffect(providerAccounts.load());
const account = await runCauseEffect(providerAccounts.create("codex"));
assert.ok(account);
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  providerAccounts,
  preferredProvider: "codex",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
});
const errors: string[] = [];
agents.on("event", (event) => {
  if (event.type === "error") errors.push(event.code);
});
try {
  await runCauseEffect(agents.initialize());
  await waitFor("provider ready", () => agents.getStatus().phase === "ready");
  writeFileSync(controlPath, JSON.stringify({ hold: true }));
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Handover",
      description: "",
      avatarSeed: "handover",
      avatarHue: null,
      initialMessage: "First message.",
    }),
  );
  const active = await waitFor("running turn", () => {
    const session = store.activeProviderSession(agent.id);
    return session &&
      protocol().some((line) => line.method === "turn/start" && line.threadId === session.externalSessionId)
      ? session
      : null;
  });
  await runCauseEffect(agents.updateAgent({ agentId: agent.id, providerAccountId: account.id }));
  assert.equal(store.list().find((one) => one.id === agent.id)?.pendingRuntime?.providerAccountId, account.id);
  assert.equal(store.activeProviderSession(agent.id)?.id, active.id);
  report.checks.push("Running session stays active while account change waits");
  await runCauseEffect(
    agents.updateAgent({ agentId: agent.id, provider: "codex", model: agent.model, providerAccountId: null }),
  );
  assert.equal(store.list().find((one) => one.id === agent.id)?.pendingRuntime, undefined);
  assert.equal(store.activeProviderSession(agent.id)?.id, active.id);
  report.checks.push("Choosing the running account clears the pending change");
  await runCauseEffect(agents.updateAgent({ agentId: agent.id, providerAccountId: account.id }));
  await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "Queued message." }));
  writeFileSync(controlPath, JSON.stringify({ hold: false }));
  await waitFor("next message on second account", () =>
    protocol().some((line) => line.method === "turn/start" && line.codexHome === providerAccounts.home(account)),
  );
  await waitFor("deliveries finished", () =>
    agents
      .listQueue(agent.id)
      .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status)),
  );
  const moved = store.list().find((one) => one.id === agent.id);
  assert.equal(moved?.providerAccountId, account.id);
  assert.equal(moved?.pendingRuntime, undefined);
  assert.notEqual(store.activeProviderSession(agent.id)?.id, active.id);
  assert.deepEqual(errors, []);
  report.checks.push("Queued message uses the second account after the running turn ends");
  writeFileSync(controlPath, JSON.stringify({ hold: true }));
  const beforeTask = protocol().length;
  const task = await runCauseEffect(
    agents.startTask({ agentId: agent.id, text: "Task message.", clientMessageId: crypto.randomUUID() }),
  );
  await waitFor("running task", () =>
    protocol()
      .slice(beforeTask)
      .some((line) => line.method === "turn/start"),
  );
  await runCauseEffect(agents.updateAgent({ agentId: agent.id, providerAccountId: null }));
  assert.equal(store.list().find((one) => one.id === agent.id)?.providerAccountId, account.id);
  assert.ok(store.list().find((one) => one.id === agent.id)?.pendingRuntime);
  report.checks.push("Running task keeps its account while a change waits");
  writeFileSync(controlPath, JSON.stringify({ hold: false }));
  await waitFor("task and handover finish", () => {
    const current = store.list().find((one) => one.id === agent.id);
    return (
      current &&
      !current.pendingRuntime &&
      !current.providerAccountId &&
      agents.listTasks(agent.id).tasks.some((one) => one.id === task.id && one.state === "idle")
    );
  });
  const beforeReturn = protocol().length;
  await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "After task." }));
  await waitFor("next turn uses default account", () =>
    protocol()
      .slice(beforeReturn)
      .some((line) => line.method === "turn/start" && line.codexHome === defaultHome),
  );
  await waitFor("last delivery finished", () =>
    agents
      .listQueue(agent.id)
      .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status)),
  );
  assert.deepEqual(errors, []);
  report.checks.push("Task completion applies the account change before the next turn");
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  writeFileSync(controlPath, JSON.stringify({ hold: false }));
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}
