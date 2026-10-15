// Drives local serial conversations through real stores, services, native provider adapters and
// the desktop controller. Only provider processes, synthetic actors and owned roots are injected.
import assert from "node:assert/strict";
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { type FSWatcher, watch } from "node:fs";
import { appendFile, chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { AGENT_PROVIDERS } from "@openbot/contracts/agent-providers";
import {
  type AgentEvent,
  type AgentStatus,
  type AgentSummary,
  CONTEXT_RESET_ITEM_TYPE,
  type ConversationSearchPage,
  type ConversationSnapshot,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  type QueuedMessageReceipt,
  type VoiceTranscriptionResult,
} from "@openbot/contracts/ipc";
import type {
  AgentConversationActionInput,
  AgentConversationEvent,
  AgentConversationList,
  AgentConversationQueue,
  AgentConversationRead,
  AgentConversationTarget,
} from "@openbot/contracts/ipc-agent-conversations";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_V1_CAPABILITIES,
  TEAM_PROTOCOL_V1_WEBSOCKET,
  TEAM_PROTOCOL_VERSION_HEADER,
} from "@openbot/contracts/team-protocol/v1";
import {
  decodeTeamProtocolV1CurrentEvent,
  decodeTeamProtocolV1CurrentHttpResponse,
  encodeTeamProtocolV1CurrentEvent,
  encodeTeamProtocolV1CurrentHttpResponse,
} from "@openbot/contracts/team-protocol/v1-adapter";
import {
  decodeTeamProtocolV2CurrentHttpResponse,
  encodeTeamProtocolV2CurrentHttpResponse,
} from "@openbot/contracts/team-protocol/v2-adapter";
import { TEAM_PROTOCOL_V3_CAPABILITIES } from "@openbot/contracts/team-protocol/v3";
import {
  decodeTeamProtocolV3CurrentHttpResponse,
  encodeTeamProtocolV3CurrentHttpResponse,
} from "@openbot/contracts/team-protocol/v3-adapter";
import { TEAM_PROTOCOL_V4_CAPABILITIES } from "@openbot/contracts/team-protocol/v4";
import {
  decodeTeamProtocolV4CurrentHttpResponse,
  encodeTeamProtocolV4CurrentHttpResponse,
} from "@openbot/contracts/team-protocol/v4-adapter";
import { TEAM_PROTOCOL_V5_CAPABILITIES } from "@openbot/contracts/team-protocol/v5";
import {
  decodeTeamProtocolV5CurrentHttpResponse,
  encodeTeamProtocolV5CurrentHttpResponse,
} from "@openbot/contracts/team-protocol/v5-adapter";
import { TEAM_PROTOCOL_V6_CAPABILITIES } from "@openbot/contracts/team-protocol/v6";
import {
  decodeTeamProtocolV6CurrentHttpResponse,
  encodeTeamProtocolV6CurrentHttpResponse,
} from "@openbot/contracts/team-protocol/v6-adapter";
import { TEAM_PROTOCOL_V7_CAPABILITIES } from "@openbot/contracts/team-protocol/v7";
import {
  decodeTeamProtocolV7CurrentHttpResponse,
  encodeTeamProtocolV7CurrentHttpResponse,
} from "@openbot/contracts/team-protocol/v7-adapter";
import { redactText, registerSecretValue } from "@openbot/logging";
import { Deferred, Effect } from "effect";
import { type Browser, chromium } from "playwright-core";
import { WebSocket } from "ws";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { ProviderAccountStore } from "../src/backend/agent/provider-account-store";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient } from "../src/backend/agent-client";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { AttachmentFiles } from "../src/backend/attachment-files";
import { databaseRows, requiredStringColumn } from "../src/backend/database/database-rows";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { providerHistoryPersistence } from "../src/backend/provider-history-persistence";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
import {
  parseConversationAction,
  parseConversationCreate,
  parseConversationList,
  parseConversationRead,
  parseConversationSearch,
  parseConversationSend,
  parseConversationUpdate,
} from "../src/main/ipc/agent-conversation-inputs";
import type { TeamApiBrowser } from "../src/main/team-api/dependencies";
import { TeamApiServer } from "../src/main/team-api-server";
import { TeamStore } from "../src/main/team-store";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "agent-conversations-e2e");
const WAIT_MS = 15_000;
const STARTUP_MS = 60_000;
const ARTIFACT_WRITE_MS = 10_000;
const ARTIFACT_BYTES = 2 * 1024 * 1024;
const FIXTURE_VERSION = "agent-conversations-provider/1";
const sourcePaths = [
  "scripts/agent-conversations-e2e.ts",
  "scripts/agent-conversations-provider-fixture.mjs",
  "src/renderer/stories/agent-conversations-controller-fixture.tsx",
  "src/renderer/stories/AgentConversations.stories.tsx",
  ".storybook/preview.tsx",
  "src/renderer/src/i18n-context.tsx",
  "packages/i18n/src/messages/de/common.ts",
  "packages/i18n/src/messages/de/conversation.ts",
  "src/backend/agent-conversations/agent-conversation-schema.ts",
  "src/backend/agent-conversations/agent-conversation-store.ts",
  "src/backend/agent-conversations/agent-conversations.ts",
  "src/backend/agent-service.ts",
  "src/backend/agent-store.ts",
  "src/backend/mailbox-store.ts",
  "src/backend/mailbox-delivery-gate.ts",
  "src/backend/attachment-files.ts",
  "src/backend/openbot-database.ts",
  "src/backend/openbot-database-schema.ts",
  "src/backend/openbot-database-schema-history.json",
  "src/backend/database/database-core.ts",
  "src/backend/database/agent-roster.ts",
  "src/backend/database/mailbox-projection.ts",
  "src/backend/database/conversation-queries.ts",
  "src/backend/database/conversation-writer.ts",
  "src/backend/database/provider-sessions.ts",
  "src/backend/database/provider-history-store.ts",
  "src/backend/database/thread-summaries.ts",
  "src/backend/agent/conversation-runtime.ts",
  "src/backend/agent/conversation-reader.ts",
  "src/backend/agent/mailbox-sync.ts",
  "src/backend/agent/drain-scheduler.ts",
  "src/backend/agent/queue-controls.ts",
  "src/backend/agent/thread-lifecycle.ts",
  "src/backend/agent/boot-recovery.ts",
  "src/backend/agent/turn-lifecycle.ts",
  "src/backend/agent/attention-registry.ts",
  "src/backend/agent/agent-removal.ts",
  "src/backend/agent/provider-runtime.ts",
  "src/backend/agent/provider-account-store.ts",
  "src/backend/agent/duplication-gate.ts",
  "src/backend/agent/usage-limit-gate.ts",
  "src/backend/agent/routine-scheduler.ts",
  "src/backend/agent/routine-quiet-runs.ts",
  "src/backend/app-server-client.ts",
  "src/backend/acp-client.ts",
  "src/backend/acp-configuration.ts",
  "src/backend/grok-client.ts",
  "src/backend/protocol.ts",
  "src/backend/provider-drivers.ts",
  "src/backend/provider-history-persistence.ts",
  "src/backend/provider-history-import.ts",
  "src/backend/cli.ts",
  "src/backend/messaging/messaging-threads.ts",
  "src/backend/messaging/messaging-store.ts",
  "src/backend/channel-service.ts",
  "src/backend/channel-store.ts",
  "src/main/team-store.ts",
  "src/backend/conversation-read-store.ts",
  "src/main/team-api-server.ts",
  "src/main/team-api/dependencies.ts",
  "src/main/ipc/agent-conversation-handlers.ts",
  "src/main/ipc/agent-conversation-inputs.ts",
  "src/preload/agent-conversation-decoding.ts",
  "src/preload/agent-event-decoding.ts",
  "src/preload/conversation-decoding.ts",
  "packages/contracts/src/team-api-routes.ts",
  "src/renderer/src/app-message-projection.ts",
  "packages/contracts/src/ipc-agent-conversations.ts",
  "packages/contracts/src/ipc.ts",
  "packages/contracts/src/ipc-endpoints.ts",
  "src/renderer/src/features/conversation/agent-conversations-controller.ts",
  "src/renderer/src/features/conversation/WorkspaceConversation.tsx",
  "src/renderer/src/features/conversation/conversation-context.tsx",
  "src/renderer/src/features/conversation/conversation-types.ts",
  "src/renderer/src/features/conversation/conversation-keys.ts",
  "src/renderer/src/features/conversation/conversation-scope.ts",
  "src/renderer/src/features/conversation/conversation-runtime.ts",
  "src/renderer/src/features/conversation/stores/composer-store.ts",
  "src/renderer/src/features/conversation/stores/composer-actions.ts",
  "src/renderer/src/features/conversation/stores/pending-send-store.ts",
  "src/renderer/src/features/conversation/stores/queue-store.ts",
  "src/renderer/src/features/conversation/stores/voice-store.ts",
  "src/renderer/src/features/conversation/stores/scroll-store.ts",
  "src/renderer/src/features/conversation/stores/skills-store.ts",
  "src/renderer/src/features/conversation/stores/mcp-servers-store.ts",
  "packages/ui/src/features/conversation/AgentConversationsDialog.tsx",
  "packages/ui/src/features/conversation/styles/agent-conversations.css",
  "packages/ui/src/features/custom-providers/custom-providers.css",
  "packages/ui/src/styles/primitives.css",
  "packages/ui/src/item.tsx",
  "packages/ui/src/button.tsx",
  ...[1, 2, 3, 4, 5, 6, 7].flatMap((version) => [
    `packages/contracts/src/team-protocol/v${version}.ts`,
    `packages/contracts/src/team-protocol/v${version}-adapter.ts`,
  ]),
  ...[4, 5, 6, 7].flatMap((version) => [
    `packages/contracts/src/team-protocol/v${version}-base.ts`,
    `packages/contracts/src/team-protocol/v${version}-base-adapter.ts`,
  ]),
  "src/main/ipc/agent-template-inputs.ts",
  "src/main/ipc/provider-inputs.ts",
  "src/main/mcp-tool-runtime-preparation.ts",
  "src/main/ipc/agent-template-handlers.ts",
  "src/main/ipc/provider-handlers.ts",
  "src/main/ipc/mcp-server-handlers.ts",
  "src/main/team-api/route-agent-install.ts",
  "src/main/team-api/route-agent-publish.ts",
  "src/main/team-api/route-providers.ts",
  "src/main/team-api/route-mcp.ts",
];
interface Receipt {
  name: string;
  data: Record<string, string | number | boolean | string[] | null>;
}
interface CaseResult {
  id: number;
  name: string;
  status: "pending" | "running" | "passed" | "failed";
  receipts: Receipt[];
  error: string | null;
}
interface ProviderLog {
  provider: "codex" | "grok";
  pid: number;
  event: string;
  method?: string;
  sessionId?: string;
  turnId?: string;
  tag?: string;
  mode?: string;
  requestId?: string | number;
  markers?: string[];
  status?: string;
  nodeVersion?: string;
  errorCode?: number;
  error?: string;
  accountKey?: string;
}
interface FixtureReplyBarrier {
  method: string;
  threadId: string;
  editAction: string | null;
  failReply: boolean;
  used: boolean;
  reached: Deferred.Deferred<void>;
  released: Deferred.Deferred<void>;
}
interface FixtureTransferBarrier {
  reached: Deferred.Deferred<void>;
  released: Deferred.Deferred<void>;
  transferId: string | null;
}
interface MailboxIdentitySnapshot {
  messageIds: string[];
  deliveries: Array<{ id: string; messageId: string; recipientAgentId: string }>;
  destinations: Array<{ deliveryId: string; threadId: string }>;
}
interface NativeFaultCase {
  kind:
    | "wrong-code"
    | "code-type"
    | "wrong-id"
    | "missing-id"
    | "prefix"
    | "suffix"
    | "message-type"
    | "data"
    | "authorization"
    | "timeout"
    | "transport"
    | "exact-other-method";
  method: "thread/resume" | "turn/start";
}
interface FixtureBridgeBootstrap {
  agent: AgentSummary;
  status: AgentStatus;
  main: AgentConversationTarget;
  a: AgentConversationTarget;
  b: AgentConversationTarget;
}
interface FixtureAcknowledgement {
  acknowledged: true;
}
type FixtureBridgeReply =
  | FixtureBridgeBootstrap
  | FixtureAcknowledgement
  | AgentConversationList
  | AgentConversationTarget
  | AgentConversationRead
  | AgentConversationQueue
  | ConversationSearchPage
  | QueuedMessageReceipt
  | VoiceTranscriptionResult;
interface ControllerDraftReceipt {
  a: string;
  b: string;
  replyA: string | null;
  currentReply: string | null;
  target: string;
}
interface ControllerSendReceipt {
  captured: string;
  selected: string;
  bDraft: string;
}
interface ControllerRetryReceipt {
  clientMessageId: string;
  threadId: string;
}
interface ControllerPageReceipt {
  selected: string;
  aPageThread: string;
  bPageThread: string;
}
interface ControllerOlderReceipt {
  before: number;
  after: number;
  matchingIds: string[];
  selected: string;
}
interface ControllerEditReceipt {
  editingThreadId: string;
  selected: string;
  aDraft: string;
  bDraft: string;
  focusBefore: number;
  focusAfter: number;
  actionsBefore: boolean;
  actionsAfter: boolean;
}
interface ControllerCancelEditReceipt {
  editingThreadId: null;
  aDraft: string;
  bDraft: string;
}
interface ControllerSaveReceipt {
  savedThreadId: string;
  selected: string;
  aDraft: string;
}
interface ControllerReadReceipt {
  markedThreadId: string;
  selected: string;
}
interface ControllerVoiceReceipt {
  voiceThreadId: string;
  selected: string;
  aDraft: string;
  bDraft: string;
}
interface ControllerStopReceipt {
  stoppedThreadId: string;
  selected: string;
}
interface ControllerAttentionReceipt {
  selected: string;
  aAttention: string[];
}
interface ControllerInputReceipt {
  answeredThreadId: string;
  turnId: string;
  selected: string;
}
interface ControllerScrollState {
  top: number;
  stickToLatest: boolean;
}
interface ControllerScrollReceipt {
  aScroll: ControllerScrollState;
  bScroll: ControllerScrollState;
  selected: string;
}
interface ControllerReceipts {
  draft: ControllerDraftReceipt;
  send: ControllerSendReceipt;
  retry: ControllerRetryReceipt;
  page: ControllerPageReceipt;
  older: ControllerOlderReceipt;
  "stale-attention": ControllerAttentionReceipt;
  edit: ControllerEditReceipt;
  "cancel-edit": ControllerCancelEditReceipt;
  "save-edit": ControllerSaveReceipt;
  read: ControllerReadReceipt;
  voice: ControllerVoiceReceipt;
  stop: ControllerStopReceipt;
  input: ControllerInputReceipt;
  scroll: ControllerScrollReceipt;
}
type ControllerReceiptDecoder<Operation extends keyof ControllerReceipts> = (
  value: unknown,
) => ControllerReceipts[Operation];
function decodeControllerDraft(value: unknown): ControllerDraftReceipt {
  check(
    isDynamicRecord(value) &&
      isString(value.a) &&
      isString(value.b) &&
      (value.replyA === null || isString(value.replyA)) &&
      (value.currentReply === null || isString(value.currentReply)) &&
      isString(value.target),
    "draft receipt fields",
  );
  return { a: value.a, b: value.b, replyA: value.replyA, currentReply: value.currentReply, target: value.target };
}
function decodeControllerSend(value: unknown): ControllerSendReceipt {
  check(
    isDynamicRecord(value) && isString(value.captured) && isString(value.selected) && isString(value.bDraft),
    "send receipt fields",
  );
  return { captured: value.captured, selected: value.selected, bDraft: value.bDraft };
}
function decodeControllerRetry(value: unknown): ControllerRetryReceipt {
  check(isDynamicRecord(value) && isString(value.clientMessageId) && isString(value.threadId), "retry receipt fields");
  return { clientMessageId: value.clientMessageId, threadId: value.threadId };
}
function decodeControllerPage(value: unknown): ControllerPageReceipt {
  check(
    isDynamicRecord(value) && isString(value.selected) && isString(value.aPageThread) && isString(value.bPageThread),
    "page receipt fields",
  );
  return { selected: value.selected, aPageThread: value.aPageThread, bPageThread: value.bPageThread };
}
function decodeControllerOlder(value: unknown): ControllerOlderReceipt {
  check(
    isDynamicRecord(value) &&
      typeof value.before === "number" &&
      Number.isFinite(value.before) &&
      typeof value.after === "number" &&
      Number.isFinite(value.after) &&
      Array.isArray(value.matchingIds) &&
      value.matchingIds.every(isString) &&
      isString(value.selected),
    "older page and search receipt fields",
  );
  return { before: value.before, after: value.after, matchingIds: value.matchingIds, selected: value.selected };
}
function decodeControllerEdit(value: unknown): ControllerEditReceipt {
  check(
    isDynamicRecord(value) &&
      isString(value.editingThreadId) &&
      isString(value.selected) &&
      isString(value.aDraft) &&
      isString(value.bDraft) &&
      typeof value.focusBefore === "number" &&
      Number.isFinite(value.focusBefore) &&
      typeof value.focusAfter === "number" &&
      Number.isFinite(value.focusAfter) &&
      typeof value.actionsBefore === "boolean" &&
      typeof value.actionsAfter === "boolean",
    "queue Begin receipt fields",
  );
  return {
    editingThreadId: value.editingThreadId,
    selected: value.selected,
    aDraft: value.aDraft,
    bDraft: value.bDraft,
    focusBefore: value.focusBefore,
    focusAfter: value.focusAfter,
    actionsBefore: value.actionsBefore,
    actionsAfter: value.actionsAfter,
  };
}
function decodeControllerCancelEdit(value: unknown): ControllerCancelEditReceipt {
  check(
    isDynamicRecord(value) && value.editingThreadId === null && isString(value.aDraft) && isString(value.bDraft),
    "queue Cancel receipt fields",
  );
  return { editingThreadId: null, aDraft: value.aDraft, bDraft: value.bDraft };
}
function decodeControllerSave(value: unknown): ControllerSaveReceipt {
  check(
    isDynamicRecord(value) && isString(value.savedThreadId) && isString(value.selected) && isString(value.aDraft),
    "queue Save receipt fields",
  );
  return { savedThreadId: value.savedThreadId, selected: value.selected, aDraft: value.aDraft };
}
function decodeControllerRead(value: unknown): ControllerReadReceipt {
  check(
    isDynamicRecord(value) && isString(value.markedThreadId) && isString(value.selected),
    "read mark receipt fields",
  );
  return { markedThreadId: value.markedThreadId, selected: value.selected };
}
function decodeControllerVoice(value: unknown): ControllerVoiceReceipt {
  check(
    isDynamicRecord(value) &&
      isString(value.voiceThreadId) &&
      isString(value.selected) &&
      isString(value.aDraft) &&
      isString(value.bDraft),
    "voice receipt fields",
  );
  return { voiceThreadId: value.voiceThreadId, selected: value.selected, aDraft: value.aDraft, bDraft: value.bDraft };
}
function decodeControllerStop(value: unknown): ControllerStopReceipt {
  check(isDynamicRecord(value) && isString(value.stoppedThreadId) && isString(value.selected), "stop receipt fields");
  return { stoppedThreadId: value.stoppedThreadId, selected: value.selected };
}
function decodeControllerAttention(value: unknown): ControllerAttentionReceipt {
  check(
    isDynamicRecord(value) &&
      isString(value.selected) &&
      Array.isArray(value.aAttention) &&
      value.aAttention.every(isString),
    "stale attention receipt fields",
  );
  return { selected: value.selected, aAttention: value.aAttention };
}
function decodeControllerInput(value: unknown): ControllerInputReceipt {
  check(
    isDynamicRecord(value) && isString(value.answeredThreadId) && isString(value.turnId) && isString(value.selected),
    "input receipt fields",
  );
  return { answeredThreadId: value.answeredThreadId, turnId: value.turnId, selected: value.selected };
}
function decodeControllerScrollState(value: unknown): ControllerScrollState {
  check(
    isDynamicRecord(value) &&
      typeof value.top === "number" &&
      Number.isFinite(value.top) &&
      typeof value.stickToLatest === "boolean",
    "owned scroll state fields",
  );
  return { top: value.top, stickToLatest: value.stickToLatest };
}
function decodeControllerScroll(value: unknown): ControllerScrollReceipt {
  check(isDynamicRecord(value) && isString(value.selected), "scroll receipt fields");
  return {
    aScroll: decodeControllerScrollState(value.aScroll),
    bScroll: decodeControllerScrollState(value.bScroll),
    selected: value.selected,
  };
}
interface ConversationE2EReport {
  schemaVersion: number;
  runNonce: string;
  passed: boolean;
  sourceSha: string;
  sourceDigest: string;
  sourceManifest: Array<{ path: string; sha256: string }>;
  runtime: {
    bun: string | null;
    compatibilityVersion: string;
    node: string;
    providerNode: Set<string>;
    chromium: string;
    platform: NodeJS.Platform;
    architecture: string;
    providerFixture: string;
  };
  limits: {
    stateWaitMs: number;
    storybookStartupMs: number;
    providerRequestMs: number;
    artifactWriteMs: number;
    artifactBytes: number;
  };
  cases: CaseResult[];
  setupReceipts: Receipt[];
  timeout: boolean;
  failure: string | null;
  cleanupComplete: boolean;
  cleanupErrors: Array<{ resource: string; error: string }>;
  artifactErrors: string[];
  limitations: string[];
}
const cases: CaseResult[] = [
  "main data and independent subjects",
  "serial admission and steering",
  "destination idempotency and attachment binding",
  "atomic failure and post-transfer validation",
  "exact turn input and queue actions",
  "archive rename and restore",
  "restart and uncertain effects",
  "provider account handoff and runtime refresh",
  "shared messaging main and owned execution threads",
  "routine teammate and usage holds",
  "released Team routes and events",
  "real renderer controller and captured state",
  "duplicate and ordered deletion",
].map((name, index) => ({ id: index + 1, name, status: "pending", receipts: [], error: null }));
const report: ConversationE2EReport = {
  schemaVersion: 1,
  runNonce: randomUUID(),
  passed: false,
  sourceSha: "",
  sourceDigest: "",
  sourceManifest: [],
  runtime: {
    bun: process.versions.bun ?? null,
    compatibilityVersion: process.version,
    node: "",
    providerNode: new Set<string>(),
    chromium: "",
    platform: process.platform,
    architecture: process.arch,
    providerFixture: FIXTURE_VERSION,
  },
  limits: {
    stateWaitMs: WAIT_MS,
    storybookStartupMs: STARTUP_MS,
    providerRequestMs: 5_000,
    artifactWriteMs: ARTIFACT_WRITE_MS,
    artifactBytes: ARTIFACT_BYTES,
  },
  cases,
  setupReceipts: [],
  timeout: false,
  failure: null,
  cleanupComplete: false,
  cleanupErrors: [],
  artifactErrors: [],
  limitations: [
    "This fixture checks host routing and native adapter protocol behavior. It does not check live Codex or Grok model quality or real accounts.",
    "The Team probes use the real loopback Team server with synthetic local members. They do not establish public account, Signal or WebRTC sessions.",
    "Local controller receipts check real application stores and service calls. Microphone and speech recognition hardware are not used. Shared UI screenshots are local review artifacts and are not test assertions.",
  ],
};
const temporary = await mkdtemp(join(tmpdir(), "openbot-conversations-e2e-"));
const stateRoot = join(temporary, "state");
const homeRoot = join(temporary, "home");
const fixtureRoot = join(temporary, "provider");
registerSecretValue(temporary);
registerSecretValue(ROOT);
const changed = new EventEmitter();
let service: AgentService | undefined;
let store: AgentStore | undefined;
let mailbox: MailboxStore | undefined;
let database: OpenBotDatabase | undefined;
let accounts: ProviderAccountStore | undefined;
let host: TeamApiServer | undefined;
let bridge: Server | undefined;
let storybook: ChildProcess | undefined;
let browser: Browser | undefined;
let providerWatch: FSWatcher | undefined;
const clients: AgentClient[] = [];
const sockets: WebSocket[] = [];
const ownedProcesses = new Set<number>();
const events: AgentEvent[] = [];
const conversationEvents: AgentConversationEvent[] = [];
const environment = new Map<string, string | undefined>();
let transferCalls = 0;
let transferBarrier: FixtureTransferBarrier | null = null;
let currentCase: CaseResult | undefined;
let retainedChannel: { id: string; threadId: string; messageId: string } | null = null;
let unrelatedAgent: AgentSummary | null = null;
let fixtureAgentSequence = 0;

function check(condition: boolean, code: string): asserts condition {
  if (!condition) throw new Error(`Conversation check failed: ${code}.`);
}
function safe(error: unknown): string {
  return redactText(error instanceof Error ? error.message : String(error))
    .replaceAll(temporary, "[fixture-root]")
    .replaceAll(ROOT, "[worktree]")
    .slice(0, 8192);
}
function receipt(name: string, data: Receipt["data"]): void {
  currentCase?.receipts.push({ name, data });
}
function setEnv(name: string, value: string): void {
  if (!environment.has(name)) environment.set(name, process.env[name]);
  process.env[name] = value;
}
function unexpected(): never {
  throw new Error("This fixture refuses external browser, vault, desktop and integration work.");
}
const browserHost = {
  listTabs: () => [],
  getControlState: () => ({ sessions: [] }),
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  endTakeover: () => {},
  close: () => Effect.void,
  beginTakeover: unexpected,
  resolveUploadTarget: unexpected,
  handleDynamicTool: unexpected,
  open: unexpected,
  activate: unexpected,
  navigate: unexpected,
  reload: unexpected,
  capturePreview: unexpected,
  setVisible: unexpected,
  getDisplayState: unexpected,
  loadUrl: unexpected,
  isPrivate: () => false,
  startView: unexpected,
  dispatchViewInput: unexpected,
  copyViewSelection: unexpected,
} satisfies AgentBrowserHost & TeamApiBrowser;
async function within<T>(operation: Promise<T>, name: string, milliseconds = WAIT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_done, fail) => {
        timer = setTimeout(() => {
          report.timeout = true;
          fail(new Error(`Fixture deadline: ${name}.`));
        }, milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function finalize(resource: string, operation: () => Promise<void>): Promise<void> {
  try {
    await within(Promise.resolve().then(operation), resource);
  } catch (error) {
    report.cleanupErrors.push({ resource, error: safe(error) });
  }
}
async function writeArtifact(name: "report.json" | "storybook-safe.log", contents: string): Promise<void> {
  check(Buffer.byteLength(contents, "utf8") <= ARTIFACT_BYTES, "artifact fits the UTF-8 byte bound");
  check(
    !contents.includes(temporary) &&
      !contents.includes(JSON.stringify(temporary).slice(1, -1)) &&
      !contents.includes(ROOT) &&
      !contents.includes(JSON.stringify(ROOT).slice(1, -1)),
    "artifact contains no plain or escaped private roots",
  );
  await within(
    (async () => {
      await mkdir(OUT, { recursive: true });
      await writeFile(join(OUT, name), contents, { mode: 0o600 });
    })(),
    `bounded ${name} write`,
    ARTIFACT_WRITE_MS,
  );
}
async function closeHttp(server: Server): Promise<void> {
  server.closeAllConnections();
  if (!server.listening) return;
  await new Promise<void>((done, fail) =>
    server.close((error) => {
      if (!error || ("code" in error && error.code === "ERR_SERVER_NOT_RUNNING" && !server.listening)) done();
      else fail(error);
    }),
  );
}
async function waitState(test: () => boolean | Promise<boolean>, name: string): Promise<void> {
  let dispose = () => {};
  try {
    await within(
      new Promise<void>((done, fail) => {
        let reading = false;
        let again = false;
        let finished = false;
        const finish = (error?: unknown) => {
          if (finished) return;
          finished = true;
          changed.off("changed", inspect);
          error ? fail(error) : done();
        };
        async function inspect() {
          if (finished) return;
          if (reading) {
            again = true;
            return;
          }
          reading = true;
          try {
            if (await test()) finish();
          } catch (error) {
            finish(error);
          } finally {
            reading = false;
            if (again) {
              again = false;
              void inspect();
            }
          }
        }
        dispose = () => {
          finished = true;
          changed.off("changed", inspect);
        };
        changed.on("changed", inspect);
        void inspect();
      }),
      name,
    );
  } finally {
    dispose();
  }
}
async function providerLogs(): Promise<ProviderLog[]> {
  const rows = (await readFile(join(fixtureRoot, "provider.jsonl"), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line): ProviderLog => {
      const value = JSON.parse(line);
      if (
        !isDynamicRecord(value) ||
        (value.provider !== "codex" && value.provider !== "grok") ||
        typeof value.pid !== "number" ||
        !isString(value.event)
      )
        throw new Error("Invalid fixture provider receipt.");
      return {
        provider: value.provider,
        pid: value.pid,
        event: value.event,
        ...(isString(value.method) ? { method: value.method } : {}),
        ...(isString(value.sessionId) ? { sessionId: value.sessionId } : {}),
        ...(isString(value.turnId) ? { turnId: value.turnId } : {}),
        ...(isString(value.tag) ? { tag: value.tag } : {}),
        ...(isString(value.mode) ? { mode: value.mode } : {}),
        ...(typeof value.requestId === "number" || isString(value.requestId) ? { requestId: value.requestId } : {}),
        ...(Array.isArray(value.markers) && value.markers.every(isString) ? { markers: value.markers } : {}),
        ...(isString(value.status) ? { status: value.status } : {}),
        ...(isString(value.nodeVersion) ? { nodeVersion: value.nodeVersion } : {}),
        ...(typeof value.errorCode === "number" ? { errorCode: value.errorCode } : {}),
        ...(isString(value.error) ? { error: safe(value.error) } : {}),
        ...(isString(value.accountKey) ? { accountKey: value.accountKey } : {}),
      };
    });
  for (const row of rows) {
    if (row.event === "process-started") ownedProcesses.add(row.pid);
    if (row.nodeVersion) report.runtime.providerNode.add(row.nodeVersion);
  }
  return rows;
}
async function accepted(tag: string): Promise<ProviderLog> {
  await waitState(
    async () => (await providerLogs()).some((row) => row.event === "turn-accepted" && row.tag === tag),
    `provider acceptance ${tag}`,
  );
  const row = (await providerLogs()).find((entry) => entry.event === "turn-accepted" && entry.tag === tag);
  if (!row?.sessionId || !row.turnId) throw new Error("The provider acceptance lacks its session or turn.");
  return row;
}
async function command(action: string, sessionId?: string, pid?: number): Promise<void> {
  await appendFile(
    join(fixtureRoot, "commands.jsonl"),
    `${JSON.stringify({ action, ...(sessionId ? { sessionId } : {}), ...(pid ? { pid } : {}) })}\n`,
  );
}
function requireHost() {
  if (!service || !store || !mailbox || !database) throw new Error("The real fixture host is not open.");
  return { service, store, mailbox, database };
}
const target = (agent: AgentSummary, threadId: string): AgentConversationTarget => ({ agentId: agent.id, threadId });
function deliveryId(result: QueuedMessageReceipt): string {
  const row = result.deliveries[0];
  if (!row) throw new Error("The real enqueue receipt has no delivery.");
  return row.id;
}
function mailboxIdentitySnapshot(): MailboxIdentitySnapshot {
  const connection = requireHost().database.connection;
  return {
    messageIds: databaseRows(
      connection.prepare("SELECT message_id FROM projection_mailbox_messages ORDER BY message_id").all(),
    ).map((row) => requiredStringColumn(row, "message_id")),
    deliveries: databaseRows(
      connection
        .prepare("SELECT delivery_id, message_id, recipient_agent_id FROM projection_deliveries ORDER BY delivery_id")
        .all(),
    ).map((row) => ({
      id: requiredStringColumn(row, "delivery_id"),
      messageId: requiredStringColumn(row, "message_id"),
      recipientAgentId: requiredStringColumn(row, "recipient_agent_id"),
    })),
    destinations: databaseRows(
      connection.prepare("SELECT delivery_id, thread_id FROM agent_conversation_deliveries ORDER BY delivery_id").all(),
    ).map((row) => ({
      deliveryId: requiredStringColumn(row, "delivery_id"),
      threadId: requiredStringColumn(row, "thread_id"),
    })),
  };
}
function checkCompletedRetry(
  original: QueuedMessageReceipt,
  repeated: QueuedMessageReceipt,
  destination: AgentConversationTarget,
  before: MailboxIdentitySnapshot,
): void {
  const live = requireHost();
  check(
    original.messageId === repeated.messageId && original.deliveries.length > 0,
    "retry keeps the original message identity and deliveries",
  );
  const identities = (value: QueuedMessageReceipt) =>
    value.deliveries
      .map((row) => ({ id: row.id, recipientAgentId: row.recipientAgentId }))
      .sort((left, right) => left.id.localeCompare(right.id));
  assert.deepEqual(identities(repeated), identities(original));
  check(
    before.messageIds.filter((id) => id === original.messageId).length === 1,
    "one accepted SQLite mailbox message exists before retry",
  );
  assert.deepEqual(
    before.deliveries
      .filter((row) => row.messageId === original.messageId)
      .map((row) => ({ id: row.id, recipientAgentId: row.recipientAgentId })),
    identities(original),
  );
  const currentQueue = live.mailbox.listQueue(destination.agentId, destination.threadId);
  for (const row of repeated.deliveries) {
    const stored = live.mailbox.getDelivery(row.id)?.delivery;
    const projected = databaseRows(
      live.database.connection
        .prepare("SELECT message_id, recipient_agent_id, status FROM projection_deliveries WHERE delivery_id = ?")
        .all(row.id),
    );
    const persisted = projected[0];
    const current = currentQueue.deliveries.find((delivery) => delivery.id === row.id);
    check(
      row.recipientAgentId === destination.agentId &&
        stored !== undefined &&
        stored.messageId === original.messageId &&
        stored.recipientAgentId === row.recipientAgentId &&
        current !== undefined,
      "retry retains full mailbox message delivery and recipient identity",
    );
    check(
      projected.length === 1 &&
        persisted !== undefined &&
        requiredStringColumn(persisted, "message_id") === original.messageId &&
        requiredStringColumn(persisted, "recipient_agent_id") === row.recipientAgentId,
      "retry retains full SQLite delivery identity",
    );
    check(
      live.database.userConversations.deliveryThread(row.id) === destination.threadId &&
        live.mailbox.deliveryThreadId(row.id) === destination.threadId &&
        before.destinations.some(
          (binding) => binding.deliveryId === row.id && binding.threadId === destination.threadId,
        ),
      "retry retains the independently captured immutable destination binding",
    );
    check(
      row.status === stored.status &&
        row.status === current.status &&
        row.status === requiredStringColumn(persisted, "status") &&
        row.position === current.position,
      "retry lifecycle fields match current mailbox and SQLite state",
    );
    check(
      row.status === "completed" && row.position === null,
      "completed retry has current completed status and null queue position",
    );
  }
  assert.deepEqual(mailboxIdentitySnapshot(), before);
  receipt("completed retry contract", {
    messageId: repeated.messageId,
    deliveryIds: repeated.deliveries.map((row) => row.id),
    recipientAgentId: destination.agentId,
    threadId: destination.threadId,
    noNewMessageOrDelivery: true,
    immutableDestination: true,
    currentCompletedStatus: true,
    nullPosition: true,
  });
}
function snapshot(scope: AgentConversationTarget): ConversationSnapshot {
  return requireHost().database.readConversation(scope.agentId, scope.threadId);
}
async function send(
  scope: AgentConversationTarget,
  tag: string,
  mode = "complete",
  clientMessageId: string = randomUUID(),
  attachmentDraftIds: string[] = [],
) {
  const result = await runCauseEffect(
    requireHost().service.userConversations.send({
      ...scope,
      text: `subject-${tag} [fixture:${mode}:${tag}]`,
      clientMessageId,
      attachmentDraftIds,
    }),
  );
  receipt("send", {
    agentId: scope.agentId,
    threadId: scope.threadId,
    deliveryId: deliveryId(result),
    clientMessageId,
    tag,
  });
  return result;
}
async function terminal(result: QueuedMessageReceipt): Promise<void> {
  const id = deliveryId(result);
  await waitState(() => {
    const row = requireHost().mailbox.getDelivery(id)?.delivery;
    return Boolean(row && ["completed", "failed", "interrupted", "cancelled"].includes(row.status));
  }, `terminal delivery ${id}`);
}
async function observeTerminal(
  result: QueuedMessageReceipt,
  scope: AgentConversationTarget,
  tag: string,
): Promise<ConversationSnapshot> {
  const live = requireHost();
  const observed = snapshot(scope);
  const delivered = live.mailbox.getDelivery(deliveryId(result))?.delivery;
  const owner = live.store.list().find((row) => row.id === scope.agentId);
  const session = owner ? live.database.activeProviderSession(scope.threadId, owner.provider) : null;
  const protocol = (await providerLogs())
    .filter((row) => row.tag === tag || (session !== null && row.sessionId === session.externalSessionId))
    .slice(-16);
  receipt("terminal provider and snapshot observation", {
    agentId: scope.agentId,
    threadId: scope.threadId,
    messageId: result.messageId,
    deliveryId: deliveryId(result),
    deliveryStatus: delivered?.status ?? null,
    deliveryTurnId: delivered?.turnId ?? null,
    deliveryError: delivered?.error ? safe(delivered.error) : null,
    snapshotActiveTurnId: observed.activeTurnId,
    snapshotMessageIds: observed.messages.map((row) => row.id),
    snapshotMessageStatuses: observed.messages.map((row) => `${row.id}:${row.status}`),
    expectedAnswerFound: observed.messages.some((row) => row.text === `fixture-answer:${tag}`),
    activeProviderSessionId: session?.externalSessionId ?? null,
    providerEvents: protocol.map((row) => row.event),
    providerMethods: protocol.flatMap((row) => (row.method ? [row.method] : [])),
    providerErrors: protocol.flatMap((row) => (row.error ? [`${row.errorCode ?? "no-code"}:${row.error}`] : [])),
  });
  return observed;
}
async function complete(scope: AgentConversationTarget, tag: string) {
  const result = await send(scope, tag);
  await terminal(result);
  const observed = await observeTerminal(result, scope, tag);
  check(
    observed.messages.some((row) => row.text === `fixture-answer:${tag}`),
    `answer is in ${tag}`,
  );
  return result;
}
async function negativeCodexResumeCases(
  agent: AgentSummary,
  main: AgentConversationTarget,
  a: AgentConversationTarget,
  b: AgentConversationTarget,
): Promise<void> {
  const controls: NativeFaultCase[] = [
    { kind: "wrong-code", method: "thread/resume" },
    { kind: "code-type", method: "thread/resume" },
    { kind: "wrong-id", method: "thread/resume" },
    { kind: "missing-id", method: "thread/resume" },
    { kind: "prefix", method: "thread/resume" },
    { kind: "suffix", method: "thread/resume" },
    { kind: "message-type", method: "thread/resume" },
    { kind: "data", method: "thread/resume" },
    { kind: "authorization", method: "thread/resume" },
    { kind: "timeout", method: "thread/resume" },
    { kind: "transport", method: "thread/resume" },
    { kind: "exact-other-method", method: "turn/start" },
  ];
  for (const control of controls) {
    const sessionA = requireHost().database.activeProviderSession(a.threadId, "codex");
    const sessionB = requireHost().database.activeProviderSession(b.threadId, "codex");
    check(sessionA !== null && sessionB !== null, "negative native control starts with owned A and B sessions");
    const histories = [main, a, b].map((target) => ({
      target,
      messageIds: snapshot(target).messages.map((row) => row.id),
    }));
    const sessionIds = [main, a, b].map((target) => ({
      threadId: target.threadId,
      ids: requireHost()
        .database.listProviderSessions(target.threadId)
        .map((row) => row.id)
        .sort(),
    }));
    await stopHost();
    await boot();
    const faultPath = join(
      fixtureRoot,
      `fault-${createHash("sha256").update(`${control.method}\0${sessionA.externalSessionId}`).digest("hex")}.json`,
    );
    await within(
      writeFile(
        faultPath,
        JSON.stringify({
          nonce: report.runNonce,
          method: control.method,
          sessionId: sessionA.externalSessionId,
          kind: control.kind,
          used: false,
        }),
        { mode: 0o600 },
      ),
      "arm owned native fault control",
    );
    const logStart = (await providerLogs()).length;
    const tag = `native-negative-${control.kind}`;
    const clientId = randomUUID();
    try {
      const result = await send(a, tag, "complete", clientId);
      await terminal(result);
      await observeTerminal(result, a, tag);
      const actual = requireHost().mailbox.getDelivery(deliveryId(result))?.delivery;
      const rows = (await providerLogs()).slice(logStart);
      const startRequests = rows.filter(
        (row) =>
          row.provider === "codex" &&
          row.event === "request" &&
          row.method === "turn/start" &&
          row.sessionId === sessionA.externalSessionId,
      );
      receipt("native recovery negative control", {
        kind: control.kind,
        method: control.method,
        sessionId: sessionA.externalSessionId,
        deliveryId: deliveryId(result),
        deliveryStatus: actual?.status ?? null,
        faultConsumed: rows.filter(
          (row) =>
            row.event === "fault-consumed" &&
            row.sessionId === sessionA.externalSessionId &&
            row.method === control.method &&
            row.mode === control.kind,
        ).length,
        nativeTurnStartRequests: startRequests.length,
        nativeAcceptedTurns: rows.filter((row) => row.event === "turn-accepted" && row.tag === tag).length,
      });
      check(actual?.status === "failed", "unconfirmed native resume error fails the delivery without replacement");
      check(
        rows.filter(
          (row) =>
            row.event === "fault-consumed" &&
            row.sessionId === sessionA.externalSessionId &&
            row.method === control.method &&
            row.mode === control.kind,
        ).length === 1,
        "owned native negative fault is consumed exactly once",
      );
      check(
        startRequests.length === (control.method === "turn/start" ? 1 : 0),
        "resume refusal starts no turn and a rejected non-resume start is not repeated",
      );
      check(
        !rows.some((row) => row.event === "session-created" && row.provider === "codex") &&
          !rows.some((row) => row.event === "turn-accepted" && row.tag === tag),
        "unrelated native errors create no replacement session or accepted turn",
      );
      check(
        requireHost().database.activeProviderSession(a.threadId, "codex")?.id === sessionA.id &&
          requireHost().database.activeProviderSession(b.threadId, "codex")?.id === sessionB.id,
        "negative native recovery retains exact A and B private bindings",
      );
      check(
        requireHost()
          .store.list()
          .find((row) => row.id === agent.id)?.threadId === main.threadId &&
          requireHost()
            .database.listAgents()
            .find((row) => row.id === agent.id)?.threadId === main.threadId,
        "negative native recovery retains canonical Main in store and SQLite",
      );
      for (const previous of sessionIds)
        assert.deepEqual(
          requireHost()
            .database.listProviderSessions(previous.threadId)
            .map((row) => row.id)
            .sort(),
          previous.ids,
        );
      for (const history of histories) {
        const now = snapshot(history.target);
        for (const id of history.messageIds)
          check(
            now.messages.some((row) => row.id === id),
            "negative native error retains every existing public history ID",
          );
        if (history.target.threadId !== a.threadId)
          check(
            !now.messages.some((row) => row.id === deliveryId(result) || row.text.includes(tag)),
            "negative A delivery stays outside Main and B",
          );
      }
      const beforeRetry = mailboxIdentitySnapshot();
      const repeated = await send(a, tag, "complete", clientId);
      check(
        repeated.messageId === result.messageId && repeated.deliveries.length === result.deliveries.length,
        "failed native retry retains original message and delivery count",
      );
      const currentQueue = requireHost().mailbox.listQueue(a.agentId, a.threadId);
      for (const row of repeated.deliveries) {
        const queued = currentQueue.deliveries.find((delivery) => delivery.id === row.id);
        check(
          result.deliveries.some((prior) => prior.id === row.id && prior.recipientAgentId === row.recipientAgentId) &&
            row.status === "failed" &&
            row.position === null &&
            requireHost().mailbox.getDelivery(row.id)?.delivery.status === row.status &&
            queued !== undefined &&
            queued.status === row.status &&
            queued.position === row.position &&
            requireHost().database.userConversations.deliveryThread(row.id) === a.threadId,
          "failed native retry retains delivery recipient destination and current lifecycle state",
        );
      }
      assert.deepEqual(mailboxIdentitySnapshot(), beforeRetry);
      const afterRetry = (await providerLogs()).slice(logStart);
      check(
        afterRetry.filter(
          (row) =>
            row.provider === "codex" &&
            row.event === "request" &&
            row.method === "turn/start" &&
            row.sessionId === sessionA.externalSessionId,
        ).length === startRequests.length &&
          !afterRetry.some((row) => row.event === "turn-accepted" && row.tag === tag) &&
          !afterRetry.some((row) => row.event === "session-created" && row.provider === "codex"),
        "retry of failed native control starts no additional turn or replacement",
      );
    } finally {
      await finalize("owned native fault control", () => rm(faultPath, { force: true }));
    }
  }
}
async function refuse(operation: () => Promise<unknown>, name: string): Promise<void> {
  let refused = false;
  try {
    await operation();
  } catch (error) {
    refused = true;
    receipt(name, { refused: true, error: safe(error) });
  }
  check(refused, name);
}
async function stopHost(): Promise<void> {
  const old = service;
  if (old) await within(runCauseEffect(old.stop()), "real host stop");
  service = undefined;
  database?.close();
  database = undefined;
  store = undefined;
  mailbox = undefined;
}
async function boot(): Promise<void> {
  database = new OpenBotDatabase(stateRoot);
  store = new AgentStore(stateRoot, homeRoot, database);
  await runCauseEffect(store.initialize());
  accounts = new ProviderAccountStore(join(stateRoot, "accounts.json"), join(stateRoot, "accounts"));
  await runCauseEffect(accounts.load());
  const files = new AttachmentFiles({ userDataPath: stateRoot, sharedRoot: store.sharedRoot });
  mailbox = new MailboxStore(stateRoot, store.sharedRoot, database, {
    commitMessageTransfer: (...args) =>
      Effect.gen(function* () {
        const result = yield* files.commitMessageTransfer(...args);
        transferCalls++;
        const barrier = transferBarrier;
        if (barrier && args[5].length) {
          barrier.transferId = args[0];
          yield* Deferred.succeed(barrier.reached, undefined);
          yield* Deferred.await(barrier.released);
        }
        return result;
      }),
  });
  const currentDatabase = database;
  service = new AgentService({
    store,
    mailbox,
    browser: browserHost,
    preferredProvider: "codex",
    requestTimeoutMs: 5_000,
    providerAccounts: accounts,
    offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex" && provider !== "grok"),
    bundledExecutables: { codex: join(fixtureRoot, "codex"), grok: join(fixtureRoot, "grok"), claude: null },
    clientFactory: (provider, cli, confinement, accountEnvironment) => {
      check(provider === "codex" || provider === "grok", "only fixture providers");
      check(cli.executable === join(fixtureRoot, provider), "no provider executable fallback");
      const fixtureAccount = accountEnvironment?.CODEX_HOME
        ? createHash("sha256").update(accountEnvironment.CODEX_HOME).digest("hex")
        : "default";
      const context = {
        ...NO_PROVIDER_CREDENTIALS,
        accountEnvironment: {
          ...accountEnvironment,
          OPENBOT_CONVERSATION_FIXTURE_ROOT: fixtureRoot,
          OPENBOT_CONVERSATION_FIXTURE_PROVIDER: provider,
          OPENBOT_CONVERSATION_FIXTURE_ACCOUNT: fixtureAccount,
        },
        agentEnvironment: () => ({
          ...accountEnvironment,
          OPENBOT_CONVERSATION_FIXTURE_ROOT: fixtureRoot,
          OPENBOT_CONVERSATION_FIXTURE_PROVIDER: provider,
          OPENBOT_CONVERSATION_FIXTURE_ACCOUNT: fixtureAccount,
          GROK_HOME: join(fixtureRoot, "grok-home"),
        }),
        history: () => providerHistoryPersistence(currentDatabase, provider),
      };
      const client = requireProviderDriver(provider).createClient(cli, 5_000, context, confinement);
      clients.push(client);
      return client;
    },
    developmentDefaults: false,
  });
  const current = service;
  current.on("event", (event) => {
    events.push(event);
    changed.emit("changed");
  });
  current.on("conversationEvent", (event) => {
    conversationEvents.push(event);
    changed.emit("changed");
  });
  await within(runCauseEffect(current.initialize()), "real service initialization", STARTUP_MS);
  check(
    current
      .getStatus()
      .providers?.filter((row) => row.id === "codex" || row.id === "grok")
      .every((row) => row.state === "available") === true,
    "fixture providers available",
  );
}
async function createAgent(name: string, provider: "codex" | "grok" = "codex"): Promise<AgentSummary> {
  const live = requireHost();
  const tag = `initial-${provider}-${++fixtureAgentSequence}`;
  const initialMessage = `main-${tag} [fixture:complete:${tag}]`;
  const agent = await runCauseEffect(
    live.service.createAgent({
      name,
      description: "Synthetic assistant",
      avatarSeed: "fixture",
      avatarHue: null,
      initialMessage,
      provider,
      model: provider === "codex" ? "gpt-6-luna" : "grok-code-fast-1",
    }),
  );
  const delivery = live.mailbox.listQueue(agent.id).deliveries.find((row) => row.text === initialMessage);
  check(
    delivery !== undefined && delivery.recipientAgentId === agent.id && delivery.sender.kind === "user",
    "real initial user delivery belongs to the new agent",
  );
  const started = await accepted(tag);
  check(
    isString(started.sessionId) && isString(started.turnId) && started.provider === provider,
    "initial provider acceptance has the selected provider and native identity",
  );
  await waitState(() => {
    const current = live.store.list().find((row) => row.id === agent.id);
    return (
      current !== undefined &&
      isString(current.threadId) &&
      live.database.listAgents().find((row) => row.id === agent.id)?.threadId === current.threadId
    );
  }, `canonical created Main ${tag}`);
  const assigned = live.store.list().find((row) => row.id === agent.id);
  check(assigned !== undefined && isString(assigned.threadId), "current service-created agent has its canonical Main");
  const threadId = assigned.threadId;
  await waitState(
    async () =>
      (await providerLogs()).some(
        (row) =>
          row.event === "turn-finished" &&
          row.provider === provider &&
          row.tag === tag &&
          row.sessionId === started.sessionId &&
          row.turnId === started.turnId &&
          row.status === "completed",
      ),
    `provider initial completion ${tag}`,
  );
  await waitState(
    () =>
      live.mailbox.getDelivery(delivery.id)?.delivery.status === "completed" &&
      !live.mailbox.hasUnfinishedDelivery(agent.id) &&
      live.database.readActiveTurnId(agent.id, threadId) === null &&
      live.service.getRuntimeSnapshot().activeTurns.every((turn) => turn.agentId !== agent.id),
    `created agent idle ${tag}`,
  );
  check(
    live.database.activeProviderSession(threadId, provider)?.externalSessionId === started.sessionId,
    "initial native session belongs to the new Main",
  );
  check(
    live.database.readConversation(agent.id, threadId).messages.some((row) => row.text === `fixture-answer:${tag}`),
    "initial provider answer remains in the real Main history",
  );
  const completed = live.store.list().find((row) => row.id === agent.id);
  check(
    completed !== undefined &&
      completed.threadId === threadId &&
      live.database.listAgents().find((row) => row.id === agent.id)?.threadId === threadId,
    "completed initial message keeps the canonical store and SQLite Main",
  );
  report.setupReceipts.push({
    name: "real service initial completion",
    data: {
      agentId: agent.id,
      threadId,
      deliveryId: delivery.id,
      provider,
      sessionId: started.sessionId,
      turnId: started.turnId,
      tag,
      completed: true,
      idle: true,
    },
  });
  return completed;
}
async function createSubject(agent: AgentSummary, label: string): Promise<AgentConversationTarget> {
  return runCauseEffect(requireHost().service.userConversations.create({ agentId: agent.id, label }));
}
async function action(input: AgentConversationActionInput): Promise<void> {
  await runCauseEffect(requireHost().service.userConversations.action(input, "fixture-member"));
}
async function uploaded(name: string): Promise<string> {
  const path = join(temporary, `${name}.txt`);
  await writeFile(path, `Synthetic file ${name}\n`, { mode: 0o600 });
  const draft = (await runCauseEffect(requireHost().service.prepareAttachments([path])))[0];
  if (!draft) throw new Error("The actual upload did not make a draft.");
  return draft.id;
}
function armTransfer(): FixtureTransferBarrier {
  const barrier: FixtureTransferBarrier = {
    reached: Deferred.makeUnsafe<void>(),
    released: Deferred.makeUnsafe<void>(),
    transferId: null,
  };
  transferBarrier = barrier;
  return barrier;
}
async function releaseTransfer(barrier: NonNullable<typeof transferBarrier>): Promise<void> {
  transferBarrier = null;
  await Effect.runPromise(Deferred.succeed(barrier.released, undefined));
}
async function runCase(id: number, work: () => Promise<void>): Promise<void> {
  const item = cases[id - 1];
  if (!item) throw new Error("Unknown conversation case.");
  currentCase = item;
  item.status = "running";
  process.stdout.write(`${JSON.stringify({ case: id, status: "started" })}\n`);
  try {
    await work();
    item.status = "passed";
    process.stdout.write(`${JSON.stringify({ case: id, status: "passed", receipts: item.receipts.length })}\n`);
  } catch (error) {
    item.status = "failed";
    item.error = safe(error);
    throw error;
  }
}

try {
  await mkdir(fixtureRoot, { recursive: true, mode: 0o700 });
  await writeFile(join(fixtureRoot, "guard"), report.runNonce, { mode: 0o600 });
  await writeFile(join(fixtureRoot, "provider.jsonl"), "", { mode: 0o600 });
  await writeFile(join(fixtureRoot, "commands.jsonl"), "", { mode: 0o600 });
  const node = process.env.OPENBOT_E2E_NODE ?? "node";
  const nodeRuntime = await promisify(execFile)(node, ["--version"], { timeout: 5_000, maxBuffer: 4096 });
  report.runtime.node = nodeRuntime.stdout.trim();
  const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
  for (const provider of ["codex", "grok"] as const) {
    const launcher = join(fixtureRoot, provider);
    await writeFile(
      launcher,
      `#!/bin/sh\nexport OPENBOT_CONVERSATION_FIXTURE_PROVIDER=${provider}\nexec ${quote(node)} ${quote(join(ROOT, "scripts/agent-conversations-provider-fixture.mjs"))} "$@"\n`,
      { mode: 0o700 },
    );
    await chmod(launcher, 0o700);
  }
  for (const [name, value] of Object.entries({
    OPENBOT_CODEX_PATH: join(fixtureRoot, "codex"),
    OPENBOT_GROK_PATH: join(fixtureRoot, "grok"),
    CODEX_HOME: join(fixtureRoot, "codex-home"),
    GROK_HOME: join(fixtureRoot, "grok-home"),
    OPENBOT_CONVERSATION_FIXTURE_ROOT: fixtureRoot,
  }))
    setEnv(name, value);
  await mkdir(join(fixtureRoot, "codex-home"), { mode: 0o700 });
  await mkdir(join(fixtureRoot, "grok-home"), { mode: 0o700 });
  const hash = createHash("sha256");
  for (const path of sourcePaths) {
    const contents = await readFile(join(ROOT, path));
    report.sourceManifest.push({ path, sha256: createHash("sha256").update(contents).digest("hex") });
    hash.update(`${path}\0`);
    hash.update(contents);
    hash.update("\0");
  }
  report.sourceDigest = hash.digest("hex");
  report.sourceSha = (
    await promisify(execFile)("git", ["rev-parse", "HEAD"], { cwd: ROOT, timeout: 5_000, maxBuffer: 4096 })
  ).stdout.trim();
  providerWatch = watch(join(fixtureRoot, "provider.jsonl"), () => changed.emit("changed"));
  await boot();
  let agent = await createAgent("Synthetic personal assistant");
  const mainId = await runCauseEffect(requireHost().store.ensureThreadId(agent.id));
  agent =
    requireHost()
      .store.list()
      .find((row) => row.id === agent.id) ?? agent;
  const main = target(agent, mainId);
  let a = main;
  let b = main;
  let original = snapshot(main);
  let retryReceipt: QueuedMessageReceipt | null = null;
  let retryDraft = "";
  const retryClient = randomUUID();
  let retryTransferCalls = 0;

  await runCase(1, async () => {
    const draft = await uploaded("main-preserved-file");
    const result = await runCauseEffect(
      requireHost().service.sendMessage({
        agentId: agent.id,
        text: "main-preserved [fixture:complete:main-preserved]",
        attachmentDraftIds: [draft],
        clientMessageId: randomUUID(),
      }),
    );
    await terminal(result);
    await runCauseEffect(requireHost().service.clearAgentContext(agent.id));
    await runCauseEffect(requireHost().service.markConversationRead(agent.id, "fixture-member", deliveryId(result)));
    const oldReadState = (await runCauseEffect(requireHost().service.readConversationFor(agent.id, "fixture-member")))
      .readState;
    requireHost().database.saveThreadSummary(mainId, deliveryId(result), "main-preserved-summary", 12);
    original = requireHost().database.readConversation(agent.id, mainId);
    check(
      original.messages.some((row) => row.itemType === CONTEXT_RESET_ITEM_TYPE),
      "reset marker exists",
    );
    check(
      original.messages.some((row) => row.attachments?.length),
      "main uploaded attachment exists",
    );
    const rows = JSON.stringify(original.messages);
    const sessions = JSON.stringify(requireHost().database.listProviderSessions(mainId));
    a = await createSubject(agent, "Personal wiki");
    b = await createSubject(agent, "Travel plans");
    check(a.threadId !== b.threadId && a.threadId !== mainId && b.threadId !== mainId, "independent conversation ids");
    assert.equal(JSON.stringify(snapshot(main).messages), rows);
    assert.equal(JSON.stringify(requireHost().database.listProviderSessions(mainId)), sessions);
    assert.deepEqual(
      (await runCauseEffect(requireHost().service.readConversationFor(agent.id, "fixture-member"))).readState,
      oldReadState,
    );
    check(snapshot(a).messages.length === 0 && snapshot(b).messages.length === 0, "subjects start empty");
    const listed = await runCauseEffect(requireHost().service.userConversations.list({ agentId: agent.id }));
    check(listed.conversations.length === 3, "main plus two subjects");
    receipt("main preservation", {
      mainThreadId: mainId,
      aThreadId: a.threadId,
      bThreadId: b.threadId,
      oldMessageIds: original.messages.map((row) => row.id),
      sameWorkspace:
        requireHost()
          .store.list()
          .find((row) => row.id === agent.id)?.workspacePath === agent.workspacePath,
      summaryPreserved: requireHost().database.latestThreadSummary(mainId)?.text === "main-preserved-summary",
    });
  });
  await runCase(2, async () => {
    await runCauseEffect(requireHost().service.updateAgent({ agentId: agent.id, busyMessageMode: "steer" }));
    const ar = await send(a, "serial-a", "hold");
    const running = await accepted("serial-a");
    const br = await send(b, "serial-b");
    check(requireHost().mailbox.getDelivery(deliveryId(br))?.delivery.status === "queued", "B is queued behind A");
    check(
      !(await providerLogs()).some((row) => row.event === "turn-accepted" && row.tag === "serial-b"),
      "B was not a provider start",
    );
    check(
      !(await providerLogs()).some((row) => row.event === "steer" && row.markers?.includes("serial-b")),
      "B never steers A",
    );
    await runCauseEffect(requireHost().service.readConversation(agent.id));
    await command("finish", running.sessionId);
    await terminal(ar);
    await terminal(br);
    check(
      snapshot(a).messages.some((row) => row.text === "fixture-answer:serial-a"),
      "late answer belongs to A",
    );
    check(
      snapshot(b).messages.some((row) => row.text === "fixture-answer:serial-b"),
      "B answer belongs to B",
    );
    check(
      !JSON.stringify(snapshot(main)).includes("serial-a") && !JSON.stringify(snapshot(main)).includes("serial-b"),
      "main transcript is separate",
    );
    const held = await send(a, "steer-a", "hold");
    const runningSteer = await accepted("steer-a");
    const follow = await send(a, "steer-follow");
    await waitState(
      async () => (await providerLogs()).some((row) => row.event === "steer" && row.turnId === runningSteer.turnId),
      "same subject steer",
    );
    await command("finish", runningSteer.sessionId);
    await terminal(held);
    await terminal(follow);
    const grok = await createAgent("Synthetic unsupported steer", "grok");
    const gs = await createSubject(grok, "Grok subject");
    await runCauseEffect(requireHost().service.updateAgent({ agentId: grok.id, busyMessageMode: "steer" }));
    const first = await send(gs, "grok-hold", "hold");
    const g = await accepted("grok-hold");
    const second = await send(gs, "grok-follow");
    check(
      requireHost().mailbox.getDelivery(deliveryId(second))?.delivery.status === "queued",
      "unsupported steer keeps queue",
    );
    check(
      requireHost().mailbox.getDelivery(deliveryId(second))?.delivery.steerFallback === "provider-unsupported",
      "unsupported steer records reason",
    );
    await command("finish", g.sessionId);
    await terminal(first);
    await terminal(second);
    receipt("serial native adapters", {
      aTurnId: running.turnId ?? null,
      bDeliveryId: deliveryId(br),
      sameSubjectSteer: true,
      unsupportedFallback: true,
    });
  });
  await runCase(3, async () => {
    const shared = randomUUID();
    const ra = await send(a, "same-id-a", "complete", shared);
    const rb = await send(b, "same-id-b", "complete", shared);
    await terminal(ra);
    await terminal(rb);
    check(deliveryId(ra) !== deliveryId(rb), "same client id has independent destinations");
    retryDraft = await uploaded("retry-attachment");
    retryTransferCalls = transferCalls;
    retryReceipt = await send(a, "retry-a", "complete", retryClient, [retryDraft]);
    await terminal(retryReceipt);
    const before = transferCalls;
    const acceptedIdentity = mailboxIdentitySnapshot();
    const repeat = await send(a, "retry-a", "complete", retryClient, [retryDraft]);
    checkCompletedRetry(retryReceipt, repeat, a, acceptedIdentity);
    check(transferCalls === before, "accepted retry does not transfer twice");
    check(
      (await providerLogs()).filter((row) => row.event === "turn-accepted" && row.tag === "retry-a").length === 1,
      "accepted retry starts its native provider once",
    );
    const barrier = armTransfer();
    const emptyDraft = await uploaded("empty-text-upload");
    const empty = runCauseEffect(
      requireHost().service.userConversations.send({
        ...b,
        text: "",
        attachmentDraftIds: [emptyDraft],
        clientMessageId: randomUUID(),
      }),
    );
    await within(Effect.runPromise(Deferred.await(barrier.reached)), "real uploaded transfer barrier");
    await runCauseEffect(requireHost().service.userConversations.read({ ...main }, "fixture-member"));
    await releaseTransfer(barrier);
    const emptyResult = await empty;
    await terminal(emptyResult);
    const row = snapshot(b).messages.find((message) => message.id === deliveryId(emptyResult));
    check(row?.attachments?.length === 1, "empty text upload keeps captured B");
    check(
      !snapshot(main).messages.some((message) => message.id === deliveryId(emptyResult)),
      "target switch leaves main untouched",
    );
    receipt("idempotency", {
      aDeliveryId: deliveryId(ra),
      bDeliveryId: deliveryId(rb),
      retryDeliveryId: deliveryId(retryReceipt),
      transferCallsForRetry: before - retryTransferCalls,
      emptyDeliveryId: deliveryId(emptyResult),
      capturedThreadId: b.threadId,
    });
  });
  await runCase(4, async () => {
    const db = requireHost().database;
    const draft = await uploaded("atomic-failure");
    const baselineTransfers = await readdir(join(requireHost().store.sharedRoot, "Transfers"));
    db.connection.exec(
      "CREATE TEMP TRIGGER fixture_binding_failure BEFORE INSERT ON agent_conversation_deliveries BEGIN SELECT RAISE(ABORT, 'Synthetic binding failure'); END",
    );
    const client = randomUUID();
    await refuse(
      () =>
        runCauseEffect(
          requireHost().service.userConversations.send({
            ...a,
            text: "subject-atomic [fixture:complete:atomic]",
            attachmentDraftIds: [draft],
            clientMessageId: client,
          }),
        ),
      "atomic binding refusal",
    );
    db.connection.exec("DROP TRIGGER fixture_binding_failure");
    assert.deepEqual(await readdir(join(requireHost().store.sharedRoot, "Transfers")), baselineTransfers);
    check(!JSON.stringify(snapshot(a)).includes("subject-atomic"), "no staged message escapes failed binding");
    const retry = await runCauseEffect(
      requireHost().service.userConversations.send({
        ...a,
        text: "subject-atomic [fixture:complete:atomic]",
        attachmentDraftIds: [draft],
        clientMessageId: client,
      }),
    );
    await terminal(retry);
    const other = await createAgent("Synthetic foreign owner");
    const foreign = await createSubject(other, "Foreign subject");
    await refuse(
      () => send({ ...a, threadId: foreign.threadId }, "foreign-before"),
      "foreign destination before transfer",
    );
    const archived = await createSubject(agent, "Archived target");
    await runCauseEffect(requireHost().service.userConversations.update({ ...archived, archived: true }));
    await refuse(() => send(archived, "archive-before"), "archived destination before transfer");
    const lateArchive = await createSubject(agent, "Late archive");
    const archiveDraft = await uploaded("late-archive");
    const barrier = armTransfer();
    const pending = send(lateArchive, "late-archive", "complete", randomUUID(), [archiveDraft]);
    const outcome = pending.then(
      () => false,
      () => true,
    );
    await within(Effect.runPromise(Deferred.await(barrier.reached)), "archive transfer barrier");
    await runCauseEffect(requireHost().service.userConversations.update({ ...lateArchive, archived: true }));
    await releaseTransfer(barrier);
    check(await outcome, "archive after transfer is refused");
    check(
      barrier.transferId !== null &&
        !(await stat(join(requireHost().store.sharedRoot, "Transfers", barrier.transferId)).then(
          () => true,
          () => false,
        )),
      "archived transfer is removed",
    );
    check(snapshot(lateArchive).messages.length === 0, "late archived subject has no accepted row");
    const lateOwner = await createSubject(agent, "Late owner");
    const ownerDraft = await uploaded("late-owner");
    const ownerBarrier = armTransfer();
    const ownerPending = send(lateOwner, "late-owner", "complete", randomUUID(), [ownerDraft]);
    const ownerOutcome = ownerPending.then(
      () => false,
      () => true,
    );
    await within(Effect.runPromise(Deferred.await(ownerBarrier.reached)), "owner transfer barrier");
    db.connection
      .prepare("UPDATE projection_threads SET agent_id = ? WHERE thread_id = ?")
      .run(other.id, lateOwner.threadId);
    await releaseTransfer(ownerBarrier);
    check(await ownerOutcome, "foreign owner after transfer is refused");
    check(
      ownerBarrier.transferId !== null &&
        !(await stat(join(requireHost().store.sharedRoot, "Transfers", ownerBarrier.transferId)).then(
          () => true,
          () => false,
        )),
      "foreign-owner transfer is removed",
    );
    db.connection
      .prepare("UPDATE projection_threads SET agent_id = ? WHERE thread_id = ?")
      .run(agent.id, lateOwner.threadId);
    receipt("post transfer validation", {
      atomicDeliveryId: deliveryId(retry),
      noLeakedTransfer: true,
      archivedAfterTransferRefused: true,
      foreignAfterTransferRefused: true,
    });
  });
  await runCase(5, async () => {
    await runCauseEffect(requireHost().service.updateAgent({ agentId: agent.id, busyMessageMode: "queue" }));
    const ar = await send(a, "stop-a", "hold");
    const running = await accepted("stop-a");
    const br = await send(b, "edit-b", "hold");
    check(Boolean(running.turnId), "stop turn id exists");
    await refuse(() => action({ ...b, action: "stop", turnId: running.turnId ?? "missing" }), "wrong thread stop");
    await refuse(() => action({ ...a, action: "stop", turnId: "stale-turn" }), "stale turn stop");
    await refuse(() => action({ ...a, action: "cancel", deliveryId: deliveryId(br) }), "wrong thread queue cancel");
    await refuse(() => action({ ...a, action: "reorder", deliveryIds: [deliveryId(br)] }), "wrong thread reorder");
    const editId = randomUUID();
    await action({ ...b, action: "edit", edit: { action: "begin", deliveryId: deliveryId(br), editId } });
    await refuse(
      () =>
        action({
          ...a,
          action: "edit",
          edit: {
            action: "save",
            deliveryId: deliveryId(br),
            editId,
            text: "wrong subject",
            keepAttachmentIds: [],
            attachmentDraftIds: [],
          },
        }),
      "wrong thread edit save",
    );
    await action({
      ...b,
      action: "edit",
      edit: {
        action: "save",
        deliveryId: deliveryId(br),
        editId,
        text: "subject-edited-b [fixture:hold:edited-b]",
        keepAttachmentIds: [],
        attachmentDraftIds: [],
      },
    });
    await action({ ...a, action: "stop", turnId: running.turnId ?? "missing" });
    await terminal(ar);
    check(requireHost().mailbox.getDelivery(deliveryId(br))?.delivery.status !== "cancelled", "stop A preserves B");
    const edited = await accepted("edited-b");
    await refuse(() => action({ ...a, action: "stop", turnId: edited.turnId ?? "missing" }), "A cannot stop B");
    await action({ ...b, action: "stop", turnId: edited.turnId ?? "missing" });
    await terminal(br);
    const qr = await send(a, "question-a", "question");
    const q = await accepted("question-a");
    await waitState(
      () =>
        conversationEvents.some(
          (event) =>
            event.type === "conversation-event" && event.threadId === a.threadId && event.event.type === "prompt",
        ),
      "real provider question",
    );
    const read = await runCauseEffect(requireHost().service.userConversations.read(a, "fixture-member"));
    const prompt = read.attention.find((event) => event.type === "prompt");
    check(prompt?.type === "prompt", "scoped question is returned");
    const input = {
      action: "prompt" as const,
      turnId: q.turnId ?? "missing",
      requestId: prompt.requestId,
      answers: { "fixture-choice": ["Keep"] },
    };
    await runCauseEffect(requireHost().service.userConversations.read(b, "fixture-member"));
    await refuse(() => action({ ...b, ...input }), "wrong thread input");
    await refuse(() => action({ ...a, ...input, turnId: "stale-turn" }), "stale input turn");
    await refuse(
      () =>
        runCauseEffect(requireHost().service.respondToPrompt({ requestId: prompt.requestId, answers: input.answers })),
      "legacy input cannot answer added subject",
    );
    await action({ ...a, ...input });
    await terminal(qr);
    check(
      snapshot(a).messages.some((row) => row.text === "fixture-answer:question-a"),
      "correct input completes A",
    );
    const hold = await send(a, "cancel-hold", "hold");
    const h = await accepted("cancel-hold");
    const cancel = await send(b, "cancel-b");
    await action({ ...b, action: "cancel", deliveryId: deliveryId(cancel) });
    await terminal(cancel);
    await command("finish", h.sessionId);
    await terminal(hold);
    receipt("exact handles", {
      stoppedATurn: running.turnId ?? null,
      stoppedBTurn: edited.turnId ?? null,
      answeredTurn: q.turnId ?? null,
      promptRequestId: String(prompt.requestId),
      editedDeliveryId: deliveryId(br),
      cancelledDeliveryId: deliveryId(cancel),
    });
  });
  await runCase(6, async () => {
    const before = JSON.stringify(snapshot(b).messages);
    await runCauseEffect(requireHost().service.userConversations.update({ ...b, label: "November travel plan" }));
    const listed = await runCauseEffect(
      requireHost().service.userConversations.list({ agentId: agent.id, query: "November" }),
    );
    check(
      listed.conversations.some((row) => row.threadId === b.threadId),
      "renamed title filter",
    );
    await runCauseEffect(requireHost().service.userConversations.update({ ...b, archived: true }));
    const archived = await runCauseEffect(requireHost().service.userConversations.read(b, "fixture-member"));
    check(archived.summary.archivedAt !== null, "archived subject remains readable");
    assert.equal(JSON.stringify(snapshot(b).messages), before);
    await refuse(() => send(b, "archived-send"), "archived send refused");
    await runCauseEffect(requireHost().service.userConversations.update({ ...b, archived: false }));
    assert.equal(JSON.stringify(snapshot(b).messages), before);
    await complete(b, "restored-b");
    const held = await send(a, "archive-busy", "hold");
    const running = await accepted("archive-busy");
    await refuse(
      () => runCauseEffect(requireHost().service.userConversations.update({ ...a, archived: true })),
      "unfinished archive refused",
    );
    await command("finish", running.sessionId);
    await terminal(held);
    const question = await send(a, "archive-input", "question");
    await accepted("archive-input");
    await waitState(
      () =>
        conversationEvents.some(
          (event) =>
            event.type === "conversation-event" &&
            event.event.type === "prompt" &&
            event.event.turnId === requireHost().database.readActiveTurnId(a.agentId, a.threadId),
        ),
      "input before archive",
    );
    await refuse(
      () => runCauseEffect(requireHost().service.userConversations.update({ ...a, archived: true })),
      "input archive refused",
    );
    const prompt = (
      await runCauseEffect(requireHost().service.userConversations.read(a, "fixture-member"))
    ).attention.find((row) => row.type === "prompt");
    check(prompt?.type === "prompt", "archive question handle exists");
    await action({
      ...a,
      action: "prompt",
      turnId: prompt.turnId,
      requestId: prompt.requestId,
      answers: { "fixture-choice": ["Keep"] },
    });
    await terminal(question);
    receipt("restore", {
      threadId: b.threadId,
      oldMessageCount: JSON.parse(before).length,
      exactHistoryPreserved: true,
      busyAndInputArchiveRefused: true,
    });
  });
  await runCase(7, async () => {
    const mainBeforeRestart = requireHost()
      .store.list()
      .find((row) => row.id === agent.id)?.threadId;
    check(
      typeof mainBeforeRestart === "string" && mainBeforeRestart === mainId,
      "pre-restart main has its original ID",
    );
    check(
      requireHost()
        .database.listAgents()
        .find((row) => row.id === agent.id)?.threadId === mainBeforeRestart,
      "pre-restart main is stored in SQLite",
    );
    const held = await send(a, "restart-started-a", "hold");
    const startedA = await accepted("restart-started-a");
    const queued = await send(b, "restart-queued-b");
    const transfersBeforeRestart = transferCalls;
    const restartLogStart = (await providerLogs()).length;
    await stopHost();
    await boot();
    await terminal(held);
    await terminal(queued);
    check(
      (await providerLogs())
        .slice(restartLogStart)
        .some(
          (row) =>
            row.event === "request" && row.method === "thread/turns/list" && row.sessionId === startedA.sessionId,
        ),
      "recovery reads the exact A session",
    );
    const startedB = await accepted("restart-queued-b");
    check(
      startedB.sessionId === requireHost().database.activeProviderSession(b.threadId, "codex")?.externalSessionId,
      "queued restart prompt runs in B session",
    );
    check(
      requireHost()
        .store.list()
        .find((row) => row.id === agent.id)?.threadId === mainBeforeRestart,
      "restart never adopts subject as main",
    );
    check(
      requireHost().database.userConversations.threads(agent.id).includes(a.threadId),
      "A registry survives restart",
    );
    check(retryReceipt !== null, "accepted attachment retry receipt exists");
    const acceptedIdentity = mailboxIdentitySnapshot();
    const repeated = await send(a, "retry-a", "complete", retryClient, [retryDraft]);
    checkCompletedRetry(retryReceipt, repeated, a, acceptedIdentity);
    check(transferCalls === transfersBeforeRestart, "retry transfer count is stable across restart");
    check(
      (await providerLogs()).filter((row) => row.event === "turn-accepted" && row.tag === "retry-a").length === 1,
      "retry never starts provider twice",
    );
    const uncertain = await send(a, "restart-uncertain-a", "uncertain");
    const unconfirmed = await accepted("restart-uncertain-a");
    await stopHost();
    await boot();
    await terminal(uncertain);
    check(
      requireHost()
        .store.list()
        .find((row) => row.id === agent.id)?.threadId === mainBeforeRestart,
      "uncertain recovery retains the original main store identity",
    );
    check(
      requireHost()
        .database.listAgents()
        .find((row) => row.id === agent.id)?.threadId === mainBeforeRestart,
      "uncertain recovery retains the original main SQLite identity",
    );
    check(
      (await providerLogs()).filter((row) => row.event === "turn-accepted" && row.tag === "restart-uncertain-a")
        .length === 1,
      "uncertain start does not repeat",
    );
    check(
      requireHost().database.userConversations.deliveryThread(deliveryId(uncertain)) === a.threadId,
      "uncertain delivery keeps A",
    );
    check(!JSON.stringify(snapshot(main)).includes("restart-uncertain-a"), "uncertain recovery never enters main");
    const runtime = new ConversationRuntime(
      requireHost().store,
      () => {},
      () => requireHost().store.list(),
    );
    runtime.registerUserThread(agent.id, a.threadId);
    runtime.registerUserThread(agent.id, b.threadId);
    const mainAfterRestart = runtime.ensureSnapshot(agent.id, mainBeforeRestart);
    const aAfterRestart = runtime.ensureSnapshot(agent.id, a.threadId);
    const bAfterRestart = runtime.ensureSnapshot(agent.id, b.threadId);
    check(
      mainAfterRestart.threadId === mainBeforeRestart && runtime.loadedSnapshot(agent.id) === mainAfterRestart,
      "runtime keeps one original main snapshot after restart",
    );
    check(
      runtime.loadedExecutionSnapshot(a.threadId) === aAfterRestart &&
        aAfterRestart.threadId === a.threadId &&
        aAfterRestart !== mainAfterRestart,
      "A has one snapshot",
    );
    check(
      runtime.loadedExecutionSnapshot(b.threadId) === bAfterRestart &&
        bAfterRestart.threadId === b.threadId &&
        bAfterRestart !== mainAfterRestart &&
        bAfterRestart !== aAfterRestart,
      "B has one snapshot",
    );
    runtime.dispose();
    receipt("recovery", {
      startedDeliveryId: deliveryId(held),
      queuedDeliveryId: deliveryId(queued),
      uncertainDeliveryId: deliveryId(uncertain),
      uncertainTurnId: unconfirmed.turnId ?? null,
      mainThreadId: mainId,
      noRepeat: true,
    });
  });
  await runCase(8, async () => {
    const histories = new Map([a, b].map((scope) => [scope.threadId, snapshot(scope).messages.map((row) => row.id)]));
    await runCauseEffect(
      requireHost().service.updateAgent({ agentId: agent.id, provider: "grok", model: "grok-code-fast-1" }),
    );
    await complete(a, "handoff-a-grok");
    await complete(b, "handoff-b-grok");
    const grokA = await accepted("handoff-a-grok");
    const grokB = await accepted("handoff-b-grok");
    check(
      !grokA.markers?.some((marker) => marker.startsWith("subject-serial-b") || marker.startsWith("subject-edited-b")),
      "A handoff excludes B",
    );
    check(
      !grokB.markers?.some(
        (marker) => marker.startsWith("subject-serial-a") || marker.startsWith("subject-question-a"),
      ),
      "B handoff excludes A",
    );
    await runCauseEffect(
      requireHost().service.updateAgent({ agentId: agent.id, provider: "codex", model: "gpt-6-luna" }),
    );
    await complete(a, "handoff-a-codex");
    await complete(b, "handoff-b-codex");
    check(accounts !== undefined, "real account store exists");
    const account = await runCauseEffect(accounts.create("codex"));
    check(account !== null, "synthetic account slot exists");
    await runCauseEffect(requireHost().service.updateAgent({ agentId: agent.id, providerAccountId: account.id }));
    await complete(a, "account-a");
    await complete(b, "account-b");
    const accountA = requireHost().database.activeProviderSession(a.threadId, "codex");
    const accountB = requireHost().database.activeProviderSession(b.threadId, "codex");
    check(
      accountA !== null && accountB !== null && accountA.externalSessionId !== accountB.externalSessionId,
      "second account has distinct owned A and B private sessions",
    );
    await runCauseEffect(
      requireHost().service.updateAgent({ agentId: agent.id, providerAccountId: DEFAULT_PROVIDER_ACCOUNT_ID }),
    );
    check(
      requireHost().database.activeProviderSession(a.threadId, "codex") === null &&
        requireHost().database.activeProviderSession(b.threadId, "codex") === null,
      "account return retires the previous active subject sessions before new input",
    );
    for (const retired of [accountA, accountB])
      check(
        requireHost()
          .database.listProviderSessions(retired.threadId)
          .find((row) => row.id === retired.id)?.state === "inactive",
        "previous account session remains private inactive history",
      );
    await complete(a, "account-return-a");
    await complete(b, "account-return-b");
    const returnA = await accepted("account-return-a");
    const returnB = await accepted("account-return-b");
    check(
      isString(returnA.sessionId) &&
        isString(returnB.sessionId) &&
        returnA.sessionId !== accountA.externalSessionId &&
        returnB.sessionId !== accountB.externalSessionId &&
        returnA.sessionId !== returnB.sessionId,
      "return account creates distinct replacement native sessions",
    );
    check(
      returnA.markers?.includes("subject-account-a") === true && !returnA.markers.includes("subject-account-b"),
      "return account A handoff keeps only its own previous account history",
    );
    check(
      returnB.markers?.includes("subject-account-b") === true && !returnB.markers.includes("subject-account-a"),
      "return account B handoff keeps only its own previous account history",
    );
    const session = requireHost().database.activeProviderSession(a.threadId, "codex");
    check(session !== null, "A private session exists");
    const preservedB = requireHost().database.activeProviderSession(b.threadId, "codex");
    check(
      session.externalSessionId === returnA.sessionId &&
        preservedB !== null &&
        preservedB.externalSessionId === returnB.sessionId,
      "default account completion binds the exact accepted A and B sessions",
    );
    check(
      (requireHost()
        .store.list()
        .find((row) => row.id === agent.id)?.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID) ===
        DEFAULT_PROVIDER_ACCOUNT_ID,
      "actual agent uses the default account after completed return",
    );
    await negativeCodexResumeCases(agent, main, a, b);
    await rm(
      join(fixtureRoot, "sessions", `${createHash("sha256").update(session.externalSessionId).digest("hex")}.json`),
    );
    const missingLogStart = (await providerLogs()).length;
    await stopHost();
    await boot();
    check(
      requireHost().database.activeProviderSession(a.threadId, "codex")?.externalSessionId ===
        session.externalSessionId,
      "restart keeps the missing private session binding until native recovery",
    );
    await complete(a, "missing-session-a");
    const recoveredA = await accepted("missing-session-a");
    check(
      (await providerLogs())
        .slice(missingLogStart)
        .some(
          (row) =>
            row.event === "request" && row.method === "thread/resume" && row.sessionId === session.externalSessionId,
        ),
      "missing private session is refused through the actual native resume path",
    );
    check(
      isString(recoveredA.sessionId) &&
        recoveredA.sessionId !== session.externalSessionId &&
        requireHost().database.activeProviderSession(a.threadId, "codex")?.externalSessionId === recoveredA.sessionId,
      "missing private session recovery binds the exact replacement to A",
    );
    check(
      requireHost()
        .database.listProviderSessions(a.threadId)
        .find((row) => row.id === session.id)?.state === "inactive",
      "missing private session is retired without deleting public history",
    );
    check(
      requireHost().database.activeProviderSession(b.threadId, "codex")?.externalSessionId ===
        preservedB.externalSessionId &&
        requireHost()
          .store.list()
          .find((row) => row.id === agent.id)?.threadId === main.threadId,
      "missing A recovery preserves B session and original Main identity",
    );
    await runCauseEffect(requireHost().service.refreshAgentRuntime(agent.id));
    await complete(a, "runtime-refresh-a");
    const refreshedA = await accepted("runtime-refresh-a");
    check(
      isString(refreshedA.sessionId) &&
        refreshedA.sessionId !== recoveredA.sessionId &&
        requireHost().database.activeProviderSession(a.threadId, "codex")?.externalSessionId === refreshedA.sessionId,
      "explicit runtime refresh binds the exact replacement A provider context",
    );
    await runCauseEffect(
      requireHost().service.updateAgent({ agentId: agent.id, description: "Synthetic profile refresh" }),
    );
    await runCauseEffect(requireHost().service.refreshAllAgentRuntimes());
    await complete(b, "refresh-b");
    for (const scope of [a, b])
      for (const id of histories.get(scope.threadId) ?? [])
        check(
          snapshot(scope).messages.some((row) => row.id === id),
          "provider refresh retains old public message",
        );
    check(
      requireHost()
        .store.list()
        .find((row) => row.id === agent.id)?.workspacePath === agent.workspacePath,
      "switch keeps workspace",
    );
    receipt("handoff", {
      aThreadId: a.threadId,
      bThreadId: b.threadId,
      grokASession: grokA.sessionId ?? null,
      grokBSession: grokB.sessionId ?? null,
      accountSwitch: true,
      returnASession: returnA.sessionId ?? null,
      returnBSession: returnB.sessionId ?? null,
      missingASession: session.externalSessionId,
      recoveredASession: recoveredA.sessionId ?? null,
      missingPrivateSessionRecovered: true,
    });
  });
  // Cases 9 through 13 use the same production host. No new user data or provider account is used.
  await executionAndDefaultCases(agent, main, a, b);
  await releasedTeamCases(agent, main, a, b);
  await rendererCase(agent, main, a, b);
  await deletionCase(agent, main, a, b);
  report.passed = cases.every((item) => item.status === "passed");
} catch (error) {
  report.failure = safe(error);
  if (error instanceof Error && error.name === "TimeoutError") report.timeout = true;
} finally {
  if (transferBarrier) await finalize("attachment barrier", () => releaseTransfer(transferBarrier ?? armTransfer()));
  for (const socket of sockets)
    await finalize("Team socket", async () => {
      if (socket.readyState === WebSocket.CLOSED) return;
      const ended = once(socket, "close");
      socket.close();
      await ended;
    });
  if (browser) await finalize("owned headless browser", () => browser?.close() ?? Promise.resolve());
  if (storybook)
    await finalize("owned Storybook process", async () => {
      const owned = storybook;
      if (!owned || owned.exitCode !== null) return;
      const ended = once(owned, "exit");
      owned.kill("SIGTERM");
      await ended;
    });
  const remainingBridge = bridge;
  if (remainingBridge) await finalize("controller bridge", () => closeHttp(remainingBridge));
  if (host) await finalize("Team API host", () => runCauseEffect(host?.stop() ?? Effect.void));
  if (service) await finalize("real AgentService", stopHost);
  for (const client of clients) await finalize("provider adapter", () => runCauseEffect(client.stop()));
  providerWatch?.close();
  await finalize("provider process receipts", async () => {
    await providerLogs();
    for (const pid of ownedProcesses) {
      let running = false;
      try {
        process.kill(pid, 0);
        running = true;
      } catch {
        running = false;
      }
      check(!running, "owned fixture process stopped");
    }
  });
  if (database)
    await finalize("SQLite database", async () => {
      database?.close();
    });
  await finalize("owned temporary profile", () => rm(temporary, { recursive: true, force: true }));
  for (const [name, value] of environment) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  report.cleanupComplete = report.cleanupErrors.length === 0;
  report.passed = report.passed && report.cleanupComplete && report.artifactErrors.length === 0;
  let artifactWritten = false;
  try {
    const serialized = `${redactText(JSON.stringify({ ...report, runtime: { ...report.runtime, providerNode: [...report.runtime.providerNode] } }, null, 2))}\n`;
    await writeArtifact("report.json", serialized);
    artifactWritten = true;
  } catch (error) {
    report.artifactErrors.push(safe(error));
    report.passed = false;
  }
  process.stdout.write(
    `${JSON.stringify({ runNonce: report.runNonce, sourceSha: report.sourceSha, sourceDigest: report.sourceDigest, passed: report.passed, executed: cases.filter((row) => row.status !== "pending").length, passedCases: cases.filter((row) => row.status === "passed").length, cleanupComplete: report.cleanupComplete, artifactWritten, artifactComplete: artifactWritten && report.artifactErrors.length === 0, artifactErrors: report.artifactErrors.length > 0 })}\n`,
  );
  if (!report.passed) {
    process.stderr.write("The conversation E2E did not pass. Read its redacted report.\n");
    process.exitCode = 1;
  }
}

async function executionAndDefaultCases(
  agent: AgentSummary,
  main: AgentConversationTarget,
  a: AgentConversationTarget,
  b: AgentConversationTarget,
): Promise<void> {
  await runCase(9, async () => {
    const sharedAgent = await runCauseEffect(
      requireHost().store.createAgent({
        name: "Synthetic shared messaging main",
        description: "",
        avatarSeed: "shared",
        avatarHue: null,
        provider: "codex",
        model: "gpt-6-luna",
      }),
    );
    const messaging = requireHost().service.messaging;
    const connection = messaging.store.ensureConnection("discord", "fixture-workspace", "Synthetic workspace");
    messaging.store.updateConnection(connection.connectionId, { enabled: true });
    const shared = messaging.store.ensureLink({
      connectionId: connection.connectionId,
      agentId: sharedAgent.id,
      platformChannelId: "shared-channel",
      threadKey: "shared-main",
      isDirect: false,
      title: "Synthetic shared conversation",
    });
    requireHost().database.replaceAgents(
      `fixture:shared-main:${randomUUID()}`,
      requireHost()
        .store.list()
        .map((row) => (row.id === sharedAgent.id ? { ...row, threadId: shared.threadId } : row)),
      "thread.reclaimed",
    );
    requireHost().database.appendConversationMessage({
      agentId: sharedAgent.id,
      threadId: shared.threadId,
      activeTurnId: null,
      message: {
        id: "shared-old-in-app",
        author: "user",
        source: "user",
        text: "main-shared-in-app-history",
        status: "completed",
        createdAt: "2026-10-15T00:00:00.000Z",
      },
      eventType: "fixture.message",
    });
    requireHost().database.appendConversationMessage({
      agentId: sharedAgent.id,
      threadId: shared.threadId,
      activeTurnId: null,
      message: {
        id: "shared-old-external",
        author: "assistant",
        source: "assistant",
        text: "messaging-shared-external-history",
        status: "completed",
        createdAt: "2026-10-15T00:00:01.000Z",
      },
      eventType: "fixture.message",
    });
    await stopHost();
    await boot();
    const loaded = requireHost()
      .store.list()
      .find((row) => row.id === sharedAgent.id);
    check(loaded?.threadId === shared.threadId, "shared main retains old identity");
    const user = await createSubject(loaded, "Added shared-agent subject");
    await complete(user, "shared-added");
    const activities: Array<{ type: string; threadId: string; answer: string | null }> = [];
    const stopActivities = requireHost().service.messaging.onActivity((entry) => {
      activities.push({
        type: entry.type,
        threadId: entry.link.threadId,
        answer: entry.type === "finished" ? entry.answer : null,
      });
      changed.emit("changed");
    });
    const received = await runCauseEffect(
      requireHost().service.messaging.receive({
        connectionId: connection.connectionId,
        agentId: loaded.id,
        platformChannelId: "shared-channel",
        threadKey: "shared-main",
        isDirect: false,
        title: "Synthetic shared conversation",
        text: "messaging-shared-new [fixture:complete:shared-platform]",
        sourcePaths: [],
        origin: {
          authorId: "synthetic-author",
          authorName: "Synthetic member",
          platformMessageId: "shared-platform-message",
        },
        idempotencyKey: "fixture:messaging:shared",
      }),
    );
    check(received.status === "queued", "shared messaging delivery is accepted");
    await waitState(
      () => requireHost().mailbox.getDelivery(received.deliveryId)?.delivery.status === "completed",
      "shared platform completion",
    );
    await waitState(
      () => activities.some((entry) => entry.type === "finished" && entry.threadId === shared.threadId),
      "platform finish activity",
    );
    stopActivities();
    const sharedSnapshot = requireHost().database.readConversation(loaded.id, shared.threadId);
    check(
      sharedSnapshot.messages.some((row) => row.id === "shared-old-in-app") &&
        sharedSnapshot.messages.some((row) => row.id === "shared-old-external"),
      "shared old rows survive",
    );
    check(!JSON.stringify(sharedSnapshot).includes("shared-added"), "added subject stays outside shared main");
    const runtime = new ConversationRuntime(
      requireHost().store,
      () => {},
      () => requireHost().store.list(),
    );
    runtime.registerExecutionThread(loaded.id, shared.threadId);
    runtime.registerUserThread(loaded.id, user.threadId);
    check(!runtime.isExecutionThread(shared.threadId), "shared main has no duplicate execution snapshot");
    check(
      runtime.ensureSnapshot(loaded.id, shared.threadId) === runtime.snapshot(loaded.id),
      "shared main snapshot identity",
    );
    runtime.dispose();
    const distinct = requireHost().service.messaging.store.ensureLink({
      connectionId: connection.connectionId,
      agentId: agent.id,
      platformChannelId: "separate-channel",
      threadKey: "separate-messaging",
      isDirect: false,
      title: "Separate messaging history",
    });
    const distinctReceived = await runCauseEffect(
      requireHost().service.messaging.receive({
        connectionId: connection.connectionId,
        agentId: agent.id,
        platformChannelId: "separate-channel",
        threadKey: "separate-messaging",
        isDirect: false,
        title: "Separate messaging history",
        text: "messaging-separate [fixture:complete:separate-platform]",
        sourcePaths: [],
        origin: {
          authorId: "synthetic-author-two",
          authorName: "Synthetic second member",
          platformMessageId: "separate-platform-message",
        },
        idempotencyKey: "fixture:messaging:separate",
      }),
    );
    check(distinctReceived.status === "queued", "separate messaging delivery accepted");
    await waitState(
      () => requireHost().mailbox.getDelivery(distinctReceived.deliveryId)?.delivery.status === "completed",
      "separate messaging completion",
    );
    check(!JSON.stringify(snapshot(main)).includes("messaging-separate"), "separate messaging stays outside main");
    check(!JSON.stringify(snapshot(a)).includes("messaging-separate"), "separate messaging stays outside A");
    unrelatedAgent = await createAgent("Synthetic retained channel member");
    const channelId = randomUUID();
    const channelActor: { id: string; name: string } = {
      id: "fixture-channel-member",
      name: "Synthetic channel member",
    };
    await runCauseEffect(
      requireHost().service.channels.command(
        {
          type: "save",
          operationId: randomUUID(),
          channelId,
          draft: {
            name: "fixture-retained",
            title: "Synthetic retained channel",
            instructions: "Synthetic channel",
            members: [{ agentId: agent.id }, { agentId: unrelatedAgent.id }],
            leadAgentId: unrelatedAgent.id,
          },
        },
        channelActor,
      ),
    );
    const context = requireHost().service.channels.store.context(channelId, agent.id);
    const messageId = randomUUID();
    requireHost().database.persistConversationChanges({
      agentId: agent.id,
      threadId: context.threadId,
      activeTurnId: null,
      changedMessages: [
        {
          id: messageId,
          author: "user",
          source: "user",
          text: "channel-retained-history",
          status: "completed",
          createdAt: "2026-10-15T00:01:00.000Z",
        },
      ],
      eventType: "fixture.channel-message",
    });
    retainedChannel = { id: channelId, threadId: context.threadId, messageId };
    await stopHost();
    await boot();
    check(
      requireHost()
        .store.list()
        .find((row) => row.id === agent.id)?.threadId === main.threadId,
      "channel and messaging never become main",
    );
    check(
      requireHost()
        .database.readConversation(agent.id, context.threadId)
        .messages.some((row) => row.id === messageId),
      "channel history survives restart",
    );
    check(
      requireHost().database.userConversations.threads(agent.id).includes(a.threadId) &&
        requireHost().database.userConversations.threads(agent.id).includes(b.threadId),
      "added rows retain their registry identity",
    );
    receipt("execution ownership", {
      sharedMainThreadId: shared.threadId,
      sharedAgentId: loaded.id,
      separateMessagingThreadId: distinct.threadId,
      channelThreadId: context.threadId,
      addedThreadId: user.threadId,
      platformCompletion: true,
    });
  });
  await runCase(10, async () => {
    await runCauseEffect(
      requireHost().service.updateAgent({ agentId: agent.id, allowAutomation: true, busyMessageMode: "queue" }),
    );
    const routine = requireHost().service.createRoutine({
      agentId: agent.id,
      name: "Synthetic quiet routine",
      instruction: "routine-quiet-main [fixture:quiet:quiet-main]",
      active: false,
      timezone: "UTC",
      schedule: { kind: "hourly", minute: 0 },
    });
    const held = await send(a, "routing-hold-a", "hold");
    const active = await accepted("routing-hold-a");
    const routineRun = await runCauseEffect(
      requireHost().service.runRoutineFromAutomation({
        agentId: agent.id,
        routineId: routine.id,
        payload: "Synthetic local scheduler event",
      }),
    );
    check(routineRun.status === "queued", "routine remains queued behind A");
    await command("finish", active.sessionId);
    await terminal(held);
    await waitState(
      () =>
        requireHost()
          .service.listRoutineRuns({ agentId: agent.id, routineId: routine.id })
          .some((row) => row.id === routineRun.id && row.status === "succeeded"),
      "quiet routine completion",
    );
    check(
      !snapshot(main).messages.some((row) => row.author === "assistant" && row.text.trim() === "[[no-update]]"),
      "quiet no-update answer has no visible message",
    );
    check(unrelatedAgent !== null, "teammate fixture exists");
    const teammate = await runCauseEffect(
      requireHost().mailbox.enqueue({
        sender: { kind: "agent", agentId: unrelatedAgent.id },
        recipientAgentIds: [agent.id],
        text: "teammate-main-message [fixture:complete:teammate-main]",
        idempotencyKey: "fixture:teammate:main",
        expectsReply: false,
      }),
    );
    const wake = await runCauseEffect(
      requireHost().service.sendMessage({
        agentId: agent.id,
        text: "main-teammate-wake [fixture:complete:teammate-wake]",
        clientMessageId: randomUUID(),
      }),
    );
    await terminal(teammate);
    await terminal(wake);
    check(
      !JSON.stringify(snapshot(a)).includes("routine-quiet-main") &&
        !JSON.stringify(snapshot(a)).includes("teammate-main-message"),
      "defaults never enter A",
    );
    check(
      snapshot(main).messages.some((row) => row.text.includes("teammate-main-message")),
      "teammate default is main",
    );
    const usageAgent = await createAgent("Synthetic usage held assistant");
    const usageSubject = await createSubject(usageAgent, "Usage subject");
    const usageClient = randomUUID();
    const refused = await send(usageSubject, "usage-limit", "usage", usageClient);
    const refusedStart = await accepted("usage-limit");
    await waitState(
      () =>
        requireHost().mailbox.getDelivery(deliveryId(refused))?.delivery.status === "queued" &&
        requireHost().mailbox.getDelivery(deliveryId(refused))?.delivery.turnId === null &&
        requireHost()
          .service.getRuntimeSnapshot()
          .usageLimits?.some((row) => row.agentId === usageAgent.id) === true &&
        !requireHost()
          .service.getRuntimeSnapshot()
          .activeTurns.some((row) => row.agentId === usageAgent.id),
      "usage refusal restores the exact accepted delivery to a held queue",
    );
    const heldByUsage = await send(usageSubject, "usage-queued");
    await waitState(
      () =>
        requireHost()
          .service.getRuntimeSnapshot()
          .usageLimits?.some((row) => row.agentId === usageAgent.id) === true &&
        requireHost().mailbox.getDelivery(deliveryId(heldByUsage))?.delivery.status === "queued",
      "actual usage hold",
    );
    check(
      requireHost().mailbox.getDelivery(deliveryId(heldByUsage))?.delivery.status === "queued",
      "usage holds accepted queue",
    );
    check(
      !(await providerLogs()).some((row) => row.event === "turn-accepted" && row.tag === "usage-queued"),
      "usage held work never starts",
    );
    check(
      (await providerLogs()).filter((row) => row.event === "turn-accepted" && row.tag === "usage-limit").length === 1 &&
        refusedStart.accountKey === "default",
      "refused work has one native acceptance on the held default account",
    );
    const beforeRetry = mailboxIdentitySnapshot();
    const heldRetry = await send(usageSubject, "usage-limit", "usage", usageClient);
    check(
      heldRetry.messageId === refused.messageId &&
        deliveryId(heldRetry) === deliveryId(refused) &&
        heldRetry.deliveries.length === refused.deliveries.length,
      "held retry keeps the original accepted message and delivery",
    );
    const heldQueue = requireHost().service.userConversations.queue(usageSubject).snapshot;
    for (const row of heldRetry.deliveries) {
      const current = heldQueue.deliveries.find((delivery) => delivery.id === row.id);
      check(
        refused.deliveries.some(
          (original) => original.id === row.id && original.recipientAgentId === row.recipientAgentId,
        ) &&
          current !== undefined &&
          row.status === "queued" &&
          row.status === current.status &&
          row.position === current.position &&
          row.recipientAgentId === usageAgent.id,
        "held same-ID receipt retains full identity and current queue position",
      );
    }
    for (const original of [refused, heldByUsage]) {
      const queued = heldQueue.deliveries.find((row) => row.id === deliveryId(original));
      check(
        queued !== undefined &&
          queued.status === "queued" &&
          queued.messageId === original.messageId &&
          queued.recipientAgentId === usageAgent.id &&
          queued.turnId === null &&
          requireHost().database.userConversations.deliveryThread(queued.id) === usageSubject.threadId,
        "usage hold preserves exact message delivery recipient and destination without active work",
      );
    }
    assert.deepEqual(mailboxIdentitySnapshot(), beforeRetry);
    check(
      (await providerLogs()).filter((row) => row.event === "turn-accepted" && row.tag === "usage-limit").length === 1 &&
        !(await providerLogs()).some((row) => row.event === "turn-accepted" && row.tag === "usage-queued"),
      "same-ID retry issues no native work while the account is held",
    );
    check(
      (await providerLogs()).filter(
        (row) => row.event === "request" && row.method === "turn/start" && row.sessionId === refusedStart.sessionId,
      ).length === 1,
      "usage hold issues no repeated native start request",
    );
    receipt("usage hold", {
      agentId: usageAgent.id,
      threadId: usageSubject.threadId,
      refusedMessageId: refused.messageId,
      refusedDeliveryId: deliveryId(refused),
      followingDeliveryId: deliveryId(heldByUsage),
      firstNativeSession: refusedStart.sessionId ?? null,
      firstNativeTurn: refusedStart.turnId ?? null,
      exactQueuedIdentity: true,
      noNativeRetryBeforeAccountSwitch: true,
    });
    // A different synthetic provider account clears the account-specific fixture limit. No sign-in is done.
    check(accounts !== undefined, "account store for limit recovery");
    const freshAccount = await runCauseEffect(accounts.create("codex"));
    check(freshAccount !== null, "new synthetic account for later cases");
    const freshActor = createHash("sha256").update(accounts.home(freshAccount)).digest("hex");
    await runCauseEffect(
      requireHost().service.updateAgent({ agentId: usageAgent.id, providerAccountId: freshAccount.id }),
    );
    await terminal(refused);
    await terminal(heldByUsage);
    await observeTerminal(refused, usageSubject, "usage-limit");
    await observeTerminal(heldByUsage, usageSubject, "usage-queued");
    const resumed = (await providerLogs()).filter((row) => row.event === "turn-accepted" && row.tag === "usage-limit");
    const resumedStart = resumed[1];
    check(
      resumed.length === 2 &&
        resumedStart !== undefined &&
        resumedStart.accountKey === freshActor &&
        resumedStart.sessionId !== refusedStart.sessionId &&
        isString(resumedStart.turnId) &&
        resumedStart.turnId !== refusedStart.turnId,
      "the exact refused work resumes once with a fresh native turn on the new account",
    );
    check(
      requireHost()
        .store.list()
        .find((row) => row.id === usageAgent.id)?.providerAccountId === freshAccount.id,
      "resumed usage work uses the actual newly selected account",
    );
    check(
      (await providerLogs()).filter(
        (row) => row.event === "turn-accepted" && row.tag === "usage-queued" && row.accountKey === freshActor,
      ).length === 1,
      "following held work starts once on the new account",
    );
    check(
      requireHost().mailbox.getDelivery(deliveryId(refused))?.delivery.status === "completed" &&
        requireHost().mailbox.getDelivery(deliveryId(heldByUsage))?.delivery.status === "completed",
      "both original held deliveries complete after the account switch",
    );
    for (const tag of ["usage-limit", "usage-queued"])
      check(
        snapshot(usageSubject).messages.filter((row) => row.text === `fixture-answer:${tag}`).length === 1,
        "held work produces one visible answer after resumption",
      );
    check(
      requireHost().database.userConversations.deliveryThread(deliveryId(refused)) === usageSubject.threadId &&
        requireHost().database.userConversations.deliveryThread(deliveryId(heldByUsage)) === usageSubject.threadId,
      "resumption keeps both immutable subject bindings",
    );
    const completedIdentity = mailboxIdentitySnapshot();
    const completedRetry = await send(usageSubject, "usage-limit", "usage", usageClient);
    checkCompletedRetry(refused, completedRetry, usageSubject, completedIdentity);
    check(
      (await providerLogs()).filter((row) => row.event === "turn-accepted" && row.tag === "usage-limit").length === 2,
      "completed usage retry does not run the resumed work again",
    );
    check(
      requireHost()
        .service.getRuntimeSnapshot()
        .usageLimits?.some((row) => row.agentId === usageAgent.id) !== true,
      "new account releases the usage agent's hold",
    );
    await runCauseEffect(requireHost().service.updateAgent({ agentId: agent.id, providerAccountId: freshAccount.id }));
    await complete(b, "after-usage-other-account");
    receipt("default routing", {
      routineRunId: routineRun.id,
      routineId: routine.id,
      mainThreadId: main.threadId,
      teammateDeliveryId: deliveryId(teammate),
      usageHeldDeliveryId: deliveryId(heldByUsage),
      usageRefusedDeliveryId: deliveryId(refused),
      usageResumedSession: resumedStart.sessionId ?? null,
      sameHeldWorkResumedOnce: true,
      noCrossSubjectBatch: true,
    });
  });
}
async function releasedTeamCases(
  agent: AgentSummary,
  main: AgentConversationTarget,
  a: AgentConversationTarget,
  b: AgentConversationTarget,
): Promise<void> {
  await runCase(11, async () => {
    const sidebar = new SidebarLayoutStore(join(stateRoot, "sidebar.json"));
    await runCauseEffect(sidebar.initialize());
    const team = new TeamStore(join(stateRoot, "team.json"));
    await runCauseEffect(team.initialize());
    await runCauseEffect(
      team.configure("Synthetic conversation host", "fixture-owner", "synthetic-conversation-password"),
    );
    const owner = await runCauseEffect(team.login("fixture-owner", "synthetic-conversation-password"));
    registerSecretValue(owner.sessionToken);
    host = new TeamApiServer({
      store: team,
      agents: requireHost().service,
      mailbox: requireHost().mailbox,
      browser: browserHost,
      sidebarLayout: sidebar,
      appVersion: "0.0.0",
    });
    const port = await runCauseEffect(host.start());
    const origin = `http://127.0.0.1:${port}`;
    const codecs = [
      { version: 1, encode: encodeTeamProtocolV1CurrentHttpResponse, decode: decodeTeamProtocolV1CurrentHttpResponse },
      { version: 2, encode: encodeTeamProtocolV2CurrentHttpResponse, decode: decodeTeamProtocolV2CurrentHttpResponse },
      { version: 3, encode: encodeTeamProtocolV3CurrentHttpResponse, decode: decodeTeamProtocolV3CurrentHttpResponse },
      { version: 4, encode: encodeTeamProtocolV4CurrentHttpResponse, decode: decodeTeamProtocolV4CurrentHttpResponse },
      { version: 5, encode: encodeTeamProtocolV5CurrentHttpResponse, decode: decodeTeamProtocolV5CurrentHttpResponse },
      { version: 6, encode: encodeTeamProtocolV6CurrentHttpResponse, decode: decodeTeamProtocolV6CurrentHttpResponse },
      { version: 7, encode: encodeTeamProtocolV7CurrentHttpResponse, decode: decodeTeamProtocolV7CurrentHttpResponse },
    ];
    const frames = new Map<number, string[]>();
    const protocolCapabilities = (version: number): readonly string[] =>
      (version >= 7
        ? TEAM_PROTOCOL_V7_CAPABILITIES
        : version === 6
          ? TEAM_PROTOCOL_V6_CAPABILITIES
          : version === 5
            ? TEAM_PROTOCOL_V5_CAPABILITIES
            : version === 4
              ? TEAM_PROTOCOL_V4_CAPABILITIES
              : version === 3
                ? TEAM_PROTOCOL_V3_CAPABILITIES
                : TEAM_PROTOCOL_V1_CAPABILITIES
      ).filter((value) => value !== "agent-runtime-snapshots");
    const headers = (version: number) => ({
      Authorization: `Bearer ${owner.sessionToken}`,
      [TEAM_APP_VERSION_HEADER]: "0.0.0",
      [TEAM_PROTOCOL_VERSION_HEADER]: String(version),
      [TEAM_CAPABILITIES_HEADER]: protocolCapabilities(version).join(","),
    });
    for (const codec of codecs) {
      const compatibility = await (
        await fetch(`${origin}${TEAM_API_ROUTES.compatibility}`, { headers: headers(codec.version) })
      ).json();
      check(
        isDynamicRecord(compatibility) &&
          Array.isArray(compatibility.capabilities) &&
          compatibility.capabilities.length <= 128 &&
          !compatibility.capabilities.includes("agent-conversations-v1"),
        "local feature adds no Team capability",
      );
      for (const suffix of ["conversation", "queue"]) {
        const path = `/v1/agents/${agent.id}/${suffix}`;
        const response = await fetch(`${origin}${path}`, { headers: headers(codec.version) });
        check(response.ok, `released ${codec.version} ${suffix} response`);
        const wire = await response.json();
        const decoded = codec.decode("GET", path, response.status, wire);
        const encoded = codec.encode("GET", path, response.status, decoded);
        const roundTrip = codec.decode(
          "GET",
          path,
          response.status,
          typeof encoded === "string" ? JSON.parse(encoded) : encoded,
        );
        assert.deepEqual(roundTrip, decoded);
        check(
          !JSON.stringify(decoded).includes(a.threadId) && !JSON.stringify(decoded).includes(b.threadId),
          "released route excludes subject ids",
        );
        check(
          !JSON.stringify(decoded).includes("subject-serial-a") &&
            !JSON.stringify(decoded).includes("subject-serial-b"),
          "released route excludes subject history",
        );
      }
      const socket = new WebSocket(
        `${origin.replace("http", "ws")}${TEAM_API_ROUTES.events}`,
        [TEAM_PROTOCOL_V1_WEBSOCKET, `openbot-token.${owner.sessionToken}`],
        { headers: headers(codec.version) },
      );
      sockets.push(socket);
      const rows: string[] = [];
      frames.set(codec.version, rows);
      socket.on("message", (value) => {
        rows.push(String(value));
        changed.emit("changed");
      });
      await within(once(socket, "open"), "released Team event socket");
      socket.send(
        JSON.stringify({
          type: "agent-event-scope",
          includeConversations: true,
          capabilities: protocolCapabilities(codec.version),
        }),
      );
    }
    const ar = await send(a, "legacy-private-a", "hold");
    const running = await accepted("legacy-private-a");
    const br = await send(b, "legacy-private-b");
    const runtime = JSON.stringify(requireHost().service.getRuntimeSnapshot());
    check(
      !runtime.includes("legacy-private-a") && !runtime.includes("legacy-private-b"),
      "legacy runtime excludes added transcript text",
    );
    await command("finish", running.sessionId);
    await terminal(ar);
    await terminal(br);
    const marker = `main-legacy-barrier-${randomUUID()}`;
    const mr = await runCauseEffect(
      requireHost().service.sendMessage({
        agentId: agent.id,
        text: `${marker} [fixture:complete:legacy-main]`,
        clientMessageId: randomUUID(),
      }),
    );
    await terminal(mr);
    await waitState(
      () => [...frames.values()].every((rows) => rows.some((row) => row.includes(marker))),
      "ordered main event barrier on all released clients",
    );
    for (const [version, rows] of frames) {
      check(
        !rows.some(
          (row) =>
            row.includes("legacy-private-a") ||
            row.includes("legacy-private-b") ||
            row.includes(a.threadId) ||
            row.includes(b.threadId),
        ),
        `released ${version} events contain no subject transcript`,
      );
      receipt("released client", {
        version,
        events: rows.length,
        mainThreadId: main.threadId,
        mainUpdateReceived: true,
        addedTextAbsent: true,
      });
    }
    const event: AgentEvent = { type: "conversation", snapshot: snapshot(main) };
    const wire = encodeTeamProtocolV1CurrentEvent(event);
    check(wire !== null, "v1 conversation event is accepted");
    check(decodeTeamProtocolV1CurrentEvent(JSON.parse(wire)).kind === "known", "v1 event round trip remains valid");
    const stoppedHost = host;
    host = undefined;
    await runCauseEffect(stoppedHost.stop());
    for (const socket of sockets.splice(0)) {
      if (socket.readyState === WebSocket.CLOSED) continue;
      const ended = once(socket, "close");
      socket.close();
      await within(ended, "released Team socket close");
    }
  });
}
async function rendererCase(
  agent: AgentSummary,
  main: AgentConversationTarget,
  a: AgentConversationTarget,
  b: AgentConversationTarget,
): Promise<void> {
  await runCase(12, async () => {
    const live = requireHost();
    // Older pages come from real SQLite history. They do not require extra model turns.
    for (let index = 0; index < 72; index++)
      live.database.persistConversationChanges({
        agentId: agent.id,
        threadId: a.threadId,
        activeTurnId: null,
        changedMessages: [
          {
            id: `controller-old-a-${index}`,
            author: index % 2 ? "assistant" : "user",
            source: index % 2 ? "assistant" : "user",
            text: `subject-controller-history-a-${index}`,
            status: "completed",
            createdAt: new Date(Date.UTC(2026, 9, 15, 1, 0, index)).toISOString(),
          },
        ],
        eventType: "fixture.controller-history",
      });
    const streams = new Set<ServerResponse>();
    const eventAcks = new Map<string, { done(): void; promise: Promise<void> }>();
    const barrierState: { current: FixtureReplyBarrier | null } = { current: null };
    const eventListener = (value: AgentConversationEvent) => {
      const frame = `data: ${JSON.stringify(value)}\n\n`;
      for (const stream of streams) stream.write(frame);
    };
    live.service.on("conversationEvent", eventListener);
    bridge = createServer((request, response) => {
      void (async () => {
        response.setHeader("Access-Control-Allow-Origin", "*");
        response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Fixture-Nonce");
        response.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
        if (request.method === "OPTIONS") {
          response.writeHead(204);
          response.end();
          return;
        }
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (
          url.pathname === "/fixture/events" &&
          request.method === "GET" &&
          url.searchParams.get("nonce") === report.runNonce
        ) {
          response.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          response.write(": owned synthetic fixture\n\n");
          streams.add(response);
          request.once("close", () => streams.delete(response));
          return;
        }
        if (request.method !== "POST" || request.headers["x-fixture-nonce"] !== report.runNonce) {
          response.writeHead(403);
          response.end(JSON.stringify({ error: "The fixture actor is required." }));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of request) {
          const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytes += value.length;
          if (bytes > 192 * 1024) throw new Error("The fixture request is too large.");
          chunks.push(value);
        }
        const input = JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
        const method = url.pathname.slice("/fixture/".length);
        let result: FixtureBridgeReply;
        if (method === "bootstrap") {
          const ownedAgent = live.store.list().find((row) => row.id === agent.id);
          check(
            ownedAgent !== undefined && ownedAgent.threadId === main.threadId,
            "controller bootstrap actual main owner",
          );
          result = {
            agent: ownedAgent,
            status: live.service.getStatus(),
            main,
            a,
            b,
          };
        } else if (method === "barrier-arm") {
          check(isDynamicRecord(input) && isString(input.method) && isString(input.threadId), "fixture barrier shape");
          barrierState.current = {
            method: input.method,
            threadId: input.threadId,
            editAction: isString(input.editAction) ? input.editAction : null,
            failReply: input.failReply === true,
            used: false,
            reached: Deferred.makeUnsafe<void>(),
            released: Deferred.makeUnsafe<void>(),
          };
          result = { acknowledged: true };
        } else if (method === "barrier-wait") {
          const held = barrierState.current;
          check(held !== null, "armed fixture reply barrier");
          await within(Effect.runPromise(Deferred.await(held.reached)), "controller actual reply barrier");
          result = { acknowledged: true };
        } else if (method === "barrier-release") {
          const held = barrierState.current;
          check(held !== null, "existing reply barrier");
          await Effect.runPromise(Deferred.succeed(held.released, undefined));
          result = { acknowledged: true };
        } else if (method === "event-ack") {
          check(isDynamicRecord(input) && isString(input.id), "event ack shape");
          eventAcks.get(input.id)?.done();
          result = { acknowledged: true };
        } else if (method === "event-flush") {
          check(streams.size > 0, "controller event stream connected");
          const id = randomUUID();
          let done = () => {};
          const promise = new Promise<void>((resolveAck) => {
            done = resolveAck;
          });
          eventAcks.set(id, { done, promise });
          for (const stream of streams) stream.write(`event: fixture-barrier\ndata: ${JSON.stringify({ id })}\n\n`);
          await within(promise, "ordered controller event acknowledgement");
          eventAcks.delete(id);
          result = { acknowledged: true };
        } else if (method === "ask-a") {
          const session = live.database.activeProviderSession(a.threadId, "codex");
          check(session !== null, "current A provider session for deferred question");
          await command("ask", session.externalSessionId);
          await waitState(
            () =>
              conversationEvents.some(
                (event) =>
                  event.type === "conversation-event" &&
                  event.threadId === a.threadId &&
                  event.event.type === "prompt" &&
                  event.event.turnId === live.database.readActiveTurnId(agent.id, a.threadId),
              ),
            "deferred provider prompt",
          );
          result = { acknowledged: true };
        } else if (method === "voice") result = { text: "synthetic dictated note" };
        else if (method === "list")
          result = await runCauseEffect(live.service.userConversations.list(parseConversationList(input)));
        else if (method === "create")
          result = await runCauseEffect(live.service.userConversations.create(parseConversationCreate(input)));
        else if (method === "update") {
          await runCauseEffect(live.service.userConversations.update(parseConversationUpdate(input)));
          result = { acknowledged: true };
        } else if (method === "read")
          result = await runCauseEffect(
            live.service.userConversations.read(parseConversationRead(input), "fixture-member"),
          );
        else if (method === "queue") result = live.service.userConversations.queue(parseConversationRead(input));
        else if (method === "search") result = live.service.userConversations.search(parseConversationSearch(input));
        else if (method === "send")
          result = await runCauseEffect(live.service.userConversations.send(parseConversationSend(input)));
        else if (method === "action") {
          await runCauseEffect(live.service.userConversations.action(parseConversationAction(input), "fixture-member"));
          result = { acknowledged: true };
        } else throw new Error("Unknown fixture operation.");
        const held = barrierState.current;
        if (
          held &&
          !held.used &&
          held.method === method &&
          isDynamicRecord(input) &&
          input.threadId === held.threadId &&
          (held.editAction === null || (isDynamicRecord(input.edit) && input.edit.action === held.editAction))
        ) {
          held.used = true;
          await Effect.runPromise(Deferred.succeed(held.reached, undefined));
          await within(Effect.runPromise(Deferred.await(held.released)), "controller reply release");
          if (held.failReply) throw new Error("The synthetic accepted send reply was lost.");
        }
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify(result));
      })().catch((error: unknown) => {
        if (!response.headersSent) response.writeHead(500, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: safe(error) }));
      });
    });
    await new Promise<void>((done) => bridge?.listen(0, "127.0.0.1", done));
    const address = bridge.address();
    check(address !== null && typeof address !== "string", "owned loopback bridge address");
    const bridgeOrigin = `http://127.0.0.1:${address.port}`;
    const portProbe = createServer();
    await new Promise<void>((done) => portProbe.listen(0, "127.0.0.1", done));
    const portAddress = portProbe.address();
    check(portAddress !== null && typeof portAddress !== "string", "owned Storybook port");
    const storybookPort = portAddress.port;
    await new Promise<void>((done, fail) => portProbe.close((error) => (error ? fail(error) : done())));
    const node = process.env.OPENBOT_E2E_NODE ?? "node";
    let storybookLog = "";
    let readyResolve = () => {};
    const ready = new Promise<void>((done) => {
      readyResolve = done;
    });
    storybook = spawn(
      node,
      [
        join(ROOT, "node_modules/storybook/dist/bin/dispatcher.js"),
        "dev",
        "--ci",
        "--no-open",
        "--exact-port",
        "--host",
        "127.0.0.1",
        "--port",
        String(storybookPort),
      ],
      {
        cwd: ROOT,
        env: { ...process.env, OPENBOT_STORYBOOK_CHECK: "true" },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    const ownedStorybook = storybook;
    const captureLog = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      storybookLog = safe(`${storybookLog}${text}`).slice(-64 * 1024);
      if (/Storybook.*started|Local:.*127\.0\.0\.1|Local:.*localhost/u.test(text)) readyResolve();
    };
    ownedStorybook.stdout?.on("data", captureLog);
    ownedStorybook.stderr?.on("data", captureLog);
    try {
      await within(
        Promise.race([
          ready,
          once(ownedStorybook, "exit").then(() => {
            throw new Error("The owned Storybook process exited before readiness.");
          }),
        ]),
        "owned Storybook startup",
        STARTUP_MS,
      );
      browser = await chromium.launch({
        headless: true,
        ...(process.platform === "darwin" ? { channel: "chrome" } : {}),
        args: ["--disable-background-networking", "--no-first-run", "--disable-sync"],
      });
      report.runtime.chromium = browser.version();
      const page = await browser.newPage({ viewport: { width: 900, height: 720 } });
      page.setDefaultTimeout(WAIT_MS);
      interface BrowserConsoleDiagnostic {
        kind: string;
        message: string;
        firstStage: string;
        lastStage: string;
        occurrences: number;
        critical: boolean;
      }
      const consoleDiagnostics: BrowserConsoleDiagnostic[] = [];
      const consoleOrigins = new Map<string, BrowserConsoleDiagnostic>();
      let rendererStage = "controller mount";
      let consoleErrorCount = 0;
      let consoleDiagnosticCount = 0;
      let droppedConsoleDiagnostics = 0;
      let droppedCriticalDiagnostics = 0;
      const captureConsole = (kind: string, message: string, critical: boolean) => {
        consoleDiagnosticCount++;
        if (critical) consoleErrorCount++;
        const redacted = safe(message);
        const key = createHash("sha256").update(kind).update("\0").update(redacted).digest("hex");
        const existing = consoleOrigins.get(key);
        if (existing) {
          existing.occurrences++;
          existing.lastStage = rendererStage;
          existing.critical ||= critical;
          return;
        }
        if (consoleDiagnostics.length >= 32) {
          droppedConsoleDiagnostics++;
          if (critical) droppedCriticalDiagnostics++;
          return;
        }
        const entry: BrowserConsoleDiagnostic = {
          kind,
          // Reserve three bytes for a replacement character if UTF-8 ends inside a code point.
          message: Buffer.from(redacted, "utf8").subarray(0, 2045).toString("utf8"),
          firstStage: rendererStage,
          lastStage: rendererStage,
          occurrences: 1,
          critical,
        };
        consoleOrigins.set(key, entry);
        consoleDiagnostics.push(entry);
      };
      const consoleDiagnosticText = (entry: BrowserConsoleDiagnostic) =>
        Buffer.from(
          `${entry.firstStage} through ${entry.lastStage}:${entry.kind}:occurrences=${entry.occurrences}:critical=${entry.critical}:${entry.message}`,
          "utf8",
        )
          .subarray(0, 2045)
          .toString("utf8");
      const recordConsole = () =>
        receipt("controller browser diagnostics", {
          stage: rendererStage,
          criticalErrors: consoleDiagnostics.filter((entry) => entry.critical).map(consoleDiagnosticText),
          consoleErrors: consoleErrorCount,
          receivedDiagnostics: consoleDiagnosticCount,
          diagnostics: consoleDiagnostics.map(consoleDiagnosticText),
          droppedDiagnostics: droppedConsoleDiagnostics,
          droppedCriticalDiagnostics,
        });
      page.on("pageerror", (error) => captureConsole("pageerror", error.stack ?? error.message, true));
      page.on("console", (message) => {
        const text = message.text();
        const strictRead = /STRICT_READ_UNTRACKED/u.test(text);
        if (strictRead || message.type() === "warning" || message.type() === "error")
          captureConsole(message.type(), text, strictRead);
      });
      await page.addInitScript(() => {
        const browserConsole = window.console;
        const warn = browserConsole.warn.bind(browserConsole);
        browserConsole.warn = (...values) => {
          warn(...values);
          if (typeof values[0] === "string" && values[0].includes("STRICT_READ_UNTRACKED"))
            warn(new Error("Controller fixture strict read origin").stack);
        };
      });
      await page.goto(
        `http://127.0.0.1:${storybookPort}/iframe.html?id=conversation-agentconversations--controller-fixture&viewMode=story&fixtureOrigin=${encodeURIComponent(bridgeOrigin)}&fixtureNonce=${encodeURIComponent(report.runNonce)}`,
      );
      // Inspect the accessible fixture before an interaction. Each button runs the real controllers.
      await page.getByRole("button", { name: "Draft capture", exact: true }).waitFor();
      async function controller<Operation extends keyof ControllerReceipts>(
        name: string,
        operation: Operation,
        decode: ControllerReceiptDecoder<Operation>,
      ): Promise<ControllerReceipts[Operation]> {
        rendererStage = `controller ${operation}`;
        await page.getByRole("button", { name, exact: true }).click();
        await page.waitForFunction((expected) => {
          const output = document.querySelector('output[aria-label="Conversation controller receipt"]');
          if (!output?.textContent) return false;
          try {
            const receipt = JSON.parse(output.textContent);
            return receipt.operation === expected && receipt.pending === false;
          } catch {
            return false;
          }
        }, operation);
        const raw = JSON.parse(
          (await page.locator('output[aria-label="Conversation controller receipt"]').textContent()) ?? "{}",
        );
        check(
          isDynamicRecord(raw) &&
            raw.operation === operation &&
            raw.pending === false &&
            raw.error === null &&
            isString(raw.result) &&
            raw.fixtureNonce === report.runNonce &&
            raw.agentId === agent.id &&
            raw.mainThreadId === main.threadId &&
            raw.aThreadId === a.threadId &&
            raw.bThreadId === b.threadId,
          `controller ${operation} actual operation`,
        );
        const parsed = decode(JSON.parse(raw.result));
        receipt(`controller ${operation}`, {
          resultSha256: createHash("sha256").update(raw.result).digest("hex"),
          capturedA: a.threadId,
          capturedB: b.threadId,
        });
        return parsed;
      }
      const drafts = await controller("Draft capture", "draft", decodeControllerDraft);
      check(
        drafts.a === "Synthetic A draft" &&
          drafts.b === "Synthetic B draft" &&
          drafts.replyA !== null &&
          drafts.replyA === drafts.currentReply &&
          drafts.target === `${agent.id}\0${a.threadId}`,
        "draft and reply isolation",
      );
      const captured = await controller("Send capture", "send", decodeControllerSend);
      check(
        captured.captured === a.threadId &&
          captured.selected === b.threadId &&
          captured.bDraft === "Synthetic B during A send",
        "captured send preserves B draft",
      );
      await page.waitForFunction(() => {
        const raw = document.querySelector('output[aria-label="Conversation controller receipt"]')?.textContent;
        return Boolean(raw && JSON.parse(raw).pendingA.some((row: { state: string }) => row.state === "failed"));
      });
      const retry = await controller("Retry send", "retry", decodeControllerRetry);
      check(
        retry.clientMessageId.length > 0 && retry.threadId === a.threadId,
        "pending retry client and target identity",
      );
      await waitState(
        async () =>
          (await providerLogs()).some((row) => row.event === "turn-finished" && row.tag === "controller-send-a"),
        "controller provider completion",
      );
      await page.waitForFunction(() => {
        const raw = document.querySelector('output[aria-label="Conversation controller receipt"]')?.textContent;
        return Boolean(
          raw &&
            JSON.parse(raw).pendingA.every(
              (row: { state: string }) => row.state !== "failed" && row.state !== "sending",
            ),
        );
      });
      check(
        (await providerLogs()).filter((row) => row.event === "turn-accepted" && row.tag === "controller-send-a")
          .length === 1,
        "pending accepted retry starts exactly once",
      );
      const pages = await controller("Page capture", "page", decodeControllerPage);
      check(
        pages.selected === b.threadId && pages.aPageThread === a.threadId && pages.bPageThread === b.threadId,
        "late page stays at captured subject",
      );
      const older = await controller("Older page and search", "older", decodeControllerOlder);
      check(
        typeof older.before === "number" &&
          typeof older.after === "number" &&
          older.after > older.before &&
          Array.isArray(older.matchingIds) &&
          older.matchingIds.length === 72 &&
          older.matchingIds.every((id) => isString(id) && id.startsWith("controller-old-a-")) &&
          older.selected === b.threadId,
        "older page and search retain A history",
      );
      const hold = await send(a, "controller-edit-hold", "hold");
      const holdAccepted = await accepted("controller-edit-hold");
      const queued = await send(b, "controller-edit-b");
      const edited = await controller("Queue edit capture", "edit", decodeControllerEdit);
      check(
        edited.editingThreadId === b.threadId &&
          edited.selected === a.threadId &&
          edited.aDraft === "Synthetic A during B edit",
        "queue edit retains captured B",
      );
      check(
        edited.focusBefore === edited.focusAfter && edited.actionsBefore === edited.actionsAfter,
        "held B edit does not request focus or actions in A",
      );
      const canceled = await controller("Cancel queue edit", "cancel-edit", decodeControllerCancelEdit);
      check(
        canceled.editingThreadId === null && canceled.aDraft === "Synthetic A during B edit",
        "queue Cancel clears B edit and preserves A draft",
      );
      const saved = await controller("Queue save capture", "save-edit", decodeControllerSave);
      check(
        saved.savedThreadId === b.threadId &&
          saved.selected === a.threadId &&
          saved.aDraft === "Synthetic A during B save",
        "queue Save retains B and new A draft",
      );
      await page.waitForFunction(() => {
        const raw = document.querySelector('output[aria-label="Conversation controller receipt"]')?.textContent;
        if (!raw) return false;
        const value = JSON.parse(raw);
        return value.bDraft === "" && value.editingThreadId === null;
      });
      check(
        live.mailbox.getDelivery(deliveryId(queued))?.delivery.text.includes("subject-controller-saved-b") === true,
        "real B queue saves once",
      );
      await command("finish", holdAccepted.sessionId);
      await terminal(hold);
      await terminal(queued);
      const readReceipt = await controller("Read capture", "read", decodeControllerRead);
      check(readReceipt.markedThreadId === a.threadId && readReceipt.selected === b.threadId, "read mark retains A");
      const voice = await controller("Voice capture", "voice", decodeControllerVoice);
      check(
        voice.voiceThreadId === a.threadId &&
          voice.selected === b.threadId &&
          isString(voice.aDraft) &&
          voice.aDraft.includes("synthetic dictated note") &&
          isString(voice.bDraft) &&
          !voice.bDraft.includes("synthetic dictated note"),
        "actual voice finish restores A",
      );
      const stopRun = await send(a, "controller-stop-a", "hold");
      await accepted("controller-stop-a");
      const stopReceipt = await controller("Stop capture", "stop", decodeControllerStop);
      await terminal(stopRun);
      check(stopReceipt.stoppedThreadId === a.threadId && stopReceipt.selected === b.threadId, "captured exact stop");
      const inputRun = await send(a, "controller-input-a", "hold");
      const inputAccepted = await accepted("controller-input-a");
      check(isString(inputAccepted.turnId), "real controller input turn exists");
      const stale = await controller("Stale attention capture", "stale-attention", decodeControllerAttention);
      check(
        stale.selected === b.threadId && stale.aAttention.includes("prompt"),
        "selection changes while A read is held and current attention survives",
      );
      await page.waitForFunction(() => {
        const raw = document.querySelector('output[aria-label="Conversation controller receipt"]')?.textContent;
        if (!raw) return false;
        const value = JSON.parse(raw);
        return value.aAttention?.includes("prompt");
      });
      const inputReceipt = await controller("Input capture", "input", decodeControllerInput);
      await terminal(inputRun);
      check(
        inputReceipt.answeredThreadId === a.threadId &&
          inputReceipt.selected === b.threadId &&
          inputReceipt.turnId === inputAccepted.turnId,
        "captured exact input survives late read",
      );
      const scroll = await controller("Scroll capture", "scroll", decodeControllerScroll);
      check(
        isDynamicRecord(scroll.aScroll) &&
          scroll.aScroll.stickToLatest === false &&
          isDynamicRecord(scroll.bScroll) &&
          scroll.bScroll.stickToLatest === true &&
          scroll.selected === a.threadId,
        "actual scroll store keeps per-subject sticky state",
      );
      rendererStage = "controller assertions complete";
      recordConsole();
      check(consoleErrorCount === 0, "controller has no page errors or untracked reactive reads");
      receipt("headless controller", {
        chromium: report.runtime.chromium,
        realServiceBridge: true,
        acceptedSendStarts: 1,
        controlsExecuted: 14,
        consoleErrors: consoleErrorCount,
      });
      // Measure the actual dialog rows and text, including the captured long-label failure.
      await mkdir(join(OUT, "review"), { recursive: true });
      async function measureDialog(story: string, phase: "initial" | "last-actions" | "list-end") {
        return within(
          page.evaluate(
            ({ story, phase }) => {
              const dialog = document.querySelector(".agent-conversations-dialog[role=dialog]");
              if (!(dialog instanceof HTMLElement)) throw new Error("The conversation review dialog is missing.");
              const list = dialog.querySelector(".custom-provider-list");
              if (!(list instanceof HTMLElement)) throw new Error("The conversation review list is missing.");
              const issues: string[] = [];
              const geometry: string[] = [];
              const tolerance = 1;
              const contains = (outer: DOMRect, inner: DOMRect) =>
                inner.left >= outer.left - tolerance &&
                inner.right <= outer.right + tolerance &&
                inner.top >= outer.top - tolerance &&
                inner.bottom <= outer.bottom + tolerance;
              const overlaps = (left: DOMRect, right: DOMRect) =>
                Math.min(left.right, right.right) - Math.max(left.left, right.left) > tolerance &&
                Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > tolerance;
              const textRects = (element: HTMLElement) => {
                const range = document.createRange();
                range.selectNodeContents(element);
                return Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
              };
              const clippingRect = (element: HTMLElement) => {
                let left = 0;
                let top = 0;
                let right = window.innerWidth;
                let bottom = window.innerHeight;
                for (let parent = element.parentElement; parent; parent = parent.parentElement) {
                  const style = getComputedStyle(parent);
                  const rect = parent.getBoundingClientRect();
                  if (/^(auto|scroll|hidden|clip)$/u.test(style.overflowX)) {
                    left = Math.max(left, rect.left + parent.clientLeft);
                    right = Math.min(right, rect.left + parent.clientLeft + parent.clientWidth);
                  }
                  if (/^(auto|scroll|hidden|clip)$/u.test(style.overflowY)) {
                    top = Math.max(top, rect.top + parent.clientTop);
                    bottom = Math.min(bottom, rect.top + parent.clientTop + parent.clientHeight);
                  }
                }
                return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
              };
              const viewport = new DOMRect(0, 0, window.innerWidth, window.innerHeight);
              const dialogRect = dialog.getBoundingClientRect();
              if (!contains(viewport, dialogRect)) issues.push("dialog leaves the viewport");
              if (dialog.scrollWidth > dialog.clientWidth + tolerance) issues.push("dialog clips horizontal content");
              if (list.scrollWidth > list.clientWidth + tolerance) issues.push("list clips horizontal content");
              const rows = Array.from(dialog.querySelectorAll(".agent-conversations-row"));
              const expectedRows =
                story === "empty" ? 0 : story === "long-localized-labels" ? 4 : story === "archived" ? 1 : 3;
              if (rows.length !== expectedRows) issues.push("review row count differs from the story");
              let prior: DOMRect | undefined;
              let longTitles = 0;
              let unbrokenTitles = 0;
              let japaneseTitles = 0;
              let titleLines = 0;
              let actionButtons = 0;
              let checkedVisibleActions = 0;
              let checkedVisibleListControls = 0;
              for (const [index, row] of rows.entries()) {
                if (!(row instanceof HTMLElement)) throw new Error("Invalid conversation review row.");
                const rowRect = row.getBoundingClientRect();
                if (prior && rowRect.top < prior.bottom - tolerance)
                  issues.push(`row ${index} overlaps the previous row`);
                prior = rowRect;
                const group = row.parentElement;
                if (!group || !contains(group.getBoundingClientRect(), rowRect))
                  issues.push(`row ${index} leaves its group`);
                const content = row.querySelector(".ui-item-content");
                const title = row.querySelector(".agent-conversations-title");
                const select = row.querySelector(".agent-conversations-select");
                const actions = row.querySelector(".agent-conversations-row-actions");
                if (
                  !(content instanceof HTMLElement) ||
                  !(title instanceof HTMLElement) ||
                  !(select instanceof HTMLButtonElement) ||
                  !(actions instanceof HTMLElement)
                )
                  throw new Error("The conversation review row controls are missing.");
                const contentRect = content.getBoundingClientRect();
                const actionsRect = actions.getBoundingClientRect();
                if (!contains(rowRect, contentRect)) issues.push(`row ${index} content leaves its row`);
                if (!contains(rowRect, actionsRect)) issues.push(`row ${index} actions leave their row`);
                if (overlaps(contentRect, actionsRect)) issues.push(`row ${index} content overlaps its actions`);
                if (!contains(contentRect, title.getBoundingClientRect()))
                  issues.push(`row ${index} title leaves its content`);
                const glyphs = textRects(select);
                const selectRect = select.getBoundingClientRect();
                if (select.scrollWidth > select.clientWidth + tolerance)
                  issues.push(`row ${index} select clips its title`);
                titleLines += glyphs.length;
                const titleText = select.textContent?.trim() ?? "";
                if (titleText.startsWith("Persönliche Wissenssammlung")) {
                  longTitles++;
                  if (glyphs.length < 2) issues.push("the long German title does not wrap");
                }
                if (titleText.length > 100 && !/\s/u.test(titleText)) {
                  unbrokenTitles++;
                  if (glyphs.length < 2) issues.push("the unbroken title does not wrap");
                }
                if (titleText.startsWith("家族旅行")) japaneseTitles++;
                for (const glyph of glyphs) {
                  if (!contains(selectRect, glyph) || !contains(contentRect, glyph) || !contains(rowRect, glyph))
                    issues.push(`row ${index} title text leaves its owner`);
                  if (overlaps(glyph, actionsRect)) issues.push(`row ${index} title text overlaps its actions`);
                }
                const copy = Array.from(content.querySelectorAll(".ui-item-description,.agent-conversations-status"));
                for (const item of copy) {
                  if (!(item instanceof HTMLElement)) throw new Error("Invalid conversation review copy.");
                  const box = item.getBoundingClientRect();
                  if (box.width === 0 || box.height === 0) continue;
                  if (!contains(contentRect, box) || !contains(rowRect, box))
                    issues.push(`row ${index} metadata leaves its owner`);
                  if (glyphs.some((glyph) => overlaps(glyph, box)))
                    issues.push(`row ${index} title overlaps its metadata`);
                }
                const buttons = Array.from(actions.querySelectorAll("button"));
                actionButtons += buttons.length;
                for (const [buttonIndex, button] of buttons.entries()) {
                  if (!(button instanceof HTMLButtonElement)) throw new Error("Invalid conversation review action.");
                  const box = button.getBoundingClientRect();
                  if (box.width <= 0 || box.height <= 0) issues.push(`row ${index} action ${buttonIndex} has no area`);
                  if (!contains(rowRect, box) || !contains(actionsRect, box))
                    issues.push(`row ${index} action ${buttonIndex} leaves its owner`);
                  if (button.scrollWidth > button.clientWidth + tolerance)
                    issues.push(`row ${index} action ${buttonIndex} clips its label`);
                  if (textRects(button).some((glyph) => !contains(box, glyph)))
                    issues.push(`row ${index} action ${buttonIndex} text leaves its button`);
                  for (const other of buttons.slice(buttonIndex + 1))
                    if (overlaps(box, other.getBoundingClientRect()))
                      issues.push(`row ${index} action buttons overlap`);
                  if (phase === "last-actions" && index === rows.length - 1) {
                    checkedVisibleActions++;
                    if (!contains(clippingRect(button), box))
                      issues.push(`last row action ${buttonIndex} is clipped after scrolling`);
                    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
                    if (!button.disabled && !button.contains(hit))
                      issues.push(`last row action ${buttonIndex} is covered after scrolling`);
                  }
                }
                geometry.push(
                  JSON.stringify({
                    row: index,
                    top: Math.round(rowRect.top),
                    bottom: Math.round(rowRect.bottom),
                    contentBottom: Math.round(contentRect.bottom),
                    actionsTop: Math.round(actionsRect.top),
                    actionsBottom: Math.round(actionsRect.bottom),
                    lines: glyphs.length,
                  }),
                );
              }
              for (const button of Array.from(dialog.querySelectorAll("button"))) {
                if (!(button instanceof HTMLButtonElement) || button.closest(".agent-conversations-row")) continue;
                // The list's controls can be outside its visible scrolling window.
                if (list.contains(button)) continue;
                const box = button.getBoundingClientRect();
                if (!contains(clippingRect(button), box)) issues.push("a fixed dialog button is clipped");
                if (textRects(button).some((glyph) => !contains(box, glyph)))
                  issues.push("a fixed dialog button clips its label");
              }
              if (phase === "list-end") {
                const button = Array.from(list.querySelectorAll("button"))
                  .filter((item) => !item.closest(".agent-conversations-row"))
                  .at(-1);
                if (!(button instanceof HTMLButtonElement))
                  throw new Error("The final conversation list control is missing.");
                checkedVisibleListControls++;
                const box = button.getBoundingClientRect();
                if (!contains(clippingRect(button), box))
                  issues.push("the final list control is clipped after scrolling");
                if (textRects(button).some((glyph) => !contains(box, glyph)))
                  issues.push("the final list control clips its label");
                const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
                if (!button.disabled && !button.contains(hit))
                  issues.push("the final list control is covered after scrolling");
              }
              if (story === "long-localized-labels") {
                if (longTitles !== 1 || unbrokenTitles !== 1 || japaneseTitles !== 1)
                  issues.push("long-label review subjects are missing");
                if (list.scrollHeight <= list.clientHeight + tolerance)
                  issues.push("long-label content does not own a scrollable list");
                if (phase === "last-actions" && (list.scrollTop <= 0 || checkedVisibleActions !== 2))
                  issues.push("the final long-label actions were not reached by scrolling");
              }
              return {
                issues,
                geometry,
                rows: rows.length,
                titleLines,
                actionButtons,
                checkedVisibleActions,
                checkedVisibleListControls,
                scrollTop: list.scrollTop,
                scrollHeight: list.scrollHeight,
                clientHeight: list.clientHeight,
              };
            },
            { story, phase },
          ),
          `dialog layout ${story} ${phase}`,
        );
      }
      for (const viewport of [
        { width: 900, locale: "en" },
        { width: 320, locale: "de" },
      ]) {
        await page.setViewportSize({ width: viewport.width, height: 720 });
        for (const story of ["empty", "long-localized-labels", "working", "queued", "archived", "input-required"]) {
          rendererStage = `visual ${viewport.width} ${viewport.locale} ${story}`;
          await page.goto(
            `http://127.0.0.1:${storybookPort}/iframe.html?id=conversation-agentconversations--${story}&viewMode=story&globals=locale:${viewport.locale}`,
          );
          await page
            .getByRole("dialog", { name: viewport.locale === "de" ? "Unterhaltungen" : "Conversations", exact: true })
            .waitFor();
          if (story !== "empty")
            await page
              .getByRole("button", { name: viewport.locale === "de" ? "Umbenennen" : "Rename", exact: true })
              .first()
              .waitFor();
          await within(
            page.evaluate(async () => {
              await document.fonts.ready;
              await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
            }),
            "review font and layout readiness",
          );
          const initial = await measureDialog(story, "initial");
          const suffix = viewport.width === 900 ? story : `${story}-${viewport.width}-${viewport.locale}`;
          await page.screenshot({ path: join(OUT, "review", `${suffix}.png`) });
          receipt("conversation dialog layout", {
            story,
            width: viewport.width,
            locale: viewport.locale,
            phase: "initial",
            ...initial,
          });
          check(initial.issues.length === 0, `dialog initial bounds ${story} ${viewport.width} ${viewport.locale}`);
          if (initial.rows > 0) {
            const lastActions = page
              .locator(".agent-conversations-row")
              .last()
              .locator(".agent-conversations-row-actions");
            await lastActions.scrollIntoViewIfNeeded();
            const reached = await measureDialog(story, "last-actions");
            await page.screenshot({ path: join(OUT, "review", `${suffix}-last-actions.png`) });
            receipt("conversation dialog layout", {
              story,
              width: viewport.width,
              locale: viewport.locale,
              phase: "last-actions",
              ...reached,
            });
            check(
              reached.issues.length === 0 && reached.checkedVisibleActions > 0,
              `dialog scrolled action bounds ${story} ${viewport.width} ${viewport.locale}`,
            );
          }
          if (story === "long-localized-labels") {
            await page
              .getByRole("button", { name: viewport.locale === "de" ? "Mehr laden" : "Load more", exact: true })
              .scrollIntoViewIfNeeded();
            const listEnd = await measureDialog(story, "list-end");
            await page.screenshot({ path: join(OUT, "review", `${suffix}-list-end.png`) });
            receipt("conversation dialog layout", {
              story,
              width: viewport.width,
              locale: viewport.locale,
              phase: "list-end",
              ...listEnd,
            });
            check(
              listEnd.issues.length === 0 && listEnd.checkedVisibleListControls === 1,
              `dialog final list control bounds ${viewport.width} ${viewport.locale}`,
            );
          }
        }
      }
      rendererStage = "visual review assertions complete";
      recordConsole();
      check(consoleErrorCount === 0, "review states have no page errors or untracked reactive reads");
    } finally {
      live.service.off("conversationEvent", eventListener);
      for (const stream of streams) stream.end();
      const held = barrierState.current;
      if (held) await Effect.runPromise(Deferred.succeed(held.released, undefined));
      try {
        await writeArtifact("storybook-safe.log", `${storybookLog}\n`);
      } catch (error) {
        report.artifactErrors.push(safe(error));
      }
      const ownedBrowser = browser;
      if (ownedBrowser)
        await finalize("owned headless renderer browser", async () => {
          await ownedBrowser.close();
          browser = undefined;
        });
      await finalize("owned Storybook", async () => {
        if (ownedStorybook.exitCode === null) {
          const ended = once(ownedStorybook, "exit");
          ownedStorybook.kill("SIGTERM");
          await ended;
        }
        storybook = undefined;
      });
      const ownedBridge = bridge;
      if (ownedBridge)
        await finalize("owned renderer bridge", async () => {
          await closeHttp(ownedBridge);
          bridge = undefined;
        });
    }
  });
}
async function deletionCase(
  agent: AgentSummary,
  main: AgentConversationTarget,
  a: AgentConversationTarget,
  b: AgentConversationTarget,
): Promise<void> {
  await runCase(13, async () => {
    const current = requireHost();
    const duplication = await runCauseEffect(current.service.duplicateAgent(agent.id, randomUUID()));
    const layout = new SidebarLayoutStore(join(stateRoot, "duplication-layout.json"));
    await runCauseEffect(layout.initialize());
    await runCauseEffect(current.service.commitAgentDuplication(duplication.id, layout.getSnapshot()));
    check(
      current.database.userConversations.threads(duplication.id).length === 0,
      "duplicate keeps no user conversations",
    );
    check(duplication.threadId === null, "duplicate copies no chat identity");
    const empty = await runCauseEffect(current.service.readConversation(duplication.id));
    check(empty.messages.length === 0, "duplicate copies no history");
    const ownedThreads = [main.threadId, ...current.database.userConversations.threads(agent.id)];
    const sessions = ownedThreads.flatMap((threadId) => current.database.listProviderSessions(threadId));
    check(sessions.length > 0, "real provider sessions exist before removal");
    const session = sessions.find((row) => row.threadId === a.threadId);
    check(session !== undefined, "A session exists for cleanup failure");
    const privateName = createHash("sha256").update(session.externalSessionId).digest("hex");
    const privatePath = join(stateRoot, "provider-toolsets", privateName);
    const oldContents = await readFile(privatePath).catch(() => null);
    await rm(privatePath, { force: true });
    await mkdir(privatePath, { mode: 0o700 });
    await writeFile(join(privatePath, "owned-obstruction"), "Synthetic cleanup fault", { mode: 0o600 });
    await refuse(
      () => runCauseEffect(current.service.deleteAgent(agent.id)),
      "retryable provider file cleanup failure",
    );
    check(
      current.store.list().some((row) => row.id === agent.id),
      "failed cleanup keeps agent record",
    );
    check(current.database.userConversations.threads(agent.id).includes(a.threadId), "failed cleanup keeps A registry");
    check(
      current.database.listProviderSessions(a.threadId).some((row) => row.id === session.id),
      "failed cleanup retains private session receipt",
    );
    await rm(privatePath, { recursive: true, force: true });
    if (oldContents) await writeFile(privatePath, oldContents, { mode: 0o600 });
    const attachedFiles = current.mailbox
      .listStoredFiles()
      .filter((row) => row.agentId === agent.id)
      .map((row) => row.path);
    const privateFiles = sessions.flatMap((row) => {
      const external = createHash("sha256").update(row.externalSessionId).digest("hex");
      const id = createHash("sha256").update(row.id).digest("hex");
      return [
        join(stateRoot, "provider-handoffs", external),
        join(stateRoot, "provider-toolsets", external),
        join(stateRoot, "provider-work-steps", external),
        join(stateRoot, "provider-work-steps", "v2", id),
      ];
    });
    check(unrelatedAgent !== null && retainedChannel !== null, "other agent and channel fixtures exist");
    const otherId = unrelatedAgent.id;
    const channel = retainedChannel;
    const channelBefore = JSON.stringify(current.database.readConversation(agent.id, channel.threadId).messages);
    await runCauseEffect(current.service.deleteAgent(agent.id));
    check(!current.store.list().some((row) => row.id === agent.id), "original agent record is removed");
    check(
      current.store.list().some((row) => row.id === otherId) &&
        current.store.list().some((row) => row.id === duplication.id),
      "unrelated agent and duplicate remain",
    );
    for (const threadId of ownedThreads) {
      check(
        databaseRows(
          current.database.connection
            .prepare("SELECT thread_id FROM projection_threads WHERE thread_id = ?")
            .all(threadId),
        ).length === 0,
        "owned thread removed",
      );
      check(current.database.listProviderSessions(threadId).length === 0, "owned provider sessions removed");
      check(
        databaseRows(
          current.database.connection
            .prepare("SELECT aggregate_id FROM orchestration_events WHERE aggregate_id = ?")
            .all(threadId),
        ).length === 0,
        "private conversation events removed",
      );
      check(
        databaseRows(
          current.database.connection
            .prepare("SELECT thread_id FROM agent_conversation_deliveries WHERE thread_id = ?")
            .all(threadId),
        ).length === 0,
        "delivery bindings removed",
      );
    }
    for (const path of [...attachedFiles, ...privateFiles, agent.workspacePath])
      check(
        !(await stat(path).then(
          () => true,
          () => false,
        )),
        "owned private file removed",
      );
    assert.equal(JSON.stringify(current.database.readConversation(agent.id, channel.threadId).messages), channelBefore);
    check(current.service.channels.store.exists(channel.id), "shared channel remains");
    check(
      databaseRows(current.database.connection.prepare("PRAGMA foreign_key_check").all()).length === 0,
      "final foreign keys are valid",
    );
    receipt("ordered deletion", {
      originalAgentId: agent.id,
      duplicateAgentId: duplication.id,
      retainedAgentId: otherId,
      removedThreadIds: ownedThreads,
      providerSessionsRemoved: sessions.length,
      attachedFilesRemoved: attachedFiles.length,
      privateFilesChecked: privateFiles.length,
      channelThreadId: channel.threadId,
      failedCleanupWasRetryable: true,
      mainAndBothSubjectsRemoved: ownedThreads.includes(a.threadId) && ownedThreads.includes(b.threadId),
    });
  });
}
