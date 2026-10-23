// Runs the real OpenCode driver and `ProviderRuntime` against a fake `opencode acp` that fails as
// OpenCode 2.1.3 does: `-32603` "Internal error: Internal service failure" (#2850). Checks that a
// failed turn reads as OpenCode's service failure, not the generic text, and that a failed start
// reaches the toast with the provider's name while its row keeps OpenCode's own words.
// `bun run test:opencode-service-failure`. Writes .openbot-build/opencode-service-failure-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import type { FailureContext } from "../src/backend/agent/failure-signal";
import { ProviderRuntime } from "../src/backend/agent/provider-runtime";
import type { AgentClient } from "../src/backend/agent-client";
import { AgentStore } from "../src/backend/agent-store";
import type { AgentCliInfo } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import {
  BUILT_IN_PROVIDER_DRIVERS,
  NO_PROVIDER_CREDENTIALS,
  requireProviderDriver,
} from "../src/backend/provider-drivers";
import { installFakeAgent, runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-service-failure-e2e");
const SERVICE_FAILURE = "Internal error: Internal service failure";

interface EmittedError {
  code: string;
  message: string;
  agentId: string | undefined;
  context: FailureContext | undefined;
}

interface Report {
  passed: boolean;
  turn?: { error: string };
  start?: { toast: EmittedError | null; rowState: string | undefined; rowMessage: string | null | undefined };
}

const root = await mkdtemp(join(tmpdir(), "openbot-opencode-service-failure-e2e-"));
const report: Report = { passed: false };
const clients: AgentClient[] = [];

try {
  const workspace = join(root, "workspace");
  await mkdir(workspace);

  // 1. A failed turn names OpenCode's local service and the fix, not "Internal error".
  const promptFake = join(root, "prompt", "bin", "opencode");
  await installFakeAgent(promptFake, "opencode-service-failure", { FAKE_FAIL: "prompt" });
  const cli: AgentCliInfo = { executable: promptFake, version: "2.1.3", source: "managed" };
  const client = requireProviderDriver("opencode").createClient(cli, 10_000, NO_PROVIDER_CREDENTIALS);
  clients.push(client);
  client.start();
  const { error } = await runTurn(client, await startThread(client, { cwd: workspace }));
  assert.equal(error, sourceText("error.provider.opencodeServiceFailure"), "A failed turn names OpenCode's service.");
  report.turn = { error };

  // 2. A failed start reaches the user with the provider's name. The row keeps OpenCode's words.
  const startFake = join(root, "start", "bin", "opencode");
  await installFakeAgent(startFake, "opencode-service-failure", { FAKE_FAIL: "initialize" });
  process.env.OPENBOT_OPENCODE_PATH = startFake;
  const store = new AgentStore(join(root, "profile"), join(root, "home"), new OpenBotDatabase(join(root, "profile")));
  const emitted: EmittedError[] = [];
  const providers = new ProviderRuntime({
    offProviders: BUILT_IN_PROVIDER_DRIVERS.map((driver) => driver.id).filter((id) => id !== "opencode"),
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
    emitError: (code, failure, agentId, context) =>
      emitted.push({ code, message: failure instanceof Error ? failure.message : String(failure), agentId, context }),
    requestTimeoutMs: 10_000,
    preferredProvider: "opencode",
    clientFactory: null,
    bundledExecutables: {},
    credentials: NO_PROVIDER_CREDENTIALS,
    redactMcp: (text) => text,
  });
  await runCauseEffect(providers.ensureProvider("opencode").pipe(Effect.ignore));
  const toast = emitted.find((entry) => entry.code === "opencode_start_failed") ?? null;
  const row = providers.status().providers?.find((entry) => entry.id === "opencode");
  report.start = { toast, rowState: row?.state, rowMessage: row?.message };
  for (const started of await runCauseEffect(providers.dispose())) await runCauseEffect(started.stop());
  assert.ok(toast, "The failed start is reported.");
  assert.equal(
    toast.message,
    sourceText("error.provider.namedFailure", { provider: "OpenCode", detail: SERVICE_FAILURE }),
    "The report names OpenCode.",
  );
  assert.equal(toast.agentId, undefined, "A failed start belongs to no chat.");
  assert.ok(toast.context?.causeCode, "The analytics cause comes from OpenCode's own error.");
  assert.equal(row?.state, "error", "The OpenCode row shows the failure.");
  assert.equal(row?.message, SERVICE_FAILURE, "The row keeps OpenCode's own words.");
  report.passed = true;
} finally {
  await stopClients(clients);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
