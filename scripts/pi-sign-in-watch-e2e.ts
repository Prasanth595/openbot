// Starts Pi signed out on the real driver and `ProviderRuntime`, with a fake `pi` that lists models
// only while its `auth.json` exists. Then writes that file, as `/login` in Pi over SSH does, and
// checks that the Pi row becomes available with no restart (#2895).
// `bun scripts/pi-sign-in-watch-e2e.ts`. Writes .openbot-build/pi-sign-in-watch-e2e/report.json.
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentEvent, AgentProviderState } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { ProviderRuntime } from "../src/backend/agent/provider-runtime";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { BUILT_IN_PROVIDER_DRIVERS, NO_PROVIDER_CREDENTIALS } from "../src/backend/provider-drivers";

const OUT = resolve(import.meta.dirname, "../.openbot-build/pi-sign-in-watch-e2e");
const WAIT_MS = 15_000;

const FAKE_PI = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
if (process.argv.includes("--version")) {
  process.stdout.write("1.2.0\\n");
  process.exit(0);
}
fs.appendFileSync(process.env.FAKE_PI_LOG, JSON.stringify({ pid: process.pid, argv: process.argv.slice(2) }) + "\\n");
const signedIn = () => fs.existsSync(path.join(process.env.PI_CODING_AGENT_DIR, "auth.json"));
const send = (frame) => process.stdout.write(JSON.stringify(frame) + "\\n");
const lines = readline.createInterface({ input: process.stdin });
lines.on("close", () => process.exit(0));
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  const reply = (data) => send({ type: "response", id: message.id, command: message.type, success: true, data });
  if (message.type === "get_available_models")
    return reply({ models: signedIn() ? [{ provider: "openai", id: "gpt-fake", name: "GPT Fake" }] : [] });
  reply({});
});
`;

interface Report {
  passed: boolean;
  atStart?: { state: AgentProviderState | undefined; spawns: number };
  afterSignIn?: { state: AgentProviderState | undefined; spawns: number; restarted: boolean };
  error?: string;
}

const root = await mkdtemp(join(tmpdir(), "openbot-pi-sign-in-watch-e2e-"));
const agentDirectory = join(root, "pi-agent");
const log = join(root, "pi.jsonl");
const executable = join(root, "bin", "pi");
const report: Report = { passed: false };
const saved = {
  OPENBOT_PI_PATH: process.env.OPENBOT_PI_PATH,
  PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
  FAKE_PI_LOG: process.env.FAKE_PI_LOG,
};
process.env.OPENBOT_PI_PATH = executable;
process.env.PI_CODING_AGENT_DIR = agentDirectory;
process.env.FAKE_PI_LOG = log;

async function spawns(): Promise<number> {
  const text = await readFile(log, "utf8").catch(() => "");
  return text.split("\n").filter(Boolean).length;
}

const store = new AgentStore(join(root, "profile"), join(root, "home"), new OpenBotDatabase(join(root, "profile")));
const statusEvents: AgentEvent[] = [];
let onStatus = () => {};
const providers = new ProviderRuntime({
  offProviders: BUILT_IN_PROVIDER_DRIVERS.map((driver) => driver.id).filter((id) => id !== "pi"),
  conversation: new ConversationRuntime(
    store,
    () => undefined,
    () => store.list(),
  ),
  hooks: {
    bindClient: () => undefined,
    onProvidersReady: () => Effect.void,
    onProviderLost: () => undefined,
    onClientStopped: () => Effect.void,
    isStopping: () => false,
    isProviderBusy: () => false,
    isAgentBusy: () => false,
    isProviderAssigned: () => true,
    onAgentClientLost: () => Effect.void,
    sharedRoot: () => join(root, "shared"),
    onProviderResumed: () => undefined,
    onProviderActivated: () => Effect.void,
    captureConfigRevision: () => 0,
  },
  emit: (event) => {
    if (event.type !== "status") return;
    statusEvents.push(event);
    onStatus();
  },
  emitError: () => undefined,
  requestTimeoutMs: 5_000,
  preferredProvider: "pi",
  clientFactory: null,
  bundledExecutables: {},
  credentials: NO_PROVIDER_CREDENTIALS,
  redactMcp: (text) => text,
});

const piState = () => providers.status().providers?.find((row) => row.id === "pi")?.state;

/** Resolves when the Pi row reaches `state`, from the status events the runtime emits. */
function waitForPiState(state: AgentProviderState): Promise<void> {
  return new Promise((resolveWait, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for Pi to be ${state}.`)), WAIT_MS);
    onStatus = () => {
      if (piState() !== state) return;
      clearTimeout(timer);
      resolveWait();
    };
    onStatus();
  });
}

try {
  await mkdir(join(root, "bin"), { recursive: true });
  await mkdir(agentDirectory, { recursive: true });
  await writeFile(executable, FAKE_PI);
  await chmod(executable, 0o755);

  // 1. No sign-in file: Pi starts signed out and keeps no client.
  await runCauseEffect(providers.start());
  report.atStart = { state: piState(), spawns: await spawns() };
  assert.equal(report.atStart.state, "sign-in-required");

  // 2. Pi's own sign-in writes the file. The host checks again, with no restart and no user action.
  const eventsBeforeSignIn = statusEvents.length;
  await writeFile(join(agentDirectory, "auth.json"), JSON.stringify({ openai: { type: "oauth" } }));
  await waitForPiState("available");
  report.afterSignIn = {
    state: piState(),
    spawns: await spawns(),
    restarted: statusEvents
      .slice(eventsBeforeSignIn)
      .some((event) => event.type === "status" && event.status.phase === "restarting"),
  };
  assert.equal(report.afterSignIn.restarted, false);
  assert.ok(report.afterSignIn.spawns > report.atStart.spawns, "Pi was asked for its models again");
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  for (const client of await runCauseEffect(providers.dispose())) await runCauseEffect(client.stop());
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
