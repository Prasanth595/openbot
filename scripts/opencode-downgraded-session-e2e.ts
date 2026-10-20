// Runs the real OpenCode driver against a fake `opencode acp` that acts as OpenCode 1.19.3 does on a
// session that OpenCode 2.0 wrote in its `session_v2` table: it advertises `session/resume` and
// `session/list`, does not list the session, and answers each resume with "OpenCode service failure".
// Checks that such a resume ends as a missing session, which the agent replaces and gives the
// transcript; that a session the list still holds is tried once more and kept; and that a managed
// OpenCode older than a working system OpenCode is not selected.
// `bun run test:opencode-downgraded-session`. Writes .openbot-build/opencode-downgraded-session-e2e/report.json.
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { isMissingProviderSessionError } from "../src/backend/agent/thread-items";
import type { AgentClient } from "../src/backend/agent-client";
import { type AgentCliInfo, resolveOpencodeCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-downgraded-session-e2e");

// Sessions named `v2-…` are in the table this version cannot read: not listed, and not resumable.
// `kept-…` sessions are listed but fail to resume, as an internal fault does.
const FAKE_OPENCODE = `#!/usr/bin/env node
const fs = require("node:fs");
const NL = String.fromCharCode(10);
const log = (entry) => fs.appendFileSync(process.env.FAKE_OPENCODE_LOG, JSON.stringify(entry) + NL);
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
const MODEL = "opencode/minimax-m3.1-flash-free";
const setup = (sessionId) => ({ sessionId,
  models: { availableModels: [{ modelId: MODEL, name: "MiniMax" }], currentModelId: MODEL } });
const failure = { code: -32603, message: "Internal error: OpenCode service failure", data: { service: "session" } };
let count = 0;
function handle(message) {
  if (message.id === undefined) return;
  const params = message.params ?? {};
  if (message.method === "initialize") {
    write({ id: message.id, result: { protocolVersion: 1, authMethods: [], agentCapabilities: {
      loadSession: true, sessionCapabilities: { close: {}, fork: {}, list: {}, resume: {} } } } });
    return;
  }
  if (message.method === "session/new") {
    count += 1;
    write({ id: message.id, result: setup("s-" + process.pid + "-" + count) });
    return;
  }
  if (message.method === "session/resume" || message.method === "session/load") {
    log({ event: message.method, sessionId: params.sessionId });
    if (/^(?:v2|kept)-/.test(params.sessionId)) write({ id: message.id, error: failure });
    else write({ id: message.id, result: setup(params.sessionId) });
    return;
  }
  if (message.method === "session/list") {
    log({ event: "session/list" });
    write({ id: message.id, result: { sessions: [{ sessionId: "kept-1", cwd: params.cwd }] } });
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
  event: "session/resume" | "session/load" | "session/list";
  sessionId?: string;
}

interface Report {
  passed: boolean;
  unreadable?: { error: string; missingSession: boolean; resumes: number; listed: boolean };
  listed?: { error: string; missingSession: boolean; resumes: number };
  selection?: { olderManaged: string; newerManaged: string; sameVersion: string; secondSystem: string };
}

const root = await mkdtemp(join(tmpdir(), "openbot-opencode-downgraded-session-e2e-"));
const log = join(root, "opencode.jsonl");
const report: Report = { passed: false };
const clients: AgentClient[] = [];
process.env.FAKE_OPENCODE_LOG = log;

async function readLog(): Promise<LogEntry[]> {
  const text = await readFile(log, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** Resumes a thread and answers the failure, which must not be a success. */
async function resumeFailure(client: AgentClient, threadId: string, cwd: string): Promise<Error> {
  try {
    await runCauseEffect(client.request("thread/resume", { threadId, cwd }, (value) => value));
  } catch (error) {
    assert.ok(error instanceof Error, "The client fails with an Error.");
    return error;
  }
  assert.fail(`The resume of ${threadId} must fail.`);
}

/** A program that prints `version` for `--version`. */
async function fakeCli(name: string): Promise<string> {
  const executable = join(root, name, "bin", "opencode");
  await mkdir(join(root, name, "bin"), { recursive: true });
  await writeFile(executable, `#!/bin/sh\necho "${name.split("-").at(-1)}"\n`);
  await chmod(executable, 0o755);
  return executable;
}

try {
  const executable = join(root, "opencode", "bin", "opencode");
  const workspace = join(root, "workspace");
  await mkdir(join(root, "opencode", "bin"), { recursive: true });
  await mkdir(workspace);
  await writeFile(executable, FAKE_OPENCODE);
  await chmod(executable, 0o755);
  const cli: AgentCliInfo = { executable, version: "1.19.3", source: "managed" };
  const client = requireProviderDriver("opencode").createClient(cli, 10_000, NO_PROVIDER_CREDENTIALS);
  clients.push(client);
  client.start();

  // 1. A session that this version cannot read is a missing session, so the agent gets a new one
  // with its transcript instead of failing each turn.
  const unreadable = await resumeFailure(client, "v2-1", workspace);
  const first = await readLog();
  const unreadableReport = {
    error: unreadable.message,
    missingSession: isMissingProviderSessionError(unreadable, "opencode"),
    resumes: first.filter((entry) => entry.event === "session/resume").length,
    listed: first.some((entry) => entry.event === "session/list"),
  };
  report.unreadable = unreadableReport;
  assert.equal(unreadableReport.missingSession, true, "An unreadable session is replaced.");
  assert.equal(unreadableReport.listed, true, "The session list decides that the session is missing.");
  assert.equal(unreadableReport.resumes, 1, "A session that is not listed is not resumed again.");

  // 2. A session that the list holds is kept: one more resume, then the service failure is reported.
  await rm(log, { force: true });
  const kept = await resumeFailure(client, "kept-1", workspace);
  const keptReport = {
    error: kept.message,
    missingSession: isMissingProviderSessionError(kept, "opencode"),
    resumes: (await readLog()).filter((entry) => entry.event === "session/resume").length,
  };
  report.listed = keptReport;
  assert.equal(keptReport.missingSession, false, "A listed session is not replaced.");
  assert.equal(keptReport.resumes, 2, "A listed session is resumed once more.");
  assert.equal(keptReport.error, sourceText("error.provider.opencodeServiceFailure"));

  // 3. A managed copy older than a working system copy is not selected; a newer or equal one is.
  const system = await fakeCli("system-2.0.4");
  const select = async (managed: string, systemCandidates = [system]) => {
    const resolved = await runCauseEffect(
      resolveOpencodeCli({ systemCandidates, bundledExecutable: await fakeCli(managed) }),
    );
    return `${resolved.source} ${resolved.version}`;
  };
  report.selection = {
    olderManaged: await select("managed-1.19.3"),
    newerManaged: await select("managed-2.1.0"),
    sameVersion: await select("same-2.0.4"),
    secondSystem: await select("managed-1.19.3", [await fakeCli("old-1.0.0"), system]),
  };
  assert.equal(report.selection.olderManaged, "system 2.0.4", "A newer system OpenCode wins.");
  assert.equal(report.selection.newerManaged, "managed 2.1.0", "A newer managed OpenCode wins.");
  assert.equal(report.selection.sameVersion, "managed 2.0.4", "The managed OpenCode wins a tie.");
  assert.equal(report.selection.secondSystem, "system 2.0.4", "Each system OpenCode is compared.");
  report.passed = true;
} finally {
  await Promise.all(clients.map((client) => runCauseEffect(client.stop()).catch(() => undefined)));
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
