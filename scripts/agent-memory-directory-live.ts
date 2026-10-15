// Manual live-model evidence. Run with --allow-live-model. This script does not sign in.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/agent-providers";
import {
  type AgentEvent,
  CONVERSATION_PLAN_ITEM_TYPE,
  isAgentMemory,
  isAgentMemorySelection,
  isAgentModel,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { isSecretName, redactText, registerSecretValue } from "@openbot/logging";
import { Effect } from "effect";
import { startingModel } from "../src/backend/agent/model-choice";
import { isDynamicToolCall } from "../src/backend/agent/thread-items";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient } from "../src/backend/agent-client";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { CodexAppServerClient } from "../src/backend/app-server-client";
import { resolveCodexCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import {
  type AppServerNotification,
  type AppServerRequest,
  decodeAccountReadResult,
  decodeModelListResponse,
  getArray,
  getRecord,
  getString,
  type RequestId,
  type ResponseDecoder,
  type RpcError,
} from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-memory-directory-live");
const CLI = process.argv.find((argument) => argument.startsWith("--codex-path="))?.slice("--codex-path=".length);
const TURN_DEADLINE_MS = 60_000;
const RESPONSE_LIMIT_BYTES = 8192;
const PROFILE =
  "Answer only from your saved memories. Do not read files, run commands, browse, use external services, change saved facts, or send messages. Keep answers brief. When no saved fact supports the answer, say that it is not recorded.";
const READ_TOOLS = new Set(["openbot.search_memories", "openbot.list_memory_directory", "openbot.read_memory"]);
const NATIVE_ACTIONS = new Set([
  "commandExecution",
  "fileChange",
  "imageView",
  "webSearch",
  "imageGeneration",
  "collabAgentToolCall",
  "mcpToolCall",
]);

interface LiteralMemoryRow {
  id: string;
  agentId: string;
  text: string;
  revision: number;
  inclusion: "essential" | "searchable";
  userControlled: boolean;
}
interface LiteralSearchEvidence {
  query: string;
  hasMore: boolean;
  memories: LiteralMemoryRow[];
}
interface Trace {
  case: string;
  tool: string;
  target: string;
  argumentsText: string;
  directoryRequest: { query: string; cursorSha256: string | null } | null;
  success: boolean | null;
  responseBytes: number;
  responseText: string;
  returnedIds: string[];
  currentRead: { id: string; text: string } | null;
  literalSearch: LiteralSearchEvidence | null;
  directory: {
    query: string;
    cursorSha256: string | null;
    nextCursorSha256: string | null;
    scanned: number;
    hasMore: boolean;
    returnedIds: string[];
  } | null;
}
interface TurnResult {
  name: string;
  request: string;
  expectedId: string | null;
  expectedCurrentBody: string | null;
  expectedCurrentRevision: number | null;
  requiredEvidence: "current-fact" | "literal-current-control" | "absent-directory-scan";
  observedEvidence: "directory-current-id" | "literal-current-row" | "empty-directory-scan" | null;
  directoryCurrentIdValidated: boolean;
  automatedPassed: boolean;
  assertionFailure: string | null;
  response: string;
  responseBytes: number;
  completionStatus: string | null;
  counts: { search: number; describe: number; directory: number; currentIdRead: number; literalSearch: number };
}
interface PromptReceipt {
  model: string | null;
  reasoningEffort: string | null;
  developerInstructionsBytes: number;
  developerInstructionsSha256: string;
  normalMemoryGuidance: string[];
  dynamicToolSchemaBytes: number;
}
interface TurnInputReceipt {
  case: string;
  inputBytes: number;
  inputSha256: string;
  includesSyntheticAnswer: boolean;
}
interface LiveReport {
  schemaVersion: number;
  runNonce: string;
  status: "skipped" | "failed" | "completed";
  automatedPassed: boolean;
  manualResponseReview: "required";
  reason: string;
  runtime: {
    bunVersion: string | null;
    nodeCompatibilityVersion: string;
    platform: string;
    architecture: string;
    cliVersion: string | null;
    cliSource: string | null;
    selectedModel: string | null;
    advertisedModelCount: number;
    authenticated: boolean;
  };
  corpus: {
    records: number;
    searchable: number;
    essential: number;
    targets: {
      name: string;
      memoryId: string;
      title: string;
      aliases: string[];
      initialBody: string;
      correctedBody?: string;
    }[];
  };
  limits: { turns: number; turnDeadlineMs: number; responseBytes: number; toolTraceEntries: number };
  profile: string;
  promptReceipts: PromptReceipt[];
  turnInputReceipts: TurnInputReceipt[];
  directoryCurrentIdValidatedCases: string[];
  turns: TurnResult[];
  trace: Trace[];
  violations: string[];
  diagnostics: string[];
  cleanupComplete: boolean;
  limitations: string[];
}
const report: LiveReport = {
  schemaVersion: 1,
  runNonce: randomUUID(),
  status: "skipped",
  automatedPassed: false,
  manualResponseReview: "required",
  reason: "The live-model option was not supplied.",
  runtime: {
    bunVersion: process.versions.bun ?? null,
    nodeCompatibilityVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    cliVersion: null,
    cliSource: null,
    selectedModel: null,
    advertisedModelCount: 0,
    authenticated: false,
  },
  corpus: { records: 0, searchable: 0, essential: 0, targets: [] },
  limits: { turns: 6, turnDeadlineMs: TURN_DEADLINE_MS, responseBytes: RESPONSE_LIMIT_BYTES, toolTraceEntries: 160 },
  profile: PROFILE,
  promptReceipts: [],
  turnInputReceipts: [],
  directoryCurrentIdValidatedCases: [],
  turns: [],
  trace: [],
  violations: [],
  diagnostics: [],
  cleanupComplete: false,
  limitations: [
    "This is a manual opt-in run of one advertised Codex model on six requests and 128 synthetic facts. It is not a model comparison or a semantic recall benchmark.",
    "Assertions check real tool selection and current stored bodies. A person must review the six final answers for meaning, including the absent-fact answer.",
    "Each positive case requires the expected current fact through a directory hint and current-ID read, or through a validated literal-search row with the exact ID, owner, body and revision. The expected revision comes from the current memory domain immediately before the request. Literal rows are recorded separately from directory and current-ID evidence.",
    "The whole run must include at least one successful directory hint and matching current-ID read. A run that uses only literal search cannot pass the directory validation requirement.",
    "The normal product memory instructions and tool catalog remain in use. The synthetic profile asks for read-only memory work. An adapter refuses unrelated dynamic tools and approvals.",
    "Workspace only limits writes. It does not isolate reads or network access. Observed native action events stop this run; that event guard is not an OS isolation guarantee.",
    "Only an already configured ChatGPT account is used. The script does not read auth files, sign in, open a browser, use a password vault, or seed user data.",
    "The provider may retain its own synthetic thread history. The script removes only its temporary local store and workspace. It does not delete account history.",
    "No prices, token savings, VPS speed, external-source provenance, or general model-quality claims are derived from this run.",
  ],
};

for (const [name, value] of Object.entries(process.env)) {
  if (value && isSecretName(name)) registerSecretValue(value);
}

function registerPrivateFields(value: unknown, depth = 0): void {
  if (depth > 20) return;
  if (Array.isArray(value)) {
    for (const item of value) registerPrivateFields(item, depth + 1);
  } else if (isDynamicRecord(value)) {
    for (const [name, field] of Object.entries(value)) {
      if (isString(field) && (isSecretName(name) || name === "email")) registerSecretValue(field);
      else registerPrivateFields(field, depth + 1);
    }
  }
}
function safeText(value: string, limit = RESPONSE_LIMIT_BYTES): string {
  const bytes = Buffer.from(redactText(value), "utf8");
  return bytes.length <= limit ? bytes.toString("utf8") : `${bytes.subarray(0, limit).toString("utf8")} [truncated]`;
}
function cursorHash(value: string | null): string | null {
  return value ? createHash("sha256").update(value).digest("hex") : null;
}
function deadline<T>(operation: Promise<T>, name: string, milliseconds = TURN_DEADLINE_MS): Promise<T> {
  return new Promise<T>((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`Deadline: ${name}`)), milliseconds);
    operation.then(
      (value) => {
        clearTimeout(timer);
        done(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        fail(error);
      },
    );
  });
}
function completion(service: AgentService, agentId: string) {
  let resolveEvent: (event: Extract<AgentEvent, { type: "turn-completed" }>) => void = () => {};
  let rejectEvent: (error: Error) => void = () => {};
  const promise = new Promise<Extract<AgentEvent, { type: "turn-completed" }>>((done, fail) => {
    resolveEvent = done;
    rejectEvent = fail;
  });
  const listener = (event: AgentEvent) => {
    if (event.type === "turn-completed" && event.agentId === agentId) resolveEvent(event);
    else if (event.type === "error" && event.agentId === agentId)
      rejectEvent(new Error(`Product error: ${event.code}`));
    else if (event.type === "usage-limit-reached" && event.agentId === agentId)
      rejectEvent(new Error("The configured account reached its usage limit."));
    else if (event.type === "approval" || event.type === "prompt" || event.type === "browser-takeover-requested")
      rejectEvent(new Error("This run does not answer approvals or prompts."));
  };
  service.on("event", listener);
  return { promise, cancel: () => service.off("event", listener) };
}
function receipt(name: string, status: string): void {
  // Machine-readable: only fixture names and closed status labels, never account metadata.
  process.stdout.write(`${JSON.stringify({ fixture: "agent-memory-directory-live", case: name, status })}\n`);
}

class ObservedCodexClient extends EventEmitter implements AgentClient {
  readonly provider = "codex";
  readonly contextCompaction = "events";
  readonly advertised = new Set<string>();
  readonly #client: CodexAppServerClient;
  readonly #pending = new Map<RequestId, Trace>();
  activeCase = "initialization";
  authenticated = false;
  #violation: ((error: Error) => void) | null = null;

  constructor(executable: string, extraEnv?: Readonly<Record<string, string>>) {
    super();
    this.#client = new CodexAppServerClient(executable, 15_000, extraEnv);
    this.#client.on("request", this.#requestReceived);
    this.#client.on("notification", this.#notificationReceived);
    this.#client.on("diagnostic", this.#diagnosticReceived);
    this.#client.once("exit", this.#exitReceived);
  }
  get running(): boolean {
    return this.#client.running;
  }
  start(): void {
    this.#client.start();
  }
  readonly stop = Effect.fn("MemoryDirectoryLive.stop")(function* (this: ObservedCodexClient) {
    try {
      yield* this.#client.stop();
    } finally {
      this.#client.off("request", this.#requestReceived);
      this.#client.off("notification", this.#notificationReceived);
      this.#client.off("diagnostic", this.#diagnosticReceived);
      this.#client.off("exit", this.#exitReceived);
      this.#pending.clear();
    }
  });
  releaseThread(threadId: string) {
    return this.#client.releaseThread(threadId);
  }
  readHistory = (...args: Parameters<CodexAppServerClient["readHistory"]>) => this.#client.readHistory(...args);
  request<T>(method: string, params: unknown, decode: ResponseDecoder<T>, timeoutMs?: number) {
    if (method === "thread/start" || method === "thread/resume") {
      const instructions = getString(params, "developerInstructions") ?? "";
      const model = getString(params, "model");
      assert.equal(model, report.runtime.selectedModel, "The run must use its selected advertised model.");
      assert.ok(
        instructions.includes("Use openbot.search_memories when past preferences") &&
          instructions.includes("If literal search misses a relevant past fact"),
        "Use the normal product search and memory directory instructions.",
      );
      const tools = getArray(params, "dynamicTools");
      assert.equal(
        report.corpus.targets.some(
          (target) =>
            instructions.includes(target.initialBody) ||
            Boolean(target.correctedBody && instructions.includes(target.correctedBody)),
        ),
        false,
        "Searchable answers must not enter the developer prefix.",
      );
      if (method === "thread/start") {
        report.promptReceipts.push({
          model,
          reasoningEffort: getString(params, "effort"),
          developerInstructionsBytes: Buffer.byteLength(instructions, "utf8"),
          developerInstructionsSha256: createHash("sha256").update(instructions).digest("hex"),
          normalMemoryGuidance: instructions
            .split("\n")
            .filter(
              (line) =>
                line.startsWith("Use openbot.search_memories when past preferences") ||
                line.startsWith("If literal search misses a relevant past fact") ||
                line.startsWith("Other OpenBot and embedded browser tools"),
            ),
          dynamicToolSchemaBytes: Buffer.byteLength(JSON.stringify(tools), "utf8"),
        });
      }
    }
    if (method === "turn/start") {
      const input = JSON.stringify(getArray(params, "input"));
      const includesSyntheticAnswer = report.corpus.targets.some(
        (target) =>
          input.includes(target.initialBody) || Boolean(target.correctedBody && input.includes(target.correctedBody)),
      );
      report.turnInputReceipts.push({
        case: this.activeCase,
        inputBytes: Buffer.byteLength(input, "utf8"),
        inputSha256: createHash("sha256").update(input).digest("hex"),
        includesSyntheticAnswer,
      });
      assert.equal(includesSyntheticAnswer, false, "Do not seed answers into a natural turn request.");
    }
    return this.#client.request(
      method,
      params,
      (value) => {
        if (method === "account/read" || method === "config/read") registerPrivateFields(value);
        if (method === "account/read") this.authenticated = decodeAccountReadResult(value).account?.type === "chatgpt";
        if (method === "model/list") {
          for (const entry of decodeModelListResponse(value).data)
            if (isAgentModel(entry.model)) this.advertised.add(entry.model);
        }
        return decode(value);
      },
      timeoutMs,
    );
  }
  notify(method: string, params?: unknown): void {
    this.#client.notify(method, params);
  }
  respond(id: RequestId, value: unknown): void {
    const entry = this.#pending.get(id);
    if (entry) {
      entry.success = isDynamicRecord(value) && value.success === true;
      const text = getArray(value, "contentItems")
        .filter(isDynamicRecord)
        .filter((item) => item.type === "inputText")
        .map((item) => getString(item, "text") ?? "")
        .join("\n");
      entry.responseBytes = Buffer.byteLength(text, "utf8");
      entry.responseText = safeText(text, 16_384);
      if (entry.success) {
        try {
          const parsed = JSON.parse(text);
          const entries = getArray(parsed, "entries").filter(isDynamicRecord);
          entry.returnedIds = entries.flatMap((item) => (isString(item.memoryId) ? [item.memoryId] : []));
          if (entry.target === "openbot.search_memories") {
            assert.ok(isDynamicRecord(parsed) && Array.isArray(parsed.memories) && typeof parsed.hasMore === "boolean");
            const memories = getArray(parsed, "memories").map((row): LiteralMemoryRow => {
              assert.ok(isDynamicRecord(row) && isAgentMemory(row));
              const selection = {
                memoryId: row.id,
                inclusion: row.inclusion,
                userControlled: row.userControlled,
                revision: row.revision,
              };
              assert.ok(isAgentMemorySelection(selection));
              return {
                id: row.id,
                agentId: row.agentId,
                text: safeText(row.text),
                revision: selection.revision,
                inclusion: selection.inclusion,
                userControlled: selection.userControlled,
              };
            });
            entry.literalSearch = {
              query: getString(JSON.parse(entry.argumentsText), "query") ?? "",
              hasMore: parsed.hasMore,
              memories,
            };
          }
          if (
            entry.target === "openbot.list_memory_directory" &&
            isDynamicRecord(parsed) &&
            typeof parsed.scanned === "number" &&
            typeof parsed.hasMore === "boolean"
          ) {
            entry.directory = {
              query: entry.directoryRequest?.query ?? "",
              cursorSha256: entry.directoryRequest?.cursorSha256 ?? null,
              nextCursorSha256: cursorHash(getString(parsed, "nextCursor")),
              scanned: parsed.scanned,
              hasMore: parsed.hasMore,
              returnedIds: entry.returnedIds,
            };
          }
          const memory = getRecord(parsed, "memory");
          if (
            entry.target === "openbot.read_memory" &&
            getString(parsed, "status") === "ok" &&
            memory &&
            isString(memory.text)
          ) {
            const idValue =
              getString(memory, "id") ??
              getString(memory, "memoryId") ??
              getString(JSON.parse(entry.argumentsText), "memoryId");
            if (idValue) entry.currentRead = { id: idValue, text: safeText(memory.text) };
          }
        } catch {
          this.#fail("A successful memory tool returned an invalid response body.");
        }
      }
      this.#pending.delete(id);
    }
    this.#client.respond(id, value);
  }
  respondError(id: RequestId, error: RpcError): void {
    const entry = this.#pending.get(id);
    if (entry) {
      entry.success = false;
      entry.responseText = "Provider request failed.";
      this.#pending.delete(id);
    }
    this.#client.respondError(id, error);
  }
  violationSignal() {
    const promise = new Promise<never>((_done, fail) => {
      this.#violation = fail;
    });
    return {
      promise,
      cancel: () => {
        this.#violation = null;
      },
    };
  }
  #fail(message: string): void {
    if (report.violations.length < 20) report.violations.push(safeText(message, 1024));
    this.#violation?.(new Error(message));
  }
  readonly #requestReceived = (request: AppServerRequest): void => {
    if (request.method !== "item/tool/call" || !isDynamicToolCall(request.params)) {
      this.#client.respondError(request.id, {
        code: -32603,
        message: "This manual memory run does not answer this request.",
      });
      this.#fail("A provider requested an approval, prompt, or unsupported operation.");
      return;
    }
    const call = request.params;
    const target =
      call.tool === "tool_call" ? (getString(call.arguments, "name") ?? "") : `${call.namespace}.${call.tool}`;
    const discovery = call.namespace === "openbot" && (call.tool === "tool_search" || call.tool === "tool_describe");
    if (!discovery && !READ_TOOLS.has(target)) {
      this.#client.respondError(request.id, {
        code: -32603,
        message: "Only saved-memory reads are allowed in this manual run.",
      });
      this.#fail("The model requested an unrelated dynamic tool.");
      return;
    }
    if (report.trace.length >= report.limits.toolTraceEntries) {
      this.#client.respondError(request.id, { code: -32603, message: "The manual run reached its tool-call bound." });
      this.#fail("The model reached the tool-call bound.");
      return;
    }
    const argumentsValue = call.tool === "tool_call" ? (getRecord(call.arguments, "arguments") ?? {}) : call.arguments;
    const entry: Trace = {
      case: this.activeCase,
      tool: call.tool,
      target,
      argumentsText: safeText(JSON.stringify(argumentsValue) ?? "null", 4096),
      directoryRequest:
        target === "openbot.list_memory_directory"
          ? {
              query: getString(argumentsValue, "query") ?? "",
              cursorSha256: cursorHash(getString(argumentsValue, "cursor")),
            }
          : null,
      success: null,
      responseBytes: 0,
      responseText: "",
      returnedIds: [],
      currentRead: null,
      literalSearch: null,
      directory: null,
    };
    report.trace.push(entry);
    this.#pending.set(request.id, entry);
    this.emit("request", request);
  };
  readonly #notificationReceived = (notification: AppServerNotification): void => {
    if (notification.method === "model/rerouted")
      this.#fail("The provider reported model rerouting. No substitute model is accepted.");
    if (notification.method === "item/started" || notification.method === "item/completed") {
      const type = getString(getRecord(notification.params, "item"), "type");
      if (type && NATIVE_ACTIONS.has(type)) this.#fail(`The model used an out-of-scope native item: ${type}.`);
    }
    this.emit("notification", notification);
  };
  readonly #diagnosticReceived = (message: string): void => {
    if (report.diagnostics.length < 20) report.diagnostics.push(safeText(message, 1024));
    this.emit("diagnostic", safeText(message, 1024));
  };
  readonly #exitReceived = (): void => {
    this.emit("exit", new Error("The owned Codex process exited."));
  };
}

const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: () => Effect.die(new Error("No browser in this run.")),
  endTakeover: () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  resolveUploadTarget: () => Effect.die(new Error("No upload in this run.")),
  handleDynamicTool: () => Effect.die(new Error("No browser tool in this run.")),
};
const fixtures = [
  {
    name: "english-paraphrase",
    title: "Personal wiki hosting",
    aliases: ["hosting decision"],
    body: "The owner chose Boreal because it keeps data on the VPS.",
    request: "Why did I pick the place that hosts my personal wiki?",
  },
  {
    name: "korean-jeju",
    title: "가족 여행 결정",
    aliases: ["제주", "여행"],
    body: "11월 제주도로 가족 여행을 가기로 결정했다.",
    request: "제주 여행에 대해 내가 뭐라고 결정했지?",
  },
  {
    name: "japanese-tokyo",
    title: "来月の会議",
    aliases: ["東京"],
    body: "来月は東京で会議に参加します。",
    request: "東京での予定を確認して。",
  },
  {
    name: "chinese-wiki",
    title: "个人知识库",
    aliases: ["私人知识库"],
    body: "资料归档保存在个人服务器。",
    request: "我的私人知识库保存在哪里？",
  },
] as const;

let temporary: string | undefined;
let store: AgentStore | undefined;
let service: AgentService | undefined;
const clients: ObservedCodexClient[] = [];
const originalCodexPath = process.env.OPENBOT_CODEX_PATH;

async function runTurn(
  serviceValue: AgentService,
  client: ObservedCodexClient,
  agentId: string,
  input: {
    name: string;
    request: string;
    expectedId: string | null;
    expectedBody: string | null;
    literalControl?: boolean;
  },
): Promise<void> {
  const result: TurnResult = {
    name: input.name,
    request: input.request,
    expectedId: input.expectedId,
    expectedCurrentBody: input.expectedBody,
    expectedCurrentRevision: null,
    requiredEvidence: input.literalControl
      ? "literal-current-control"
      : input.expectedId
        ? "current-fact"
        : "absent-directory-scan",
    observedEvidence: null,
    directoryCurrentIdValidated: false,
    automatedPassed: false,
    assertionFailure: null,
    response: "",
    responseBytes: 0,
    completionStatus: null,
    counts: { search: 0, describe: 0, directory: 0, currentIdRead: 0, literalSearch: 0 },
  };
  report.turns.push(result);
  client.activeCase = input.name;
  const completed = completion(serviceValue, agentId);
  const violation = client.violationSignal();
  receipt(input.name, "started");
  try {
    const event = await deadline(
      Promise.race([
        (async () => {
          if (input.expectedId) {
            const metadata = serviceValue.getMemoryDirectoryMetadata({ agentId, memoryId: input.expectedId });
            assert.ok(metadata, "The expected synthetic fact must exist in the current memory domain.");
            result.expectedCurrentRevision = metadata.memoryRevision;
          }
          await runCauseEffect(serviceValue.sendMessage({ agentId, text: input.request, attachmentDraftIds: [] }));
          return completed.promise;
        })(),
        violation.promise,
      ]),
      input.name,
    );
    result.completionStatus = event.status;
    const snapshot = await runCauseEffect(serviceValue.readConversation(agentId));
    const messages = snapshot.messages.filter(
      (message) =>
        message.turnId === event.turnId &&
        message.author === "assistant" &&
        message.itemType !== "commentary" &&
        message.itemType !== "question_prompt" &&
        message.itemType !== CONVERSATION_PLAN_ITEM_TYPE,
    );
    result.response = safeText(messages.map((message) => message.text).join("\n"));
    result.responseBytes = Buffer.byteLength(messages.map((message) => message.text).join("\n"), "utf8");
    const trace = report.trace.filter((entry) => entry.case === input.name);
    result.counts = {
      search: trace.filter((entry) => entry.tool === "tool_search").length,
      describe: trace.filter((entry) => entry.tool === "tool_describe").length,
      directory: trace.filter((entry) => entry.target === "openbot.list_memory_directory").length,
      currentIdRead: trace.filter((entry) => entry.target === "openbot.read_memory").length,
      literalSearch: trace.filter((entry) => entry.target === "openbot.search_memories").length,
    };
    try {
      assert.equal(event.status, "completed", "The actual model turn must complete.");
      assert.ok(
        result.response.length > 0 && result.responseBytes <= RESPONSE_LIMIT_BYTES,
        "Keep the actual answer present and bounded.",
      );
      for (const entry of trace.filter((item) => item.directory))
        assert.ok(entry.responseBytes <= 4096, "Keep the real directory response within its product byte bound.");
      for (const entry of trace.filter((item) => item.target === "openbot.read_memory"))
        assert.ok(
          entry.responseBytes <= RESPONSE_LIMIT_BYTES,
          "Keep real current-ID reads within their product byte bound.",
        );
      for (const entry of trace.filter((item) => item.target === "openbot.search_memories"))
        assert.ok(
          entry.responseBytes <= RESPONSE_LIMIT_BYTES,
          "Keep real literal-search rows within their product byte bound.",
        );
      if (input.expectedId) {
        const directoryHint = trace.some((entry) => entry.directory?.returnedIds.includes(input.expectedId ?? ""));
        const currentIdRead = trace.some(
          (entry) =>
            entry.currentRead !== null &&
            entry.currentRead.id === input.expectedId &&
            entry.currentRead.text === input.expectedBody,
        );
        const literalCurrentRow =
          result.expectedCurrentRevision !== null &&
          trace.some((entry) =>
            entry.literalSearch?.memories.some(
              (row) =>
                row.id === input.expectedId &&
                row.agentId === agentId &&
                row.text === input.expectedBody &&
                row.revision === result.expectedCurrentRevision,
            ),
          );
        result.directoryCurrentIdValidated = directoryHint && currentIdRead;
        if (literalCurrentRow) result.observedEvidence = "literal-current-row";
        else {
          assert.ok(result.counts.directory > 0, "Observe actual directory discovery in this turn.");
          assert.ok(directoryHint, "The model must inspect the expected hint in this turn.");
          assert.ok(currentIdRead, "The selected actual ID must return the correct current body.");
          result.observedEvidence = "directory-current-id";
        }
      } else {
        assert.ok(result.counts.directory > 0, "Observe actual directory discovery in this turn.");
        assert.equal(
          trace.some((entry) => entry.currentRead !== null || Boolean(entry.literalSearch?.memories.length)),
          false,
          "No current fact supports the absent request.",
        );
        const queries = new Set(trace.flatMap((entry) => (entry.directory ? [entry.directory.query] : [])));
        const fullEmptyScan = [...queries].some((query) => {
          const pages = trace.flatMap((entry) => (entry.directory?.query === query ? [entry.directory] : []));
          let expectedCursor: string | null = null;
          let scanned = 0;
          let empty = true;
          for (const page of pages) {
            if (page.cursorSha256 === null) {
              expectedCursor = null;
              scanned = 0;
              empty = true;
            }
            if (page.cursorSha256 !== expectedCursor) {
              scanned = 0;
              empty = false;
            }
            scanned += page.scanned;
            empty = empty && page.returnedIds.length === 0;
            expectedCursor = page.nextCursorSha256;
            if (!page.hasMore && expectedCursor === null && empty && scanned === 128) return true;
          }
          return false;
        });
        assert.ok(
          fullEmptyScan,
          "An empty first page is insufficient: observe a complete filtered scan for the absent fact.",
        );
        result.observedEvidence = "empty-directory-scan";
      }
      result.automatedPassed = true;
    } catch (error) {
      result.assertionFailure = safeText(
        error instanceof Error ? error.message : "An evidence assertion failed.",
        1024,
      );
    }
    receipt(input.name, result.automatedPassed ? "tool-evidence-passed" : "tool-evidence-failed");
  } catch {
    result.assertionFailure =
      "The live turn did not complete within its bound, or its provider or workflow became unavailable.";
    receipt(input.name, "stopped");
    throw new Error("A live turn could not complete. Remaining turns were not sent.");
  } finally {
    completed.cancel();
    violation.cancel();
  }
}

try {
  if (process.argv.includes("--allow-live-model")) {
    assert.ok(CLI, "Supply the explicit path of the existing CLI. No runtime is selected implicitly.");
    receipt("initialization", "started");
    const cli = await runCauseEffect(resolveCodexCli({ systemCandidates: [CLI], bundledExecutable: null }));
    assert.equal(cli.executable, CLI, "Use only the specified existing CLI. Do not substitute a runtime.");
    report.runtime.cliVersion = cli.version;
    report.runtime.cliSource = cli.source;
    process.env.OPENBOT_CODEX_PATH = cli.executable;
    temporary = await mkdtemp(join(tmpdir(), "openbot-memory-directory-live-"));
    registerSecretValue(temporary);
    store = new AgentStore(join(temporary, "state"), join(temporary, "home"));
    await runCauseEffect(store.initialize());
    const mailbox = new MailboxStore(join(temporary, "state"), store.sharedRoot, store.database);
    service = new AgentService({
      store,
      mailbox,
      browser,
      preferredProvider: "codex",
      requestTimeoutMs: 15_000,
      clientFactory: (provider, resolvedCli, _confinement, extraEnv) => {
        assert.equal(provider, "codex");
        assert.equal(resolvedCli.executable, cli.executable);
        const client = new ObservedCodexClient(resolvedCli.executable, extraEnv);
        clients.push(client);
        return client;
      },
      bundledExecutables: { codex: null, claude: null, grok: null },
      offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
      developmentDefaults: false,
      agentMemoryLimit: () => 128,
    });
    await deadline(runCauseEffect(service.initialize()), "provider initialization");
    const provider = service.getStatus().providers?.find((candidate) => candidate.id === "codex");
    const client = clients.find((candidate) => candidate.running && candidate.authenticated);
    report.runtime.authenticated = Boolean(client && provider?.state === "available");
    if (!client || provider?.state !== "available") {
      report.reason =
        "The existing configured ChatGPT account or runtime is unavailable. No login was attempted and no turn was sent.";
    } else {
      const advertised = service
        .listModels()
        .filter((model) => model.provider === "codex" && client.advertised.has(model.id));
      const model = startingModel("codex", advertised, { provider: "codex", model: null });
      report.runtime.advertisedModelCount = advertised.length;
      if (!model) {
        report.reason = "The real provider did not advertise a product model. No fallback model or turn was used.";
      } else {
        report.runtime.selectedModel = model.id;
        const agent = await runCauseEffect(
          service.createAgentProfile({
            name: "Synthetic memory recall",
            description: PROFILE,
            avatarSeed: "synthetic-memory",
            avatarHue: null,
            provider: "codex",
            model: model.id,
          }),
        );
        await runCauseEffect(
          service.updateAgent({ agentId: agent.id, access: "workspace", computerUse: false, notifications: false }),
        );
        for (let index = 0; index < 128; index += 1)
          service.createMemory({
            agentId: agent.id,
            text: `Archive ${index}: synthetic topic${index} records an unrelated equipment decision.`,
          });
        const memories = service.listMemories(agent.id).sort((left, right) => left.id.localeCompare(right.id));
        const targets = memories.slice(-fixtures.length);
        for (const [index, fixture] of fixtures.entries()) {
          const target = targets[index];
          assert.ok(target);
          service.updateMemory({ agentId: agent.id, memoryId: target.id, text: fixture.body });
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
          report.corpus.targets.push({
            name: fixture.name,
            memoryId: target.id,
            title: fixture.title,
            aliases: [...fixture.aliases],
            initialBody: fixture.body,
          });
        }
        const selection = service.getMemorySelection(agent.id);
        assert.equal(selection.selections.filter((entry) => entry.inclusion === "essential").length, 0);
        report.corpus = {
          ...report.corpus,
          records: service.listMemories(agent.id).length,
          searchable: 128,
          essential: 0,
        };
        assert.equal(report.corpus.records, 128);
        report.status = "failed";
        report.reason = "The live run started. Final answers require manual review.";
        for (const [index, fixture] of fixtures.entries()) {
          const target = targets[index];
          assert.ok(target);
          await runTurn(service, client, agent.id, {
            name: fixture.name,
            request: fixture.request,
            expectedId: target.id,
            expectedBody: fixture.body,
          });
        }
        const travel = targets[1];
        assert.ok(travel);
        const correctedBody = "가족 여행은 부산으로 변경했다. 이유는 이동 시간이 짧기 때문이다.";
        service.updateMemory({ agentId: agent.id, memoryId: travel.id, text: correctedBody });
        const changed = service.getMemoryDirectoryMetadata({ agentId: agent.id, memoryId: travel.id });
        assert.ok(changed);
        service.setMemoryDirectoryMetadata({
          agentId: agent.id,
          memoryId: travel.id,
          expectedMemoryRevision: changed.memoryRevision,
          expectedAnnotationRevision: changed.annotationRevision,
          title: "가족 여행 결정",
          aliases: ["제주", "부산", "여행"],
        });
        const recordedTravel = report.corpus.targets[1];
        assert.ok(recordedTravel);
        recordedTravel.correctedBody = correctedBody;
        await runTurn(service, client, agent.id, {
          name: "corrected-current-fact",
          request: "전에 제주로 가려고 했던 가족 여행의 현재 결정과 이유를 확인해 줘.",
          expectedId: travel.id,
          expectedBody: correctedBody,
          literalControl: true,
        });
        await runTurn(service, client, agent.id, {
          name: "absent-fact",
          request: "What did I decide about renewing my flute insurance?",
          expectedId: null,
          expectedBody: null,
        });
        const discoveredNormally =
          report.trace.some((entry) => entry.tool === "tool_search" && entry.success) &&
          report.trace.some((entry) => entry.tool === "tool_describe" && entry.success);
        report.directoryCurrentIdValidatedCases = report.turns
          .filter((turn) => turn.automatedPassed && turn.directoryCurrentIdValidated)
          .map((turn) => turn.name);
        report.automatedPassed =
          report.turns.length === 6 &&
          report.turns.every((turn) => turn.automatedPassed) &&
          report.violations.length === 0 &&
          discoveredNormally &&
          report.directoryCurrentIdValidatedCases.length > 0 &&
          report.promptReceipts.length > 0;
        report.status = "completed";
        report.reason = report.automatedPassed
          ? "All six live turns completed and their tool evidence passed. Review final answers before making recall claims."
          : "All six live turns completed. Required current-fact evidence or overall directory validation is incomplete. Review the bounded actual outputs.";
        if (!report.automatedPassed) process.exitCode = 1;
      }
    }
  }
} catch {
  report.status = report.turns.length === 0 ? "skipped" : "failed";
  report.reason =
    report.turns.length === 0
      ? "The existing runtime, account, or advertised model could not be used. No live turn was sent and no login was attempted."
      : "The run stopped after a provider, deadline, or workflow failure. Remaining turns were not sent and no substitute model was used.";
  if (report.status === "failed") process.exitCode = 1;
} finally {
  let cleanupFailed = false;
  if (service) {
    try {
      await Effect.runPromise(
        service.stop().pipe(
          Effect.timeoutOrElse({
            duration: 20_000,
            orElse: () => Effect.die(new Error("Owned service cleanup reached its deadline.")),
          }),
        ),
      );
    } catch {
      cleanupFailed = true;
    }
  }
  for (const client of clients) {
    if (!client.running) continue;
    try {
      await Effect.runPromise(
        client.stop().pipe(
          Effect.timeoutOrElse({
            duration: 15_000,
            orElse: () => Effect.die(new Error("Owned provider cleanup reached its deadline.")),
          }),
        ),
      );
    } catch {
      cleanupFailed = true;
    }
  }
  try {
    store?.database.close();
    if (!cleanupFailed && clients.every((client) => !client.running) && temporary)
      await rm(temporary, { recursive: true, force: true });
  } catch {
    cleanupFailed = true;
  }
  report.cleanupComplete = !cleanupFailed && clients.every((client) => !client.running);
  if (!report.cleanupComplete) {
    report.status = "failed";
    report.automatedPassed = false;
    report.reason = "Owned resource cleanup failed. The report does not claim a clean run.";
    process.exitCode = 1;
  }
  if (originalCodexPath === undefined) delete process.env.OPENBOT_CODEX_PATH;
  else process.env.OPENBOT_CODEX_PATH = originalCodexPath;
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${redactText(JSON.stringify(report, null, 2))}\n`);
}
// Machine-readable: the report is fresh even for a skip or failure.
process.stdout.write(
  `${JSON.stringify({ fixture: "agent-memory-directory-live", status: report.status, automatedPassed: report.automatedPassed, manualResponseReview: report.manualResponseReview, turns: report.turns.length, report: join(OUT, "report.json") })}\n`,
);
