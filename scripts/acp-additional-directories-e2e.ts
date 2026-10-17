// Runs the real `acp` provider driver over three fake agents to check which ACP session requests
// carry the agent's workspace roots as `additionalDirectories`. Grok 1.0.60 does not advertise the
// field and refuses it on `session/new`, `session/load` and `session/resume`, so every new Grok
// session failed. The fake "strict" agents answer as Grok does: one resumes with `session/resume`,
// one with `session/load`. The "wide" agent advertises the field and must still get the roots.
// `bun run test:acp-directories`. Writes .openbot-build/acp-additional-directories-e2e/report.json.
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentClient } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type AppServerNotification, getString, isRecord } from "../src/backend/protocol";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { CustomAgentStore } from "../src/main/custom-agent-store";
import type { CustomProviderCipher } from "../src/main/custom-provider-store";

const OUT = resolve(import.meta.dirname, "../.openbot-build/acp-additional-directories-e2e");

const FAKE_AGENT = `#!/usr/bin/env node
const fs = require("node:fs");
const NL = String.fromCharCode(10);
const mode = process.env.FAKE_MODE;
const log = (entry) => fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(entry) + NL);
let buffer = "";
let sessions = 0;
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
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
const SESSION_METHODS = ["session/new", "session/load", "session/resume"];
function handle(message) {
  if (message.id === undefined) return;
  if (message.method === "initialize") {
    const sessionCapabilities =
      mode === "strict-resume" ? { resume: {} } : mode === "wide" ? { resume: {}, additionalDirectories: {} } : {};
    write({ id: message.id, result: {
      protocolVersion: 1,
      agentInfo: { name: "fake", title: mode, version: "1.0.0" },
      agentCapabilities: { loadSession: true, sessionCapabilities },
    } });
    return;
  }
  if (SESSION_METHODS.includes(message.method)) {
    const directories = message.params.additionalDirectories;
    log({ method: message.method, cwd: message.params.cwd, additionalDirectories: directories ?? null });
    // Grok 1.0.60's answer to a field it does not advertise.
    if (mode !== "wide" && directories?.length) {
      write({ id: message.id, error: { code: -32602, message: "Invalid params",
        data: "additionalDirectories is not supported: a session works only in its cwd" } });
      return;
    }
    if (message.method === "session/new") {
      sessions += 1;
      write({ id: message.id, result: { sessionId: "s-" + sessions } });
    } else {
      write({ id: message.id, result: {} });
    }
    return;
  }
  if (message.method === "session/prompt") {
    write({ method: "session/update", params: { sessionId: message.params.sessionId, update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "OK" },
    } } });
    write({ id: message.id, result: { stopReason: "end_turn" } });
    return;
  }
  write({ id: message.id, result: {} });
}
setInterval(() => {}, 1000);
`;

const MODES = ["strict-resume", "strict-load", "wide"] as const;
type Mode = (typeof MODES)[number];

interface SessionRequest {
  method: string;
  cwd: string;
  additionalDirectories: string[] | null;
}

interface AgentResult {
  requests: SessionRequest[];
  firstReply: string;
  resumedReply: string;
}

interface Report {
  passed: boolean;
  roots?: string[];
  agents: Partial<Record<Mode, AgentResult>>;
}

const cipher: CustomProviderCipher = {
  canPersist: () => true,
  encrypt: (value) => Buffer.from(value, "utf8"),
  decrypt: (value) => value.toString("utf8"),
};

const root = await mkdtemp(join(tmpdir(), "openbot-acp-directories-e2e-"));
const report: Report = { passed: false, agents: {} };
const clients: AgentClient[] = [];

try {
  const executable = join(root, "bin", "fake-acp-agent");
  const workspace = join(root, "workspace");
  const shared = join(root, "shared");
  const roots = [workspace, shared];
  report.roots = roots;
  await mkdir(join(root, "bin"));
  await mkdir(workspace);
  await mkdir(shared);
  await writeFile(executable, FAKE_AGENT);
  await chmod(executable, 0o755);

  const store = new CustomAgentStore({ path: join(root, "custom-agents.json"), cipher });
  await runCauseEffect(store.load());
  for (const mode of MODES) {
    await runCauseEffect(
      store.save({
        id: mode,
        name: mode,
        command: executable,
        args: [],
        env: [
          { name: "FAKE_MODE", value: mode },
          { name: "FAKE_LOG", value: join(root, `${mode}.jsonl`) },
        ],
      }),
    );
  }

  const driver = requireProviderDriver("acp");
  const context = {
    apiKey: () => null,
    customProviders: () => [],
    mcpServers: () => [],
    customAgents: () => store.configs(),
  };
  const cli = await runCauseEffect(driver.resolveCli());
  const open = () => {
    const client = driver.createClient(cli, 20_000, context, undefined);
    clients.push(client);
    client.start();
    return client;
  };

  for (const mode of MODES) {
    const model = `${mode}/default`;
    // A new session, a turn, then a new process that opens the saved session again.
    let client = open();
    const thread = await threadId(client, { model, cwd: workspace, runtimeWorkspaceRoots: roots });
    const firstReply = await runTurn(client, thread, model);
    await runCauseEffect(client.stop());
    client = open();
    await runCauseEffect(
      client.request(
        "thread/resume",
        { threadId: thread, model, cwd: workspace, runtimeWorkspaceRoots: roots },
        (v) => v,
      ),
    );
    const resumedReply = await runTurn(client, thread, model);
    await runCauseEffect(client.stop());

    // The client also opens sessions of its own to list models. They carry no roots.
    const requests = await readLog(join(root, `${mode}.jsonl`));
    const resumeMethod = mode === "strict-load" ? "session/load" : "session/resume";
    const withRoots = requests.filter((request) => request.additionalDirectories !== null);
    assert.ok(
      requests.some((request) => request.method === resumeMethod && request.cwd === workspace),
      `${mode}: the restart opens the saved session with ${resumeMethod}.`,
    );
    if (mode === "wide") {
      assert.deepEqual(
        withRoots.map((request) => request.method),
        ["session/new", "session/resume"],
        "wide: the thread's session requests carry the roots.",
      );
      for (const request of withRoots) assert.deepEqual(request.additionalDirectories, roots);
    } else {
      assert.deepEqual(withRoots, [], `${mode}: no session request carries a field the agent does not advertise.`);
    }
    assert.equal(firstReply, "OK", `${mode}: the first turn answers.`);
    assert.equal(resumedReply, "OK", `${mode}: the turn after the restart answers.`);
    report.agents[mode] = { requests, firstReply, resumedReply };
  }

  report.passed = true;
} finally {
  await Promise.all(clients.map((client) => runCauseEffect(client.stop()).catch(() => undefined)));
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function readLog(path: string): Promise<SessionRequest[]> {
  const text = await readFile(path, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function threadId(
  client: AgentClient,
  params: { model: string; cwd: string; runtimeWorkspaceRoots: string[] },
): Promise<string> {
  const response = await runCauseEffect(client.request("thread/start", params, (value) => value));
  const id = JSON.stringify(response).match(/"id":"([^"]+)"/)?.[1];
  assert.ok(id, "thread/start answers a thread id.");
  return id;
}

/** Starts a turn and waits for its completion; the reply is the text of the completed agent items. */
async function runTurn(client: AgentClient, thread: string, model: string): Promise<string> {
  let reply = "";
  const done = new Promise<void>((finish, fail) => {
    client.on("notification", (notification: AppServerNotification) => {
      if (getString(notification.params, "threadId") !== thread) return;
      if (notification.method === "item/completed" && isRecord(notification.params)) {
        reply += getString(notification.params.item, "text") ?? "";
      }
      if (notification.method === "error") fail(new Error(getString(notification.params, "message") ?? "error"));
      if (notification.method === "turn/completed") finish();
    });
  });
  await runCauseEffect(
    client.request(
      "turn/start",
      { threadId: thread, model, input: [{ type: "text", text: "Reply with OK only.", text_elements: [] }] },
      (v) => v,
    ),
  );
  await done;
  return reply;
}
