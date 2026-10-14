// Starts the Antigravity provider end to end on the real driver and `ProviderRuntime`, with a fake
// server that, like the Windows PyInstaller build, unpacks itself into the temporary folder at each
// start. Checks that each process gets its own temporary folder and that OpenBot removes it, that
// failed starts stop after the limit, that an automatic refresh does not start the provider again
// and a user refresh does, that low disk space stops a start before the process spawns, and that a
// launch removes what an earlier run left.
// `bun scripts/antigravity-start-e2e.ts`. Writes .openbot-build/antigravity-start-e2e/report.json.
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { ProviderRuntime } from "../src/backend/agent/provider-runtime";
import type { AgentClient, AgentProvider } from "../src/backend/agent-client";
import { AgentStore } from "../src/backend/agent-store";
import { type AgentCliInfo, ANTIGRAVITY_MANIFEST } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import {
  BUILT_IN_PROVIDER_DRIVERS,
  NO_PROVIDER_CREDENTIALS,
  requireProviderDriver,
} from "../src/backend/provider-drivers";
import { sweepProviderTemp } from "../src/backend/provider-temp";

const OUT = resolve(import.meta.dirname, "../.openbot-build/antigravity-start-e2e");
const WAIT_MS = 15_000;

// `FAKE_AGY_MODE`: `hang` never answers, `crash` exits at its first request.
const FAKE_AGY = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const temp = process.env.TMP || process.env.TEMP || process.env.TMPDIR;
const unpacked = path.join(temp, "_MEI" + process.pid.toString(16));
fs.mkdirSync(unpacked, { recursive: true });
fs.writeFileSync(path.join(unpacked, "python310.dll"), Buffer.alloc(5 * 1024 * 1024));
fs.appendFileSync(process.env.FAKE_AGY_LOG, JSON.stringify({
  pid: process.pid, TMP: process.env.TMP, TEMP: process.env.TEMP, TMPDIR: process.env.TMPDIR, unpacked,
}) + String.fromCharCode(10));
process.stdin.on("data", () => {
  if (process.env.FAKE_AGY_MODE === "crash") process.exit(3);
});
setInterval(() => {}, 1000);
`;

interface StartEntry {
  pid: number;
  TMP: string;
  TEMP: string;
  TMPDIR: string;
  unpacked: string;
}

interface Report {
  passed: boolean;
  stoppedProcess?: { tempRoot: string; envInRoot: boolean; unpackedWhileRunning: boolean; leftAfterStop: string[] };
  startCap?: { attempts: number; spawns: number; state: string | undefined; message: string | null | undefined };
  automaticRefresh?: { spawns: number };
  userRefresh?: { spawns: number };
  leftInTempRoot?: string[];
  launchSweep?: { left: string[] };
  lowDisk?: { attempts: number; spawns: number; message: string | null | undefined };
}

const root = await mkdtemp(join(tmpdir(), "openbot-antigravity-start-e2e-"));
const log = join(root, "agy.jsonl");
const report: Report = { passed: false };
process.env.FAKE_AGY_LOG = log;

async function starts(): Promise<StartEntry[]> {
  const text = await readFile(log, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** Waits for a condition on files that another process changes, and fails after `WAIT_MS`. */
async function waitFor(label: string, check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + WAIT_MS;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((resume) => setTimeout(resume, 50));
  }
}

const entries = (path: string): Promise<string[]> => readdir(path).catch(() => []);

function runtime(tempRoot: string, freeBytes: () => number): { providers: ProviderRuntime; store: AgentStore } {
  const store = new AgentStore(join(root, "profile"), join(root, "home"), new OpenBotDatabase(join(root, "profile")));
  const providers = new ProviderRuntime({
    offProviders: BUILT_IN_PROVIDER_DRIVERS.map((driver) => driver.id).filter((id) => id !== "antigravity"),
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
    emit: () => undefined,
    emitError: () => undefined,
    requestTimeoutMs: 5_000,
    preferredProvider: "antigravity",
    clientFactory: null,
    bundledExecutables: { antigravity: executable },
    credentials: { ...NO_PROVIDER_CREDENTIALS, providerTempDirectory: tempRoot, availableDiskBytes: freeBytes },
    redactMcp: (text) => text,
  });
  return { providers, store };
}

function antigravityRow(providers: ProviderRuntime) {
  return providers.status().providers?.find((row) => row.id === ("antigravity" satisfies AgentProvider));
}

const executable = join(root, "agy", "1.2.1", "bin", "agy_acp_server");
try {
  await mkdir(join(root, "agy", "1.2.1", "bin"), { recursive: true });
  await writeFile(join(root, "agy", "1.2.1", ANTIGRAVITY_MANIFEST), JSON.stringify({ version: "1.2.1" }));
  await writeFile(executable, FAKE_AGY);
  await chmod(executable, 0o755);
  const cli: AgentCliInfo = { executable, version: "1.2.1", source: "managed" };

  // 1. A process that is stopped while it unpacks: its folder is in OpenBot's root and is removed.
  process.env.FAKE_AGY_MODE = "hang";
  const stoppedRoot = join(root, "temp-stopped");
  const client: AgentClient = requireProviderDriver("antigravity").createClient(cli, 5_000, {
    ...NO_PROVIDER_CREDENTIALS,
    providerTempDirectory: stoppedRoot,
  });
  client.start();
  await waitFor("the fake server to unpack", async () => (await starts()).length === 1);
  const [started] = await starts();
  assert.ok(started);
  const tempRoot = join(stoppedRoot, "antigravity");
  const envInRoot = [started.TMP, started.TEMP, started.TMPDIR].every((path) => path.startsWith(`${tempRoot}${sep}`));
  const unpackedWhileRunning = (await entries(started.unpacked)).length > 0;
  await runCauseEffect(client.stop());
  await waitFor("the stopped process's folder to be removed", async () => (await entries(tempRoot)).length === 0);
  report.stoppedProcess = {
    tempRoot,
    envInRoot,
    unpackedWhileRunning,
    leftAfterStop: await entries(tempRoot),
  };
  assert.ok(envInRoot, "TMP, TEMP and TMPDIR point into OpenBot's temporary root");
  assert.ok(unpackedWhileRunning, "the fake server unpacked while it ran");

  // 2. Failed starts stop after the limit, whatever asks for the provider.
  process.env.FAKE_AGY_MODE = "crash";
  await rm(log, { force: true });
  const capRoot = join(root, "temp-cap");
  const { providers } = runtime(capRoot, () => Number.MAX_SAFE_INTEGER);
  const attempts = 6;
  for (let attempt = 0; attempt < attempts; attempt += 1)
    await runCauseEffect(providers.ensureProvider("antigravity").pipe(Effect.ignore));
  const capRow = antigravityRow(providers);
  report.startCap = {
    attempts,
    spawns: (await starts()).length,
    state: capRow?.state,
    message: capRow?.message,
  };
  assert.equal(report.startCap.spawns, 3, "three failed starts, then no more");
  assert.equal(capRow?.state, "error");
  assert.equal(capRow?.message, sourceText("error.provider.startStopped", { provider: "Gemini" }));

  // 3. An automatic refresh, such as the one an auth error asks for, does not start it again.
  await runCauseEffect(providers.refreshProviders({ automatic: true }).pipe(Effect.ignore));
  report.automaticRefresh = { spawns: (await starts()).length - 3 };
  assert.equal(report.automaticRefresh.spawns, 0);

  // 4. A refresh the user asks for starts it once more.
  await runCauseEffect(providers.refreshProviders({ automatic: false }).pipe(Effect.ignore));
  report.userRefresh = { spawns: (await starts()).length - 3 };
  assert.equal(report.userRefresh.spawns, 1);
  await runCauseEffect(providers.dispose());
  await waitFor(
    "every crashed process's folder to be removed",
    async () => (await entries(join(capRoot, "antigravity"))).length === 0,
  );
  report.leftInTempRoot = await entries(join(capRoot, "antigravity"));

  // 5. Low disk space stops each start before the process spawns, and the row keeps saying why: no
  // process started, so it is not a failed start.
  await rm(log, { force: true });
  const lowDisk = runtime(join(root, "temp-low-disk"), () => 0).providers;
  for (let attempt = 0; attempt < attempts; attempt += 1)
    await runCauseEffect(lowDisk.ensureProvider("antigravity").pipe(Effect.ignore));
  report.lowDisk = { attempts, spawns: (await starts()).length, message: antigravityRow(lowDisk)?.message };
  await runCauseEffect(lowDisk.dispose());
  assert.equal(report.lowDisk.spawns, 0);
  assert.equal(report.lowDisk.message, sourceText("error.provider.tempDiskSpace", { provider: "Gemini" }));

  // 6. At launch, folders that an earlier run left are removed.
  const sweepRoot = join(root, "temp-sweep");
  await mkdir(join(sweepRoot, "antigravity", "run-earlier", "_MEI1a2b"), { recursive: true });
  await writeFile(join(sweepRoot, "antigravity", "run-earlier", "_MEI1a2b", "python310.dll"), "");
  await sweepProviderTemp(sweepRoot);
  await waitFor(
    "the earlier run's folder to be removed",
    async () => (await entries(join(sweepRoot, "antigravity"))).length === 0,
  );
  report.launchSweep = { left: await entries(join(sweepRoot, "antigravity")) };

  report.passed = true;
} finally {
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
