// Drives the production Claude adapter with an injected SDK stream and local summary control.
// Uses real SQLite profiles, provider sessions, conversation ownership, context state and a loopback
// Team route. No installed provider, login, account, auth file, vault, browser or model is used.
// Main conversations only. Same-agent added subjects remain an integration follow-up.
// bun scripts/context-category-usage-e2e.ts
// Writes .openbot-build/context-category-usage-e2e/report.json.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  type AgentContextCategoryUsage,
  type AgentSummary,
  CONTEXT_CATEGORY_BYTES_LIMIT,
  CONTEXT_CATEGORY_LIMIT,
  decodeContextCategoryUsage,
  parseReadContextCategoriesInput,
  type ReadContextCategoriesInput,
  type TeamMemberSummary,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import {
  CONTEXT_CATEGORIES_CAPABILITY,
  CONTEXT_CATEGORIES_ROUTE,
} from "@openbot/contracts/team-protocol/context-categories-v1";
import { teamCapabilitiesForProtocol } from "@openbot/contracts/team-protocol/current";
import { teamHttpCodec } from "@openbot/contracts/team-protocol/http-codecs";
import { teamSideRouteCodec } from "@openbot/contracts/team-protocol/side-routes";
import { TEAM_CAPABILITIES_HEADER, TEAM_PROTOCOL_VERSION_HEADER } from "@openbot/contracts/team-protocol/v1";
import { redactText, registerSecretValue, teeLogLines } from "@openbot/logging";
import { readContextCategories, type TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { ContextCategories } from "../src/backend/agent/context-categories";
import { ContextCompaction } from "../src/backend/agent/context-compaction";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import type { AgentClient } from "../src/backend/agent-client";
import { AgentStore } from "../src/backend/agent-store";
import { ClaudeAgentClient } from "../src/backend/claude-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import {
  type AppServerNotification,
  decodeThreadResponse,
  decodeTurnResponse,
  getRecord,
} from "../src/backend/protocol";
import {
  assertContextCategoryScope,
  decodeContextCategoriesFromHost,
} from "../src/main/remote-context-categories-decoding";
import { HttpError } from "../src/main/team-api/http-error";
import { requestCapabilities, requestProtocol } from "../src/main/team-api/request-helpers";
import { routeContextCategories } from "../src/main/team-api/route-context-categories";
import { decodeContextCategoriesFromMain } from "../src/preload/context-categories-decoding";
import { ContextCategoryReader } from "../src/renderer/src/features/conversation/context-category-reader";
import { createWebContextCategoryRead } from "../src/renderer/src/features/web-client/web-context-categories";

type QueryFactory = NonNullable<ConstructorParameters<typeof ClaudeAgentClient>[1]>;
type Query = ReturnType<QueryFactory>;
type StreamMessage = Query extends AsyncIterable<infer Message> ? Message : never;
const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build/context-category-usage-e2e");
const EXPECTED_CHECKS = 18;
const WAIT_MS = 10_000;
const runNonce = randomUUID();
const startedAt = new Date().toISOString();
const PRIVATE_LABEL = "/fixture-private/memory/session-credential-file";
const PRIVATE_TOKEN = "synthetic-context-private-token";
const privateValues = [PRIVATE_LABEL, PRIVATE_TOKEN];
for (const value of privateValues) registerSecretValue(value);
const sourcePaths = [
  ".github/workflows/ci.yml",
  "PRIVACY.md",
  "bun.lock",
  "changelog.d/codex-context-category-usage.md",
  "docs/architecture/context-usage.md",
  "docs/architecture/team-api.md",
  "node_modules/@anthropic-ai/claude-agent-sdk/package.json",
  "node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts",
  "package.json",
  "packages/contracts/package.json",
  "packages/contracts/src/input-limits.ts",
  "packages/contracts/src/ipc-agent-events.ts",
  "packages/contracts/src/ipc-agent-runtime.ts",
  "packages/contracts/src/ipc-context-categories.ts",
  "packages/contracts/src/ipc-endpoints.ts",
  "packages/contracts/src/ipc.ts",
  "packages/contracts/src/runtime-values.ts",
  "packages/contracts/src/team-protocol/admin-wire.ts",
  "packages/contracts/src/team-protocol/context-categories-v1.ts",
  "packages/contracts/src/team-protocol/current.ts",
  "packages/contracts/src/team-protocol/fixtures/context-categories-v1/client-request.json",
  "packages/contracts/src/team-protocol/fixtures/context-categories-v1/host-response.json",
  "packages/contracts/src/team-protocol/fixtures/v7/host-http-response.json",
  "packages/contracts/src/team-protocol/http-codecs.ts",
  "packages/contracts/src/team-protocol/optional-routes.ts",
  "packages/contracts/src/team-protocol/side-routes.ts",
  "packages/contracts/src/team-protocol/v1-adapter.ts",
  "packages/contracts/src/team-protocol/v1.ts",
  "packages/contracts/src/team-protocol/v2-adapter.ts",
  "packages/contracts/src/team-protocol/v2.ts",
  "packages/contracts/src/team-protocol/v3-adapter.ts",
  "packages/contracts/src/team-protocol/v3.ts",
  "packages/contracts/src/team-protocol/v4-adapter.ts",
  "packages/contracts/src/team-protocol/v4.ts",
  "packages/contracts/src/team-protocol/v5-adapter.ts",
  "packages/contracts/src/team-protocol/v5.ts",
  "packages/contracts/src/team-protocol/v6-adapter.ts",
  "packages/contracts/src/team-protocol/v6.ts",
  "packages/contracts/src/team-protocol/v7-adapter.ts",
  "packages/contracts/src/team-protocol/v7.ts",
  "packages/i18n/src/message.ts",
  "packages/i18n/src/messages/de/composer.ts",
  "packages/i18n/src/messages/en/composer.ts",
  "packages/i18n/src/messages/es/composer.ts",
  "packages/i18n/src/messages/fr/composer.ts",
  "packages/i18n/src/messages/it/composer.ts",
  "packages/i18n/src/messages/ja/composer.ts",
  "packages/i18n/src/messages/pl/composer.ts",
  "packages/i18n/src/messages/pt/composer.ts",
  "packages/i18n/src/messages/ru/composer.ts",
  "packages/i18n/src/messages/tr/composer.ts",
  "packages/logging/src/index.ts",
  "packages/team-client/src/index.ts",
  "packages/team-client/src/team-api-requests.ts",
  "packages/ui/src/features/conversation/ContextUsage.tsx",
  "packages/ui/src/features/conversation/styles/context-usage.css",
  "packages/ui/src/text.tsx",
  "scripts/context-category-usage-e2e.ts",
  "src/backend/agent-client.ts",
  "src/backend/agent-service.ts",
  "src/backend/agent-store.ts",
  "src/backend/agent/context-categories.ts",
  "src/backend/agent/context-compaction.ts",
  "src/backend/agent/conversation-runtime.ts",
  "src/backend/agent/plan-updates.ts",
  "src/backend/agent/provider-runtime.ts",
  "src/backend/agent/tool-catalog.ts",
  "src/backend/agent/turn-lifecycle.ts",
  "src/backend/claude-client.ts",
  "src/backend/claude-context-categories.ts",
  "src/backend/claude-history.ts",
  "src/backend/cli.ts",
  "src/backend/database/database-core.ts",
  "src/backend/database/provider-sessions.ts",
  "src/backend/effect-boundary.ts",
  "src/backend/idle-thread-pool.ts",
  "src/backend/openbot-database-schema-history.json",
  "src/backend/openbot-database-schema.ts",
  "src/backend/openbot-database.ts",
  "src/backend/protocol.ts",
  "src/backend/provider-client-effects.ts",
  "src/main/ipc/agent-handlers.ts",
  "src/main/ipc/scoped-handler.ts",
  "src/main/remote-context-categories-decoding.test.ts",
  "src/main/remote-context-categories-decoding.ts",
  "src/main/team-api-server.ts",
  "src/main/team-api/dependencies.ts",
  "src/main/team-api/http-error.ts",
  "src/main/team-api/request-context.ts",
  "src/main/team-api/request-helpers.ts",
  "src/main/team-api/route-context-categories.ts",
  "src/main/trusted-ipc.ts",
  "src/preload/context-categories-decoding.test.ts",
  "src/preload/context-categories-decoding.ts",
  "src/preload/index.ts",
  "src/renderer/src/features/conversation/ConversationComposer.tsx",
  "src/renderer/src/features/conversation/context-category-reader.ts",
  "src/renderer/src/features/conversation/context-category-state.ts",
  "src/renderer/src/features/conversation/conversation-controller-context.tsx",
  "src/renderer/src/features/conversation/conversation-runtime.ts",
  "src/renderer/src/features/conversation/conversation-types.ts",
  "src/renderer/src/features/web-client/WebWorkspace.tsx",
  "src/renderer/src/features/web-client/web-client-context.tsx",
  "src/renderer/src/features/web-client/web-context-categories.ts",
  "src/renderer/src/features/web-client/web-conversation-runtime.ts",
  "src/renderer/src/preview/mock-openbot.ts",
  "src/renderer/stories/ContextUsage.stories.tsx",
];
const sourceManifest: Array<{ path: string; sha256: string }> = [];
let sourceDigest: string | null = null;
let sourceHead: string | null = null;
let nodeChildVersion: string | null = null;
let temporary: string | null = null;
let stopLogTee: (() => void) | null = null;
let fixtureLog = "";
let failure: string | null = null;
let passed = false;
const checks: string[] = [];
const cleanupErrors: Array<{ resource: string; error: string }> = [];
const artifactErrors: string[] = [];
const queries: SyntheticQuery[] = [];
const clients: ClaudeAgentClient[] = [];
const stores: AgentStore[] = [];
const conversations: ConversationRuntime[] = [];
const compactions: ContextCompaction[] = [];
const servers: Server[] = [];
const tasks = new Set<Promise<void>>();
const routeErrors: string[] = [];
const forbiddenTotals = new Set<number>();
const usageNotifications: Array<{ threadId: string; used: number; window: number }> = [];
let routeCalls = 0;

function deferred<T>() {
  let resolveValue: (value: T) => void = () => {
    throw new Error("Deferred is not initialized.");
  };
  const promise = new Promise<T>((resolveValueNow) => {
    resolveValue = resolveValueNow;
  });
  return { promise, resolve: resolveValue };
}

async function within<T>(operation: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Fixture deadline: ${label}.`)), WAIT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function failureText(error: unknown): string {
  return redactText(error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 4096);
}

function artifactText(value: string): string {
  const safe = redactText(value);
  if (Buffer.byteLength(safe) > 512 * 1024) throw new Error("Fixture artifact is too large.");
  for (const privateValue of privateValues) {
    if (
      safe.includes(privateValue) ||
      safe.includes(JSON.stringify(privateValue).slice(1, -1)) ||
      safe.includes(encodeURIComponent(privateValue))
    )
      throw new Error("Private fixture data reached an artifact.");
  }
  return safe;
}

/** A synthetic SDK boundary. The real Claude adapter owns all context processing and lifecycle. */
class SyntheticQuery implements Query {
  readonly #queue: Array<{ message: StreamMessage; done: ReturnType<typeof deferred<void>> }> = [];
  #waiting: ReturnType<typeof deferred<void>> | null = null;
  readonly #inputs = new Set<ReturnType<typeof deferred<void>>>();
  readonly #controls = new Set<ReturnType<typeof deferred<void>>>();
  readonly pending = new Set<ReturnType<typeof deferred<unknown>>>();
  readonly summaries: Promise<unknown>[] = [];
  readonly summaryCalls: Array<{ detail: "summary" }> = [];
  readonly promptTask: Promise<void>;
  inputCount = 0;
  modelChanges = 0;
  active = false;
  closed = false;
  constructor(
    prompt: AsyncIterable<SDKUserMessage>,
    readonly threadId: string,
  ) {
    this.promptTask = (async () => {
      for await (const _message of prompt) {
        this.inputCount += 1;
        for (const receipt of this.#inputs) receipt.resolve();
        this.#inputs.clear();
      }
    })();
  }
  async *[Symbol.asyncIterator](): AsyncGenerator<StreamMessage, void, unknown> {
    while (!this.closed) {
      if (!this.#queue.length) {
        this.#waiting = deferred<void>();
        await this.#waiting.promise;
        this.#waiting = null;
      }
      const entry = this.#queue.shift();
      if (!entry) continue;
      try {
        yield entry.message;
      } finally {
        entry.done.resolve();
      }
    }
  }
  async push(message: StreamMessage): Promise<void> {
    if (this.closed) throw new Error("Synthetic query is closed.");
    const done = deferred<void>();
    this.#queue.push({ message, done });
    this.#waiting?.resolve();
    await within(done.promise, "SDK stream consumption");
  }
  async waitInput(count: number): Promise<void> {
    if (this.inputCount >= count) return;
    const receipt = deferred<void>();
    this.#inputs.add(receipt);
    await within(receipt.promise, "SDK prompt receipt");
    assert.ok(this.inputCount >= count);
  }
  async waitControl(count: number): Promise<void> {
    if (this.summaryCalls.length >= count) return;
    const receipt = deferred<void>();
    this.#controls.add(receipt);
    await within(receipt.promise, "SDK summary control");
    assert.ok(this.summaryCalls.length >= count);
  }
  async getContextUsage(options: { detail: "summary" }): Promise<unknown> {
    assert.deepEqual(options, { detail: "summary" });
    this.summaryCalls.push({ ...options });
    for (const receipt of this.#controls) receipt.resolve();
    this.#controls.clear();
    return await (this.summaries.shift() ?? Promise.resolve(null));
  }
  async interrupt(): Promise<void> {
    throw new Error("No interrupt is part of this fixture.");
  }
  async supportedModels() {
    return [];
  }
  async setModel(): Promise<void> {
    this.modelChanges += 1;
  }
  async applyFlagSettings(): Promise<void> {}
  close(): void {
    this.closed = true;
    this.#waiting?.resolve();
    for (const entry of this.#queue.splice(0)) entry.done.resolve();
    for (const receipt of this.#inputs) receipt.resolve();
    for (const receipt of this.#controls) receipt.resolve();
    this.#inputs.clear();
    this.#controls.clear();
  }
}

function nativeUsage(
  used = 1200,
  window = 2000,
  categories: unknown = [
    { name: "Messages", tokens: 1000, kind: "used" },
    { name: "Free space", tokens: 600, kind: "free" },
    { name: "Autocompact buffer", tokens: 200, kind: "buffer" },
    { name: "MCP tools (deferred)", tokens: 5000, kind: "deferred" },
  ],
) {
  return {
    total_tokens: used,
    raw_max_tokens: window,
    categories,
    memory_files: [{ path: PRIVATE_LABEL, tokens: 50 }],
    mcp_tools: [{ name: PRIVATE_TOKEN, server_name: PRIVATE_TOKEN, tokens: 10 }],
  };
}

function summaryUsage(
  used = 1300,
  categories: unknown = [
    { name: "System prompt", tokens: 300, color: PRIVATE_TOKEN },
    { name: "Messages", tokens: 1000, color: "blue", isDeferred: false },
    { name: "MCP tools (deferred)", tokens: 9000, color: "red", isDeferred: true },
  ],
) {
  return {
    totalTokens: used,
    rawMaxTokens: 2000,
    categories,
    gridRows: PRIVATE_TOKEN,
    memoryFiles: [{ path: PRIVATE_LABEL }],
    mcpTools: [{ name: PRIVATE_TOKEN }],
  };
}

function record(value: unknown) {
  return isDynamicRecord(value) ? value : null;
}

function notification(client: ClaudeAgentClient, threadId: string, used: number): Promise<void> {
  const receipt = deferred<void>();
  const listener = (event: AppServerNotification) => {
    const usage = getRecord(event.params, "tokenUsage");
    if (
      event.method === "thread/tokenUsage/updated" &&
      getRecord(usage, "last")?.totalTokens === used &&
      record(event.params)?.threadId === threadId
    )
      receipt.resolve();
  };
  client.on("notification", listener);
  return within(receipt.promise, "Usage notification").finally(() => client.off("notification", listener));
}

function newClient(compaction?: ContextCompaction): ClaudeAgentClient {
  const client = new ClaudeAgentClient(
    { executable: "/fixture-not-an-executable/claude", version: "2.1.121", source: "system" },
    (params) => {
      if (typeof params.prompt === "string") throw new Error("A fixture query must use the real streaming prompt.");
      const threadId = params.options?.resume ?? params.options?.sessionId;
      if (typeof threadId !== "string") throw new Error("A fixture query needs an exact session ID.");
      const query = new SyntheticQuery(params.prompt, threadId);
      queries.push(query);
      return query;
    },
    async () => [],
  );
  client.on("notification", (event) => {
    const params = record(event.params);
    if (event.method === "thread/tokenUsage/updated") {
      assert.ok(params);
      assert.deepEqual(Object.keys(params).sort(), ["threadId", "tokenUsage"]);
      const usage = getRecord(params, "tokenUsage");
      const last = getRecord(usage, "last");
      assert.ok(usage);
      assert.ok(last);
      assert.equal(typeof params.threadId, "string");
      assert.deepEqual(Object.keys(usage).sort(), ["estimated", "last", "modelContextWindow"]);
      assert.equal(typeof last.totalTokens, "number");
      assert.equal(typeof usage.modelContextWindow, "number");
      if (
        typeof params.threadId === "string" &&
        typeof last.totalTokens === "number" &&
        typeof usage.modelContextWindow === "number"
      ) {
        usageNotifications.push({
          threadId: params.threadId,
          used: last.totalTokens,
          window: usage.modelContextWindow,
        });
        compaction?.observeUsage(params.threadId, last.totalTokens, usage.modelContextWindow, true, null, true);
      }
    }
    if (
      event.method === "openbot/context-compaction" &&
      typeof params?.threadId === "string" &&
      (params.status === "running" || params.status === "completed" || params.status === "failed")
    )
      compaction?.observeCompaction(params.threadId, params.status, "none");
  });
  clients.push(client);
  client.start();
  return client;
}

async function startThread(client: ClaudeAgentClient, cwd: string) {
  const result = await runCauseEffect(
    client.request("thread/start", { cwd, model: "claude-sonnet-5-5", persistSession: true }, decodeThreadResponse),
  );
  const query = queries.findLast((candidate) => candidate.threadId === result.thread.id);
  assert.ok(query);
  return { id: result.thread.id, query };
}

async function startTurn(client: ClaudeAgentClient, query: SyntheticQuery, model = "claude-sonnet-5-5") {
  const before = query.inputCount;
  await runCauseEffect(
    client.request(
      "turn/start",
      {
        threadId: query.threadId,
        model,
        input: [{ type: "text", text: "Synthetic context fixture." }],
      },
      decodeTurnResponse,
    ),
  );
  query.active = true;
  await query.waitInput(before + 1);
}

async function native(client: ClaudeAgentClient, query: SyntheticQuery, value: ReturnType<typeof nativeUsage>) {
  if (!query.active) await startTurn(client, query);
  const receipt =
    typeof value.total_tokens === "number" &&
    Number.isFinite(value.total_tokens) &&
    value.total_tokens >= 0 &&
    Number.isFinite(value.raw_max_tokens) &&
    value.raw_max_tokens > 0
      ? notification(client, query.threadId, value.total_tokens)
      : Promise.resolve();
  await query.push({
    type: "assistant",
    parent_tool_use_id: null,
    uuid: randomUUID(),
    message: { role: "assistant", content: [] },
    context_usage: value,
  });
  await receipt;
}

async function finish(client: ClaudeAgentClient, query: SyntheticQuery, value: unknown = null) {
  const count = query.summaryCalls.length + 1;
  query.summaries.push(Promise.resolve(value));
  const report = record(value);
  const receipt =
    typeof report?.totalTokens === "number" &&
    Number.isFinite(report.totalTokens) &&
    report.totalTokens >= 0 &&
    typeof report.rawMaxTokens === "number" &&
    Number.isFinite(report.rawMaxTokens) &&
    report.rawMaxTokens > 0
      ? notification(client, query.threadId, report.totalTokens)
      : Promise.resolve();
  await query.push({ type: "result", subtype: "success", uuid: randomUUID(), result: "Synthetic completion." });
  query.active = false;
  await query.waitControl(count);
  await receipt;
}

async function pendingSummary(client: ClaudeAgentClient, query: SyntheticQuery) {
  if (!query.active) await startTurn(client, query);
  const pending = deferred<unknown>();
  query.pending.add(pending);
  const count = query.summaryCalls.length + 1;
  query.summaries.push(pending.promise);
  await query.push({ type: "result", subtype: "success", uuid: randomUUID(), result: "Synthetic completion." });
  query.active = false;
  await query.waitControl(count);
  return pending;
}

async function finalize(resource: string, operation: () => Promise<void>): Promise<void> {
  try {
    await within(operation(), `Finalize ${resource}`);
  } catch (error) {
    cleanupErrors.push({ resource, error: failureText(error) });
  }
}

try {
  await within(
    Promise.all([rm(join(OUT, "report.json"), { force: true }), rm(join(OUT, "fixture.log"), { force: true })]),
    "Previous fixture artifacts",
  );
  sourceHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  nodeChildVersion = execFileSync("node", ["-p", "process.version"], { cwd: ROOT, encoding: "utf8" }).trim();
  for (const path of sourcePaths)
    sourceManifest.push({
      path,
      sha256: createHash("sha256")
        .update(await readFile(join(ROOT, path)))
        .digest("hex"),
    });
  sourceDigest = createHash("sha256").update(JSON.stringify(sourceManifest)).digest("hex");
  temporary = await mkdtemp(join(tmpdir(), "openbot-context-categories-"));
  privateValues.push(temporary);
  registerSecretValue(temporary);
  stopLogTee = teeLogLines(["claude-query", "openbot-database-schema"], (line) => {
    fixtureLog = `${fixtureLog}${redactText(line)}\n`.slice(-64 * 1024);
  });
  const store = new AgentStore(join(temporary, "state"), join(temporary, "home"));
  stores.push(store);
  await runCauseEffect(store.initialize());
  const first = await runCauseEffect(
    store.createAgent({ name: "Context first", description: "", avatarSeed: "builder", avatarHue: null }),
  );
  const second = await runCauseEffect(
    store.createAgent({ name: "Context second", description: "", avatarSeed: "builder", avatarHue: null }),
  );
  await runCauseEffect(store.updateAgent({ agentId: first.id, provider: "claude", model: "claude-sonnet-5-5" }));
  await runCauseEffect(store.updateAgent({ agentId: second.id, provider: "claude", model: "claude-sonnet-5-5" }));
  const mainThread = await runCauseEffect(store.ensureThreadId(first.id));
  const secondMain = await runCauseEffect(store.ensureThreadId(second.id));
  const subjectThread = `subject-${randomUUID()}`;
  const conversation = new ConversationRuntime(
    store,
    () => {},
    () => store.list(),
  );
  conversations.push(conversation);
  let current: AgentClient | null = null;
  const providers = {
    clientForAgent: (_agent: AgentSummary) => current,
    peekClientForAgent: (_agent: AgentSummary) => current,
  };
  const compaction = new ContextCompaction({
    store,
    providers: { ...providers, clientFor: () => current, isReady: () => true, listModels: () => [] },
    emitError: () => {
      throw new Error("No compaction request is part of this fixture.");
    },
    scheduleDrain: () => {},
  });
  compactions.push(compaction);
  const client = newClient(compaction);
  current = client;
  const scope = new ContextCategories({ store, conversation, providers });
  const primary = await startThread(client, temporary);
  const other = await startThread(client, temporary);
  const bind = (agentId: string, publicThread: string, externalId: string) => {
    store.database.bindProviderSession({
      threadId: publicThread,
      provider: "claude",
      externalSessionId: externalId,
      model: "claude-sonnet-5-5",
      effort: "medium",
    });
    conversation.bindThread(externalId, agentId, publicThread);
    conversation.markThreadLoaded(externalId, client);
  };
  bind(first.id, mainThread, primary.id);
  bind(second.id, secondMain, other.id);
  const target = { agentId: first.id, threadId: mainThread };
  const read = () => scope.read(target);

  await native(client, primary.query, nativeUsage());
  assert.deepEqual(
    read()?.categories?.map((row) => row.kind),
    ["used", "free", "buffer", "deferred"],
  );
  assert.equal(read()?.usedTokens, 1200);
  assert.equal(read()?.windowTokens, 2000);
  assert.equal(read()?.categories?.[3]?.tokens, 5000);
  assert.ok(!JSON.stringify(read()).includes(PRIVATE_LABEL));
  assert.ok(!JSON.stringify(read()).includes(PRIVATE_TOKEN));
  checks.push("Native kinds remain separate and deferred schemas do not change the provider total.");

  await finish(client, primary.query, summaryUsage());
  assert.equal(read()?.source, "summary");
  assert.deepEqual(
    read()?.categories?.map((row) => row.kind),
    [null, null, null],
  );
  assert.deepEqual(
    read()?.categories?.map((row) => row.isDeferred),
    [null, false, true],
  );
  assert.deepEqual(primary.query.summaryCalls, [{ detail: "summary" }]);
  checks.push("The existing post-turn control uses summary only and retains isDeferred without color guesses.");

  for (const categories of [
    undefined,
    { tokens: 1 },
    [{ name: "Messages", tokens: -1, kind: "used" }],
    [{ name: "Messages", tokens: NaN, kind: "used" }],
    [{ name: "Messages", tokens: 1, kind: "future-kind" }],
  ]) {
    await native(client, primary.query, { ...nativeUsage(1250), categories });
    assert.equal(read()?.usedTokens, 1250);
    assert.equal(read()?.categories, null);
  }
  const beforeMalformed = usageNotifications.length;
  await primary.query.push({
    type: "assistant",
    parent_tool_use_id: null,
    uuid: randomUUID(),
    message: { role: "assistant", content: [] },
    context_usage: "malformed",
  });
  assert.equal(read(), null);
  assert.equal(usageNotifications.length, beforeMalformed);
  await native(client, primary.query, nativeUsage(1250));
  checks.push(
    "Missing and malformed native rows preserve valid total usage; an invalid top-level report clears cached detail.",
  );

  for (const categories of [
    undefined,
    [{ name: "Messages", tokens: 1, isDeferred: "true" }],
    [{ name: "Messages", tokens: Number.MAX_SAFE_INTEGER + 1 }],
  ]) {
    await finish(client, primary.query, { ...summaryUsage(1400), categories });
    assert.equal(read()?.usedTokens, 1400);
    assert.equal(read()?.categories, null);
    await startTurn(client, primary.query);
  }
  await native(client, primary.query, nativeUsage(0, 2000, []));
  assert.equal(read()?.usedTokens, 0);
  assert.deepEqual(read()?.categories, []);
  await native(client, primary.query, nativeUsage(2500, 2000));
  assert.equal(read()?.usedTokens, 2500);
  await native(client, primary.query, nativeUsage(2500.5, 2000.5, []));
  assert.equal(read()?.usedTokens, 2500.5);
  const beforeInvalid = usageNotifications.length;
  await native(client, primary.query, nativeUsage(Number.POSITIVE_INFINITY, 2000));
  assert.equal(read(), null);
  assert.equal(usageNotifications.length, beforeInvalid);
  await native(client, primary.query, nativeUsage(1250));
  checks.push("Summary faults keep totals; zero, fractional and over-window totals keep the existing meter meaning.");

  const longRows = Array.from({ length: 128 }, (_value, index) => ({
    name: index === 0 ? PRIVATE_LABEL : "Messages",
    tokens: index,
    kind: "used",
  }));
  await native(client, primary.query, nativeUsage(1500, 2000, longRows));
  assert.equal(read()?.categories?.length, CONTEXT_CATEGORY_LIMIT);
  assert.equal(read()?.truncated, true);
  assert.equal(read()?.categories?.[0]?.label, "other");
  assert.ok(Buffer.byteLength(JSON.stringify(read())) <= CONTEXT_CATEGORY_BYTES_LIMIT);
  const copy = client.readContextCategories(primary.id);
  const copiedRow = copy?.categories?.[0];
  assert.ok(copiedRow);
  copiedRow.tokens = 999999;
  assert.equal(client.readContextCategories(primary.id)?.categories?.[0]?.tokens, 0);
  checks.push("The adapter retains 32 rows, marks truncation, hides unknown names and returns isolated copies.");

  const compactPending = await pendingSummary(client, primary.query);
  forbiddenTotals.add(170001);
  await primary.query.push({ type: "system", subtype: "status", status: "compacting" });
  assert.equal(read(), null);
  compactPending.resolve(summaryUsage(170001));
  await primary.query.push({ type: "system", subtype: "compact_boundary" });
  assert.equal(read(), null);
  checks.push("Compaction clears detail and invalidates a summary that was already pending.");

  await native(client, primary.query, nativeUsage(1600));
  const turnPending = await pendingSummary(client, primary.query);
  forbiddenTotals.add(170002);
  await startTurn(client, primary.query);
  turnPending.resolve(summaryUsage(170002));
  await native(client, primary.query, nativeUsage(1650));
  assert.equal(read()?.usedTokens, 1650);
  checks.push("A new turn rejects the older summary and keeps only the current native estimate.");

  await finish(client, primary.query);
  await startTurn(client, primary.query, "claude-opus-5-5");
  assert.equal(read(), null);
  assert.equal(primary.query.modelChanges, 1);
  await native(client, primary.query, nativeUsage(1800));
  await finish(client, primary.query);
  checks.push("A model change clears the cached categories before the replacement model runs.");

  const reopenPending = await pendingSummary(client, primary.query);
  forbiddenTotals.add(170003);
  await runCauseEffect(client.releaseThread(primary.id));
  assert.equal(read(), null);
  await runCauseEffect(
    client.request(
      "thread/resume",
      { threadId: primary.id, cwd: temporary, model: "claude-sonnet-5-5" },
      decodeThreadResponse,
    ),
  );
  const reopened = queries.findLast((query) => query.threadId === primary.id);
  assert.ok(reopened);
  assert.notEqual(reopened, primary.query);
  reopenPending.resolve(summaryUsage(170003));
  assert.equal(read(), null);
  await native(client, reopened, nativeUsage(1900));
  checks.push("A released and resumed session has a new runtime and cannot retain a previous runtime report.");

  await native(client, other.query, nativeUsage(900));
  assert.equal(read()?.usedTokens, 1900);
  assert.equal(scope.read({ agentId: first.id, threadId: subjectThread }), null);
  await reopened.push({
    type: "assistant",
    parent_tool_use_id: null,
    uuid: randomUUID(),
    session_id: other.id,
    message: { role: "assistant", content: [] },
    context_usage: nativeUsage(1910),
  });
  assert.equal(read(), null);
  await native(client, reopened, nativeUsage(1900));
  assert.equal(scope.read({ agentId: second.id, threadId: secondMain })?.usedTokens, 900);
  assert.equal(scope.read({ agentId: second.id, threadId: mainThread }), null);
  conversation.bindThread(other.id, second.id, mainThread);
  assert.equal(scope.read({ agentId: second.id, threadId: secondMain }), null);
  conversation.bindThread(other.id, second.id, secondMain);
  conversation.unloadThread(other.id);
  assert.equal(scope.read({ agentId: second.id, threadId: secondMain }), null);
  conversation.markThreadLoaded(other.id, client);
  checks.push(
    "Two agents read only their exact Main sessions; mismatched, unloaded and added-subject targets return no data.",
  );

  await finish(client, reopened);
  await finish(client, other.query);
  const replacement = newClient();
  current = replacement;
  assert.equal(read(), null);
  current = client;
  for (const provider of ["codex", "acp"] as const) {
    await runCauseEffect(store.updateAgent({ agentId: first.id, provider, model: "gpt-6-luna" }));
    assert.equal(read(), null);
  }
  await runCauseEffect(store.updateAgent({ agentId: first.id, provider: "claude", model: "claude-sonnet-5-5" }));
  const newSession = await startThread(client, temporary);
  bind(first.id, mainThread, newSession.id);
  assert.equal(read(), null);
  await native(client, newSession.query, nativeUsage(1950));
  assert.equal(read()?.usedTokens, 1950);
  checks.push("Provider, client and active-session replacements refuse an older report.");

  const routeTarget = {
    listAgents: () => store.list(),
    readContextCategories: (input: ReadContextCategoriesInput) => scope.read(input),
  };
  const member: TeamMemberSummary = {
    id: "fixture-member",
    username: "fixture",
    email: null,
    name: null,
    role: "member",
    createdAt: startedAt,
    disabled: false,
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://fixture.invalid");
    const codec = teamSideRouteCodec(url.pathname);
    routeCalls += 1;
    const hidden = request.headers["x-fixture-hidden"] === "true" ? new Set([first.id]) : new Set<string>();
    const task = routeContextCategories(
      {
        request,
        response,
        method: request.method ?? "GET",
        url,
        protocol: requestProtocol(request),
        capabilities: requestCapabilities(request),
        member,
        token: PRIVATE_TOKEN,
        sessionId: "fixture-session",
        sessionExpiresAt: startedAt,
        json: (status, value) => {
          response.writeHead(status, { "content-type": "application/json" });
          response.end(JSON.stringify(codec?.response(url.pathname, status, value) ?? value));
          return "handled";
        },
        empty: (status) => {
          response.writeHead(status);
          response.end();
          return "handled";
        },
      },
      routeTarget,
      hidden,
    )
      .then((outcome) => {
        if (outcome !== "handled") {
          response.writeHead(404);
          response.end();
        }
      })
      .catch((error: unknown) => {
        if (!(error instanceof HttpError)) routeErrors.push(failureText(error));
        response.writeHead(error instanceof HttpError ? error.status : 500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: error instanceof HttpError ? error.message : "Fixture route failure." }));
      })
      .finally(() => {
        tasks.delete(task);
      });
    tasks.add(task);
  });
  servers.push(server);
  await within(
    new Promise<void>((resolveValue, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolveValue();
      });
    }),
    "Loopback listener",
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const headers = {
    [TEAM_PROTOCOL_VERSION_HEADER]: "7",
    [TEAM_CAPABILITIES_HEADER]: CONTEXT_CATEGORIES_CAPABILITY,
    "content-type": "application/json",
  };
  const request: TeamApiRequest = async (method, path, decode, body) => {
    assert.equal(path, CONTEXT_CATEGORIES_ROUTE);
    assert.equal(method, "POST");
    const codec = teamSideRouteCodec(path);
    assert.ok(codec);
    const response = await within(
      fetch(`${origin}${path}`, { method, headers, body: JSON.stringify(codec.request(path, body)) }),
      "Current Team read",
    );
    const value = await response.json();
    if (!response.ok) throw new Error("Fixture host refused a read.");
    return decode(codec.response(path, response.status, value));
  };
  const callsBeforeRead = queries.reduce((sum, query) => sum + query.summaryCalls.length, 0);
  const inputsBeforeRead = queries.reduce((sum, query) => sum + query.inputCount, 0);
  const remote = await runCauseEffect(readContextCategories(request, target));
  assert.deepEqual(remote, read());
  assert.equal(
    await runCauseEffect(readContextCategories(request, { agentId: first.id, threadId: subjectThread })),
    null,
  );
  const hidden = await fetch(`${origin}${CONTEXT_CATEGORIES_ROUTE}`, {
    method: "POST",
    headers: { ...headers, "x-fixture-hidden": "true" },
    body: JSON.stringify(target),
  });
  assert.equal(hidden.status, 404);
  const malformed = await fetch(`${origin}${CONTEXT_CATEGORIES_ROUTE}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ agentId: "x".repeat(129), threadId: mainThread }),
  });
  assert.equal(malformed.status, 400);
  checks.push("The real current Team route reads visible Main metadata and refuses hidden or malformed targets.");

  assert.deepEqual(decodeContextCategoriesFromHost(remote), read());
  assert.deepEqual(decodeContextCategoriesFromMain(remote), read());
  assert.throws(() => assertContextCategoryScope(remote, { agentId: second.id, threadId: secondMain }));
  const malformedReply = {
    ...remote,
    categories: [{ label: PRIVATE_LABEL, tokens: 1, kind: "used", isDeferred: null }],
  };
  assert.throws(() => decodeContextCategoriesFromHost(malformedReply));
  assert.throws(() => decodeContextCategoriesFromMain(malformedReply));
  assert.throws(() =>
    decodeContextCategoryUsage({
      ...remote,
      categories: Array.from({ length: 33 }, () => ({ label: "messages", tokens: 1, kind: "used", isDeferred: null })),
    }),
  );
  assert.throws(() => parseReadContextCategoriesInput({ agentId: first.id, threadId: "" }));
  const extras = { ...remote, memoryFiles: [{ path: PRIVATE_LABEL }], raw: PRIVATE_TOKEN };
  assert.ok(!JSON.stringify(decodeContextCategoriesFromMain(extras)).includes(PRIVATE_LABEL));
  assert.ok(!JSON.stringify(decodeContextCategoriesFromHost(extras)).includes(PRIVATE_TOKEN));
  const wireRequest = JSON.parse(
    await readFile(
      join(ROOT, "packages/contracts/src/team-protocol/fixtures/context-categories-v1/client-request.json"),
      "utf8",
    ),
  );
  const wireResponse = JSON.parse(
    await readFile(
      join(ROOT, "packages/contracts/src/team-protocol/fixtures/context-categories-v1/host-response.json"),
      "utf8",
    ),
  );
  assert.ok(isDynamicRecord(wireRequest));
  assert.ok(isDynamicRecord(wireResponse));
  const wireCodec = teamSideRouteCodec(CONTEXT_CATEGORIES_ROUTE);
  assert.ok(wireCodec);
  assert.deepEqual(wireCodec.request(CONTEXT_CATEGORIES_ROUTE, wireRequest.body), wireRequest.body);
  assert.deepEqual(wireCodec.response(CONTEXT_CATEGORIES_ROUTE, 200, wireResponse.body), wireResponse.body);
  checks.push(
    "Current host and preload decoders retain bounded safe fields and the optional wire fixtures round trip.",
  );

  assert.ok(teamCapabilitiesForProtocol(7).includes(CONTEXT_CATEGORIES_CAPABILITY));
  assert.ok(!teamCapabilitiesForProtocol(6).includes(CONTEXT_CATEGORIES_CAPABILITY));
  let webEnabled = false;
  let hostId = "fixture-host";
  let webCalls = 0;
  const webRead = createWebContextCategoryRead({
    request:
      () =>
      async (...args) => {
        webCalls += 1;
        return request(...args);
      },
    enabled: () => webEnabled,
    hostId: () => hostId,
  });
  assert.equal(await webRead(target, hostId), null);
  assert.equal(webCalls, 0);
  webEnabled = true;
  assert.deepEqual(await webRead(target, hostId), read());
  const heldWeb = deferred<AgentContextCategoryUsage | null>();
  const heldRead = createWebContextCategoryRead({
    request: () => async (_method, _path, decode) => decode(await heldWeb.promise),
    enabled: () => true,
    hostId: () => hostId,
  });
  const oldHost = heldRead(target, hostId);
  hostId = "replacement-host";
  heldWeb.resolve(remote);
  assert.equal(await oldHost, null);
  const noCapability = await fetch(`${origin}${CONTEXT_CATEGORIES_ROUTE}`, {
    method: "POST",
    headers: { ...headers, [TEAM_CAPABILITIES_HEADER]: "" },
    body: JSON.stringify(target),
  });
  assert.equal(await noCapability.json(), null);
  checks.push("The actual joined adapter sends no unsupported-host request and rejects a replaced host response.");

  const frozen = compaction.snapshot().find((state) => state.agentId === first.id);
  assert.ok(frozen?.usage);
  assert.equal("categories" in frozen.usage, false);
  const fixture = JSON.parse(
    await readFile(join(ROOT, "packages/contracts/src/team-protocol/fixtures/v7/host-http-response.json"), "utf8"),
  );
  const codec = teamHttpCodec(7);
  const path = "/v1/agents";
  const encodedBefore = codec.encodeResponse("GET", path, 200, fixture, {});
  const encodedAfter = codec.encodeResponse(
    "GET",
    path,
    200,
    fixture.map((agent: AgentSummary) => ({ ...agent, contextCategories: remote })),
    {},
  );
  assert.equal(encodedAfter, encodedBefore);
  assert.equal(
    queries.reduce((sum, query) => sum + query.summaryCalls.length, 0),
    callsBeforeRead,
  );
  assert.equal(
    queries.reduce((sum, query) => sum + query.inputCount, 0),
    inputsBeforeRead,
  );
  checks.push(
    "Current reads send no SDK control or prompt and keep released total notifications and roster projection unchanged.",
  );

  const firstRead = deferred<AgentContextCategoryUsage | null>();
  const nextRead = deferred<AgentContextCategoryUsage | null>();
  const readStarted = deferred<void>();
  const observed: Array<AgentContextCategoryUsage | null> = [];
  let selectedCalls = 0;
  let activeReads = 0;
  let maximumReads = 0;
  const reader = new ContextCategoryReader(
    async () => {
      selectedCalls += 1;
      activeReads += 1;
      maximumReads = Math.max(maximumReads, activeReads);
      if (selectedCalls === 1) readStarted.resolve();
      try {
        return await (selectedCalls === 1 ? firstRead.promise : nextRead.promise);
      } finally {
        activeReads -= 1;
      }
    },
    (value) => observed.push(value),
  );
  reader.select({ ...target, serverId: "fixture-host" });
  await readStarted.promise;
  const secondTarget = { agentId: second.id, threadId: secondMain, serverId: "fixture-host" };
  for (let index = 0; index < 20; index += 1) reader.select({ ...secondTarget });
  assert.equal(selectedCalls, 1);
  firstRead.resolve(remote);
  nextRead.resolve(scope.read({ agentId: second.id, threadId: secondMain }));
  await reader.refresh();
  assert.equal(observed.findLast((value) => value !== null)?.agentId, second.id);
  assert.ok(observed.filter((value) => value !== null).every((value) => value.agentId === second.id));
  assert.equal(maximumReads, 1);
  assert.equal(selectedCalls, 2);
  reader.select({ ...secondTarget });
  assert.equal(observed.at(-1)?.agentId, second.id);
  reader.dispose();
  assert.equal(observed.at(-1), null);
  const afterDispose = deferred<AgentContextCategoryUsage | null>();
  const disposedStarted = deferred<void>();
  const disposed = new ContextCategoryReader(
    async () => {
      disposedStarted.resolve();
      return await afterDispose.promise;
    },
    (value) => observed.push(value),
  );
  disposed.select({ ...target, serverId: "fixture-host" });
  await disposedStarted.promise;
  const settled = disposed.refresh();
  disposed.dispose();
  afterDispose.resolve(remote);
  await settled;
  assert.equal(observed.at(-1), null);
  checks.push(
    "The read controller coalesces invalidations, keeps one request in flight, rejects stale targets and clears on disposal.",
  );

  await finish(client, newSession.query);
  const slow = await pendingSummary(client, newSession.query);
  forbiddenTotals.add(170004);
  const responded = deferred<void>();
  // A delayed synthetic provider response is input to the existing two-second deadline, not a sleep poll.
  const delay = setTimeout(() => {
    slow.resolve(summaryUsage(170004));
    responded.resolve();
  }, 2100);
  await within(responded.promise, "Delayed SDK control response");
  clearTimeout(delay);
  await newSession.query.push({ type: "system", subtype: "fixture_barrier" });
  assert.equal(read()?.usedTokens, 1950);
  checks.push("A summary beyond the existing deadline cannot replace the current native total or categories.");

  await runCauseEffect(client.stop());
  assert.equal(read(), null);
  client.start();
  assert.equal(read(), null);
  await runCauseEffect(client.stop());
  conversation.dispose();
  compaction.dispose();
  store.database.close();
  const restarted = new AgentStore(join(temporary, "state"), join(temporary, "home"));
  stores.push(restarted);
  await runCauseEffect(restarted.initialize());
  assert.equal(restarted.list().find((candidate) => candidate.id === first.id)?.threadId, mainThread);
  assert.equal(restarted.database.activeProviderSession(mainThread, "claude")?.externalSessionId, newSession.id);
  const restartConversation = new ConversationRuntime(
    restarted,
    () => {},
    () => restarted.list(),
  );
  conversations.push(restartConversation);
  const restartScope = new ContextCategories({
    store: restarted,
    conversation: restartConversation,
    providers: { peekClientForAgent: () => replacement },
  });
  assert.equal(restartScope.read(target), null);
  assert.ok(!usageNotifications.some((item) => forbiddenTotals.has(item.used)));
  assert.equal(routeErrors.length, 0);
  assert.equal(checks.length, EXPECTED_CHECKS - 1);
  checks.push("Restart keeps Main thread and session identity but retains no runtime category cache.");
  // The final check is counted after its assertions.
  assert.equal(checks.length, EXPECTED_CHECKS);
  passed = true;
} catch (error) {
  failure = failureText(error);
} finally {
  // A control can outlive a closed SDK stream. Each owned synthetic control still has its own cleanup.
  for (const [index, query] of queries.entries())
    await finalize(`SDK controls ${index}`, async () => {
      for (const pending of query.pending) pending.resolve(null);
      query.pending.clear();
    });
  for (const [index, client] of clients.entries())
    await finalize(`Claude client ${index}`, () => runCauseEffect(client.stop()));
  for (const [index, query] of queries.entries()) await finalize(`SDK input stream ${index}`, () => query.promptTask);
  for (const [index, compaction] of compactions.entries())
    await finalize(`Context state ${index}`, async () => {
      compaction.dispose();
    });
  for (const [index, conversation] of conversations.entries())
    await finalize(`Conversation state ${index}`, async () => {
      conversation.dispose();
    });
  for (const [index, server] of servers.entries()) {
    await finalize(`Loopback connections ${index}`, async () => {
      server.closeAllConnections();
    });
    await finalize(
      `Loopback listener ${index}`,
      () =>
        new Promise<void>((resolveValue, reject) =>
          server.close((error) => {
            if (error && !("code" in error && error.code === "ERR_SERVER_NOT_RUNNING" && !server.listening))
              reject(error);
            else resolveValue();
          }),
        ),
    );
  }
  await finalize("Route tasks", async () => {
    await Promise.all([...tasks]);
  });
  for (const [index, store] of stores.entries())
    await finalize(`Database ${index}`, async () => {
      store.database.close();
    });
  await finalize("Log tee", async () => {
    stopLogTee?.();
  });
  const temporaryPath = temporary;
  if (temporaryPath) await finalize("Temporary files", () => rm(temporaryPath, { recursive: true, force: true }));
  const cleanupComplete = cleanupErrors.length === 0;
  passed = passed && cleanupComplete && routeErrors.length === 0;
  try {
    await within(mkdir(OUT, { recursive: true }), "Artifact directory");
  } catch (error) {
    artifactErrors.push(failureText(error));
  }
  let logWritten = false;
  try {
    await within(writeFile(join(OUT, "fixture.log"), artifactText(fixtureLog)), "Fixture log");
    logWritten = true;
  } catch (error) {
    artifactErrors.push(failureText(error));
  }
  passed = passed && artifactErrors.length === 0;
  const report = {
    schemaVersion: 1,
    passed,
    runNonce,
    sourceHead,
    sourceManifest,
    sourceDigest,
    startedAt,
    completedAt: new Date().toISOString(),
    runtime: {
      javascript: process.versions.bun ? "Bun" : "Node",
      version: process.versions.bun ?? process.version,
      nodeCompatibilityVersion: process.version,
      nodeChildVersion,
      platform: process.platform,
      architecture: process.arch,
    },
    expectedChecks: EXPECTED_CHECKS,
    checks,
    calls: {
      sdkQueries: queries.length,
      summaryControls: queries.reduce((sum, query) => sum + query.summaryCalls.length, 0),
      summaryDetails: [...new Set(queries.flatMap((query) => query.summaryCalls.map((call) => call.detail)))],
      promptInputs: queries.reduce((sum, query) => sum + query.inputCount, 0),
      routeReads: routeCalls,
    },
    limits: {
      categories: CONTEXT_CATEGORY_LIMIT,
      responseBytes: CONTEXT_CATEGORY_BYTES_LIMIT,
      summaryDeadlineMs: 2000,
      finalizerDeadlineMs: WAIT_MS,
    },
    failure,
    cleanupComplete,
    cleanupErrors,
    routeErrors,
    artifactErrors,
    logWritten,
    limitations: [
      "Synthetic SDK controls prove integration, not provider estimate accuracy.",
      "Synthetic Team actor and loopback HTTP do not establish account login or Signal delivery.",
      "Headless popover verification is a separate Root-owned check.",
      "Only Claude categories and remote Main reads are in this scope. Native mobile is unchanged.",
    ],
  };
  let reportWritten = false;
  try {
    await within(
      writeFile(join(OUT, "report.json"), artifactText(`${JSON.stringify(report, null, 2)}\n`)),
      "Fixture report",
    );
    reportWritten = true;
  } catch (error) {
    artifactErrors.push(failureText(error));
    passed = false;
  }
  // Machine-readable: a safe result receipt and relative artifact paths only.
  process.stdout.write(
    `${JSON.stringify({
      passed,
      runNonce,
      sourceDigest,
      checks: checks.length,
      expectedChecks: EXPECTED_CHECKS,
      cleanupComplete,
      logWritten,
      reportWritten,
      report: ".openbot-build/context-category-usage-e2e/report.json",
    })}\n`,
  );
  if (!passed || !reportWritten) process.exitCode = 1;
}
