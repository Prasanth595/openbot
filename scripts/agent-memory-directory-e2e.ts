// Drives production SQLite, the memory service, the normal tool router and optional Team routes.
// The provider is a scripted fixture. This checks host workflow, not model recall quality.
// Run: bun scripts/agent-memory-directory-e2e.ts
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { AGENT_MEMORY_CONTEXT_BUDGET_BYTES, essentialMemoryBytes } from "@openbot/contracts/agent-memory-context";
import {
  type AgentMemoryDirectoryMetadata,
  type GetAgentMemoryDirectoryInput,
  MEMORY_DIRECTORY_LIMITS,
  type MemoryDirectoryEntry,
  type MemoryDirectoryPage,
  normalizeMemoryDirectoryQuery,
  type SetAgentMemoryDirectoryInput,
} from "@openbot/contracts/agent-memory-directory";
import { AGENT_PROVIDERS } from "@openbot/contracts/agent-providers";
import type { AgentEvent, TeamMemberSummary } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { teamCapabilitiesForProtocol } from "@openbot/contracts/team-protocol/current";
import {
  MEMORY_DIRECTORY_CAPABILITY,
  MEMORY_DIRECTORY_CODECS,
  MEMORY_DIRECTORY_METADATA_ROUTE,
  MEMORY_DIRECTORY_SET_ROUTE,
} from "@openbot/contracts/team-protocol/memory-directory-v1";
import { redactText } from "@openbot/logging";
import { readAgentMemoryDirectoryMetadata } from "@openbot/team-client/memory-directory-requests";
import { Effect } from "effect";
import { AgentMemories } from "../src/backend/agent/agent-memories";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { developerInstructions, memoryContext, memoryContextUpdate } from "../src/backend/agent/developer-instructions";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient } from "../src/backend/agent-client";
import { AgentMemoryStore } from "../src/backend/agent-memory-store";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { MailboxStore } from "../src/backend/mailbox-store";
import {
  type AppServerNotification,
  getString,
  type RequestId,
  type ResponseDecoder,
  type RpcError,
} from "../src/backend/protocol";
import { ProviderClientOperationError } from "../src/backend/provider-client-effects";
import { HttpError } from "../src/main/team-api/http-error";
import { routeAgentMemories } from "../src/main/team-api/route-agent-memories";
import { routeMemoryDirectory } from "../src/main/team-api/route-memory-directory";

const ROOT = resolve(import.meta.dirname, "..");
const REPORT_PATH = ".openbot-build/agent-memory-directory-e2e/report.json";
const OUT = join(ROOT, ".openbot-build/agent-memory-directory-e2e");
const MAX_REPORT_BYTES = 2 * 1024 * 1024;
const runNonce = randomUUID();
let temporary = "";
let ownedStore: AgentStore | undefined;
const originalCodexPath = process.env.OPENBOT_CODEX_PATH;
const sourceManifest: { path: string; sha256: string }[] = [];
const privateHashes = new Set<string>();
const cleanupErrors: { resource: string; error: string }[] = [];
const artifactErrors: string[] = [];
const cleanupCompleted: string[] = [];
const corpora: CorpusReport[] = [];
const httpTasks = new Set<Promise<void>>();
// Fixed inventory. No Git command or dirty-file list changes this receipt in a clean checkout.
const sourcePaths = [
  "bun.lock",
  "package.json",
  "packages/contracts/package.json",
  "packages/contracts/src/agent-memory-context.ts",
  "packages/contracts/src/agent-memory-directory.ts",
  "packages/contracts/src/agent-providers.ts",
  "packages/contracts/src/input-limits.ts",
  "packages/contracts/src/ipc-agent-memories.ts",
  "packages/contracts/src/runtime-values.ts",
  "packages/contracts/src/team-protocol/admin-wire.ts",
  "packages/contracts/src/team-protocol/agent-memories-v1.ts",
  "packages/contracts/src/team-protocol/current.ts",
  "packages/contracts/src/team-protocol/memory-directory-v1.ts",
  "packages/contracts/src/team-protocol/optional-routes.ts",
  "packages/contracts/src/team-protocol/fixtures/memory-directory-v1/client-request.json",
  "packages/contracts/src/team-protocol/fixtures/memory-directory-v1/host-response.json",
  "packages/logging/src/index.ts",
  "packages/team-client/src/memory-directory-requests.ts",
  "scripts/agent-memory-directory-e2e.ts",
  "src/backend/agent-client.ts",
  "src/backend/agent-memory-directory.ts",
  "src/backend/agent-memory-selection.ts",
  "src/backend/agent-memory-store.ts",
  "src/backend/agent-service.ts",
  "src/backend/agent-store.ts",
  "src/backend/agent/agent-memories.ts",
  "src/backend/agent/conversation-runtime.ts",
  "src/backend/agent/developer-instructions.ts",
  "src/backend/agent/mcp-gateway.ts",
  "src/backend/agent/memory-tool-inputs.ts",
  "src/backend/agent/openbot-tool-router.ts",
  "src/backend/agent/provider-runtime.ts",
  "src/backend/agent/routine-tools.ts",
  "src/backend/agent/thread-lifecycle.ts",
  "src/backend/agent/tool-catalog.ts",
  "src/backend/agent/tool-guidance.ts",
  "src/backend/database/agent-roster.ts",
  "src/backend/database/database-core.ts",
  "src/backend/database/database-rows.ts",
  "src/backend/mailbox-store.ts",
  "src/backend/mcp-redaction.ts",
  "src/backend/memory-store.ts",
  "src/backend/openbot-database.ts",
  "src/backend/openbot-database-schema.ts",
  "src/backend/openbot-tools.ts",
  "src/backend/protocol.ts",
  "src/backend/provider-client-effects.ts",
  "src/main/team-api/dependencies.ts",
  "src/main/team-api/http-error.ts",
  "src/main/team-api/route-agent-memories.ts",
  "src/main/team-api/route-memory-directory.ts",
];
const checks: string[] = [];
const providerOutputs: string[] = [];
const trace: {
  tool: string;
  target?: string;
  responseBytes: number;
  ids?: string[];
  status?: string;
  memoryRevision?: number;
  directoryRevision?: number | null;
}[] = [];
const recallControls: { kind: string; success: boolean; responseBytes: number; memories: number; guidance: boolean }[] =
  [];
const report = {
  schemaVersion: 2,
  passed: false,
  runNonce,
  startedAt: new Date().toISOString(),
  completedAt: "",
  sourceManifest,
  sourceDigest: "",
  sourceComplete: false,
  sourceScope:
    "Fixed fixture, memory, store, router, schema, redactor and optional transport inventory. Not every transitive application dependency.",
  expected: { groups: 15, scriptedProviderTurns: 24, recallControls: 42 },
  actualScriptedProviderTurns: 0,
  paidProviderTurns: 0,
  cleanupComplete: false,
  cleanupCompleted,
  cleanupErrors,
  artifactErrors,
  scope:
    "Synthetic local production service and transport with a scripted Codex-compatible provider. No real model, external source, credential or VPS speed measurement.",
  runtime: {
    runner: process.versions.bun ? "Bun" : "Node",
    runnerVersion: process.versions.bun ?? process.version,
    bunVersion: process.versions.bun ?? null,
    nodeCompatibilityVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
  },
  checks,
  trace,
  recallControls,
  corpora,
  failure: "",
};
interface CorpusReport {
  records: number;
  searchable: number;
  pages: number;
  directoryBytes: number;
  essentialsBytes: number;
  fullTurnBytes: number;
  outcomes: { request: string; expectedId: string; selectedId: string; currentRead: boolean }[];
  ftsBaseline: { literalQuery: string; literalTargetFound: boolean; aliasQuery: string; aliasTargetFound: boolean }[];
  latencyMilliseconds: { samples: number; p50: number; p95: number };
}
type MemoryDirectoryPostInput = GetAgentMemoryDirectoryInput | SetAgentMemoryDirectoryInput;

function protectedArtifactValues(): string[] {
  return [ROOT, OUT, temporary, originalCodexPath ?? "", ...privateHashes].filter((value) => value.length > 0);
}

function failureText(error: unknown): string {
  let message = error instanceof Error ? error.message : "Memory directory fixture failed.";
  for (const value of protectedArtifactValues()) {
    message = message.replaceAll(value, "[private]");
    message = message.replaceAll(JSON.stringify(value).slice(1, -1), "[private]");
  }
  return (
    redactText(message)
      .replace(/\b[a-f0-9]{64}\b/giu, "[private-digest]")
      .replace(/\/(?:Users|home|private|var|tmp|Applications|opt|usr)\/[^\s"'<>)]*/gu, "[private-path]")
      .slice(0, 2048) || "Memory directory fixture failed."
  );
}

async function finalize(resource: string, operation: () => Promise<void> | void): Promise<void> {
  try {
    await deadline(Promise.resolve().then(operation), `${resource} cleanup`);
    cleanupCompleted.push(resource);
  } catch (error) {
    cleanupErrors.push({ resource, error: failureText(error) });
  }
}

async function drainHttpRequests(): Promise<void> {
  const settled = await Promise.allSettled([...httpTasks]);
  if (settled.some((result) => result.status === "rejected"))
    throw new Error("A fixture request failed during cleanup.");
}

function encodeReport(): string {
  const encoded = redactText(JSON.stringify(report, null, 2));
  const containsProtected = (value: string) =>
    protectedArtifactValues().some(
      (privateValue) => value.includes(privateValue) || value.includes(JSON.stringify(privateValue).slice(1, -1)),
    );
  const protectedValueFound = containsProtected(encoded);
  if (!protectedValueFound && Buffer.byteLength(encoded, "utf8") <= MAX_REPORT_BYTES) return encoded;
  artifactErrors.push(
    protectedValueFound
      ? "The exact artifact guard refused a private value or its JSON-escaped form."
      : "The fixture artifact exceeded its 2 MiB byte limit.",
  );
  report.passed = false;
  // Keep the primary failure and source/cleanup receipts, but omit dynamic data after a guard failure.
  const fallback = redactText(
    JSON.stringify({ ...report, checks: [], trace: [], corpora: [], recallControls: [] }, null, 2),
  );
  if (!containsProtected(fallback) && Buffer.byteLength(fallback, "utf8") <= MAX_REPORT_BYTES) return fallback;
  return JSON.stringify({
    schemaVersion: report.schemaVersion,
    runNonce,
    passed: false,
    failure: "Unsafe fixture artifact refused.",
  });
}
function latch<T>() {
  let resolveValue: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolveValue = done;
  });
  return { promise, resolve: resolveValue };
}
async function deadline<T>(promise: Promise<T>, name: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_done, reject) => {
        timer = setTimeout(() => reject(new Error(`Fixture deadline: ${name}`)), 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

class ScriptedProvider extends EventEmitter implements AgentClient {
  readonly provider = "codex";
  running = false;
  threadStarts = 0;
  turnStarts = 0;
  readonly configurations: string[] = [];
  readonly turnInputs: string[] = [];
  readonly responses = new Map<RequestId, ReturnType<typeof latch<unknown>>>();
  pendingTurn = latch<{ threadId: string; turnId: string }>();
  start() {
    this.running = true;
  }
  stop() {
    return Effect.sync(() => {
      this.running = false;
    });
  }
  releaseThread() {
    return Effect.void;
  }
  request<T>(method: string, params: unknown, decode: ResponseDecoder<T>) {
    return Effect.try({
      try: () => {
        if (method === "account/read")
          return decode({
            account: { type: "chatgpt", email: "fixture@example.invalid", planType: "plus" },
            requiresOpenaiAuth: false,
          });
        if (method === "model/list")
          return decode({
            data: [
              {
                model: "gpt-5.6-luna",
                displayName: "Fixture model",
                defaultReasoningEffort: "low",
                supportedReasoningEfforts: [{ reasoningEffort: "low" }],
              },
            ],
          });
        if (method === "account/rateLimits/read") return decode({ rateLimits: null });
        if (method === "config/read")
          return decode({
            config: { mcp_servers: {} },
            layers: [
              {
                name: { type: "user", file: join(temporary, "codex.toml") },
                version: "fixture",
                config: { mcp_servers: {} },
              },
            ],
          });
        if (method === "thread/start") {
          this.threadStarts += 1;
          this.configurations.push(JSON.stringify(params));
          return decode({ thread: { id: `fixture-session-${randomUUID()}` } });
        }
        if (method === "thread/resume") return decode({ thread: { id: getString(params, "threadId") } });
        if (method === "turn/start") {
          this.turnStarts += 1;
          const threadId = getString(params, "threadId");
          assert.ok(threadId);
          const turnId = randomUUID();
          this.turnInputs.push(JSON.stringify(params));
          this.pendingTurn.resolve({ threadId, turnId });
          return decode({ turn: { id: turnId, status: "inProgress" } });
        }
        if (method === "thread/read") return decode({ thread: { id: getString(params, "threadId"), turns: [] } });
        return decode({});
      },
      catch: (cause) => new ProviderClientOperationError({ cause }),
    });
  }
  notify() {}
  respond(id: RequestId, value: unknown) {
    this.responses.get(id)?.resolve(value);
    this.responses.delete(id);
  }
  respondError(id: RequestId, error: RpcError) {
    this.respond(id, { fixtureRpcError: failureText(new Error(error.message)) });
  }
  async tool(
    threadId: string,
    turnId: string,
    tool: string,
    argumentsValue: unknown,
    claimedOwner?: string,
  ): Promise<unknown> {
    const id = randomUUID();
    const response = latch<unknown>();
    this.responses.set(id, response);
    assert.ok(this.listenerCount("request") > 0, "The real service must own the provider request listener.");
    this.emit("request", {
      id,
      method: "item/tool/call",
      params: {
        threadId,
        turnId,
        callId: id,
        namespace: "openbot",
        tool,
        arguments: argumentsValue,
        ...(claimedOwner ? { ownerAgentId: claimedOwner } : {}),
      },
    });
    const value = await deadline(response.promise, tool);
    assert.ok(isDynamicRecord(value) && value.success === true && Array.isArray(value.contentItems));
    const text = value.contentItems.find((item: unknown) => isDynamicRecord(item) && item.type === "inputText");
    assert.ok(isDynamicRecord(text) && isString(text.text));
    providerOutputs.push(text.text);
    const parsed = JSON.parse(text.text);
    const entryIds =
      isDynamicRecord(parsed) && Array.isArray(parsed.entries)
        ? parsed.entries.flatMap((entry: unknown) =>
            isDynamicRecord(entry) && isString(entry.memoryId) ? [entry.memoryId] : [],
          )
        : [];
    trace.push({
      tool,
      ...(getString(argumentsValue, "name") ? { target: getString(argumentsValue, "name") ?? undefined } : {}),
      responseBytes: Buffer.byteLength(text.text, "utf8"),
      ...(entryIds.length ? { ids: entryIds } : {}),
      ...(isDynamicRecord(parsed) && isString(parsed.status) ? { status: parsed.status } : {}),
      ...(isDynamicRecord(parsed) && typeof parsed.memoryRevision === "number"
        ? { memoryRevision: parsed.memoryRevision }
        : {}),
      ...(isDynamicRecord(parsed) && (parsed.directoryRevision === null || typeof parsed.directoryRevision === "number")
        ? { directoryRevision: parsed.directoryRevision }
        : {}),
    });
    return parsed;
  }
}

const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: () => Effect.die(new Error("No browser in the memory fixture.")),
  endTakeover: () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  resolveUploadTarget: () => Effect.die(new Error("No upload in the memory fixture.")),
  handleDynamicTool: () => Effect.die(new Error("No browser tool in the memory fixture.")),
};
const provider = new ScriptedProvider();
let service: AgentService | undefined;
let http: Server | undefined;
let lifecycle: ConversationRuntime | undefined;

const fixtures = [
  {
    text: "The owner chose Boreal because it keeps data on the VPS.",
    title: "Personal wiki hosting",
    aliases: ["hosting decision"],
    request: "Why did I choose a host for my personal wiki?",
  },
  {
    text: "11월 제주도로 가족 여행을 가기로 결정했다.",
    title: "가족 여행 결정",
    aliases: ["제주", "여행"],
    request: "제주 여행에 대해 내가 뭐라고 결정했지?",
  },
  {
    text: "来月は東京で会議に参加します。",
    title: "来月の会議",
    aliases: ["東京"],
    request: "東京での予定を確認して。",
  },
  {
    text: "资料归档保存在个人服务器。",
    title: "个人知识库",
    aliases: ["私人知识库"],
    request: "我的私人知识库保存在哪里？",
  },
  {
    text: "Pasta is the owner's preferred lunch.",
    title: "Lunch preference",
    aliases: ["favored noodles"],
    request: "What lunch do I usually favor?",
  },
  {
    text: "The project's café review happens on Friday.",
    title: "Coffee review",
    aliases: ["coffee evaluation"],
    request: "When is the coffee evaluation?",
  },
] as const;
const literalQueries = [
  "Boreal",
  "제주도로",
  "来月は東京で会議に参加します",
  "资料归档保存在个人服务器",
  "Pasta",
  "café",
] as const;

function event(serviceValue: AgentService, type: "turn-started" | "turn-completed", agentId: string) {
  const result = latch<Extract<AgentEvent, { type: typeof type }>>();
  const listener = (value: AgentEvent) => {
    if (value.type === type && value.agentId === agentId) {
      serviceValue.off("event", listener);
      result.resolve(value);
    }
  };
  serviceValue.on("event", listener);
  return { promise: result.promise, cancel: () => serviceValue.off("event", listener) };
}
async function begin(serviceValue: AgentService, agentId: string, request: string) {
  provider.pendingTurn = latch<{ threadId: string; turnId: string }>();
  const started = event(serviceValue, "turn-started", agentId);
  await Effect.runPromise(serviceValue.sendMessage({ agentId, text: request, attachmentDraftIds: [] }));
  const turn = await deadline(provider.pendingTurn.promise, "turn request");
  provider.emit("notification", {
    method: "turn/started",
    params: { threadId: turn.threadId, turn: { id: turn.turnId } },
  } satisfies AppServerNotification);
  try {
    await deadline(started.promise, "service turn start");
  } finally {
    started.cancel();
  }
  return turn;
}
async function finish(
  serviceValue: AgentService,
  agentId: string,
  turn: { threadId: string; turnId: string },
  text: string,
  status = "completed",
) {
  const completed = event(serviceValue, "turn-completed", agentId);
  if (status === "completed")
    provider.emit("notification", {
      method: "item/completed",
      params: { threadId: turn.threadId, turnId: turn.turnId, item: { type: "agentMessage", id: randomUUID(), text } },
    } satisfies AppServerNotification);
  provider.emit("notification", {
    method: "turn/completed",
    params: { threadId: turn.threadId, turn: { id: turn.turnId, status } },
  } satisfies AppServerNotification);
  try {
    await deadline(completed.promise, "service turn completion");
  } finally {
    completed.cancel();
  }
}
function page(value: unknown): MemoryDirectoryPage {
  assert.ok(isDynamicRecord(value) && Array.isArray(value.entries));
  const entries = value.entries.map((entry: unknown): MemoryDirectoryEntry => {
    assert.ok(
      isDynamicRecord(entry) &&
        isString(entry.memoryId) &&
        typeof entry.memoryRevision === "number" &&
        (entry.directoryRevision === null || typeof entry.directoryRevision === "number") &&
        isString(entry.title) &&
        (entry.titleKind === "explicit" || entry.titleKind === "current-text-excerpt") &&
        Array.isArray(entry.aliases) &&
        entry.aliases.every(isString),
    );
    return {
      memoryId: entry.memoryId,
      memoryRevision: entry.memoryRevision,
      directoryRevision: entry.directoryRevision,
      title: entry.title,
      titleKind: entry.titleKind,
      aliases: entry.aliases,
    };
  });
  assert.ok(
    typeof value.searchableCount === "number" &&
      typeof value.scanned === "number" &&
      typeof value.hasMore === "boolean" &&
      (value.nextCursor === null || isString(value.nextCursor)),
  );
  return {
    entries,
    searchableCount: value.searchableCount,
    scanned: value.scanned,
    hasMore: value.hasMore,
    nextCursor: value.nextCursor,
  };
}
function toolText(value: unknown): string {
  assert.ok(isDynamicRecord(value) && Array.isArray(value.contentItems));
  const item = value.contentItems.find((entry: unknown) => isDynamicRecord(entry) && entry.type === "inputText");
  assert.ok(isDynamicRecord(item) && isString(item.text));
  assert.ok(Buffer.byteLength(item.text, "utf8") <= AGENT_MEMORY_CONTEXT_BUDGET_BYTES);
  return item.text;
}
function emptyRecallTools(value: unknown, excluded: readonly string[]): string[] {
  assert.ok(
    isDynamicRecord(value) &&
      Array.isArray(value.memories) &&
      value.memories.length === 0 &&
      value.hasMore === false &&
      isString(value.guidance),
  );
  assert.match(value.guidance, /literal/iu);
  for (const text of excluded)
    assert.equal(
      value.guidance.includes(text),
      false,
      "Fixed guidance must not carry query text, a selected ID or a saved answer.",
    );
  const names = [...value.guidance.matchAll(/openbot\.[a-z_]+/gu)].map((match) => match[0]);
  assert.ok(names.includes("openbot.list_memory_directory") && names.includes("openbot.read_memory"));
  assert.ok(Buffer.byteLength(JSON.stringify(value), "utf8") <= AGENT_MEMORY_CONTEXT_BUDGET_BYTES);
  recallControls.push({
    kind: "empty-literal-guidance",
    success: true,
    responseBytes: Buffer.byteLength(JSON.stringify(value), "utf8"),
    memories: 0,
    guidance: true,
  });
  return names;
}
function choose(entries: readonly MemoryDirectoryEntry[], request: string): MemoryDirectoryEntry | undefined {
  const normalized = normalizeMemoryDirectoryQuery(request);
  const tokens = normalized.match(/[a-z]{3,}/gu) ?? [];
  return entries
    .map((entry) => ({
      entry,
      score: [entry.title, ...entry.aliases].reduce((sum, hint) => {
        const value = normalizeMemoryDirectoryQuery(hint);
        return (
          sum + (normalized.includes(value) ? 10 : tokens.filter((token) => value.split(/\s+/u).includes(token)).length)
        );
      }, 0),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.entry;
}
async function discover(
  turn: { threadId: string; turnId: string },
  names: readonly string[] = ["openbot.list_memory_directory", "openbot.read_memory"],
): Promise<void> {
  const search = await provider.tool(turn.threadId, turn.turnId, "tool_search", { queries: names, limit: 2 });
  const serialized = JSON.stringify(search);
  assert.ok(names.every((name) => serialized.includes(name)));
  const described = await provider.tool(turn.threadId, turn.turnId, "tool_describe", { names });
  assert.ok(JSON.stringify(described).includes("expectedDirectoryRevision"));
}

try {
  for (const path of sourcePaths) {
    const content = await deadline(readFile(join(ROOT, path)), "Source receipt read");
    sourceManifest.push({ path, sha256: createHash("sha256").update(content).digest("hex") });
  }
  report.sourceDigest = createHash("sha256").update(JSON.stringify(sourceManifest)).digest("hex");
  report.sourceComplete = sourceManifest.length === sourcePaths.length;
  temporary = await mkdtemp(join(tmpdir(), "openbot-memory-directory-"));
  const store = new AgentStore(join(temporary, "state"), join(temporary, "home"));
  ownedStore = store;
  const mailbox = new MailboxStore(join(temporary, "state"), store.sharedRoot, store.database);
  await Effect.runPromise(store.initialize());
  const memoryStore = new AgentMemoryStore(store.database, () => 512);
  const cli = join(temporary, "fixture-codex");
  await writeFile(cli, "#!/bin/sh\nprintf 'codex-cli 0.156.0-fixture\\n'\n");
  await chmod(cli, 0o700);
  process.env.OPENBOT_CODEX_PATH = cli;
  service = new AgentService({
    store,
    mailbox,
    browser,
    preferredProvider: "codex",
    preferredModel: "gpt-5.6-luna",
    clientFactory: (providerId, resolvedCli) => {
      assert.equal(providerId, "codex");
      assert.equal(resolvedCli.executable, cli);
      return provider;
    },
    bundledExecutables: { codex: cli, claude: null, grok: null },
    offProviders: AGENT_PROVIDERS.filter((providerId) => providerId !== "codex"),
    agentMemoryLimit: () => 512,
  });
  await Effect.runPromise(service.initialize());
  assert.equal(service.getStatus().providers?.find((candidate) => candidate.id === "codex")?.state, "available");
  const privateAgent = await Effect.runPromise(
    store.createAgent({ name: "Private fixture", description: "", avatarSeed: "private", avatarHue: null }),
  );
  const privateMemory = memoryStore.createManual(privateAgent.id, "Private other-owner fact.");
  const privateMetadata = service.getMemoryDirectoryMetadata({ agentId: privateAgent.id, memoryId: privateMemory.id });
  assert.ok(privateMetadata);
  service.setMemoryDirectoryMetadata({
    agentId: privateAgent.id,
    memoryId: privateMemory.id,
    expectedMemoryRevision: privateMetadata.memoryRevision,
    expectedAnnotationRevision: null,
    title: "Private owner hint",
    aliases: ["private alias"],
  });

  for (const size of [64, 128, 512]) {
    const agent = await Effect.runPromise(
      store.createAgent({ name: `Corpus ${size}`, description: "", avatarSeed: `corpus-${size}`, avatarHue: null }),
    );
    for (let index = 0; index < size; index += 1)
      memoryStore.createManual(
        agent.id,
        `Archive ${index}: synthetic topic${index} records a decision. ${"Bounded archive detail. ".repeat(7)}`,
      );
    const sorted = memoryStore.list(agent.id).sort((a, b) => a.id.localeCompare(b.id));
    const targets = sorted.slice(-6);
    for (const [index, fixture] of fixtures.entries()) {
      const target = targets[index];
      assert.ok(target);
      memoryStore.updateManual(agent.id, target.id, fixture.text);
      const metadata = service.getMemoryDirectoryMetadata({ agentId: agent.id, memoryId: target.id });
      assert.ok(metadata);
      service.setMemoryDirectoryMetadata({
        agentId: agent.id,
        memoryId: target.id,
        expectedMemoryRevision: metadata.memoryRevision,
        expectedAnnotationRevision: metadata.annotationRevision,
        title: fixture.title,
        aliases: fixture.aliases,
      });
    }
    for (const target of sorted.slice(0, 5))
      memoryStore.updateManual(
        agent.id,
        target.id,
        `Archive ${target.id}: hosting decision from an unrelated document.`,
      );
    const essential = sorted.slice(5, 7);
    memoryStore.setInclusions(
      agent.id,
      essential.map((memory) => {
        const selection = memoryStore.getSelection(agent.id, memory.id);
        assert.ok(selection);
        return { memoryId: memory.id, inclusion: "essential", expectedRevision: selection.revision };
      }),
      "user",
    );
    const before = JSON.stringify(memoryStore.list(agent.id));
    let cursor: string | null = null;
    const seen = new Set<string>();
    let pages = 0;
    let bytes = 0;
    do {
      const directory = memoryStore.directory.list(agent.id, "", cursor);
      assert.ok(directory.scanned <= 25);
      assert.ok(Buffer.byteLength(JSON.stringify(directory), "utf8") <= 4096);
      for (const entry of directory.entries) {
        assert.equal(seen.has(entry.memoryId), false);
        seen.add(entry.memoryId);
      }
      pages += 1;
      bytes += Buffer.byteLength(JSON.stringify(directory), "utf8");
      cursor = directory.nextCursor;
      assert.ok(pages <= size);
    } while (cursor !== null);
    assert.equal(seen.size, size - 2);
    assert.equal(seen.has(privateMemory.id), false);
    assert.equal(JSON.stringify(memoryStore.list(agent.id)), before);
    const firstFiltered = memoryStore.directory.list(agent.id, "東京");
    assert.deepEqual(
      firstFiltered.entries.map((entry) => entry.memoryId),
      [targets[2]?.id],
    );
    assert.equal(firstFiltered.scanned, size - 2);
    assert.equal(firstFiltered.hasMore, false);
    assert.equal(firstFiltered.nextCursor, null);
    const firstUnfiltered = memoryStore.directory.list(agent.id);
    assert.ok(firstUnfiltered.nextCursor);
    assert.throws(() => memoryStore.directory.list(privateAgent.id, "", firstUnfiltered.nextCursor));
    assert.throws(() => memoryStore.directory.list(agent.id, "東京", firstUnfiltered.nextCursor));
    assert.throws(() => memoryStore.directory.list(agent.id, "", `${firstUnfiltered.nextCursor}.forged`));
    const outcomes: CorpusReport["outcomes"] = [];
    const ftsBaseline: CorpusReport["ftsBaseline"] = [];
    for (const [index, fixture] of fixtures.entries()) {
      const literalQuery = literalQueries[index];
      assert.ok(literalQuery);
      const aliasQuery = fixture.aliases[0];
      assert.ok(aliasQuery);
      const literalTargetFound = memoryStore
        .search(agent.id, literalQuery)
        .memories.some((memory) => memory.id === targets[index]?.id);
      const aliasTargetFound = memoryStore
        .search(agent.id, aliasQuery)
        .memories.some((memory) => memory.id === targets[index]?.id);
      assert.equal(literalTargetFound, true);
      assert.equal(aliasTargetFound, false);
      ftsBaseline.push({ literalQuery, literalTargetFound, aliasQuery, aliasTargetFound });
      const turn = await begin(service, agent.id, fixture.request);
      // The hosting alias also finds unrelated archive bodies. "wiki" is the empty literal control.
      const missQuery = index === 0 ? "wiki" : aliasQuery;
      assert.equal(memoryStore.search(agent.id, missQuery).memories.length, 0);
      const miss = await provider.tool(turn.threadId, turn.turnId, "search_memories", { query: missQuery });
      const fallbackNames = emptyRecallTools(miss, [missQuery, fixture.text, targets[index]?.id ?? "missing-target"]);
      await discover(turn, fallbackNames);
      const literal = await provider.tool(turn.threadId, turn.turnId, "search_memories", { query: literalQuery });
      assert.ok(isDynamicRecord(literal) && Array.isArray(literal.memories));
      assert.equal(literal.guidance, undefined);
      const literalMemory = literal.memories.find(
        (memory: unknown) => isDynamicRecord(memory) && memory.id === targets[index]?.id,
      );
      assert.ok(isDynamicRecord(literalMemory));
      assert.equal(literalMemory.text, fixture.text);
      assert.equal(
        literalMemory.revision,
        memoryStore.getSelection(agent.id, targets[index]?.id ?? "missing-target")?.revision,
      );
      assert.ok(Buffer.byteLength(JSON.stringify(literal), "utf8") <= AGENT_MEMORY_CONTEXT_BUDGET_BYTES);
      recallControls.push({
        kind: "current-literal-result",
        success: true,
        responseBytes: Buffer.byteLength(JSON.stringify(literal), "utf8"),
        memories: literal.memories.length,
        guidance: false,
      });
      if (index === 2) {
        const filtered = page(
          await provider.tool(turn.threadId, turn.turnId, "tool_call", {
            name: "openbot.list_memory_directory",
            arguments: { query: "東京" },
          }),
        );
        assert.deepEqual(
          filtered.entries.map((entry) => entry.memoryId),
          [targets[index]?.id],
        );
        assert.equal(filtered.scanned, size - 2);
        assert.equal(filtered.hasMore, false);
        assert.equal(filtered.nextCursor, null);
        assert.ok(Buffer.byteLength(JSON.stringify(filtered), "utf8") <= 4096);
      }
      if (index === 0) {
        const foreignHint = memoryStore.directory.metadata(privateAgent.id, privateMemory.id);
        assert.ok(foreignHint);
        const foreignRead = await provider.tool(
          turn.threadId,
          turn.turnId,
          "tool_call",
          {
            name: "openbot.read_memory",
            arguments: {
              memoryId: privateMemory.id,
              expectedMemoryRevision: foreignHint.memoryRevision,
              expectedDirectoryRevision: foreignHint.directoryRevision,
            },
          },
          privateAgent.id,
        );
        assert.deepEqual(
          foreignRead,
          { status: "missing" },
          "The real router derives the owner from the thread, not the claimed owner.",
        );
      }
      const entries: MemoryDirectoryEntry[] = [];
      let after: string | null = null;
      do {
        const directory = page(
          await provider.tool(turn.threadId, turn.turnId, "tool_call", {
            name: "openbot.list_memory_directory",
            arguments: { cursor: after },
          }),
        );
        entries.push(...directory.entries);
        after = directory.nextCursor;
      } while (after !== null);
      const selected = choose(entries, fixture.request);
      assert.ok(selected);
      const read = await provider.tool(turn.threadId, turn.turnId, "tool_call", {
        name: "openbot.read_memory",
        arguments: {
          memoryId: selected.memoryId,
          expectedMemoryRevision: selected.memoryRevision,
          expectedDirectoryRevision: selected.directoryRevision,
        },
      });
      assert.ok(
        isDynamicRecord(read) && read.status === "ok" && isDynamicRecord(read.memory) && isString(read.memory.text),
      );
      assert.equal(selected.memoryId, targets[index]?.id);
      assert.equal(read.memory.text, fixture.text);
      outcomes.push({
        request: fixture.request,
        expectedId: targets[index]?.id ?? "",
        selectedId: selected.memoryId,
        currentRead: true,
      });
      await finish(service, agent.id, turn, read.memory.text);
    }
    const essentialFacts = memoryStore
      .list(agent.id)
      .filter((memory) => essential.some((entry) => entry.id === memory.id));
    const context = memoryContext(essentialFacts, { storedMemoryCount: size, memoryLimit: 512 });
    const prompt = memoryContextUpdate(null, context);
    assert.ok(prompt);
    for (let sample = 0; sample < 5; sample += 1) memoryStore.directory.list(agent.id, "東京");
    const timings: number[] = [];
    for (let sample = 0; sample < 30; sample += 1) {
      const start = performance.now();
      memoryStore.directory.list(agent.id, "東京");
      timings.push(performance.now() - start);
    }
    timings.sort((a, b) => a - b);
    report.corpora.push({
      records: size,
      searchable: seen.size,
      pages,
      directoryBytes: bytes,
      essentialsBytes: essentialMemoryBytes(essentialFacts),
      fullTurnBytes: Buffer.byteLength(prompt, "utf8"),
      outcomes,
      ftsBaseline,
      latencyMilliseconds: { samples: timings.length, p50: timings[14] ?? 0, p95: timings[28] ?? 0 },
    });
  }
  checks.push(
    "64/128/512 actual-store corpora preserve unfiltered 25-row/4096-byte pages and late filtered hints; each scripted turn gets fixed guidance from an empty FTS response, discovers its tools, reads a current ID, and checks an unchanged successful literal body and revision without fallback guidance.",
  );
  const correctionCorpus = report.corpora.find((corpus) => corpus.records === 128);
  assert.ok(correctionCorpus);
  const travelId = correctionCorpus.outcomes[1]?.expectedId;
  assert.ok(travelId);
  const travel = store.database.connection
    .prepare("SELECT agent_id FROM projection_agent_memories WHERE memory_id = ?")
    .get(travelId);
  assert.ok(travel && isString(travel.agent_id));
  const correctionTurn = await begin(service, travel.agent_id, "제주 여행에 대해 내가 뭐라고 결정했지?");
  await discover(correctionTurn);
  const selectedTravel = service.getMemoryDirectoryMetadata({ agentId: travel.agent_id, memoryId: travelId });
  assert.ok(selectedTravel);
  const correctedText = "가족 여행은 부산으로 변경했다. 이유는 이동 시간이 짧기 때문이다.";
  service.updateMemory({ agentId: travel.agent_id, memoryId: travelId, text: correctedText });
  const staleTravel = await provider.tool(correctionTurn.threadId, correctionTurn.turnId, "tool_call", {
    name: "openbot.read_memory",
    arguments: {
      memoryId: selectedTravel.memoryId,
      expectedMemoryRevision: selectedTravel.memoryRevision,
      expectedDirectoryRevision: selectedTravel.directoryRevision,
    },
  });
  assert.deepEqual(staleTravel, { status: "stale" });
  const staleMetadata = service.getMemoryDirectoryMetadata({ agentId: travel.agent_id, memoryId: travelId });
  assert.ok(staleMetadata);
  service.setMemoryDirectoryMetadata({
    agentId: travel.agent_id,
    memoryId: travelId,
    expectedMemoryRevision: staleMetadata.memoryRevision,
    expectedAnnotationRevision: staleMetadata.annotationRevision,
    title: "가족 여행 결정",
    aliases: ["제주", "부산", "여행"],
  });
  let travelCursor: string | null = null;
  let refreshedTravel: MemoryDirectoryEntry | undefined;
  do {
    const directory = page(
      await provider.tool(correctionTurn.threadId, correctionTurn.turnId, "tool_call", {
        name: "openbot.list_memory_directory",
        arguments: { query: "제주", cursor: travelCursor },
      }),
    );
    refreshedTravel = directory.entries[0];
    travelCursor = directory.nextCursor;
  } while (!refreshedTravel && travelCursor !== null);
  assert.ok(refreshedTravel);
  assert.equal(refreshedTravel.memoryId, travelId);
  const currentTravel = await provider.tool(correctionTurn.threadId, correctionTurn.turnId, "tool_call", {
    name: "openbot.read_memory",
    arguments: {
      memoryId: refreshedTravel.memoryId,
      expectedMemoryRevision: refreshedTravel.memoryRevision,
      expectedDirectoryRevision: refreshedTravel.directoryRevision,
    },
  });
  assert.ok(isDynamicRecord(currentTravel) && currentTravel.status === "ok" && isDynamicRecord(currentTravel.memory));
  assert.equal(currentTravel.memory.text, correctedText);
  await finish(service, travel.agent_id, correctionTurn, correctedText);
  checks.push(
    "A correction after selection returns stale through the actual provider tool bridge; a refreshed former-city alias routes to the current Busan decision and reason.",
  );

  const oversizedAgent = await Effect.runPromise(
    store.createAgent({ name: "Preserved larger profile", description: "", avatarSeed: "larger", avatarHue: null }),
  );
  let loweredLimit = 600;
  const largerStore = new AgentMemoryStore(store.database, () => loweredLimit);
  for (let index = 0; index < 525; index += 1) largerStore.createManual(oversizedAgent.id, `Preserved fact ${index}.`);
  loweredLimit = 64;
  let largerCursor: string | null = null;
  const largerIds = new Set<string>();
  do {
    const directory = largerStore.directory.list(oversizedAgent.id, "", largerCursor);
    for (const entry of directory.entries) {
      assert.equal(largerIds.has(entry.memoryId), false);
      largerIds.add(entry.memoryId);
    }
    largerCursor = directory.nextCursor;
  } while (largerCursor !== null);
  assert.equal(largerIds.size, 525);
  assert.equal(largerStore.count(oversizedAgent.id), 525);
  assert.throws(() => largerStore.createManual(oversizedAgent.id, "New fact cannot bypass the lowered cap."));
  const legacyAbsent = largerStore.directory.list(oversizedAgent.id, "absent-filter-subject");
  assert.deepEqual(legacyAbsent.entries, []);
  assert.equal(legacyAbsent.scanned, 512);
  assert.equal(legacyAbsent.hasMore, true);
  assert.ok(legacyAbsent.nextCursor);
  const legacyAbsentEnd = largerStore.directory.list(
    oversizedAgent.id,
    "absent-filter-subject",
    legacyAbsent.nextCursor,
  );
  assert.deepEqual(legacyAbsentEnd.entries, []);
  assert.equal(legacyAbsentEnd.scanned, 13);
  assert.equal(legacyAbsentEnd.hasMore, false);
  assert.equal(legacyAbsentEnd.nextCursor, null);
  const absent128Agent = await Effect.runPromise(
    store.createAgent({
      name: "Absent filtered subject",
      description: "",
      avatarSeed: "absent-filter",
      avatarHue: null,
    }),
  );
  for (let index = 0; index < 128; index += 1)
    memoryStore.createManual(absent128Agent.id, `Unannotated fact ${index}.`);
  const absent128 = memoryStore.directory.list(absent128Agent.id, "absent-filter-subject");
  assert.deepEqual(absent128.entries, []);
  assert.equal(absent128.scanned, 128);
  assert.equal(absent128.hasMore, false);
  assert.equal(absent128.nextCursor, null);
  assert.ok(Buffer.byteLength(JSON.stringify(legacyAbsent), "utf8") <= 4096);
  assert.ok(Buffer.byteLength(JSON.stringify(legacyAbsentEnd), "utf8") <= 4096);
  checks.push(
    "An absent filter completes all 128 current records in one lookup; a preserved 525-record profile needs exactly 512 plus 13 inspected rows and stays complete after the storage choice falls to 64 without extra fact slots.",
  );

  const boundsAgent = await Effect.runPromise(
    store.createAgent({ name: "Byte bounds", description: "", avatarSeed: "bounds", avatarHue: null }),
  );
  const escapedId = `escaped-${'"\n\\'.repeat(39)}`;
  const insertedAt = new Date().toISOString();
  store.database.connection
    .prepare(`INSERT INTO projection_agent_memories
    (memory_id, agent_id, text, normalized_text, origin, source_turn_id, created_at, updated_at, last_event_sequence)
    VALUES (?, ?, ?, ?, 'manual', NULL, ?, ?, 0)`)
    .run(escapedId, boundsAgent.id, "Escaped ID current fact", "Escaped ID current fact", insertedAt, insertedAt);
  for (let index = 0; index < 24; index += 1) memoryStore.createManual(boundsAgent.id, `Byte-bound fact ${index}.`);
  for (const memory of memoryStore.list(boundsAgent.id)) {
    const metadata = service.getMemoryDirectoryMetadata({ agentId: boundsAgent.id, memoryId: memory.id });
    assert.ok(metadata);
    service.setMemoryDirectoryMetadata({
      agentId: boundsAgent.id,
      memoryId: memory.id,
      expectedMemoryRevision: metadata.memoryRevision,
      expectedAnnotationRevision: metadata.annotationRevision,
      title: "t".repeat(96),
      aliases: ["a".repeat(64), "b".repeat(64), "c".repeat(64), "d".repeat(64)],
    });
  }
  let boundedCursor: string | null = null;
  const boundedIds = new Set<string>();
  let boundPages = 0;
  do {
    const directory = memoryStore.directory.list(boundsAgent.id, "", boundedCursor, (value) =>
      value.replace(/t{96}/gu, "😀".repeat(200)),
    );
    assert.ok(directory.scanned <= 25);
    assert.ok(Buffer.byteLength(JSON.stringify(directory), "utf8") <= 4096);
    for (const entry of directory.entries) {
      assert.equal(boundedIds.has(entry.memoryId), false);
      boundedIds.add(entry.memoryId);
      assert.equal(/[\uD800-\uDBFF]$/u.test(entry.title), false);
    }
    boundPages += 1;
    boundedCursor = directory.nextCursor;
    assert.ok(boundPages <= 25);
  } while (boundedCursor !== null);
  assert.equal(boundedIds.size, 25);
  assert.ok(boundPages > 1);
  assert.equal(boundedIds.has(escapedId), true);
  let denseCursor: string | null = null;
  const denseIds = new Set<string>();
  let densePages = 0;
  do {
    const directory = memoryStore.directory.list(boundsAgent.id, "a", denseCursor, (value) =>
      value.replace(/t{96}/gu, "😀".repeat(200)),
    );
    assert.ok(Buffer.byteLength(JSON.stringify(directory), "utf8") <= 4096);
    assert.ok(directory.scanned <= 512);
    // All records match. A byte-overflow row is inspected and then reconsidered on the next page.
    assert.equal(directory.scanned, directory.entries.length + (directory.hasMore ? 1 : 0));
    for (const entry of directory.entries) {
      assert.equal(denseIds.has(entry.memoryId), false);
      denseIds.add(entry.memoryId);
    }
    densePages += 1;
    denseCursor = directory.nextCursor;
    assert.ok(densePages <= 25);
  } while (denseCursor !== null);
  assert.equal(denseIds.size, 25);
  assert.ok(densePages > 1);
  assert.equal(denseIds.has(escapedId), true);
  const maximumFact = `${'"\\\n'.repeat(166)}xx`;
  const maximumStored = memoryStore.updateManual(boundsAgent.id, escapedId, maximumFact);
  const maximumMetadata = service.getMemoryDirectoryMetadata({ agentId: boundsAgent.id, memoryId: escapedId });
  assert.ok(maximumMetadata);
  const maximumRead = memoryStore.directory.read(
    boundsAgent.id,
    escapedId,
    maximumMetadata.memoryRevision,
    maximumMetadata.directoryRevision,
  );
  assert.equal(maximumStored.text.length, 500);
  assert.equal(maximumRead.status, "ok");
  assert.ok(Buffer.byteLength(JSON.stringify(maximumRead), "utf8") <= 8192);
  const combining = memoryStore.createManual(boundsAgent.id, "Combining alias fixture.");
  const combiningMetadata = service.getMemoryDirectoryMetadata({ agentId: boundsAgent.id, memoryId: combining.id });
  assert.ok(combiningMetadata);
  service.setMemoryDirectoryMetadata({
    agentId: boundsAgent.id,
    memoryId: combining.id,
    expectedMemoryRevision: combiningMetadata.memoryRevision,
    expectedAnnotationRevision: combiningMetadata.annotationRevision,
    title: "Unicode alias",
    aliases: ["Café", "ＣＡＦÉ", " Café "],
  });
  const combined = memoryStore.directory.metadata(boundsAgent.id, combining.id);
  assert.ok(combined);
  assert.deepEqual(combined.aliases, ["Café"]);
  let combiningCursor: string | null = null;
  let combiningFound = false;
  do {
    const directory = memoryStore.directory.list(boundsAgent.id, "CAFÉ", combiningCursor);
    combiningFound ||= directory.entries.some((entry) => entry.memoryId === combining.id);
    combiningCursor = directory.nextCursor;
  } while (!combiningFound && combiningCursor !== null);
  assert.equal(combiningFound, true);
  const privateRow = store.database.connection
    .prepare(
      "SELECT sequence, payload_json FROM orchestration_events WHERE aggregate_type = 'agent-memory' AND aggregate_id = ? AND event_type = 'agent-memory.directory-set.v1' ORDER BY sequence DESC LIMIT 1",
    )
    .get(combining.id);
  assert.ok(privateRow && typeof privateRow.sequence === "number" && isString(privateRow.payload_json));
  const privateBinding = JSON.parse(privateRow.payload_json);
  assert.ok(isDynamicRecord(privateBinding) && isString(privateBinding.memoryTextDigest));
  const privateDigest = privateBinding.memoryTextDigest;
  privateHashes.add(privateDigest);
  store.database.connection
    .prepare(
      "UPDATE orchestration_events SET payload_json = json_set(payload_json, '$.actor', 'invalid') WHERE sequence = ?",
    )
    .run(privateRow.sequence);
  try {
    assert.throws(
      () => memoryStore.directory.metadata(boundsAgent.id, combining.id),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(
          error.message === "Invalid saved memory directory annotation.",
          true,
          "Private annotation decoding must use a safe generic error.",
        );
        assert.equal(error.message.includes(privateDigest), false);
        return true;
      },
    );
  } finally {
    store.database.connection
      .prepare("UPDATE orchestration_events SET payload_json = ? WHERE sequence = ?")
      .run(privateRow.payload_json, privateRow.sequence);
  }
  checks.push(
    "Maximum title/alias fields, an escaped 125-character ID and expanding redaction fit final directory bytes; dense filtered matches stop at 4096 bytes and reconsider every omitted match without duplicate entries.",
  );

  const agent = await Effect.runPromise(
    store.createAgent({ name: "Lifecycle", description: "", avatarSeed: "lifecycle", avatarHue: null }),
  );
  lifecycle = new ConversationRuntime(
    store,
    () => {},
    () => store.list(),
  );
  const errors: string[] = [];
  const memories = new AgentMemories({
    store,
    conversation: lifecycle,
    emit: () => {},
    emitError: (code) => errors.push(code),
    limit: () => 512,
  });
  const call = (tool: string, argumentsValue: unknown, turnId = randomUUID(), redact?: (value: string) => string) =>
    memories.handleTool(
      {
        threadId: "fixture-thread",
        turnId,
        callId: randomUUID(),
        namespace: "openbot",
        tool,
        arguments: argumentsValue,
      },
      agent.id,
      redact,
    );
  const annotate = (memoryId: string, title: string, aliases: string[] = []): AgentMemoryDirectoryMetadata => {
    const current = memories.getDirectoryMetadata({ agentId: agent.id, memoryId });
    assert.ok(current);
    return memories.setDirectoryMetadata({
      agentId: agent.id,
      memoryId,
      expectedMemoryRevision: current.memoryRevision,
      expectedAnnotationRevision: current.annotationRevision,
      title,
      aliases,
    });
  };
  const initial = memories.create({ agentId: agent.id, text: "11월 제주도로 가족 여행을 가기로 결정했다." });
  const selected = annotate(initial.id, "가족 여행 결정", ["제주", "여행"]);
  const originalDates = memoryStore.get(agent.id, initial.id);
  assert.ok(originalDates);
  assert.deepEqual(originalDates, initial, "Labels cannot change the fact or its dates.");
  const sameTimestamp = initial.updatedAt;
  store.database.connection
    .prepare("UPDATE projection_agent_memories SET text = ?, normalized_text = ?, updated_at = ? WHERE memory_id = ?")
    .run("부산 여행으로 변경했다.", "부산 여행으로 변경했다.", sameTimestamp, initial.id);
  const stale = memoryStore.directory.read(agent.id, initial.id, selected.memoryRevision, selected.directoryRevision);
  assert.deepEqual(stale, { status: "stale" });
  const fallback = memories.getDirectoryMetadata({ agentId: agent.id, memoryId: initial.id });
  assert.ok(fallback);
  assert.equal(fallback.titleKind, "current-text-excerpt");
  assert.deepEqual(fallback.aliases, []);
  assert.equal(fallback.title, "부산 여행으로 변경했다.");
  assert.equal(fallback.annotationUserControlled, true);
  const staleTitleQuery = memoryStore.directory.list(agent.id, selected.title);
  assert.deepEqual(staleTitleQuery.entries, []);
  assert.equal(staleTitleQuery.scanned, 1);
  assert.equal(staleTitleQuery.hasMore, false);
  assert.deepEqual(
    memoryStore.directory.list(agent.id, "부산").entries.map((entry) => entry.memoryId),
    [initial.id],
  );
  assert.equal(
    call("remember", {
      memoryId: initial.id,
      text: "Agent cannot replace user labels.",
      directory: { title: "Replacement", aliases: [] },
    })?.success,
    false,
  );
  assert.equal(memoryStore.get(agent.id, initial.id)?.text, "부산 여행으로 변경했다.");
  const current = annotate(initial.id, "가족 여행 결정", ["제주", "부산", "여행"]);
  assert.equal(
    memoryStore.directory.read(agent.id, initial.id, current.memoryRevision, current.directoryRevision).status,
    "ok",
  );
  const beforeClock = memoryStore.get(agent.id, initial.id);
  assert.ok(beforeClock);
  const afterClock = memories.update({
    agentId: agent.id,
    memoryId: initial.id,
    text: "부산을 선택한 이유는 짧은 이동 시간이다.",
  });
  assert.ok(afterClock.updatedAt > beforeClock.updatedAt);
  assert.deepEqual(
    memoryStore.directory.read(agent.id, initial.id, current.memoryRevision, current.directoryRevision),
    { status: "stale" },
  );
  const realDate = globalThis.Date;
  const fixedTime = Date.parse("2050-01-01T00:00:00.000Z");
  globalThis.Date = new Proxy(realDate, {
    construct: (target, args) => Reflect.construct(target, args.length === 0 ? [fixedTime] : args),
  });
  try {
    const first = memories.update({ agentId: agent.id, memoryId: initial.id, text: "Fixed-clock first correction." });
    const firstHint = annotate(initial.id, "Fixed clock subject");
    const second = memories.update({
      agentId: agent.id,
      memoryId: initial.id,
      text: "Fixed-clock current correction.",
    });
    assert.equal(Date.parse(second.updatedAt), Date.parse(first.updatedAt) + 1);
    assert.equal(memoryStore.directory.metadata(agent.id, initial.id)?.titleKind, "current-text-excerpt");
    assert.deepEqual(
      memoryStore.directory.read(agent.id, initial.id, firstHint.memoryRevision, firstHint.directoryRevision),
      { status: "stale" },
    );
  } finally {
    globalThis.Date = realDate;
  }
  checks.push(
    "A same-timestamp SQLite correction invalidates old labels by current-text binding; a standard store correction keeps increasing timestamps; old handles return stale without old text.",
  );

  const stagedTurn = randomUUID();
  const stagedText = "Cancelled directory fact.";
  assert.equal(
    call(
      "remember",
      { text: stagedText, directory: { title: "Cancelled hint", aliases: ["cancelled alias"] } },
      stagedTurn,
    )?.success,
    true,
  );
  memories.finishTurn(stagedTurn, "interrupted");
  assert.equal(
    memoryStore.list(agent.id).some((memory) => memory.text === stagedText),
    false,
  );
  const clearTurn = randomUUID();
  call("remember", { text: "Epoch fact", directory: { title: "Epoch hint", aliases: [] } }, clearTurn);
  memories.clear(agent.id);
  memories.finishTurn(clearTurn, "completed");
  assert.equal(memoryStore.count(agent.id), 0);
  const eventsBeforeInvalid = store.database.connection
    .prepare("SELECT COUNT(*) AS count FROM orchestration_events")
    .get()?.count;
  const oversizedDirectory = { title: "😀".repeat(48), aliases: ["😀".repeat(32), "🦊".repeat(32), "🐋".repeat(32)] };
  assert.ok(oversizedDirectory.title.length <= MEMORY_DIRECTORY_LIMITS.title);
  assert.ok(oversizedDirectory.aliases.length <= MEMORY_DIRECTORY_LIMITS.aliases);
  assert.ok(oversizedDirectory.aliases.every((alias) => alias.length <= MEMORY_DIRECTORY_LIMITS.alias));
  assert.equal(
    new Set(oversizedDirectory.aliases.map(normalizeMemoryDirectoryQuery)).size,
    oversizedDirectory.aliases.length,
  );
  const oversizedDirectoryBytes = Buffer.byteLength(JSON.stringify(oversizedDirectory), "utf8");
  assert.equal(oversizedDirectoryBytes, 609);
  assert.ok(oversizedDirectoryBytes > MEMORY_DIRECTORY_LIMITS.annotationBytes);
  assert.equal(call("remember", { text: "Oversize fact", directory: oversizedDirectory })?.success, false);
  assert.equal(
    store.database.connection.prepare("SELECT COUNT(*) AS count FROM orchestration_events").get()?.count,
    eventsBeforeInvalid,
  );
  assert.equal(memoryStore.count(agent.id), 0);
  const successTurn = randomUUID();
  call(
    "remember",
    { text: "Committed annotated fact", directory: { title: "Committed hint", aliases: ["ＣＯＭＭＩＴＴＥＤ"] } },
    successTurn,
  );
  memories.finishTurn(successTurn, "completed");
  const committed = memoryStore.list(agent.id).find((memory) => memory.text === "Committed annotated fact");
  assert.ok(committed);
  assert.equal(
    memoryStore.directory.list(agent.id, "committed").entries.some((entry) => entry.memoryId === committed.id),
    true,
  );
  const ownTurn = randomUUID();
  const beforeOwnErrors = errors.length;
  for (let index = 0; index < 2; index += 1)
    assert.equal(
      call(
        "remember",
        {
          text: "Same-turn duplicate fact",
          directory: { title: "Same-turn subject", aliases: ["same turn"] },
        },
        ownTurn,
      )?.success,
      true,
    );
  memories.finishTurn(ownTurn, "completed");
  const sameTurnFacts = memoryStore.list(agent.id).filter((memory) => memory.text === "Same-turn duplicate fact");
  assert.equal(sameTurnFacts.length, 1);
  assert.equal(errors.length, beforeOwnErrors);
  const sameTurnFact = sameTurnFacts[0];
  assert.ok(sameTurnFact);
  assert.equal(memoryStore.directory.metadata(agent.id, sameTurnFact.id)?.title, "Same-turn subject");
  const relabelTurn = randomUUID();
  for (const title of ["First own label", "Second own label"])
    assert.equal(
      call(
        "remember",
        {
          memoryId: sameTurnFact.id,
          text: sameTurnFact.text,
          directory: { title, aliases: [] },
        },
        relabelTurn,
      )?.success,
      true,
    );
  memories.finishTurn(relabelTurn, "completed");
  assert.equal(memoryStore.directory.metadata(agent.id, sameTurnFact.id)?.title, "Second own label");
  assert.equal(errors.length, beforeOwnErrors);
  checks.push(
    "Identical remembers and consecutive relabels in one turn adjust only their own committed revisions, retain one survivor and report no false conflict.",
  );
  const conflictTurn = randomUUID();
  call(
    "remember",
    { memoryId: committed.id, text: "Must roll back", directory: { title: "New hint", aliases: [] } },
    conflictTurn,
  );
  annotate(committed.id, "User protected during turn");
  memories.finishTurn(conflictTurn, "completed");
  assert.equal(memoryStore.get(agent.id, committed.id)?.text, "Committed annotated fact");
  assert.ok(errors.includes("memory_commit_failed"));
  const failingTurn = randomUUID();
  call("remember", { text: "Atomic new fact", directory: { title: "Reject fixture", aliases: [] } }, failingTurn);
  store.database.connection.exec(
    "CREATE TRIGGER fixture_reject_directory BEFORE INSERT ON orchestration_events WHEN NEW.event_type = 'agent-memory.directory-set.v1' AND json_extract(NEW.payload_json, '$.title') = 'Reject fixture' BEGIN SELECT RAISE(ABORT, 'Fixture annotation failure'); END",
  );
  try {
    memories.finishTurn(failingTurn, "completed");
  } finally {
    store.database.connection.exec("DROP TRIGGER fixture_reject_directory");
  }
  assert.equal(
    memoryStore.list(agent.id).some((memory) => memory.text === "Atomic new fact"),
    false,
  );
  checks.push(
    "Interrupted and cleared turns create no hints; oversized metadata writes nothing; concurrent user labels and an actual annotation INSERT failure roll back the fact and hints together.",
  );

  const survivor = memories.create({ agentId: agent.id, text: "Survivor fact" });
  const mergeSource = memories.create({ agentId: agent.id, text: "Source fact" });
  const mergeTurn = randomUUID();
  call(
    "remember",
    { memoryId: mergeSource.id, text: survivor.text, directory: { title: "Merged subject", aliases: ["merged"] } },
    mergeTurn,
  );
  memories.finishTurn(mergeTurn, "completed");
  assert.equal(memoryStore.get(agent.id, mergeSource.id), null);
  assert.equal(memories.getDirectoryMetadata({ agentId: agent.id, memoryId: survivor.id })?.title, "Merged subject");
  const exactTurn = randomUUID();
  call("remember", { text: survivor.text, directory: { title: "Merged subject", aliases: ["merged"] } }, exactTurn);
  memories.finishTurn(exactTurn, "completed");
  assert.equal(memoryStore.list(agent.id).filter((memory) => memory.text === survivor.text).length, 1);
  const differentTurn = randomUUID();
  assert.equal(
    call("remember", { text: survivor.text, directory: { title: "Different subject", aliases: [] } }, differentTurn)
      ?.success,
    false,
  );
  const mergeSubjects: string[] = [];
  for (const suffix of ["A", "B"]) {
    const turn = randomUUID();
    call(
      "remember",
      { text: `Merge conflict ${suffix}`, directory: { title: `Subject ${suffix}`, aliases: [] } },
      turn,
    );
    memories.finishTurn(turn, "completed");
    const memory = memoryStore.list(agent.id).find((entry) => entry.text === `Merge conflict ${suffix}`);
    assert.ok(memory);
    mergeSubjects.push(memory.id);
  }
  const conflictSource = mergeSubjects[0];
  const conflictSurvivor = mergeSubjects[1];
  assert.ok(conflictSource && conflictSurvivor);
  const beforeMerge = JSON.stringify(memoryStore.list(agent.id));
  assert.equal(call("remember", { memoryId: conflictSource, text: "Merge conflict B" })?.success, false);
  assert.equal(JSON.stringify(memoryStore.list(agent.id)), beforeMerge);
  assert.equal(memoryStore.directory.metadata(agent.id, conflictSource)?.title, "Subject A");
  assert.equal(memoryStore.directory.metadata(agent.id, conflictSurvivor)?.title, "Subject B");
  const removable = memories.create({ agentId: agent.id, text: "User label reverse action." });
  annotate(removable.id, "Owner controlled hint");
  const editedRemovable = memories.update({
    agentId: agent.id,
    memoryId: removable.id,
    text: "Current reverse-action fact.",
  });
  const ownerHint = memories.getDirectoryMetadata({ agentId: agent.id, memoryId: removable.id });
  assert.ok(ownerHint);
  assert.equal(ownerHint.directoryRevision, null);
  assert.ok(ownerHint.annotationRevision !== null);
  const removedHint = memories.setDirectoryMetadata({
    agentId: agent.id,
    memoryId: removable.id,
    expectedMemoryRevision: ownerHint.memoryRevision,
    expectedAnnotationRevision: ownerHint.annotationRevision,
    title: null,
    aliases: [],
  });
  assert.equal(removedHint.annotationUserControlled, false);
  assert.equal(removedHint.actor, null);
  assert.deepEqual(memoryStore.get(agent.id, removable.id), editedRemovable);
  assert.throws(() =>
    memories.setDirectoryMetadata({
      agentId: agent.id,
      memoryId: removable.id,
      expectedMemoryRevision: ownerHint.memoryRevision,
      expectedAnnotationRevision: ownerHint.annotationRevision,
      title: "Stale editor replacement",
      aliases: [],
    }),
  );
  assert.equal(memoryStore.directory.metadata(agent.id, removable.id)?.actor, null);
  assert.deepEqual(memoryStore.get(agent.id, removable.id), editedRemovable);
  const releasedTurn = randomUUID();
  call(
    "remember",
    { text: editedRemovable.text, directory: { title: "Agent hint after release", aliases: [] } },
    releasedTurn,
  );
  memories.finishTurn(releasedTurn, "completed");
  assert.equal(memoryStore.directory.metadata(agent.id, removable.id)?.title, "Agent hint after release");
  checks.push(
    "A stale-label editor token cannot replace a later removal; removal releases user control without changing the fact, and an agent can then save current labels.",
  );
  checks.push(
    "Merge annotations use the actual survivor ID; exact duplicates keep one fact; a different survivor annotation fails before deleting a source.",
  );

  const other = await Effect.runPromise(
    store.createAgent({ name: "Clone", description: "", avatarSeed: "clone", avatarHue: null }),
  );
  memories.duplicate(agent.id, other.id);
  const copied = memoryStore.list(other.id).find((memory) => memory.text === survivor.text);
  assert.ok(copied);
  const copyMetadata = memoryStore.directory.metadata(other.id, copied.id);
  assert.ok(copyMetadata);
  assert.equal(copyMetadata.title, "Merged subject");
  assert.notEqual(copied.id, survivor.id);
  assert.equal(copied.sourceTurnId, null);
  const protectedCopy = memoryStore.list(other.id).find((memory) => memory.text === committed.text);
  assert.ok(protectedCopy);
  assert.equal(memoryStore.directory.metadata(other.id, protectedCopy.id)?.annotationUserControlled, true);
  const copyEvent = store.database.connection
    .prepare(
      "SELECT payload_json FROM orchestration_events WHERE aggregate_type = 'agent-memory' AND aggregate_id = ? AND event_type = 'agent-memory.directory-set.v1' ORDER BY sequence DESC LIMIT 1",
    )
    .get(copied.id);
  assert.ok(copyEvent && isString(copyEvent.payload_json));
  const payload = JSON.parse(copyEvent.payload_json);
  assert.ok(isDynamicRecord(payload));
  assert.equal(payload.annotationSourceTurnId, null);
  const commands = store.database.connection
    .prepare(
      "SELECT DISTINCT command_id FROM orchestration_events WHERE aggregate_type = 'agent-memory' AND aggregate_id = ?",
    )
    .all(survivor.id);
  memories.delete({ agentId: agent.id, memoryId: survivor.id });
  assert.deepEqual(memoryStore.directory.read(agent.id, survivor.id, 0, null), { status: "missing" });
  assert.equal(memoryStore.directory.metadata(other.id, copied.id)?.title, "Merged subject");
  assert.equal(
    store.database.connection
      .prepare(
        "SELECT 1 FROM orchestration_events WHERE aggregate_id = ? AND event_type = 'agent-memory.directory-set.v1'",
      )
      .get(survivor.id),
    undefined,
  );
  for (const command of commands) {
    assert.ok(isString(command.command_id));
    assert.equal(
      store.database.connection
        .prepare("SELECT 1 FROM orchestration_command_receipts WHERE command_id = ?")
        .get(command.command_id),
      undefined,
    );
  }
  const sourceCursor = memoryStore.directory.list(other.id, "unmatched").nextCursor;
  if (sourceCursor !== null) {
    assert.throws(() => memoryStore.directory.list(agent.id, "unmatched", sourceCursor));
    assert.throws(() => memoryStore.directory.list(other.id, "different", sourceCursor));
  }
  assert.deepEqual(
    memoryStore.directory.read(agent.id, copied.id, copyMetadata.memoryRevision, copyMetadata.directoryRevision),
    { status: "missing" },
  );
  const hardDeleteCommands = store.database.connection
    .prepare(
      "SELECT DISTINCT command_id FROM orchestration_events WHERE aggregate_type = 'agent-memory' AND aggregate_id = ?",
    )
    .all(copied.id);
  await Effect.runPromise(store.deleteAgent(other.id));
  assert.equal(
    store.database.connection
      .prepare(
        "SELECT 1 FROM orchestration_events WHERE aggregate_id = ? AND event_type = 'agent-memory.directory-set.v1'",
      )
      .get(copied.id),
    undefined,
  );
  for (const command of hardDeleteCommands) {
    assert.ok(isString(command.command_id));
    assert.equal(
      store.database.connection
        .prepare("SELECT 1 FROM orchestration_command_receipts WHERE command_id = ?")
        .get(command.command_id),
      undefined,
    );
  }
  checks.push(
    "Local clones have independent IDs and null save-turn locators; forget and hard agent deletion purge directory events; another owner cannot read a selected ID.",
  );
  const clearFact = memories.create({ agentId: agent.id, text: "Clear purge fixture." });
  const clearHint = annotate(clearFact.id, "Clear purge title", ["clear-purge-alias"]);
  const clearCommands = store.database.connection
    .prepare(
      "SELECT DISTINCT command_id FROM orchestration_events WHERE aggregate_type = 'agent-memory' AND aggregate_id = ?",
    )
    .all(clearFact.id);
  memories.clear(agent.id);
  assert.deepEqual(
    memoryStore.directory.read(agent.id, clearFact.id, clearHint.memoryRevision, clearHint.directoryRevision),
    { status: "missing" },
  );
  for (const command of clearCommands) {
    assert.ok(isString(command.command_id));
    assert.equal(
      store.database.connection
        .prepare("SELECT 1 FROM orchestration_command_receipts WHERE command_id = ?")
        .get(command.command_id),
      undefined,
    );
  }
  assert.equal(
    store.database.connection
      .prepare(
        "SELECT 1 FROM orchestration_events WHERE aggregate_id = ? AND event_type = 'agent-memory.directory-set.v1'",
      )
      .get(clearFact.id),
    undefined,
  );
  const emptyListResponse = call("list_memories", {});
  assert.equal(emptyListResponse?.success, true);
  const emptyList = JSON.parse(toolText(emptyListResponse));
  assert.ok(isDynamicRecord(emptyList) && Array.isArray(emptyList.memories));
  assert.deepEqual(emptyList.memories, []);
  assert.equal(emptyList.guidance, undefined);
  recallControls.push({
    kind: "empty-list-without-guidance",
    success: true,
    responseBytes: Buffer.byteLength(toolText(emptyListResponse), "utf8"),
    memories: 0,
    guidance: false,
  });
  const missingQuery = "unrecordedfluteinsurance";
  const expandGuidance =
    (extraCharacters: number) =>
    (value: string): string => {
      const payload = JSON.parse(value);
      return isDynamicRecord(payload) && isString(payload.guidance)
        ? JSON.stringify({ ...payload, guidance: `${payload.guidance}${"g".repeat(extraCharacters)}` })
        : value;
    };
  const boundedGuidanceResponse = call("search_memories", { query: missingQuery }, randomUUID(), expandGuidance(1024));
  assert.equal(boundedGuidanceResponse?.success, true);
  const boundedGuidance = JSON.parse(toolText(boundedGuidanceResponse));
  emptyRecallTools(boundedGuidance, [missingQuery]);
  assert.ok(
    isDynamicRecord(boundedGuidance) && isString(boundedGuidance.guidance) && boundedGuidance.guidance.length > 1024,
  );
  let expandedGuidanceBytes = 0;
  const oversizedGuidanceResponse = call("search_memories", { query: missingQuery }, randomUUID(), (value) => {
    const expanded = expandGuidance(9000)(value);
    expandedGuidanceBytes = Buffer.byteLength(expanded, "utf8");
    return expanded;
  });
  assert.ok(expandedGuidanceBytes > AGENT_MEMORY_CONTEXT_BUDGET_BYTES);
  assert.equal(oversizedGuidanceResponse?.success, false);
  const guidanceFailure = JSON.parse(toolText(oversizedGuidanceResponse));
  assert.ok(isDynamicRecord(guidanceFailure) && isString(guidanceFailure.error) && guidanceFailure.error.length > 0);
  assert.equal(guidanceFailure.guidance, undefined);
  recallControls.push({
    kind: "oversize-guidance-controlled-failure",
    success: false,
    responseBytes: Buffer.byteLength(toolText(oversizedGuidanceResponse), "utf8"),
    memories: 0,
    guidance: false,
  });
  const retained = memories.create({ agentId: agent.id, text: "Persistent lifecycle fact." });
  annotate(retained.id, "Persistent lifecycle hint");
  checks.push(
    "Clear purges private annotation history and command receipts, with missing reads that contain no forgotten data.",
  );

  const normalRememberTurn = await begin(
    service,
    agent.id,
    "Remember a short durable fixture fact with recall labels.",
  );
  const normalText = "Normal provider tool remembers this fixture fact.";
  const normalStaged = await provider.tool(normalRememberTurn.threadId, normalRememberTurn.turnId, "remember", {
    text: normalText,
    directory: { title: "Normal stage subject", aliases: ["normal stage"] },
  });
  assert.ok(isDynamicRecord(normalStaged) && normalStaged.status === "staged");
  assert.equal(
    memoryStore.list(agent.id).some((memory) => memory.text === normalText),
    false,
  );
  await finish(service, agent.id, normalRememberTurn, "Saved the fixture fact.");
  const normalSaved = memoryStore.list(agent.id).find((memory) => memory.text === normalText);
  assert.ok(normalSaved);
  assert.equal(normalSaved.sourceTurnId, normalRememberTurn.turnId);
  assert.equal(memoryStore.directory.metadata(agent.id, normalSaved.id)?.title, "Normal stage subject");
  const interruptedRememberTurn = await begin(
    service,
    agent.id,
    "Stage another fixture fact before this turn is interrupted.",
  );
  const expansionFacts = Array.from({ length: 10 }, (_value, index) =>
    memoryStore.createManual(agent.id, `${"password=x ".repeat(45)}${index}`),
  );
  try {
    const rawExpansionSearch = memoryStore.search(agent.id, "password", 10);
    assert.ok(rawExpansionSearch.memories.length > 0);
    const expandedSearch = await provider.tool(
      interruptedRememberTurn.threadId,
      interruptedRememberTurn.turnId,
      "search_memories",
      { query: "password", limit: 10 },
    );
    assert.ok(isDynamicRecord(expandedSearch) && Array.isArray(expandedSearch.memories));
    assert.ok(
      expandedSearch.memories.length > 0 && expandedSearch.memories.length < rawExpansionSearch.memories.length,
    );
    assert.equal(expandedSearch.hasMore, true);
    assert.equal(expandedSearch.guidance, undefined);
    assert.ok(
      expandedSearch.memories.every(
        (memory: unknown) =>
          isDynamicRecord(memory) &&
          isString(memory.text) &&
          memory.text.includes("[redacted]") &&
          !memory.text.includes("password=x"),
      ),
    );
    const expandedSearchBytes = Buffer.byteLength(JSON.stringify(expandedSearch), "utf8");
    assert.ok(expandedSearchBytes <= AGENT_MEMORY_CONTEXT_BUDGET_BYTES);
    recallControls.push({
      kind: "router-redaction-expansion",
      success: true,
      responseBytes: expandedSearchBytes,
      memories: expandedSearch.memories.length,
      guidance: false,
    });
  } finally {
    for (const memory of expansionFacts) memoryStore.delete(agent.id, memory.id);
  }
  const positiveBeforeTrim = memoryStore.search(agent.id, "provider");
  assert.ok(positiveBeforeTrim.memories.some((memory) => memory.id === normalSaved.id));
  let expandedPositiveBytes = 0;
  const trimmedPositiveResponse = call("search_memories", { query: "provider" }, randomUUID(), (value) => {
    const payload = JSON.parse(value);
    if (!isDynamicRecord(payload) || !Array.isArray(payload.memories)) return value;
    const expanded = JSON.stringify({
      ...payload,
      memories: payload.memories.map((memory: unknown) =>
        isDynamicRecord(memory) && isString(memory.text)
          ? { ...memory, text: `${memory.text}${"x".repeat(9000)}` }
          : memory,
      ),
    });
    expandedPositiveBytes = Math.max(expandedPositiveBytes, Buffer.byteLength(expanded, "utf8"));
    return expanded;
  });
  assert.ok(expandedPositiveBytes > AGENT_MEMORY_CONTEXT_BUDGET_BYTES);
  assert.equal(trimmedPositiveResponse?.success, true);
  const trimmedPositive = JSON.parse(toolText(trimmedPositiveResponse));
  assert.ok(isDynamicRecord(trimmedPositive) && Array.isArray(trimmedPositive.memories));
  assert.deepEqual(trimmedPositive.memories, []);
  assert.equal(trimmedPositive.hasMore, true);
  assert.equal(trimmedPositive.guidance, undefined);
  assert.equal(memoryStore.get(agent.id, normalSaved.id)?.text, normalText);
  recallControls.push({
    kind: "positive-rows-trimmed-without-guidance",
    success: true,
    responseBytes: Buffer.byteLength(toolText(trimmedPositiveResponse), "utf8"),
    memories: 0,
    guidance: false,
  });
  const interruptedText = "Interrupted provider fixture must not be remembered.";
  const interruptedStaged = await provider.tool(
    interruptedRememberTurn.threadId,
    interruptedRememberTurn.turnId,
    "remember",
    {
      text: interruptedText,
      directory: { title: "Interrupted normal subject", aliases: ["interrupted normal"] },
    },
  );
  assert.ok(isDynamicRecord(interruptedStaged) && interruptedStaged.status === "staged");
  await finish(service, agent.id, interruptedRememberTurn, "", "interrupted");
  assert.equal(
    memoryStore.list(agent.id).some((memory) => memory.text === interruptedText),
    false,
  );
  assert.equal(
    store.database.connection
      .prepare(
        "SELECT 1 FROM orchestration_events WHERE event_type = 'agent-memory.directory-set.v1' AND json_extract(payload_json, '$.annotationSourceTurnId') = ?",
      )
      .get(interruptedRememberTurn.turnId),
    undefined,
  );
  const absentTurn = await begin(service, agent.id, "Do you have a saved fact about not-in-any-fixture?");
  const absentLiteral = await provider.tool(absentTurn.threadId, absentTurn.turnId, "search_memories", {
    query: missingQuery,
  });
  await discover(absentTurn, emptyRecallTools(absentLiteral, [missingQuery]));
  let absentCursor: string | null = null;
  let absentCount = 0;
  do {
    const directory = page(
      await provider.tool(absentTurn.threadId, absentTurn.turnId, "tool_call", {
        name: "openbot.list_memory_directory",
        arguments: { query: "not-in-any-fixture", cursor: absentCursor },
      }),
    );
    absentCount += directory.entries.length;
    absentCursor = directory.nextCursor;
  } while (absentCursor !== null);
  assert.equal(absentCount, 0);
  await finish(service, agent.id, absentTurn, "I have no saved fact about that subject.");
  checks.push(
    "The full service and router preserve annotated remember settlement and absent-subject scans; normal redaction trims an expanded positive result within 8192 bytes, guidance expansion fits or returns a controlled failure, and trimmed positive rows never gain false no-match guidance.",
  );

  const member: TeamMemberSummary = {
    id: "fixture-member",
    username: "fixture",
    email: null,
    name: "Fixture",
    role: "member",
    createdAt: new Date().toISOString(),
    avatarUrl: null,
    disabled: false,
  };
  const hidden = new Set([privateAgent.id]);
  const activeService = service;
  http = createServer((request, response) => {
    const task = (async () => {
      const url = new URL(request.url ?? "/", "http://fixture.invalid");
      const capabilities = new Set((request.headers["x-fixture-capabilities"]?.toString() ?? "").split(","));
      const context = {
        request,
        response,
        url,
        method: request.method ?? "GET",
        protocol: 7,
        capabilities,
        member,
        token: "synthetic",
        sessionId: "fixture",
        sessionExpiresAt: "2100-01-01T00:00:00.000Z",
        json: (status: number, value: object | null) => {
          response.writeHead(status, { "Content-Type": "application/json" });
          response.end(JSON.stringify(value));
          return "handled" as const;
        },
        empty: (status: number) => {
          response.writeHead(status);
          response.end();
          return "handled" as const;
        },
      };
      if ((await routeMemoryDirectory(context, activeService, hidden)) === "handled") return;
      const legacy = url.pathname.match(/^\/v1\/agents\/([^/]+)\/(memories(?:\/[^/]+)?)$/u);
      if (
        legacy &&
        (await routeAgentMemories(
          context,
          { agentId: decodeURIComponent(legacy[1] ?? ""), action: legacy[2] ?? "" },
          { agents: activeService },
        )) === "handled"
      )
        return;
      context.json(404, { error: "Unmatched fixture route." });
    })().catch((error: unknown) => {
      if (!response.headersSent)
        response.writeHead(error instanceof HttpError ? error.status : 500, { "Content-Type": "application/json" });
      if (!response.writableEnded) response.end(JSON.stringify({ error: failureText(error) }));
    });
    httpTasks.add(task);
    void task.then(
      () => httpTasks.delete(task),
      (error) => {
        httpTasks.delete(task);
        cleanupErrors.push({ resource: "Loopback response", error: failureText(error) });
      },
    );
  });
  await new Promise<void>((done, reject) => {
    http?.once("error", reject);
    http?.listen(0, "127.0.0.1", done);
  });
  const address = http.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, input: MemoryDirectoryPostInput, supported = true) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-fixture-capabilities": supported ? MEMORY_DIRECTORY_CAPABILITY : "",
      },
      body: JSON.stringify(input),
    });
  const transportFact = service.createMemory({ agentId: agent.id, text: "Transport current fact." });
  const transportMetadata = service.getMemoryDirectoryMetadata({ agentId: agent.id, memoryId: transportFact.id });
  assert.ok(transportMetadata);
  const request = {
    agentId: agent.id,
    memoryId: transportFact.id,
    expectedMemoryRevision: transportMetadata.memoryRevision,
    expectedAnnotationRevision: transportMetadata.annotationRevision,
    title: "Transport label",
    aliases: ["transport"],
  };
  const response = await post(MEMORY_DIRECTORY_SET_ROUTE, request);
  assert.equal(response.status, 200);
  const wire = await response.json();
  assert.ok(JSON.stringify(wire).includes("Transport label"));
  assert.equal(
    (await post(MEMORY_DIRECTORY_METADATA_ROUTE, { agentId: privateAgent.id, memoryId: privateMemory.id })).status,
    404,
  );
  assert.equal(
    (await post(MEMORY_DIRECTORY_METADATA_ROUTE, { agentId: agent.id, memoryId: transportFact.id }, false)).status,
    404,
  );
  const oldHost = await Effect.runPromise(
    readAgentMemoryDirectoryMetadata(
      () => Effect.die(new Error("Old host must receive no metadata request.")),
      { agentId: agent.id, memoryId: transportFact.id },
      false,
    ),
  );
  assert.equal(oldHost, null);
  const oldEdit = await fetch(`${base}/v1/agents/${encodeURIComponent(agent.id)}/memories/${transportFact.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "Transport corrected through old route." }),
  });
  assert.equal(oldEdit.status, 200);
  const oldShape = await oldEdit.json();
  assert.ok(isDynamicRecord(oldShape));
  assert.deepEqual(
    Object.keys(oldShape).sort(),
    ["agentId", "createdAt", "id", "origin", "sourceTurnId", "text", "updatedAt"].sort(),
  );
  assert.equal(
    service.getMemoryDirectoryMetadata({ agentId: agent.id, memoryId: transportFact.id })?.titleKind,
    "current-text-excerpt",
  );
  assert.equal(teamCapabilitiesForProtocol(6).includes(MEMORY_DIRECTORY_CAPABILITY), false);
  assert.equal(teamCapabilitiesForProtocol(7).includes(MEMORY_DIRECTORY_CAPABILITY), true);
  for (const file of ["client-request.json", "host-response.json"]) {
    const fixture = JSON.parse(
      await readFile(
        resolve(import.meta.dirname, `../packages/contracts/src/team-protocol/fixtures/memory-directory-v1/${file}`),
        "utf8",
      ),
    );
    assert.ok(isDynamicRecord(fixture) && isString(fixture.path));
    const codec = MEMORY_DIRECTORY_CODECS.get(fixture.path);
    assert.ok(codec);
    assert.deepEqual(
      file === "client-request.json" ? codec.request(fixture.body) : codec.response(200, fixture.body),
      fixture.body,
    );
  }
  checks.push(
    "Actual loopback HTTP routes preserve old text response shapes, hide another agent, gate the optional capability, and leave old-host text controls available.",
  );

  const rows = store.database.connection
    .prepare("SELECT payload_json FROM orchestration_events WHERE event_type = 'agent-memory.directory-set.v1'")
    .all();
  const digests = rows.map((row) => {
    assert.ok(isString(row.payload_json));
    const value = JSON.parse(row.payload_json);
    assert.ok(isDynamicRecord(value) && isString(value.memoryTextDigest));
    privateHashes.add(value.memoryTextDigest);
    return value.memoryTextDigest;
  });
  const outbound = JSON.stringify({
    wire,
    oldShape,
    trace,
    providerOutputs,
    configurations: provider.configurations,
    inputs: provider.turnInputs,
    metadata: service.getMemoryDirectoryMetadata({ agentId: agent.id, memoryId: retained.id }),
  });
  assert.equal(outbound.includes("memoryTextDigest"), false);
  assert.equal(
    digests.some((digest) => outbound.includes(digest)),
    false,
  );
  for (const configuration of provider.configurations)
    for (const fixture of fixtures) {
      assert.equal(
        configuration.includes(fixture.title),
        false,
        "Directory titles must stay out of provider session configuration.",
      );
      for (const alias of fixture.aliases) assert.equal(configuration.includes(alias), false);
    }
  const claudeInstructions = developerInstructions(
    store.list().find((entry) => entry.id === agent.id) ?? privateAgent,
    store.sharedRoot,
    [],
    store.sharedRoot,
    { memoriesInTurns: true },
  );
  assert.equal(claudeInstructions.includes("Transport label"), false);
  const greeting = await begin(service, agent.id, "Hello.");
  const callsBefore = trace.length;
  await finish(service, agent.id, greeting, "Hello.");
  assert.equal(trace.length, callsBefore);
  const absent = memoryStore.directory.list(agent.id, "not-in-any-fixture");
  assert.equal(absent.entries.length, 0);
  const startsBeforeLabel = provider.threadStarts;
  const greetingMetadata = service.getMemoryDirectoryMetadata({ agentId: agent.id, memoryId: retained.id });
  assert.ok(greetingMetadata);
  const unchangedFact = memoryStore.get(agent.id, retained.id);
  service.setMemoryDirectoryMetadata({
    agentId: agent.id,
    memoryId: retained.id,
    expectedMemoryRevision: greetingMetadata.memoryRevision,
    expectedAnnotationRevision: greetingMetadata.annotationRevision,
    title: "Label only change",
    aliases: [],
  });
  assert.deepEqual(memoryStore.get(agent.id, retained.id), unchangedFact);
  const afterLabel = await begin(service, agent.id, "Hello again.");
  await finish(service, agent.id, afterLabel, "Hello again.");
  assert.equal(provider.threadStarts, startsBeforeLabel);
  checks.push(
    "Private text digests do not enter public metadata, old text routes, tool trace or scripted provider requests; titles and aliases stay out of session configuration; label-only edits keep the same session; a greeting uses no directory.",
  );
  assert.ok(
    trace
      .filter((entry) => entry.tool === "tool_call")
      .every((entry) => entry.responseBytes <= AGENT_MEMORY_CONTEXT_BUDGET_BYTES),
  );
  await Effect.runPromise(service.stop());
  cleanupCompleted.push("Agent service");
  service = undefined;
  lifecycle.dispose();
  cleanupCompleted.push("Conversation runtime");
  lifecycle = undefined;
  const restartMetadata = memoryStore.directory.metadata(agent.id, retained.id);
  assert.ok(restartMetadata);
  store.database.close();
  await Effect.runPromise(store.database.initialize());
  assert.equal(memoryStore.directory.metadata(agent.id, retained.id)?.title, "Label only change");
  assert.equal(
    memoryStore.directory.read(agent.id, retained.id, restartMetadata.memoryRevision, restartMetadata.directoryRevision)
      .status,
    "ok",
  );
  checks.push(
    "Database close and reopen retain fact IDs, current annotation revisions and checked read handles through the same production store object.",
  );
  report.passed = true;
} catch (error) {
  report.failure = failureText(error);
} finally {
  const ownedHttp = http;
  if (ownedHttp)
    await finalize("Loopback listener", async () => {
      if (!ownedHttp.listening) return;
      await new Promise<void>((done, fail) => {
        ownedHttp.close((error) => {
          if (!error || ("code" in error && error.code === "ERR_SERVER_NOT_RUNNING" && !ownedHttp.listening)) done();
          else fail(error);
        });
        ownedHttp.closeAllConnections();
      });
    });
  await finalize("Loopback requests", drainHttpRequests);
  const ownedLifecycle = lifecycle;
  if (ownedLifecycle) await finalize("Conversation runtime", () => ownedLifecycle.dispose());
  const ownedService = service;
  if (ownedService) await finalize("Agent service", () => Effect.runPromise(ownedService.stop()));
  await finalize("Fixture provider", async () => {
    for (const response of provider.responses.values())
      response.resolve({ success: false, contentItems: [{ type: "inputText", text: '{"error":"Fixture cleanup."}' }] });
    provider.responses.clear();
    await Effect.runPromise(provider.stop());
    assert.equal(provider.running, false, "The owned scripted provider must stop.");
  });
  const fixtureStore = ownedStore;
  if (fixtureStore) await finalize("Agent database", () => fixtureStore.database.close());
  await finalize("Provider path environment", () => {
    if (originalCodexPath === undefined) delete process.env.OPENBOT_CODEX_PATH;
    else process.env.OPENBOT_CODEX_PATH = originalCodexPath;
    assert.equal(process.env.OPENBOT_CODEX_PATH, originalCodexPath);
  });
  if (temporary) await finalize("Fixture directory", () => rm(temporary, { recursive: true, force: true }));
  report.cleanupComplete = cleanupErrors.length === 0;
  report.actualScriptedProviderTurns = provider.turnStarts;
  report.completedAt = new Date().toISOString();
  report.passed = report.passed && report.cleanupComplete && report.sourceComplete && artifactErrors.length === 0;
  let reportWritten = false;
  try {
    await deadline(mkdir(OUT, { recursive: true }), "Report directory");
    await deadline(writeFile(join(OUT, "report.json"), `${encodeReport()}\n`), "Fixture report");
    reportWritten = true;
  } catch (error) {
    artifactErrors.push(failureText(error));
    report.passed = false;
  }
  process.exitCode = report.passed ? 0 : 1;
  if (!report.passed)
    process.stderr.write(
      `${JSON.stringify({ runNonce, failure: report.failure, cleanupErrors, artifactErrors, cleanupComplete: report.cleanupComplete })}\n`,
    );
  // Machine-readable: bind this receipt to a source digest, run nonce and completed cleanup.
  process.stdout.write(
    `${JSON.stringify({ passed: report.passed, runNonce, sourceDigest: report.sourceDigest, cleanupComplete: report.cleanupComplete, reportWritten, checks: checks.length, scriptedProviderTurns: provider.turnStarts, recallControls: recallControls.length, report: REPORT_PATH })}\n`,
  );
}
