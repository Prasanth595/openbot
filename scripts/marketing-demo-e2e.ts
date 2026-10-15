// Drives the real public route. This fixture owns its server, browser, data, and cleanup.
// Run: bun scripts/marketing-demo-e2e.ts
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { resolve } from "node:path";
import {
  type AgentSummary,
  type ConversationSnapshot,
  isAgentSummary,
  isRoutine,
  type OpenBotDesktopApi,
  type QueueSnapshot,
  type Routine,
  type RoutineRun,
} from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
import { redactText, registerSecretValue } from "@openbot/logging";
import { type Browser, type BrowserContext, chromium, type Page } from "playwright-core";
import { z } from "zod";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build/marketing-demo-e2e");
const WAIT_MS = 15_000;
const START_MS = 60_000;
const MAX_LOG_BYTES = 256 * 1024;
const t = translateFor("en");
// Keep this explicit. A changed implementation must change its recorded source identity.
const SOURCE_FILES = [
  ".github/workflows/ci.yml",
  "scripts/marketing-demo-e2e.ts",
  "src/renderer/src/preview/MarketingDemo.tsx",
  "src/renderer/src/preview/MarketingDemoSession.tsx",
  "src/renderer/src/preview/demo-storage.ts",
  "src/renderer/src/preview/marketing-demo-manifest.ts",
  "src/renderer/src/preview/OpenBotPlayground.tsx",
  "src/renderer/src/preview/mock-openbot.ts",
  "src/renderer/src/preview/mock-support.ts",
  "src/renderer/src/preview/mock-auth.ts",
  "src/renderer/src/preview/mock-team.ts",
  "src/renderer/src/preview/mock-browser.ts",
  "src/renderer/src/preview/mock-voice.ts",
  "src/renderer/src/preview/mock-skills.ts",
  "src/renderer/src/preview/mock-routine-flows.ts",
  "src/renderer/src/preview/preview.css",
  "src/renderer/src/App.tsx",
  "src/renderer/src/AppView.tsx",
  "src/renderer/src/WorkspaceFrame.tsx",
  "src/renderer/src/features/usage/usage.css",
  "packages/ui/src/features/account/app-loading-screen.css",
  "packages/ui/src/button.tsx",
  "packages/ui/src/styles/primitives.css",
  "packages/ui/src/features/sidebar/SidebarNav.tsx",
  "packages/ui/src/features/sidebar/SidebarAgentSection.tsx",
  "src/renderer/src/styles/app-shell.css",
  "src/renderer/src/features/routine-flows/RoutineFlowsCanvas.tsx",
  "packages/ui/src/features/conversation/MarkdownMessageText.tsx",
  "src/renderer/src/app-providers.tsx",
  "src/renderer/src/navigation.tsx",
  "src/renderer/src/platform.tsx",
  "src/renderer/src/send-shortcut-preference.ts",
  "src/renderer/src/features/conversation/conversation-types.ts",
  "src/renderer/src/features/conversation/WorkspaceConversation.tsx",
  "src/renderer/src/features/conversation/ConversationComposer.tsx",
  "src/renderer/src/features/conversation/stores/voice-store.ts",
  "src/renderer/src/features/conversation/stores/skills-store.ts",
  "src/renderer/src/features/conversation/stores/mcp-servers-store.ts",
  "src/renderer/src/features/servers/server-scope.tsx",
  "packages/ui/src/features/conversation/ChatScrollRail.tsx",
  "src/renderer/src/features/conversation/conversation-controller.ts",
  "src/renderer/src/features/conversation/composer-draft-storage.ts",
  "src/renderer/src/features/agents/agents-context.tsx",
  "apps/auth-api/renderer-preview-alias.ts",
  "apps/auth-api/vite.config.ts",
  "apps/auth-api/tsconfig.json",
  "apps/auth-api/src/routes/app-preview.tsx",
  "apps/auth-api/src/routes/app-preview.lazy.tsx",
  "apps/auth-api/src/routes/__root.tsx",
  "apps/auth-api/src/types/renderer-preview.d.ts",
  "packages/logging/src/index.ts",
  "packages/i18n/src/messages/en/preview.ts",
  "packages/i18n/src/messages/de/preview.ts",
  "packages/i18n/src/messages/es/preview.ts",
  "packages/i18n/src/messages/fr/preview.ts",
  "packages/i18n/src/messages/it/preview.ts",
  "packages/i18n/src/messages/ja/preview.ts",
  "packages/i18n/src/messages/pl/preview.ts",
  "packages/i18n/src/messages/pt/preview.ts",
  "packages/i18n/src/messages/ru/preview.ts",
  "packages/i18n/src/messages/tr/preview.ts",
  "bun.lock",
  ".nvmrc",
] as const;

interface StrictWarningOrigin {
  message: string;
  stack: string;
}
interface StrictWarningCounters {
  total: number;
  duplicates: number;
  dropped: number;
}
type PreviewWaitTarget =
  | { kind: "idle" }
  | { kind: "reply"; agentId: string; threadId: string | null; previousMessageId: string | null }
  | { kind: "routine"; agentId: string; routineId: string };
interface PreviewWaitReceipt {
  snapshots: ConversationSnapshot[];
  queue: QueueSnapshot | null;
  routineRun: RoutineRun | null;
}
interface ReplyMessageReceipt {
  id: string;
  author: string;
  turnId: string | null;
  status: string;
  textBytes: number;
  textSha256: string;
}
interface ReplySnapshotReceipt {
  phase: "before" | "terminal" | "returned";
  agentId: string;
  threadId: string | null;
  activeTurnId: string | null;
  revision: number;
  messageCount: number;
  messages: ReplyMessageReceipt[];
}
interface BrowserProof {
  priorStorage: Storage;
  priorDescriptor: PropertyDescriptor | undefined;
  priorApi: OpenBotDesktopApi | undefined;
  oldApi: OpenBotDesktopApi | undefined;
  rendererTimers: Set<number>;
  rendererIntervals: Set<number>;
  oldEvents: number;
  mediaRequests: number;
  strictWarnings: StrictWarningOrigin[];
  strictWarningTotal: number;
  strictWarningDuplicates: number;
  strictWarningDropped: number;
}
declare global {
  interface Window {
    marketingDemoProof?: BrowserProof;
  }
}

const REQUIRED_CASES = [
  "fresh public route and synthetic manifest",
  "guided plan action",
  "guided research action",
  "guided content action",
  "guided client action",
  "guided report action",
  "manual agent switching preserves completed results",
  "ordinary composer free text is unsupported and not echoed",
  "files skills and routine run use the same manifest",
  "completed reset removes drafts panels queues and mutations",
  "reset during a real preview turn disposes its old API",
  "exit restores prior bridge storage and stops owned timers",
  "desktop result and current signup link",
  "fresh narrow mobile session guided actions reset and exit",
  "no account provider Signal or other live requests",
] as const;
type RequiredCaseName = (typeof REQUIRED_CASES)[number];
interface CaseResult {
  name: RequiredCaseName;
  passed: boolean;
  detail: string;
}
interface SourceIdentity {
  path: string;
  sha256: string;
}
interface RequestReceipt {
  kind: string;
  path: string;
}
interface RuntimeReceipt {
  bun: string | null;
  node: string;
  compatibilityNode: string;
  chromium: string;
  platform: NodeJS.Platform;
}
interface PublicRouteStartupReceipt {
  attempts: number;
  lastStatus: number | null;
  html: boolean;
  ready: boolean;
}
interface CleanupReceipt {
  browser: boolean;
  server: boolean;
  errors: string[];
}
interface MobileRectReceipt {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface MobileGeometryReceipt {
  phase: "success" | "failure";
  expectedMessageId: string | null;
  matchedMessageId: string | null;
  messageExists: boolean;
  body: MobileRectReceipt | null;
  scroll: MobileRectReceipt | null;
  composer: MobileRectReceipt | null;
  viewport: { width: number; height: number };
  composerFocused: boolean;
  activeTag: string | null;
  activeContentEditable: boolean;
  scrollTop: number | null;
  scrollHeight: number | null;
  clientHeight: number | null;
  alignmentWheelDeltaY: number;
}
interface FixtureReport {
  fixture: "marketing-demo/1";
  runNonce: string;
  startedAt: string;
  finishedAt: string;
  gitHead: string;
  sourceDigest: string;
  sourceFiles: SourceIdentity[];
  runtime: RuntimeReceipt;
  startup: PublicRouteStartupReceipt;
  requiredCases: readonly RequiredCaseName[];
  cases: CaseResult[];
  requests: { allowedStatic: number; blockedTotal: number; blocked: RequestReceipt[] };
  consoleErrors: string[];
  consoleWarnings: string[];
  strictWarningOrigins: StrictWarningOrigin[];
  strictWarningTotal: number;
  strictWarningDuplicates: number;
  strictWarningDropped: number;
  warningCaptureErrors: string[];
  replyReceipts: ReplySnapshotReceipt[];
  replyReceiptsDropped: number;
  mobileGeometry: MobileGeometryReceipt[];
  mobileFailureCapture: "not-attempted" | "written" | "failed";
  droppedConsoleErrors: number;
  droppedConsoleWarnings: number;
  primaryFailure: string | null;
  cleanup: CleanupReceipt;
  artifactErrors: string[];
  logWritten: boolean;
  logBytes: number;
  passed: boolean;
}
const report: FixtureReport = {
  fixture: "marketing-demo/1",
  runNonce: randomUUID(),
  startedAt: new Date().toISOString(),
  finishedAt: "",
  gitHead: "",
  sourceDigest: "",
  sourceFiles: [],
  runtime: {
    bun: typeof process.versions.bun === "string" ? process.versions.bun : null,
    node: "",
    compatibilityNode: process.version,
    chromium: "",
    platform: process.platform,
  },
  startup: { attempts: 0, lastStatus: null, html: false, ready: false },
  requiredCases: REQUIRED_CASES,
  cases: [],
  requests: { allowedStatic: 0, blockedTotal: 0, blocked: [] },
  consoleErrors: [],
  consoleWarnings: [],
  strictWarningOrigins: [],
  strictWarningTotal: 0,
  strictWarningDuplicates: 0,
  strictWarningDropped: 0,
  warningCaptureErrors: [],
  replyReceipts: [],
  replyReceiptsDropped: 0,
  mobileGeometry: [],
  mobileFailureCapture: "not-attempted",
  droppedConsoleErrors: 0,
  droppedConsoleWarnings: 0,
  primaryFailure: null,
  cleanup: { browser: false, server: false, errors: [] },
  artifactErrors: [],
  logWritten: false,
  logBytes: 0,
  passed: false,
};

let browser: Browser | undefined;
let server: ChildProcess | undefined;
let serverLog = "";
let manifest: DemoManifest;
let activePage: Page | undefined;
const warningCounts = new WeakMap<Page, StrictWarningCounters>();
const warningOriginsSeen = new Set<string>();
const manifestSchema = z.object({
  version: z.literal(1),
  id: z.literal("marketing"),
  agents: z.array(z.custom<AgentSummary>(isAgentSummary)).length(3),
  actions: z
    .array(
      z.object({ id: z.string(), agentId: z.string(), labelKey: z.string(), prompt: z.string(), result: z.string() }),
    )
    .length(5),
  routines: z.record(z.string(), z.array(z.custom<Routine>(isRoutine))),
  skills: z.record(
    z.string(),
    z.array(
      z.object({
        skillId: z.string(),
        slug: z.string(),
        name: z.string(),
        installedVersion: z.number(),
        availableVersion: z.number(),
        state: z.literal("installed"),
        enabled: z.boolean(),
        origin: z.literal("workspace"),
        location: z.string(),
        description: z.string(),
      }),
    ),
  ),
  files: z.record(z.string(), z.object({ content: z.string(), mimeType: z.string() })),
});
type DemoManifest = z.infer<typeof manifestSchema>;

async function bounded<T>(work: Promise<T>, ms: number, operation: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${operation} deadline`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function byteTail(value: string, limit: number): string {
  const bytes = Buffer.from(value);
  if (bytes.length <= limit) return value;
  let start = bytes.length - limit;
  while (((bytes[start] ?? 0) & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString("utf8");
}
const PRIVATE_PATHS = [ROOT, OUT, ...(process.env.HOME ? [process.env.HOME] : [])];
for (const path of PRIVATE_PATHS) {
  registerSecretValue(path);
  const escaped = JSON.stringify(path).slice(1, -1);
  if (escaped !== path) registerSecretValue(escaped);
}
function safeText(value: string): string {
  // Normalize owned prefixes before secret masking. The shared redactor deliberately masks the
  // whole token around a registered secret, which otherwise removes the useful relative module.
  let result = value;
  for (const path of [...PRIVATE_PATHS].sort((left, right) => right.length - left.length)) {
    const alias = path === OUT ? "<fixture-output>" : path === ROOT ? "<worktree>" : "<home>";
    result = result.replaceAll(JSON.stringify(path).slice(1, -1), alias).replaceAll(path, alias);
  }
  return redactText(result);
}

function guardFinalArtifact(value: string, maxBytes: number): string {
  const serialized = value.endsWith("\n") ? value : `${value}\n`;
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) throw new Error("Artifact byte bound exceeded.");
  if (PRIVATE_PATHS.some((path) => serialized.includes(path) || serialized.includes(JSON.stringify(path).slice(1, -1))))
    throw new Error("A private path remains in the final artifact.");
  return serialized;
}
function safeError(error: unknown): string {
  return byteTail(safeText(error instanceof Error ? error.message : String(error)), 8_192);
}
function serializeReport(): string {
  return guardFinalArtifact(safeText(JSON.stringify(report, null, 2)), 1024 * 1024);
}
function serializeLog(): string {
  return guardFinalArtifact(byteTail(safeText(serverLog), MAX_LOG_BYTES - 1), MAX_LOG_BYTES);
}
async function writeFixtureArtifact(
  name: "log" | "report",
  filename: "server-safe.log" | "report.json",
  serialize: () => string,
): Promise<boolean> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 10_000);
  try {
    const value = serialize();
    await bounded(
      writeFile(resolve(OUT, filename), value, { encoding: "utf8", signal: abort.signal }),
      10_000,
      `${name} artifact write`,
    );
    if (name === "log") report.logBytes = Buffer.byteLength(value, "utf8");
    return true;
  } catch (error) {
    report.artifactErrors.push(`${name}: ${safeError(error)}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
function blockedRequest(kind: string, path: string): void {
  report.requests.blockedTotal++;
  if (report.requests.blocked.length < 64) report.requests.blocked.push({ kind, path: byteTail(safeText(path), 1024) });
}
function recordConsole(kind: "error" | "warning", value: string): void {
  const rows = kind === "error" ? report.consoleErrors : report.consoleWarnings;
  if (rows.length < 64) rows.push(byteTail(safeText(value), 2_048));
  else if (kind === "error") report.droppedConsoleErrors++;
  else report.droppedConsoleWarnings++;
}

type FixtureStage =
  | RequiredCaseName
  | "runtime-metadata"
  | "owned-public-server"
  | "public-route-readiness"
  | "headless-browser"
  | "browser-cleanup"
  | "server-cleanup"
  | "log-artifact"
  | "report-artifact";
function progress(stage: FixtureStage, phase: "started" | "passed" | "failed"): void {
  // Machine-readable: stage names are fixed fixture identifiers, never visitor input.
  process.stdout.write(
    guardFinalArtifact(
      safeText(
        JSON.stringify({
          fixture: report.fixture,
          runNonce: report.runNonce,
          gitHead: report.gitHead,
          sourceDigest: report.sourceDigest,
          stage,
          phase,
        }),
      ),
      16 * 1024,
    ),
  );
}
async function waitForOwnedPublicRoute(child: ChildProcess, port: number): Promise<void> {
  const abort = new AbortController();
  let polling: ReturnType<typeof setInterval> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let settled = false;
  try {
    await new Promise<void>((accept, reject) => {
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const onError = (): void => fail(new Error("Owned public route server failed before HTTP readiness."));
      const onExit = (): void => fail(new Error("Owned public route server exited before HTTP readiness."));
      child.once("error", onError);
      child.once("exit", onExit);
      const releaseListeners = (): void => {
        child.off("error", onError);
        child.off("exit", onExit);
      };
      abort.signal.addEventListener("abort", releaseListeners, { once: true });
      deadline = setTimeout(
        () =>
          fail(
            new Error(
              `public route startup deadline: ${report.startup.attempts} owned HTTP probes; last status ${report.startup.lastStatus ?? "unavailable"}`,
            ),
          ),
        START_MS,
      );
      const probe = (): void => {
        if (settled || inFlight || abort.signal.aborted) return;
        inFlight = true;
        report.startup.attempts++;
        // Node HTTP does not follow redirects or use account cookies. Only this owned loopback
        // document can be requested. Its status and content type are sufficient; no HTML is read.
        const request = httpRequest(
          {
            hostname: "127.0.0.1",
            port,
            path: "/app-preview?useCase=marketing",
            method: "GET",
            headers: { accept: "text/html" },
            agent: false,
            signal: abort.signal,
          },
          (response) => {
            report.startup.lastStatus = response.statusCode ?? null;
            const contentType = response.headers["content-type"];
            report.startup.html = typeof contentType === "string" && contentType.toLowerCase().includes("text/html");
            const ready = response.statusCode === 200 && report.startup.html;
            response.destroy();
            inFlight = false;
            if (ready && !settled) {
              report.startup.ready = true;
              settled = true;
              accept();
            }
          },
        );
        request.once("error", () => {
          inFlight = false;
        });
        request.setTimeout(2_000, () => request.destroy(new Error("Owned public document probe timed out.")));
        request.end();
      };
      // Poll the HTTP readiness predicate. Console formatting is not a readiness contract.
      polling = setInterval(probe, 100);
      if (child.exitCode !== null || child.signalCode !== null) onExit();
      else probe();
    });
  } finally {
    clearInterval(polling);
    clearTimeout(deadline);
    abort.abort();
  }
}
async function captureWarningOrigins(): Promise<void> {
  const page = activePage;
  if (!page || page.isClosed()) return;
  try {
    const receipt = await bounded(
      page.evaluate(() => {
        const proof = window.marketingDemoProof;
        if (!proof) throw new Error("The owned page has no warning capture receipt.");
        return {
          origins: proof.strictWarnings,
          total: proof.strictWarningTotal,
          duplicates: proof.strictWarningDuplicates,
          dropped: proof.strictWarningDropped,
        };
      }),
      10_000,
      "warning origin receipt",
    );
    const previous = warningCounts.get(page) ?? { total: 0, duplicates: 0, dropped: 0 };
    report.strictWarningTotal += receipt.total - previous.total;
    report.strictWarningDuplicates += receipt.duplicates - previous.duplicates;
    report.strictWarningDropped += receipt.dropped - previous.dropped;
    warningCounts.set(page, { total: receipt.total, duplicates: receipt.duplicates, dropped: receipt.dropped });
    for (const row of receipt.origins) {
      const origin = { message: byteTail(safeText(row.message), 2_048), stack: byteTail(safeText(row.stack), 8_192) };
      const key = `${origin.message}\n${origin.stack}`;
      if (warningOriginsSeen.has(key)) continue;
      warningOriginsSeen.add(key);
      if (report.strictWarningOrigins.length < 32) report.strictWarningOrigins.push(origin);
      else report.strictWarningDropped++;
    }
  } catch (error) {
    report.warningCaptureErrors.push(safeError(error));
  }
}
async function check(name: RequiredCaseName, work: () => Promise<void>): Promise<void> {
  progress(name, "started");
  try {
    await bounded(work(), WAIT_MS * 4, name);
    await captureWarningOrigins();
    report.cases.push({ name, passed: true, detail: "passed" });
  } catch (error) {
    await captureWarningOrigins();
    report.cases.push({ name, passed: false, detail: safeError(error) });
    progress(name, "failed");
    throw error;
  }
  progress(name, "passed");
}
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((accept, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", accept);
  });
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("No owned TCP port was allocated.");
  await new Promise<void>((accept, reject) => probe.close((error) => (error ? reject(error) : accept())));
  return address.port;
}
async function processVersion(command: string, args: string[]): Promise<string> {
  const child = spawn(command, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout?.on("data", (part: Buffer) => {
    output = (output + part.toString()).slice(0, 8_192);
  });
  try {
    await bounded(
      new Promise<void>((accept, reject) => {
        child.once("error", reject);
        child.once("exit", (code) => (code === 0 ? accept() : reject(new Error("Runtime metadata failed."))));
      }),
      10_000,
      "runtime metadata",
    );
    return output.trim();
  } finally {
    await stopServer(child);
  }
}
function processAbsent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ESRCH";
}
async function stopServer(child: ChildProcess, processGroup = false): Promise<void> {
  const groupId = processGroup && process.platform !== "win32" ? child.pid : undefined;
  function signal(kind: NodeJS.Signals): void {
    if (!groupId) {
      child.kill(kind);
      return;
    }
    try {
      process.kill(-groupId, kind);
    } catch (error) {
      if (!processAbsent(error)) throw error;
    }
  }
  const stopped = child.exitCode !== null || child.signalCode !== null;
  const ended = stopped ? Promise.resolve() : new Promise<void>((accept) => child.once("exit", () => accept()));
  if (!stopped || groupId) signal("SIGTERM");
  try {
    await bounded(ended, 10_000, "server stop");
  } catch {
    signal("SIGKILL");
    await bounded(ended, 10_000, "server kill");
  }
  if (!groupId) return;
  try {
    process.kill(-groupId, 0);
  } catch (error) {
    if (processAbsent(error)) return;
    throw error;
  }
  signal("SIGKILL");
  let poll: ReturnType<typeof setInterval> | undefined;
  try {
    // A process-group absence barrier includes Vite's owned workerd child, not only its leader.
    await bounded(
      new Promise<void>((accept, reject) => {
        poll = setInterval(() => {
          try {
            process.kill(-groupId, 0);
          } catch (error) {
            if (processAbsent(error)) accept();
            else reject(error);
          }
        }, 50);
      }),
      10_000,
      "owned process group absence",
    );
  } finally {
    clearInterval(poll);
  }
}

async function preparePage(context: BrowserContext): Promise<Page> {
  await context.addInitScript(() => {
    const browserWindow: Window = window;
    const priorStorage = browserWindow.localStorage;
    // Only fixture-owned synthetic data. No account or browser profile is imported.
    priorStorage.setItem("marketing-demo-fixture-sentinel", "untouched");
    priorStorage.setItem(
      "openbot:composer-drafts",
      JSON.stringify({ agents: { campaign: { text: "synthetic prior draft" } }, channels: {} }),
    );
    const proof: BrowserProof = {
      priorStorage,
      priorDescriptor: Object.getOwnPropertyDescriptor(window, "localStorage"),
      priorApi: window.openbot,
      oldApi: undefined,
      rendererTimers: new Set(),
      rendererIntervals: new Set(),
      oldEvents: 0,
      mediaRequests: 0,
      strictWarnings: [],
      strictWarningTotal: 0,
      strictWarningDuplicates: 0,
      strictWarningDropped: 0,
    };
    window.marketingDemoProof = proof;
    const browserConsole = window.console;
    const forwardWarning = browserConsole.warn.bind(browserConsole);
    browserConsole.warn = (...args: unknown[]): void => {
      const message = args[0];
      if (typeof message === "string" && message.includes("[STRICT_READ_UNTRACKED]")) {
        proof.strictWarningTotal++;
        const previousStackLimit = Error.stackTraceLimit;
        Error.stackTraceLimit = 24;
        const stack = new Error("Strict read warning origin").stack ?? "";
        Error.stackTraceLimit = previousStackLimit;
        const origin = { message: message.slice(0, 2_048), stack: stack.slice(0, 8_192) };
        if (proof.strictWarnings.some((row) => row.message === origin.message && row.stack === origin.stack))
          proof.strictWarningDuplicates++;
        else if (proof.strictWarnings.length < 32) proof.strictWarnings.push(origin);
        else proof.strictWarningDropped++;
      }
      forwardWarning(...args);
    };
    if (navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = async () => {
        proof.mediaRequests++;
        throw new Error("A demo must not request microphone access.");
      };
    const originalSetTimeout = browserWindow.setTimeout.bind(browserWindow);
    const originalClearTimeout = browserWindow.clearTimeout.bind(browserWindow);
    const originalSetInterval = browserWindow.setInterval.bind(browserWindow);
    const originalClearInterval = browserWindow.clearInterval.bind(browserWindow);
    browserWindow.setTimeout = (handler: TimerHandler, timeout?: number, ...args: unknown[]): number => {
      const rendererOwned = /\/src\/renderer\/|\/packages\/ui\//u.test(new Error().stack ?? "");
      let id = 0;
      const callback =
        typeof handler === "function"
          ? () => {
              proof.rendererTimers.delete(id);
              handler(...args);
            }
          : handler;
      id = originalSetTimeout(callback, timeout);
      if (rendererOwned) proof.rendererTimers.add(id);
      return id;
    };
    browserWindow.clearTimeout = (id?: number) => {
      if (id !== undefined) {
        proof.rendererTimers.delete(id);
        proof.rendererIntervals.delete(id);
      }
      originalClearTimeout(id);
    };
    browserWindow.setInterval = (handler: TimerHandler, timeout?: number, ...args: unknown[]): number => {
      const callback = typeof handler === "function" ? () => handler(...args) : handler;
      const id = originalSetInterval(callback, timeout);
      if (/\/src\/renderer\/|\/packages\/ui\//u.test(new Error().stack ?? "")) proof.rendererIntervals.add(id);
      return id;
    };
    browserWindow.clearInterval = (id?: number) => {
      if (id !== undefined) {
        proof.rendererTimers.delete(id);
        proof.rendererIntervals.delete(id);
      }
      originalClearInterval(id);
    };
  });
  const page = await context.newPage();
  activePage = page;
  page.setDefaultTimeout(WAIT_MS);
  page.on("pageerror", (error) => recordConsole("error", error.message));
  page.on("console", (message) => {
    if (message.type() === "error") recordConsole("error", message.text());
    else if (message.type() === "warning") recordConsole("warning", message.text());
  });
  return page;
}
async function state(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const api = window.openbot;
    const agents = await api.agent.listAgents();
    const rows = [];
    for (const agent of agents) {
      const routines = await api.agent.listRoutines(agent.id);
      rows.push({
        agent,
        conversation: await api.agent.readConversation(agent.id),
        queue: await api.agent.listQueue(agent.id),
        memories: await api.agent.listMemories(agent.id),
        routines,
        runs: await Promise.all(
          routines.map((routine) => api.agent.listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 50 })),
        ),
        skills: await api.skills.listInstalled(agent.id),
        files: await api.agent.listWorkspaceDirectory({ agentId: agent.id, path: "." }),
      });
    }
    return JSON.stringify({
      rows,
      servers: await api.servers.list(),
      browser: await api.browser.listTabs(),
      tables: await api.agent.listTables(),
    });
  });
}
function recordReply(phase: ReplySnapshotReceipt["phase"], snapshot: ConversationSnapshot): void {
  if (report.replyReceipts.length >= 64) {
    report.replyReceiptsDropped++;
    return;
  }
  report.replyReceipts.push({
    phase,
    agentId: snapshot.agentId,
    threadId: snapshot.threadId,
    activeTurnId: snapshot.activeTurnId,
    revision: snapshot.revision,
    messageCount: snapshot.messages.length,
    messages: snapshot.messages.slice(-4).map((message) => ({
      id: message.id,
      author: message.author,
      turnId: message.turnId ?? null,
      status: message.status,
      textBytes: Buffer.byteLength(message.text, "utf8"),
      textSha256: createHash("sha256").update(message.text).digest("hex"),
    })),
  });
}
async function awaitPreviewReceipt(page: Page, target: PreviewWaitTarget): Promise<PreviewWaitReceipt> {
  return page.evaluate(
    async (input): Promise<PreviewWaitReceipt> => {
      const browserWindow: Window = window;
      const api = window.openbot;
      if (!api) throw new Error("The owned preview API is not mounted.");
      return new Promise<PreviewWaitReceipt>((accept, reject) => {
        let settled = false;
        let probing = false;
        let dirty = false;
        let unsubscribe = () => {};
        let deadline: ReturnType<Window["setTimeout"]> | undefined;
        const finish = (receipt: PreviewWaitReceipt | null, error?: Error): void => {
          if (settled) return;
          settled = true;
          browserWindow.clearTimeout(deadline);
          unsubscribe();
          if (error) reject(error);
          else if (receipt) accept(receipt);
        };
        const inspect = async (): Promise<PreviewWaitReceipt | null> => {
          if (input.target.kind === "idle") {
            const snapshots = await Promise.all(
              (await api.agent.listAgents()).map((agent) => api.agent.readConversation(agent.id)),
            );
            return snapshots.every((snapshot) => snapshot.activeTurnId === null)
              ? { snapshots, queue: null, routineRun: null }
              : null;
          }
          if (input.target.kind === "routine") {
            const runs = await api.agent.listRoutineRuns({
              agentId: input.target.agentId,
              routineId: input.target.routineId,
              limit: 50,
            });
            const run = runs[0];
            return run?.status === "succeeded" &&
              run.agentId === input.target.agentId &&
              run.routineId === input.target.routineId
              ? { snapshots: [], queue: null, routineRun: run }
              : null;
          }
          const snapshot = await api.agent.readConversation(input.target.agentId);
          const last = snapshot.messages.at(-1);
          const request = snapshot.messages.findLast((message) => message.author === "user");
          if (
            snapshot.threadId !== input.target.threadId ||
            !last ||
            last.id === input.target.previousMessageId ||
            last.author !== "assistant" ||
            last.status !== "completed" ||
            !request?.turnId ||
            last.turnId !== request.turnId ||
            snapshot.activeTurnId !== null
          )
            return null;
          const queue = await api.agent.listQueue(input.target.agentId);
          if (
            !queue.deliveries.some(
              (delivery) =>
                delivery.id === request.id && delivery.turnId === request.turnId && delivery.status === "completed",
            )
          )
            return null;
          return { snapshots: [snapshot], queue, routineRun: null };
        };
        const probe = (): void => {
          if (settled) return;
          if (probing) {
            dirty = true;
            return;
          }
          probing = true;
          void inspect()
            .then(
              (receipt) => {
                if (receipt) finish(receipt);
              },
              (error: unknown) =>
                finish(null, error instanceof Error ? error : new Error("Owned preview state read failed.")),
            )
            .finally(() => {
              probing = false;
              if (dirty && !settled) {
                dirty = false;
                probe();
              }
            });
        };
        deadline = browserWindow.setTimeout(
          () => finish(null, new Error(`Owned preview ${input.target.kind} state deadline`)),
          input.timeoutMs,
        );
        // Subscribe before the first read so a terminal event cannot fall between the two.
        unsubscribe = api.agent.onEvent(probe);
        probe();
      });
    },
    { target, timeoutMs: WAIT_MS },
  );
}
async function idle(page: Page): Promise<void> {
  await awaitPreviewReceipt(page, { kind: "idle" });
}
async function completedReply(
  page: Page,
  agentId: string,
  previousMessageId: string | null,
  threadId: string | null,
): Promise<ConversationSnapshot> {
  const receipt = await awaitPreviewReceipt(page, { kind: "reply", agentId, previousMessageId, threadId });
  const snapshot = receipt.snapshots[0];
  assert.ok(snapshot, "A completed reply must return its captured terminal snapshot.");
  recordReply("terminal", snapshot);
  // Return the very DTO that satisfied the event predicate. Do not perform a later read.
  recordReply("returned", snapshot);
  return snapshot;
}

async function openDemo(page: Page, origin: string): Promise<string> {
  await page.goto(`${origin}/app-preview?useCase=marketing`, { waitUntil: "domcontentloaded", timeout: START_MS });
  await page.getByRole("button", { name: t("preview.demo.plan"), exact: true }).waitFor();
  await page.waitForFunction(() => window.localStorage.getItem("openbot:selected-agent:v1")?.includes("campaign"));
  await idle(page);
  assert.equal(await page.getByRole("button", { name: t("composer.voice.start"), exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => window.localStorage.getItem("marketing-demo-fixture-sentinel")), null);
  assert.equal(
    await page.evaluate(() => window.marketingDemoProof?.priorStorage.getItem("marketing-demo-fixture-sentinel")),
    "untouched",
  );
  const data = await page.evaluate(async (modulePath) => {
    const module = await import(/* @vite-ignore */ modulePath);
    return module.MARKETING_DEMO_MANIFEST;
  }, `/@fs/${ROOT}/src/renderer/src/preview/marketing-demo-manifest.ts`);
  manifest = manifestSchema.parse(data);
  const actualAgents = await page.evaluate(() => window.openbot.agent.listAgents());
  assert.deepEqual(actualAgents, manifest.agents);
  for (const agent of manifest.agents) {
    const actual = await page.evaluate(
      async (agentId) => ({
        routines: await window.openbot.agent.listRoutines(agentId),
        skills: await window.openbot.skills.listInstalled(agentId),
        snapshot: await window.openbot.agent.readConversation(agentId),
        queue: await window.openbot.agent.listQueue(agentId),
        memories: await window.openbot.agent.listMemories(agentId),
      }),
      agent.id,
    );
    assert.deepEqual(actual.routines, manifest.routines[agent.id]);
    assert.deepEqual(actual.skills, manifest.skills[agent.id]);
    assert.equal(actual.snapshot.agentId, agent.id);
    assert.equal(actual.snapshot.threadId, agent.threadId);
    assert.equal(actual.snapshot.activeTurnId, null);
    assert.equal(actual.snapshot.messages.length, 1);
    assert.equal(
      actual.snapshot.messages[0]?.text,
      `${t("preview.demo.simulatedResult")}\n\n${agent.description}\n\n${t("preview.demo.welcome")}`,
    );
    assert.deepEqual(actual.queue.deliveries, []);
    assert.deepEqual(actual.memories, []);
  }
  return state(page);
}

try {
  await mkdir(resolve(OUT, "review"), { recursive: true });
  for (const path of SOURCE_FILES)
    report.sourceFiles.push({
      path,
      sha256: createHash("sha256")
        .update(await readFile(resolve(ROOT, path)))
        .digest("hex"),
    });
  report.sourceDigest = createHash("sha256").update(JSON.stringify(report.sourceFiles)).digest("hex");
  progress("runtime-metadata", "started");
  report.gitHead = await processVersion("git", ["rev-parse", "HEAD"]);
  report.runtime.node = await processVersion("node", ["--version"]);
  progress("runtime-metadata", "passed");
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const environment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    OPENBOT_API_PORT: String(port),
    OPENBOT_API_HOST: "127.0.0.1",
    CI: "true",
  };
  progress("owned-public-server", "started");
  server = spawn(
    "node",
    [resolve(ROOT, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: resolve(ROOT, "apps/auth-api"),
      env: environment,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const append = (part: Buffer): void => {
    serverLog = byteTail(serverLog + part.toString(), MAX_LOG_BYTES);
  };
  server.stdout?.on("data", append);
  server.stderr?.on("data", append);
  progress("owned-public-server", "passed");
  progress("public-route-readiness", "started");
  try {
    await waitForOwnedPublicRoute(server, port);
    progress("public-route-readiness", "passed");
  } catch (error) {
    progress("public-route-readiness", "failed");
    throw error;
  }
  progress("headless-browser", "started");
  browser = await chromium.launch({ headless: true, ...(process.platform === "darwin" ? { channel: "chrome" } : {}) });
  report.runtime.chromium = browser.version();
  progress("headless-browser", "passed");
  async function context(width: number, height: number): Promise<BrowserContext> {
    if (!browser) throw new Error("No owned browser.");
    const owned = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    await owned.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const staticType = ["document", "script", "stylesheet", "image", "font", "media", "other"].includes(
        request.resourceType(),
      );
      const staticPath =
        url.pathname === "/app-preview" ||
        url.pathname === "/@vite/client" ||
        url.pathname.startsWith("/@") ||
        url.pathname.startsWith("/node_modules/") ||
        url.pathname.startsWith("/src/") ||
        url.pathname.startsWith("/assets/") ||
        /\.(?:css|js|tsx?|png|svg|woff2?|ico)$/u.test(url.pathname);
      if (
        url.origin !== origin ||
        request.method() !== "GET" ||
        !staticType ||
        !staticPath ||
        /^\/(?:api|signal|auth|providers)(?:\/|$)/u.test(url.pathname)
      ) {
        blockedRequest(request.resourceType(), url.origin === origin ? url.pathname : "<external origin>");
        await route.abort();
        return;
      }
      report.requests.allowedStatic++;
      await route.continue();
    });
    await owned.routeWebSocket("**/*", (socket) => {
      const url = new URL(socket.url());
      if (url.origin === origin.replace("http:", "ws:") && url.searchParams.has("token")) socket.connectToServer();
      else {
        blockedRequest("websocket", "<non-static websocket>");
        socket.close();
      }
    });
    return owned;
  }
  const desktop = await context(1280, 900);
  const page = await preparePage(desktop);
  let initial = "";
  await check("fresh public route and synthetic manifest", async () => {
    initial = await openDemo(page, origin);
    assert.equal((await desktop.cookies()).length, 0);
    await page.screenshot({ path: resolve(OUT, "review/desktop-initial.png") });
  });
  for (const id of ["plan", "research", "content", "client", "report"] as const) {
    await check(`guided ${id} action`, async () => {
      const action = manifest.actions.find((item) => item.id === id);
      assert.ok(action);
      const labels: Record<typeof id, string> = {
        plan: t("preview.demo.plan"),
        research: t("preview.demo.research"),
        content: t("preview.demo.content"),
        client: t("preview.demo.client"),
        report: t("preview.demo.report"),
      };
      const previous = await page.evaluate((agentId) => window.openbot.agent.readConversation(agentId), action.agentId);
      recordReply("before", previous);
      await page.getByRole("button", { name: labels[id], exact: true }).click();
      const snapshot = await completedReply(
        page,
        action.agentId,
        previous.messages.at(-1)?.id ?? null,
        previous.threadId,
      );
      await idle(page);
      assert.equal(snapshot.messages.at(-1)?.text, `${t("preview.demo.simulatedResult")}\n\n${action.result}`);
      await page
        .getByText(
          t("preview.demo.selected", {
            name: manifest.agents.find((agent) => agent.id === action.agentId)?.name ?? "",
          }),
          { exact: true },
        )
        .waitFor();
    });
  }
  await check("manual agent switching preserves completed results", async () => {
    await page.locator(".sidebar .agent-row").filter({ hasText: "Research" }).click();
    await page.getByText(t("preview.demo.selected", { name: "Research" }), { exact: true }).waitFor();
    await page.locator(".sidebar .agent-row").filter({ hasText: "Content" }).click();
    await page.getByText(t("preview.demo.selected", { name: "Content" }), { exact: true }).waitFor();
    const snapshot = await page.evaluate(() => window.openbot.agent.readConversation("content"));
    assert.match(snapshot.messages.at(-1)?.text ?? "", /Weekly report/u);
  });
  await check("ordinary composer free text is unsupported and not echoed", async () => {
    const previous = await page.evaluate(() => window.openbot.agent.readConversation("content"));
    recordReply("before", previous);
    const editor = page.locator(".composer-editor-surface[contenteditable=true]");
    await editor.fill("Synthetic unsupported visitor request 674");
    await editor.press("Enter");
    const snapshot = await completedReply(page, "content", previous.messages.at(-1)?.id ?? null, previous.threadId);
    await idle(page);
    assert.equal(snapshot.messages.at(-1)?.text, t("preview.demo.unsupported"));
  });
  await check("files skills and routine run use the same manifest", async () => {
    const files = await page.evaluate(async () => {
      const rows = [];
      for (const entry of (await window.openbot.agent.listWorkspaceDirectory({ agentId: "content", path: "." }))
        .entries) {
        const file = await window.openbot.agent.previewWorkspaceFile({ agentId: "content", path: entry.path });
        rows.push({ path: entry.path, content: new TextDecoder().decode(file.bytes ?? undefined) });
      }
      return rows;
    });
    assert.deepEqual(
      files,
      Object.entries(manifest.files).map(([path, file]) => ({ path, content: file.content })),
    );
    await page.locator(".composer-editor-surface[contenteditable=true]").fill("Synthetic unsent draft before reset");
    await page.waitForFunction(() =>
      window.localStorage.getItem("openbot:composer-drafts")?.includes("Synthetic unsent draft before reset"),
    );
    await page.getByRole("button", { name: t("preview.demo.routines"), exact: true }).click();
    await page.getByText("Weekly campaign report", { exact: true }).first().waitFor();
    const routine = manifest.routines.content?.[0];
    assert.ok(routine);
    const previous = await page.evaluate(() => window.openbot.agent.readConversation("content"));
    recordReply("before", previous);
    await page
      .locator(".diagram-view-header")
      .getByRole("button", { name: t("diagram.node.runNow"), exact: true })
      .click();
    const snapshot = await completedReply(page, "content", previous.messages.at(-1)?.id ?? null, previous.threadId);
    const action = manifest.actions.find((item) => item.id === "report");
    assert.ok(action);
    assert.equal(snapshot.messages.at(-1)?.text, `${t("preview.demo.simulatedResult")}\n\n${action.result}`);
    await idle(page);
    const routineReceipt = await awaitPreviewReceipt(page, {
      kind: "routine",
      agentId: "content",
      routineId: routine.id,
    });
    assert.equal(routineReceipt.routineRun?.status, "succeeded");
    // The canvas reloads after its coalesced terminal event. Its API becoming idle is not a paint barrier.
    await page.locator(".diagram-inspector-run").getByText(t("diagram.run.succeeded"), { exact: true }).waitFor();
    await page.waitForFunction((routineId) => {
      const routineNode = [...document.querySelectorAll<HTMLElement>("[data-diagram-node]")].find(
        (element) => element.getAttribute("data-diagram-node") === `routine:${routineId}`,
      );
      return (
        routineNode?.querySelector(".diagram-routine-dot")?.getAttribute("data-status") === "succeeded" &&
        !document.querySelector(".diagram-view [data-firing], .diagram-view [data-status=running]")
      );
    }, routine.id);
    await page.screenshot({ path: resolve(OUT, "review/desktop-routines.png") });
  });
  await check("completed reset removes drafts panels queues and mutations", async () => {
    await page.evaluate(() =>
      window.openbot.agent.updateAgent({ agentId: "research", name: "Synthetic changed profile" }),
    );
    assert.equal(
      (await page.evaluate(() => window.openbot.agent.listAgents())).find((agent) => agent.id === "research")?.name,
      "Synthetic changed profile",
    );
    await page.getByRole("button", { name: t("preview.demo.reset"), exact: true }).click();
    await page.getByRole("button", { name: t("preview.demo.plan"), exact: true }).waitFor();
    await idle(page);
    await page.waitForFunction(() => window.localStorage.getItem("openbot:selected-agent:v1")?.includes("campaign"));
    assert.equal(await state(page), initial);
    assert.equal(await page.locator(".composer-editor-surface[contenteditable=true]").textContent(), "");
    const resetDrafts = await page.evaluate(() => window.localStorage.getItem("openbot:composer-drafts"));
    assert.equal(resetDrafts?.includes("Synthetic unsent draft before reset") ?? false, false);
    assert.equal(resetDrafts?.includes("synthetic prior draft") ?? false, false);
  });
  await check("reset during a real preview turn disposes its old API", async () => {
    await page.evaluate(() => {
      const proof = window.marketingDemoProof;
      if (!proof) throw new Error("No fixture proof.");
      proof.oldApi = window.openbot;
    });
    await page.getByRole("button", { name: t("preview.demo.plan"), exact: true }).click();
    assert.equal(
      typeof (await page.evaluate(() => window.marketingDemoProof?.oldApi?.agent.readConversation("campaign")))
        ?.activeTurnId,
      "string",
    );
    await page.getByRole("button", { name: t("preview.demo.reset"), exact: true }).click();
    await idle(page);
    await page.waitForFunction(() => window.localStorage.getItem("openbot:selected-agent:v1")?.includes("campaign"));
    assert.equal(await state(page), initial);
    assert.equal(
      await page.evaluate(async () => {
        try {
          await window.marketingDemoProof?.oldApi?.agent.sendMessage({
            agentId: "campaign",
            text: "obsolete fixture call",
            attachmentDraftIds: [],
          });
          return false;
        } catch {
          return true;
        }
      }),
      true,
    );
  });
  await check("exit restores prior bridge storage and stops owned timers", async () => {
    await page.getByRole("button", { name: t("preview.demo.plan"), exact: true }).click();
    assert.equal(
      typeof (await page.evaluate(() => window.openbot.agent.readConversation("campaign"))).activeTurnId,
      "string",
    );
    await page.evaluate(() => {
      const proof = window.marketingDemoProof;
      if (!proof) throw new Error("No fixture proof.");
      proof.oldApi = window.openbot;
      proof.oldEvents = 0;
      proof.oldApi.agent.onEvent(() => {
        proof.oldEvents++;
      });
    });
    await page.getByRole("button", { name: t("preview.demo.exit"), exact: true }).click();
    await page.getByRole("button", { name: t("preview.demo.reopen"), exact: true }).waitFor();
    await page.waitForFunction(
      () =>
        window.marketingDemoProof?.rendererTimers.size === 0 && window.marketingDemoProof.rendererIntervals.size === 0,
    );
    await page.evaluate(async () => {
      const proof = window.marketingDemoProof;
      if (!proof?.oldApi) throw new Error("No disposed mock was captured.");
      await proof.oldApi.agent.setMessageReaction({
        agentId: "campaign",
        messageId: "demo-welcome-campaign",
        emoji: "fixture",
      });
    });
    const restored = await page.evaluate(() => {
      const proof = window.marketingDemoProof;
      if (!proof) throw new Error("No fixture proof.");
      const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
      return {
        api: window.openbot === proof.priorApi,
        storage: window.localStorage === proof.priorStorage,
        getter: descriptor?.get === proof.priorDescriptor?.get,
        mediaRequests: proof.mediaRequests,
        sentinel: proof.priorStorage.getItem("marketing-demo-fixture-sentinel"),
        draft: proof.priorStorage.getItem("openbot:composer-drafts"),
        timers: proof.rendererTimers.size,
        intervals: proof.rendererIntervals.size,
        oldEvents: proof.oldEvents,
      };
    });
    assert.deepEqual(restored, {
      api: true,
      storage: true,
      getter: true,
      mediaRequests: 0,
      sentinel: "untouched",
      draft: JSON.stringify({ agents: { campaign: { text: "synthetic prior draft" } }, channels: {} }),
      timers: 0,
      intervals: 0,
      oldEvents: 0,
    });
    await page.getByRole("button", { name: t("preview.demo.reopen"), exact: true }).click();
    await idle(page);
    await page.getByRole("button", { name: t("preview.demo.plan"), exact: true }).waitFor();
    assert.equal(await state(page), initial);
  });
  await check("desktop result and current signup link", async () => {
    const previous = await page.evaluate(() => window.openbot.agent.readConversation("content"));
    recordReply("before", previous);
    await page.getByRole("button", { name: t("preview.demo.report"), exact: true }).click();
    const snapshot = await completedReply(page, "content", previous.messages.at(-1)?.id ?? null, previous.threadId);
    await idle(page);
    const action = manifest.actions.find((item) => item.id === "report");
    assert.ok(action);
    assert.equal(snapshot.messages.at(-1)?.text, `${t("preview.demo.simulatedResult")}\n\n${action.result}`);
    const signup = page.getByRole("link", { name: t("preview.demo.start"), exact: true });
    assert.equal(await signup.getAttribute("href"), "/app");
    await page.screenshot({ path: resolve(OUT, "review/desktop-result.png") });
  });
  await desktop.close();
  await check("fresh narrow mobile session guided actions reset and exit", async () => {
    const mobile = await context(390, 844);
    const mobilePage = await preparePage(mobile);
    let mobileReplyId: string | null = null;
    let alignmentWheelDeltaY = 0;
    // At most two small receipts: the successful visibility predicate and any later failure.
    const captureGeometry = async (phase: MobileGeometryReceipt["phase"]) => {
      try {
        const receipt = await bounded(
          mobilePage.evaluate(
            (input) => {
              const text = [...document.querySelectorAll<HTMLElement>(".message-copy[data-selection-message-id]")].find(
                (element) => element.getAttribute("data-selection-message-id") === input.messageId,
              );
              const body = text?.closest<HTMLElement>(".message-content-blocks");
              const scroll = document.querySelector<HTMLElement>(".conversation-scroll");
              const composer = document.querySelector<HTMLElement>(".composer-editor-surface[contenteditable=true]");
              const rect = (element: HTMLElement | null | undefined) => {
                if (!element) return null;
                const { x, y, width, height } = element.getBoundingClientRect();
                return { x, y, width, height };
              };
              const active = document.activeElement;
              return {
                phase: input.phase,
                expectedMessageId: input.messageId,
                matchedMessageId: text?.getAttribute("data-selection-message-id")?.slice(0, 128) ?? null,
                messageExists: Boolean(text),
                body: rect(body),
                scroll: rect(scroll),
                composer: rect(composer),
                viewport: { width: window.innerWidth, height: window.innerHeight },
                composerFocused: Boolean(composer && active === composer),
                activeTag: active?.tagName.slice(0, 24) ?? null,
                activeContentEditable: active instanceof HTMLElement && active.isContentEditable,
                scrollTop: scroll?.scrollTop ?? null,
                scrollHeight: scroll?.scrollHeight ?? null,
                clientHeight: scroll?.clientHeight ?? null,
                alignmentWheelDeltaY: input.alignmentWheelDeltaY,
              };
            },
            { phase, messageId: mobileReplyId?.slice(0, 128) ?? null, alignmentWheelDeltaY },
          ),
          2_000,
          "mobile geometry receipt",
        );
        report.mobileGeometry.push(receipt);
      } catch (error) {
        report.artifactErrors.push(`mobile geometry ${phase}: ${safeError(error)}`);
      }
    };
    try {
      const fresh = await openDemo(mobilePage, origin);
      assert.equal(fresh, initial);
      const previous = await mobilePage.evaluate(() => window.openbot.agent.readConversation("research"));
      recordReply("before", previous);
      await mobilePage.getByRole("button", { name: t("preview.demo.research"), exact: true }).click();
      const snapshot = await completedReply(
        mobilePage,
        "research",
        previous.messages.at(-1)?.id ?? null,
        previous.threadId,
      );
      await idle(mobilePage);
      const action = manifest.actions.find((item) => item.id === "research");
      assert.ok(action);
      assert.equal(snapshot.messages.at(-1)?.text, `${t("preview.demo.simulatedResult")}\n\n${action.result}`);
      await mobilePage.getByText(t("preview.demo.selected", { name: "Research" }), { exact: true }).waitFor();
      const reply = snapshot.messages.at(-1);
      assert.ok(reply);
      mobileReplyId = reply.id;
      const editor = mobilePage.locator(".composer-editor-surface[contenteditable=true]");
      await editor.click();
      const jump = mobilePage.locator(".scroll-to-latest-button");
      if (await jump.isVisible()) await jump.click();
      else {
        await mobilePage.locator(".conversation-scroll").hover();
        await mobilePage.mouse.wheel(0, 5_000);
      }
      // Focus the ordinary composer before the wheel gesture; scrolling must preserve that focus.
      await editor.click();
      await mobilePage.waitForFunction(() => {
        const scroll = document.querySelector<HTMLElement>(".conversation-scroll");
        return Boolean(
          scroll &&
            scroll.clientHeight > 0 &&
            Math.abs(scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop) <= 1,
        );
      });
      // The latest position can leave the short answer's prefix above the clip. Read its actual
      // offset, then use one small ordinary wheel gesture to bring the whole answer into view.
      alignmentWheelDeltaY = await mobilePage.evaluate((messageId) => {
        const text = [...document.querySelectorAll<HTMLElement>(".message-copy[data-selection-message-id]")].find(
          (element) => element.getAttribute("data-selection-message-id") === messageId,
        );
        const body = text?.closest<HTMLElement>(".message-content-blocks");
        const scroll = document.querySelector<HTMLElement>(".conversation-scroll");
        if (!body || !scroll) return 0;
        const answer = body.getBoundingClientRect();
        const clip = scroll.getBoundingClientRect();
        if (answer.top < clip.top) return Math.max(-96, answer.top - clip.top - 12);
        if (answer.bottom > clip.bottom) return Math.min(96, answer.bottom - clip.bottom + 12);
        return 0;
      }, reply.id);
      if (alignmentWheelDeltaY !== 0) {
        await mobilePage.locator(".conversation-scroll").hover();
        await mobilePage.mouse.wheel(0, alignmentWheelDeltaY);
      }
      await mobilePage.waitForFunction((messageId) => {
        const text = [...document.querySelectorAll<HTMLElement>(".message-copy[data-selection-message-id]")].find(
          (element) => element.getAttribute("data-selection-message-id") === messageId,
        );
        const body = text?.closest<HTMLElement>(".message-content-blocks");
        const scroll = document.querySelector<HTMLElement>(".conversation-scroll");
        const composer = document.querySelector<HTMLElement>(".composer-editor-surface[contenteditable=true]");
        if (!body || !scroll || !composer || document.activeElement !== composer) return false;
        const viewport = new DOMRect(0, 0, window.innerWidth, window.innerHeight);
        const inside = (element: HTMLElement, parent: DOMRect) => {
          const rect = element.getBoundingClientRect();
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            rect.left >= parent.left - 1 &&
            rect.right <= parent.right + 1 &&
            rect.top >= parent.top - 1 &&
            rect.bottom <= parent.bottom + 1
          );
        };
        return inside(scroll, viewport) && inside(body, scroll.getBoundingClientRect()) && inside(composer, viewport);
      }, reply.id);
      await captureGeometry("success");
      await mobilePage.screenshot({ path: resolve(OUT, "review/mobile-result.png") });
      await mobilePage.getByRole("button", { name: t("preview.demo.reset"), exact: true }).click();
      await idle(mobilePage);
      await mobilePage.getByRole("button", { name: t("preview.demo.plan"), exact: true }).waitFor();
      assert.equal(await state(mobilePage), initial);
      await mobilePage.getByRole("button", { name: t("preview.demo.exit"), exact: true }).click();
      await mobilePage.getByRole("button", { name: t("preview.demo.reopen"), exact: true }).waitFor();
      await mobilePage.waitForFunction(
        () =>
          window.marketingDemoProof?.rendererTimers.size === 0 &&
          window.marketingDemoProof.rendererIntervals.size === 0,
      );
    } catch (error) {
      await captureGeometry("failure");
      // A failed receipt must not prevent the independent local image attempt or replace the cause.
      try {
        await bounded(
          mobilePage.screenshot({ path: resolve(OUT, "review/mobile-failure.png"), timeout: 5_000 }),
          5_000,
          "mobile failure capture",
        );
        report.mobileFailureCapture = "written";
      } catch (captureError) {
        report.mobileFailureCapture = "failed";
        report.artifactErrors.push(`mobile failure capture: ${safeError(captureError)}`);
      }
      throw error;
    } finally {
      await captureWarningOrigins();
      await mobile.close();
    }
  });
  await check("no account provider Signal or other live requests", async () => {
    assert.deepEqual(report.requests.blocked, []);
    assert.ok(report.requests.allowedStatic > 0);
    assert.deepEqual(report.consoleErrors, []);
    assert.deepEqual(report.consoleWarnings, []);
    assert.equal(report.strictWarningTotal, 0);
    assert.deepEqual(report.warningCaptureErrors, []);
    assert.equal(report.requests.blockedTotal, 0);
  });
} catch (error) {
  report.primaryFailure = safeError(error);
} finally {
  try {
    if (browser) await bounded(browser.close(), 10_000, "browser cleanup");
    report.cleanup.browser = true;
  } catch (error) {
    report.cleanup.errors.push(safeError(error));
  }
  try {
    if (server) await stopServer(server, true);
    report.cleanup.server = !server || server.exitCode !== null || server.signalCode !== null;
  } catch (error) {
    report.cleanup.errors.push(safeError(error));
  }
  report.finishedAt = new Date().toISOString();
  report.passed =
    report.primaryFailure === null &&
    report.cases.length === REQUIRED_CASES.length &&
    REQUIRED_CASES.every((name) => report.cases.some((row) => row.name === name && row.passed)) &&
    report.requests.blockedTotal === 0 &&
    report.consoleErrors.length === 0 &&
    report.consoleWarnings.length === 0 &&
    report.droppedConsoleErrors === 0 &&
    report.droppedConsoleWarnings === 0 &&
    report.strictWarningTotal === 0 &&
    report.warningCaptureErrors.length === 0 &&
    report.cleanup.browser &&
    report.cleanup.server &&
    report.cleanup.errors.length === 0;
  // Each write has its own deadline. A failed log never suppresses the report attempt.
  report.logWritten = await writeFixtureArtifact("log", "server-safe.log", serializeLog);
  report.passed = report.passed && report.logWritten && report.artifactErrors.length === 0;
  const reportWritten = await writeFixtureArtifact("report", "report.json", serializeReport);
  report.passed = report.passed && reportWritten && report.artifactErrors.length === 0;
  const receipt = {
    fixture: report.fixture,
    runNonce: report.runNonce,
    gitHead: report.gitHead,
    sourceDigest: report.sourceDigest,
    requiredCases: report.requiredCases,
    executedCases: report.cases.length,
    passedCases: report.cases.filter((row) => row.passed).length,
    runtime: report.runtime,
    startup: report.startup,
    passed: report.passed,
    primaryFailure: report.primaryFailure,
    cleanup: report.cleanup,
    logWritten: report.logWritten,
    reportWritten,
    logBytes: report.logBytes,
    artifactErrors: report.artifactErrors,
    strictWarningTotal: report.strictWarningTotal,
    strictWarningDropped: report.strictWarningDropped,
    warningCaptureErrors: report.warningCaptureErrors,
  };
  // Machine-readable: final receipts contain source identity, runtime, and independent write results.
  process.stdout.write(guardFinalArtifact(safeText(JSON.stringify(receipt)), 64 * 1024));
  if (!report.passed) process.exitCode = 1;
}
