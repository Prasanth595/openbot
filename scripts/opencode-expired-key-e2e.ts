// Runs turns end to end on the real OpenCode driver against a fake `opencode acp` that picks its key
// as OpenCode 1.18.30 to 1.18.35 do: config `options.apiKey` first, then the `auth.json` key, then
// `OPENCODE_API_KEY`. An old key in `auth.json` used to win over the key pasted into OpenBot (#2544).
// Checks that an expired key reads as the expired-key error, not "Internal error"; that a replaced
// key reaches a new process and the same thread there, although `auth.json` still holds the old
// key; that with no stored key the config names no key, so the user's own sign-in stays in use; and
// that a custom endpoint saved as `opencode-go` keeps its URL when a key is stored.
// `bun run test:opencode-expired-key`. Writes .openbot-build/opencode-expired-key-e2e/report.json.
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import type { AgentClient } from "../src/backend/agent-client";
import type { AgentCliInfo } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { CustomProviderConfig } from "../src/backend/opencode-config";
import { type AppServerNotification, getString } from "../src/backend/protocol";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-expired-key-e2e");

// `FAKE_AUTH_KEY` stands for the key in OpenCode's own `auth.json`. The key named `expired` gets
// the text OpenCode Console sends for an expired key, behind the ACP SDK's `Internal error:`.
const FAKE_OPENCODE = `#!/usr/bin/env node
const fs = require("node:fs");
const NL = String.fromCharCode(10);
const EXPIRED = "This API key has expired. Create a new API key in OpenCode Console and replace it in your client or secret store. Signing in again will not renew this key.";
const config = process.env.OPENCODE_CONFIG_CONTENT ? JSON.parse(process.env.OPENCODE_CONFIG_CONTENT) : {};
const configKey = config.provider?.["opencode-go"]?.options?.apiKey ?? null;
const key = configKey ?? process.env.FAKE_AUTH_KEY ?? process.env.OPENCODE_API_KEY ?? null;
const log = (entry) => fs.appendFileSync(process.env.FAKE_OPENCODE_LOG, JSON.stringify(entry) + NL);
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
const MODEL = "opencode-go/glm-5.3";
const setup = (sessionId) => ({ sessionId,
  models: { availableModels: [{ modelId: MODEL, name: "GLM 5.3" }], currentModelId: MODEL } });
log({ event: "spawn", configKey, baseURL: config.provider?.["opencode-go"]?.options?.baseURL ?? null,
  zenKey: config.provider?.opencode?.options?.apiKey ?? null });
let count = 0;
function handle(message) {
  if (message.id === undefined) return;
  const params = message.params ?? {};
  if (message.method === "initialize") {
    write({ id: message.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [] } });
    return;
  }
  if (message.method === "session/new") {
    count += 1;
    write({ id: message.id, result: setup("s-" + process.pid + "-" + count) });
    return;
  }
  if (message.method === "session/load") {
    log({ event: "load", sessionId: params.sessionId });
    write({ id: message.id, result: setup(params.sessionId) });
    return;
  }
  if (message.method === "session/prompt") {
    log({ event: "prompt", sessionId: params.sessionId, key });
    if (key === "expired") {
      write({ id: message.id, error: { code: -32603, message: "Internal error: " + EXPIRED, data: { details: EXPIRED } } });
      return;
    }
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

interface LogEntry {
  event: "spawn" | "load" | "prompt";
  configKey?: string | null;
  baseURL?: string | null;
  zenKey?: string | null;
  sessionId?: string;
  key?: string | null;
}

interface Report {
  passed: boolean;
  expired?: { error: string };
  replaced?: { thread: string; loaded: boolean; key: string | null };
  noStoredKey?: { configKey: string | null; key: string | null };
  endpoint?: { baseURL: string | null; zenKey: string | null };
}

const root = await mkdtemp(join(tmpdir(), "openbot-opencode-expired-key-e2e-"));
const log = join(root, "opencode.jsonl");
const report: Report = { passed: false };
const clients: AgentClient[] = [];
let storedKey: string | null = "expired";
let endpoints: CustomProviderConfig[] = [];
process.env.FAKE_OPENCODE_LOG = log;
process.env.FAKE_AUTH_KEY = "expired";

async function readLog(): Promise<LogEntry[]> {
  const text = await readFile(log, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** A new process, as the provider runtime starts after a key change. The key is read at spawn. */
function open(cli: AgentCliInfo): AgentClient {
  const client = requireProviderDriver("opencode").createClient(cli, 10_000, {
    ...NO_PROVIDER_CREDENTIALS,
    apiKey: (provider) => (provider === "opencode" ? storedKey : null),
    customProviders: () => endpoints,
  });
  clients.push(client);
  client.start();
  return client;
}

/** Starts a turn and waits for its end. Resolves with the turn's error message, or null. */
async function runTurn(client: AgentClient, thread: string): Promise<string | null> {
  // `AgentClient` has no `off`, so a finished turn's listener stays and ignores what follows.
  let finished = false;
  let failure: string | null = null;
  const done = new Promise<void>((finish) => {
    client.on("notification", (notification: AppServerNotification) => {
      if (finished || getString(notification.params, "threadId") !== thread) return;
      if (notification.method === "error") failure = getString(notification.params, "message") ?? "error";
      if (notification.method === "turn/completed") {
        finished = true;
        finish();
      }
    });
  });
  await runCauseEffect(
    client.request(
      "turn/start",
      { threadId: thread, input: [{ type: "text", text: "hello", text_elements: [] }] },
      (value) => value,
    ),
  );
  await done;
  return failure;
}

async function startThread(client: AgentClient, cwd: string): Promise<string> {
  const started = await runCauseEffect(client.request("thread/start", { cwd }, (value) => value));
  const thread = JSON.stringify(started).match(/"id":"([^"]+)"/)?.[1];
  assert.ok(thread, "thread/start answers a thread id.");
  return thread;
}

try {
  const executable = join(root, "opencode", "bin", "opencode");
  const workspace = join(root, "workspace");
  await mkdir(join(root, "opencode", "bin"), { recursive: true });
  await mkdir(workspace);
  await writeFile(executable, FAKE_OPENCODE);
  await chmod(executable, 0o755);
  const cli: AgentCliInfo = { executable, version: "1.18.30", source: "managed" };

  // 1. An expired key reads as the expired-key error, with no "Internal error" in front of it.
  const first = open(cli);
  const thread = await startThread(first, workspace);
  const error = await runTurn(first, thread);
  assert.equal(error, sourceText("error.provider.opencodeKeyExpired"), "An expired key names its own fix.");
  report.expired = { error };

  // 2. A replaced key reaches the next process and the same thread, although `auth.json` still
  // holds the expired key.
  await runCauseEffect(first.stop());
  storedKey = "fresh";
  const second = open(cli);
  await runCauseEffect(second.request("thread/resume", { threadId: thread, cwd: workspace }, (value) => value));
  assert.equal(await runTurn(second, thread), null, "The turn on the replaced key succeeds.");
  const entries = await readLog();
  const prompt = entries.filter((entry) => entry.event === "prompt" && entry.sessionId === thread).at(-1);
  assert.equal(prompt?.key, "fresh", "The stored key wins over the key in auth.json.");
  const loaded = entries.some((entry) => entry.event === "load" && entry.sessionId === thread);
  assert.ok(loaded, "The new process loads the same thread.");
  report.replaced = { thread, loaded, key: prompt?.key ?? null };
  await runCauseEffect(second.stop());

  // 3. With no stored key the config names no key, so the user's own `auth.json` key stays in use.
  storedKey = null;
  process.env.FAKE_AUTH_KEY = "own";
  await rm(log, { force: true });
  const third = open(cli);
  const ownThread = await startThread(third, workspace);
  assert.equal(await runTurn(third, ownThread), null, "The turn on the user's own key succeeds.");
  const own = await readLog();
  const spawn = own.find((entry) => entry.event === "spawn");
  assert.equal(spawn?.configKey, null, "With no stored key, OpenBot sends no key in the config.");
  const ownPrompt = own.find((entry) => entry.event === "prompt");
  assert.equal(ownPrompt?.key, "own", "The user's own key is used.");
  report.noStoredKey = { configKey: spawn?.configKey ?? null, key: ownPrompt?.key ?? null };
  await runCauseEffect(third.stop());

  // 4. A custom endpoint saved as `opencode-go` replaces that built-in provider, so the stored key
  // must not drop its URL. The `opencode` provider still gets the key.
  storedKey = "fresh";
  endpoints = [
    {
      id: "opencode-go",
      name: "Local",
      baseUrl: "http://127.0.0.1:1234/v1",
      apiKey: null,
      models: [{ id: "m", name: "M" }],
      headers: [],
    },
  ];
  await rm(log, { force: true });
  await startThread(open(cli), workspace);
  const endpointSpawn = (await readLog()).find((entry) => entry.event === "spawn");
  assert.ok(endpointSpawn, "The fake OpenCode started.");
  assert.equal(endpointSpawn.baseURL, "http://127.0.0.1:1234/v1", "The endpoint keeps its URL.");
  assert.equal(endpointSpawn.configKey, null, "The stored key does not replace the endpoint's options.");
  assert.equal(endpointSpawn.zenKey, "fresh", "The OpenCode provider gets the stored key.");
  report.endpoint = { baseURL: endpointSpawn.baseURL ?? null, zenKey: endpointSpawn.zenKey ?? null };
  report.passed = true;
} finally {
  await Promise.all(clients.map((client) => runCauseEffect(client.stop()).catch(() => undefined)));
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
