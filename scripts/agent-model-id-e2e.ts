// Drives the real Cline driver client and the real model catalog with a fake `cline --acp` process
// that lists the ids of issue #2519: Cline 3.0.73 mints 19 `~provider/model-latest` aliases, and the
// contract guard refused a leading `~`, so the catalog dropped every one and the picker showed none.
// Checks that the catalog keeps the tilde aliases, keeps a plain id beside them, still refuses an id
// with a space, a tilde behind another character and a path-shaped id. The catalog check is the
// regression check. The fake CLI opens on a plain id, so the last checks show that a selected tilde id
// reaches the CLI whole.
// `bun scripts/agent-model-id-e2e.ts`. Writes .openbot-build/agent-model-id-e2e/report.json.
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ModelCatalog } from "../src/backend/agent/model-catalog";
import type { AgentClient } from "../src/backend/agent-client";
import type { AgentCliInfo } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type AppServerNotification, decodeThreadResponse, getString } from "../src/backend/protocol";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-model-id-e2e");

// The ids the issue names, a plain id that must survive beside them, and the shapes that must stay
// refused. The fake lists every one of them the way an ACP CLI does, in `session/new`, and takes
// each listed id back as a model option value, so `session/set_config_option` carries an id whole.
const FAKE_CLINE = `#!/usr/bin/env node
const fs = require("node:fs");
const NL = String.fromCharCode(10);
const LISTED = [
  { modelId: "~deepseek/deepseek-flash-latest", name: "DeepSeek Flash (Latest)" },
  { modelId: "~openai/gpt-luna-latest", name: "GPT Luna (Latest)" },
  { modelId: "~z-ai/glm-flash-latest", name: "GLM Flash (Latest)" },
  { modelId: "deepseek/deepseek-chat", name: "DeepSeek Chat" },
  { modelId: "gpt 5.5", name: "GPT 5.5" },
  { modelId: "deepseek/~flash", name: "DeepSeek Flash" },
  { modelId: "../etc/passwd", name: "Escape" },
];
const CURRENT = "deepseek/deepseek-chat";
const sessions = new Map();
const log = (entry) => fs.appendFileSync(process.env.FAKE_CLINE_LOG, JSON.stringify(entry) + NL);
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
const options = (current) => [
  { id: "model", name: "Model", category: "model", type: "select", currentValue: current,
    options: LISTED.map((entry) => ({ value: entry.modelId, name: entry.name })) },
];
function handle(message) {
  if (message.id === undefined) return;
  const params = message.params ?? {};
  if (message.method === "initialize") {
    write({ id: message.id, result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] } });
    return;
  }
  if (message.method === "session/new") {
    const sessionId = "s-" + (sessions.size + 1);
    sessions.set(sessionId, CURRENT);
    write({ id: message.id, result: { sessionId, configOptions: options(CURRENT),
      models: { availableModels: LISTED, currentModelId: CURRENT } } });
    return;
  }
  if (message.method === "session/set_config_option") {
    sessions.set(params.sessionId, params.value);
    log({ event: "set", sessionId: params.sessionId, configId: params.configId, value: params.value });
    write({ id: message.id, result: { configOptions: options(params.value) } });
    return;
  }
  if (message.method === "session/prompt") {
    log({ event: "prompt", sessionId: params.sessionId, model: sessions.get(params.sessionId) });
    write({ method: "session/update", params: { sessionId: params.sessionId, update: {
      sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ok" } } } });
    write({ id: message.id, result: { stopReason: "end_turn" } });
    return;
  }
  write({ id: message.id, result: {} });
}
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf(NL)) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});
setInterval(() => {}, 1000);
`;

const TILDE_MODELS = ["~deepseek/deepseek-flash-latest", "~openai/gpt-luna-latest", "~z-ai/glm-flash-latest"];
/** The alias the pass-back checks run on: session open, then one turn. */
const PICKED_MODEL = "~deepseek/deepseek-flash-latest";

interface LogEntry {
  event: "set" | "prompt";
  sessionId: string;
  configId?: string;
  value?: string;
  model?: string | null;
}

const root = await mkdtemp(join(tmpdir(), "openbot-agent-model-id-e2e-"));
const logPath = join(root, "cline.jsonl");
const workspace = join(root, "workspace");
const executable = join(root, "cline", "bin", "cline");
process.env.FAKE_CLINE_LOG = logPath;

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}
const report: { passed: boolean; checks: typeof checks; error?: string } = { passed: false, checks };

const clients: AgentClient[] = [];

async function readLog(): Promise<LogEntry[]> {
  const text = await readFile(logPath, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** Starts a turn and waits for its completion. */
async function runTurn(client: AgentClient, thread: string, model: string): Promise<void> {
  // The listener of a finished turn stays: `finished` makes it ignore what follows, and the client
  // is stopped in the end.
  let finished = false;
  const done = new Promise<void>((finish, fail) => {
    client.on("notification", (notification: AppServerNotification) => {
      if (finished || getString(notification.params, "threadId") !== thread) return;
      if (notification.method === "error") fail(new Error(getString(notification.params, "message") ?? "error"));
      if (notification.method === "turn/completed") {
        finished = true;
        finish();
      }
    });
  });
  await runCauseEffect(
    client.request(
      "turn/start",
      { threadId: thread, model, input: [{ type: "text", text: "hello", text_elements: [] }] },
      (value) => value,
    ),
  );
  await done;
}

try {
  await mkdir(join(root, "cline", "bin"), { recursive: true });
  await mkdir(workspace);
  await writeFile(executable, FAKE_CLINE);
  await chmod(executable, 0o755);

  const cli: AgentCliInfo = { executable, version: "3.0.73", source: "managed" };
  const client = requireProviderDriver("cline").createClient(cli, 10_000, NO_PROVIDER_CREDENTIALS);
  clients.push(client);
  client.start();

  // The real catalog, pointed at the real Cline client alone. The other providers have no client,
  // so `refresh` keeps what they had and starts no process.
  const providerErrors: unknown[] = [];
  const catalog = new ModelCatalog({
    client: (provider) => (provider === "cline" ? client : undefined),
    isSignedOut: () => false,
    credentials: NO_PROVIDER_CREDENTIALS,
    requestTimeoutMs: 10_000,
    recordProviderError: (provider, error) => {
      providerErrors.push({ provider, error });
    },
  });
  const fresh = await runCauseEffect(catalog.refresh());
  const listed = catalog
    .list()
    .filter((model) => model.provider === "cline")
    .map((model) => model.id)
    .sort();

  check("the catalog refresh reads without a provider error", providerErrors.length === 0, { providerErrors });
  check("the Cline catalog came back fresh", fresh.has("cline"), { fresh: [...fresh] });
  check(
    "the catalog keeps every Cline tilde alias",
    TILDE_MODELS.every((id) => listed.includes(id)),
    {
      listed,
    },
  );
  check("the catalog keeps a plain id beside them", listed.includes("deepseek/deepseek-chat"), { listed });
  check("the catalog still refuses an id with a space", !listed.includes("gpt 5.5"), { listed });
  check("the catalog refuses a tilde behind another character", !listed.includes("deepseek/~flash"), { listed });
  check("the catalog refuses a path-shaped id", !listed.includes("../etc/passwd"), { listed });

  // The id the picker now holds has to reach the CLI whole: on session open and on the turn.
  const started = await runCauseEffect(
    client.request("thread/start", { model: PICKED_MODEL, cwd: workspace }, decodeThreadResponse),
  );
  assert.ok(started.thread.id.length > 0, "thread/start answers a thread id.");
  await runTurn(client, started.thread.id, PICKED_MODEL);

  const entries = await readLog();
  const sets = entries
    .filter((entry) => entry.event === "set" && entry.configId === "model")
    .map((entry) => entry.value);
  check("the tilde model reaches the CLI on session open", sets.includes(PICKED_MODEL), { sets });
  const prompt = entries.filter((entry) => entry.event === "prompt").at(-1);
  check("the turn runs on the tilde model", prompt?.model === PICKED_MODEL, { prompt });

  report.passed = checks.every((entry) => entry.passed);
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await Promise.all(clients.map((client) => runCauseEffect(client.stop()).catch(() => undefined)));
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  for (const entry of checks) process.stdout.write(`${entry.passed ? "PASS" : "FAIL"} ${entry.name}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
  if (!report.passed) process.exitCode = 1;
}
