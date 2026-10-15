import assert from "node:assert/strict";
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  type AgentSummary,
  defaultProviderModel,
  isAgentSummary,
  isRoutineFlowCanvas,
  type RoutineRun,
  type TeamMemberSummary,
} from "@openbot/contracts/ipc";
import { guardedDecoder } from "@openbot/contracts/ipc-decoding";
import {
  isRoutineFlowHistoryPage,
  isRoutineFlowHistoryRunPage,
  ROUTINE_FLOW_HISTORY_RESPONSE_BYTES,
  type RoutineFlowHistoryInput,
  type RoutineFlowHistoryPage,
  type RoutineFlowHistoryRunInput,
  type RoutineFlowHistoryRunPage,
} from "@openbot/contracts/ipc-routine-flow-history";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { legacyTeamCapabilities, TEAM_BOOTSTRAP_CAPABILITIES } from "@openbot/contracts/team-protocol/current";
import {
  ROUTINE_FLOW_HISTORY_CAPABILITY,
  ROUTINE_FLOW_HISTORY_CODECS,
  ROUTINE_FLOW_HISTORY_ROUTES,
} from "@openbot/contracts/team-protocol/routine-flow-history-v1";
import { teamSideRouteCodec } from "@openbot/contracts/team-protocol/side-routes";
import { TEAM_CAPABILITIES_HEADER, TEAM_PROTOCOL_VERSION_HEADER } from "@openbot/contracts/team-protocol/v1";
import { translateFor } from "@openbot/i18n";
import { createOpenBotLogger, redactText, registerSecretValue } from "@openbot/logging";
import { teamRoutineFlowHistoryApi } from "@openbot/team-client/routine-flow-history";
import type { DiagramRoutineHistoryState } from "@openbot/ui/features/diagrams/diagram-model";
import { Effect } from "effect";
import { type Browser, chromium, type Page } from "playwright-core";
import { AgentRoutineStore } from "../src/backend/agent-routine-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { routineFlowRoutines } from "../src/backend/routine-flows/routine-flow-routines";
import { RoutineFlowStore } from "../src/backend/routine-flows/routine-flow-store";
import { createRoutineFlows, type RoutineFlowsHandle } from "../src/backend/routine-flows/routine-flows";
import { parseRoutineFlowHistory, parseRoutineFlowHistoryRun } from "../src/main/ipc/routine-flow-history-inputs";
import { HttpError } from "../src/main/team-api/http-error";
import { requestCapabilities, requestProtocol } from "../src/main/team-api/request-helpers";
import { routeRoutineFlowHistory } from "../src/main/team-api/route-routine-flow-history";
import { RoutineFlowHistoryController } from "../src/renderer/src/features/routine-flows/routine-flow-history-controller";

const SOURCE_FILES = [
  ".github/workflows/ci.yml",
  "bun.lock",
  "changelog.d/routine-flow-history.md",
  "docs/architecture/agents.md",
  "docs/architecture/routine-flow-history.md",
  "packages/contracts/package.json",
  "packages/contracts/src/ipc-decoding.ts",
  "packages/contracts/src/ipc-endpoints.ts",
  "packages/contracts/src/ipc-routine-flow-history.ts",
  "packages/contracts/src/ipc.ts",
  "packages/contracts/src/team-protocol/admin-wire.ts",
  "packages/contracts/src/team-protocol/current.ts",
  "packages/contracts/src/team-protocol/events-v1.ts",
  "packages/contracts/src/team-protocol/optional-routes.ts",
  "packages/contracts/src/team-protocol/routine-flow-history-v1.ts",
  "packages/contracts/src/team-protocol/routine-flows-v1.ts",
  "packages/contracts/src/team-protocol/side-routes.ts",
  "packages/contracts/src/team-protocol/v1.ts",
  "packages/contracts/src/team-protocol/v2.ts",
  "packages/contracts/src/team-protocol/v3.ts",
  "packages/contracts/src/team-protocol/v4.ts",
  "packages/contracts/src/team-protocol/v5.ts",
  "packages/contracts/src/team-protocol/v6.ts",
  "packages/contracts/src/team-protocol/v7.ts",
  "packages/i18n/src/messages/de/diagram.ts",
  "packages/i18n/src/messages/de/error/backend.ts",
  "packages/i18n/src/messages/de/error/team.ts",
  "packages/i18n/src/messages/en/diagram.ts",
  "packages/i18n/src/messages/en/error/backend.ts",
  "packages/i18n/src/messages/en/error/team.ts",
  "packages/i18n/src/messages/es/diagram.ts",
  "packages/i18n/src/messages/es/error/backend.ts",
  "packages/i18n/src/messages/es/error/team.ts",
  "packages/i18n/src/messages/fr/diagram.ts",
  "packages/i18n/src/messages/fr/error/backend.ts",
  "packages/i18n/src/messages/fr/error/team.ts",
  "packages/i18n/src/messages/it/diagram.ts",
  "packages/i18n/src/messages/it/error/backend.ts",
  "packages/i18n/src/messages/it/error/team.ts",
  "packages/i18n/src/messages/ja/diagram.ts",
  "packages/i18n/src/messages/ja/error/backend.ts",
  "packages/i18n/src/messages/ja/error/team.ts",
  "packages/i18n/src/messages/pl/diagram.ts",
  "packages/i18n/src/messages/pl/error/backend.ts",
  "packages/i18n/src/messages/pl/error/team.ts",
  "packages/i18n/src/messages/pt/diagram.ts",
  "packages/i18n/src/messages/pt/error/backend.ts",
  "packages/i18n/src/messages/pt/error/team.ts",
  "packages/i18n/src/messages/ru/diagram.ts",
  "packages/i18n/src/messages/ru/error/backend.ts",
  "packages/i18n/src/messages/ru/error/team.ts",
  "packages/i18n/src/messages/tr/diagram.ts",
  "packages/i18n/src/messages/tr/error/backend.ts",
  "packages/i18n/src/messages/tr/error/team.ts",
  "packages/logging/src/index.ts",
  "packages/team-client/package.json",
  "packages/team-client/src/routine-flow-history.ts",
  "packages/ui/src/features/diagrams/DiagramInspector.tsx",
  "packages/ui/src/features/diagrams/DiagramView.tsx",
  "packages/ui/src/features/diagrams/diagram-model.ts",
  "packages/ui/src/features/diagrams/diagrams.css",
  "scripts/routine-flow-history-e2e.ts",
  "scripts/routine-flow-history-ipc-fixture.mjs",
  "src/backend/agent-routine-store.ts",
  "src/backend/database/agent-roster.ts",
  "src/backend/database/database-core.ts",
  "src/backend/database/database-rows.ts",
  "src/backend/openbot-database-schema-history.json",
  "src/backend/openbot-database-schema.ts",
  "src/backend/openbot-database.ts",
  "src/backend/routine-flows/routine-flow-routines.ts",
  "src/backend/routine-flows/routine-flow-store.ts",
  "src/backend/routine-flows/routine-flows.ts",
  "src/backend/routine-store.ts",
  "src/backend/routine-tables.ts",
  "src/main/index.ts",
  "src/main/ipc/agent-inputs.ts",
  "src/main/ipc/define-ipc-group.ts",
  "src/main/ipc/routine-flow-history-handlers.ts",
  "src/main/ipc/routine-flow-history-inputs.ts",
  "src/main/ipc/scoped-handler.ts",
  "src/main/remote-routine-flow-history-decoding.test.ts",
  "src/main/remote-routine-flow-history-decoding.ts",
  "src/main/team-api-server.ts",
  "src/main/team-api/dependencies.ts",
  "src/main/team-api/http-error.ts",
  "src/main/team-api/request-context.ts",
  "src/main/team-api/request-helpers.ts",
  "src/main/team-api/route-routine-flow-history.ts",
  "src/main/trusted-ipc.ts",
  "src/main/trusted-renderer.ts",
  "src/preload/index.ts",
  "src/preload/routine-flow-history-decoding.test.ts",
  "src/preload/routine-flow-history-decoding.ts",
  "src/renderer/src/app-message-projection.ts",
  "src/renderer/src/features/routine-flows/RoutineFlowsCanvas.tsx",
  "src/renderer/src/features/routine-flows/WorkspaceRoutineFlows.tsx",
  "src/renderer/src/features/routine-flows/routine-flow-diagram.ts",
  "src/renderer/src/features/routine-flows/routine-flow-history-controller.ts",
  "src/renderer/src/features/routine-flows/routine-flows-port.ts",
  "src/renderer/src/features/servers/server-capabilities.ts",
  "src/renderer/src/features/web-client/web-routine-flows.ts",
  "src/renderer/src/features/web-client/web-runtime.ts",
  "src/renderer/src/preview/mock-openbot.ts",
  "src/renderer/src/preview/mock-routine-flow-history.ts",
  "src/renderer/stories/RoutineFlowHistory.stories.tsx",
] as const;

const root = resolve(import.meta.dirname, "..");
const out = resolve(root, ".openbot-build/routine-flow-history-e2e");
registerSecretValue(root);
const nonce = randomUUID();
const startedAt = new Date().toISOString();
const runFile = promisify(execFile);
const logger = createOpenBotLogger("routine-flow-history-e2e");
const checks: { name: string; passed: boolean; detail: string | null }[] = [];
const cleanupErrors: string[] = [];
const artifactErrors: string[] = [];
let failure: string | null = null;
let directory: string | null = null;
let database: OpenBotDatabase | null = null;
let flow: RoutineFlowsHandle | null = null;
let server: Server | null = null;
let reservation: Server | null = null;
let storybook: ChildProcess | null = null;
let stopStorybookOutput: (() => void) | null = null;
let browser: Browser | null = null;
let fixtureOrigin = "";
const counters = { deliveries: 0, providerAnswers: 0, handoffs: 0, changed: 0 };
const transcript: string[] = [];
const sourceFiles = SOURCE_FILES;
const uiRequested = process.argv.includes("--ui");
const expectedGroups = uiRequested ? 13 : 12;

interface FixtureLog {
  transcript: string[];
}
type FixtureReport = ReturnType<typeof createFixtureReport>;
type FixtureArtifact = FixtureReport | FixtureLog;

interface UiNetworkReceipt {
  surface: "fixture" | "storybook" | "other";
  method: string;
  path: string;
  status: number | null;
  failure: string | null;
}
interface UiDomSnapshot {
  title: string;
  bodyText: string;
  buttons: string[];
  alerts: string[];
  statuses: string[];
}
interface UiBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface UiSelectionFrame {
  viewport: { width: number; height: number; scrollWidth: number };
  panel: UiBox;
  body: UiBox;
  region: UiBox;
  input: UiBox;
  output: UiBox;
  heading: UiBox;
  note: UiBox;
  runButtons: number;
  pressedButtons: number;
  pressedText: string;
  headingText: string;
  noteText: string;
  inputText: string;
  outputText: string;
  outputHit: boolean;
}
interface UiCaptureReceipt {
  file: string;
  locale: "en" | "de";
  selection: "older" | "newest";
  sha256: string;
  bytes: number;
  frame: UiSelectionFrame;
}
type StorybookProbeCategory =
  | "not-started"
  | "network-error"
  | "probe-timeout"
  | "http-error"
  | "invalid-json"
  | "missing-story"
  | "ready";
interface StorybookReadiness {
  attempts: number;
  lastProbe: StorybookProbeCategory;
  lastHttpStatus: number | null;
}
interface UiEvidence {
  stage: string;
  stages: { name: string; startedAt: string; wallMs: number; monotonicMs: number }[];
  consoleIssues: string[];
  droppedConsoleIssues: number;
  network: UiNetworkReceipt[];
  droppedNetwork: number;
  fixtureRequests: UiNetworkReceipt[];
  droppedFixtureRequests: number;
  failureDom: UiDomSnapshot | null;
  failureScreenshot: { file: string; sha256: string; bytes: number } | null;
  diagnosticErrors: string[];
  captures: UiCaptureReceipt[];
  storybookReadiness: StorybookReadiness;
}
let uiEvidence: UiEvidence | null = null;

function diagnosticText(value: string, bytes: number): string {
  const safe = redactText(value);
  let result = "";
  let size = 0;
  for (const character of safe) {
    const next = Buffer.byteLength(character);
    if (size + next > bytes) break;
    result += character;
    size += next;
  }
  return result;
}
function uiReceipt(url: string, method: string, status: number | null, error: string | null): UiNetworkReceipt {
  const address = new URL(url);
  const surface =
    address.origin === fixtureOrigin
      ? "fixture"
      : address.protocol === "http:" && address.hostname === "127.0.0.1"
        ? "storybook"
        : "other";
  const allowedPaths: string[] = [
    "/fixture/source",
    "/iframe.html",
    "/index.json",
    ...Object.values(ROUTINE_FLOW_HISTORY_ROUTES),
  ];
  return {
    surface,
    method: diagnosticText(method, 16),
    path: allowedPaths.includes(address.pathname) ? address.pathname : "[resource]",
    status,
    failure: error === null ? null : diagnosticText(error.split("\n")[0] ?? "Request failed.", 512),
  };
}
function recordUiNetwork(receipt: UiNetworkReceipt, host = false): void {
  if (!uiEvidence) return;
  const list = host ? uiEvidence.fixtureRequests : uiEvidence.network;
  if (list.length < 64) list.push(receipt);
  else if (host) uiEvidence.droppedFixtureRequests += 1;
  else uiEvidence.droppedNetwork += 1;
}
async function uiStage<T>(name: string, work: () => Promise<T>): Promise<T> {
  assert.ok(uiEvidence);
  const evidence = uiEvidence;
  const wall = Date.now();
  const monotonic = performance.now();
  evidence.stage = name;
  try {
    return await work();
  } finally {
    if (evidence.stages.length < 32)
      evidence.stages.push({
        name,
        startedAt: new Date(wall).toISOString(),
        wallMs: Date.now() - wall,
        monotonicMs: performance.now() - monotonic,
      });
  }
}
function waitForStorybook(child: ChildProcess, origin: string, receipt: StorybookReadiness): Promise<void> {
  return new Promise<void>((done, reject) => {
    let settled = false;
    let probeAbort: AbortController | null = null;
    let probeTimer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (deadlineTimer) clearTimeout(deadlineTimer);
      if (probeTimer) clearTimeout(probeTimer);
      if (pollTimer) clearTimeout(pollTimer);
      probeAbort?.abort();
      probeAbort = null;
      child.off("error", failed);
      child.off("exit", exited);
      if (error) reject(error);
      else done();
    };
    const lastProbe = () => `Last probe: ${receipt.lastProbe}; HTTP status: ${receipt.lastHttpStatus ?? "none"}.`;
    const failed = () => finish(new Error(`Storybook could not start. ${lastProbe()}`));
    const exited = () => finish(new Error(`Storybook stopped before readiness. ${lastProbe()}`));
    const probe = async () => {
      if (settled) return;
      receipt.attempts += 1;
      receipt.lastHttpStatus = null;
      const abort = new AbortController();
      probeAbort = abort;
      probeTimer = setTimeout(() => abort.abort(), 2000);
      let readingJson = false;
      try {
        const response = await fetch(`${origin}/index.json`, { signal: abort.signal, redirect: "error" });
        if (settled) return;
        receipt.lastHttpStatus = response.status;
        if (!response.ok) receipt.lastProbe = "http-error";
        else {
          readingJson = true;
          const index = await response.json();
          if (settled) return;
          if (!isDynamicRecord(index) || !isDynamicRecord(index.entries)) receipt.lastProbe = "invalid-json";
          else if (!Object.hasOwn(index.entries, "features-routine-flow-history--controller-fixture"))
            receipt.lastProbe = "missing-story";
          else {
            receipt.lastProbe = "ready";
            finish();
          }
        }
      } catch {
        if (!settled)
          receipt.lastProbe = abort.signal.aborted ? "probe-timeout" : readingJson ? "invalid-json" : "network-error";
      } finally {
        if (probeTimer) clearTimeout(probeTimer);
        probeTimer = undefined;
        abort.abort();
        if (probeAbort === abort) probeAbort = null;
      }
      if (!settled)
        pollTimer = setTimeout(() => {
          void probe();
        }, 200);
    };
    child.once("error", failed);
    child.once("exit", exited);
    deadlineTimer = setTimeout(
      () => finish(new Error(`Storybook did not become ready within 30000ms. ${lastProbe()}`)),
      30000,
    );
    if (child.exitCode !== null || child.signalCode !== null) exited();
    else void probe();
  });
}

async function boundedUiTask<T>(name: string, work: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${name} timed out.`)), 10000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function uiStartup<T>(name: string, work: () => Promise<T>): Promise<T> {
  return uiStage(name, () => boundedUiTask(name, work));
}
async function diagnosticCall<T>(name: string, work: () => Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${name} timed out.`)), 10000);
      }),
    ]);
  } catch (error) {
    uiEvidence?.diagnosticErrors.push(`${name}: ${safeError(error)}`);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function captureUiFailure(page: Page, origin: string): Promise<void> {
  assert.ok(uiEvidence);
  if (new URL(page.url()).origin !== origin) {
    uiEvidence.diagnosticErrors.push("The failure page is outside the owned Storybook origin.");
    return;
  }
  const snapshot = await diagnosticCall("UI DOM snapshot", () =>
    page.evaluate(() => ({
      title: document.title.slice(0, 512),
      bodyText: document.body.innerText.slice(0, 16384),
      buttons: Array.from(document.querySelectorAll("button"))
        .slice(0, 64)
        .map((node) => (node.getAttribute("aria-label") ?? node.innerText).slice(0, 512)),
      alerts: Array.from(document.querySelectorAll('[role="alert"]'))
        .slice(0, 16)
        .map((node) => node.textContent?.slice(0, 1024) ?? ""),
      statuses: Array.from(document.querySelectorAll('[role="status"]'))
        .slice(0, 16)
        .map((node) => node.textContent?.slice(0, 512) ?? ""),
    })),
  );
  if (snapshot)
    uiEvidence.failureDom = {
      title: diagnosticText(snapshot.title, 512),
      bodyText: diagnosticText(snapshot.bodyText, 16384),
      buttons: snapshot.buttons.map((text) => diagnosticText(text, 512)),
      alerts: snapshot.alerts.map((text) => diagnosticText(text, 1024)),
      statuses: snapshot.statuses.map((text) => diagnosticText(text, 512)),
    };
  const screenshot = await diagnosticCall("UI failure screenshot", () =>
    page.screenshot({ animations: "disabled", fullPage: false, timeout: 10000 }),
  );
  if (!screenshot) return;
  if (screenshot.byteLength > 2 * 1024 * 1024) {
    uiEvidence.diagnosticErrors.push("The UI failure screenshot exceeds its byte limit.");
    return;
  }
  const abort = new AbortController();
  const written = await diagnosticCall("UI failure screenshot write", async () => {
    try {
      await writeFile(resolve(out, "ui-failure.png"), screenshot, { signal: abort.signal });
      return true;
    } finally {
      abort.abort();
    }
  });
  abort.abort();
  if (written)
    uiEvidence.failureScreenshot = {
      file: "ui-failure.png",
      sha256: createHash("sha256").update(screenshot).digest("hex"),
      bytes: screenshot.byteLength,
    };
}

async function selectedUiFrame(page: Page, input: string, output: string): Promise<UiSelectionFrame> {
  return boundedUiTask("Selected history frame", () =>
    page.evaluate(
      ({ input, output }) => {
        const panel = document.querySelector(".diagram-inspector");
        const body = panel?.querySelector(".diagram-inspector-body");
        const texts = Array.from(panel?.querySelectorAll(".diagram-inspector-history-step pre") ?? []);
        const inputNode = texts.find((node) => node.textContent === input);
        const outputNode = texts.find((node) => node.textContent === output);
        const region = outputNode?.closest(".diagram-inspector-history-step")?.parentElement;
        const heading = region?.querySelector("h3");
        const note = region?.querySelector("p.diagram-inspector-muted");
        if (!panel || !body || !region || !heading || !note || !inputNode || !outputNode)
          throw new Error("The selected history output or its inspector fell away before capture.");
        const box = (node: Element) => {
          const value = node.getBoundingClientRect();
          return { x: value.x, y: value.y, width: value.width, height: value.height };
        };
        const outputBox = box(outputNode);
        const hit = document.elementFromPoint(outputBox.x + outputBox.width / 2, outputBox.y + outputBox.height / 2);
        const pressed = panel.querySelectorAll('.diagram-inspector-history-select button[aria-pressed="true"]');
        return {
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            scrollWidth: document.documentElement.scrollWidth,
          },
          panel: box(panel),
          body: box(body),
          region: box(region),
          input: box(inputNode),
          output: outputBox,
          heading: box(heading),
          note: box(note),
          runButtons: panel.querySelectorAll(".diagram-inspector-history-select button").length,
          pressedButtons: pressed.length,
          pressedText: pressed[0]?.textContent?.slice(0, 512) ?? "",
          headingText: heading.textContent?.slice(0, 512) ?? "",
          noteText: note.textContent?.slice(0, 1024) ?? "",
          inputText: inputNode.textContent?.slice(0, 128) ?? "",
          outputText: outputNode.textContent?.slice(0, 128) ?? "",
          outputHit: hit !== null && outputNode.contains(hit),
        };
      },
      { input, output },
    ),
  );
}
function assertUiContained(inner: UiBox, outer: UiBox, name: string): void {
  assert.ok(
    Number.isFinite(inner.x) && Number.isFinite(inner.y) && inner.width > 0 && inner.height > 0,
    `${name} must have a positive finite box.`,
  );
  assert.ok(
    inner.x >= outer.x - 1 &&
      inner.y >= outer.y - 1 &&
      inner.x + inner.width <= outer.x + outer.width + 1 &&
      inner.y + inner.height <= outer.y + outer.height + 1,
    `${name} must stay inside its visible container.`,
  );
}
function assertSelectedUi(frame: UiSelectionFrame, locale: "en" | "de", run: number, rows: number): void {
  const viewport = { x: 0, y: 0, width: frame.viewport.width, height: frame.viewport.height };
  assertUiContained(frame.panel, viewport, "The inspector");
  assert.ok(
    frame.panel.width >= Math.min(300, viewport.width) && frame.panel.height >= viewport.height * 0.8,
    "The inspector must keep its actual panel size.",
  );
  assert.ok(frame.viewport.scrollWidth <= viewport.width + 1, "The fixture must not overflow horizontally.");
  assertUiContained(frame.body, frame.panel, "The inspector scroll body");
  assertUiContained(frame.region, frame.body, "The selected run section");
  for (const [name, box] of [
    ["input", frame.input],
    ["output", frame.output],
    ["heading", frame.heading],
    ["read-only note", frame.note],
  ] as const)
    assertUiContained(box, frame.region, `The selected ${name}`);
  assert.equal(frame.inputText, `Stored input ${run}`);
  assert.equal(frame.outputText, `Stored output ${run}`);
  assert.equal(frame.runButtons, rows);
  assert.equal(frame.pressedButtons, 1);
  assert.ok(frame.pressedText.includes(run === 0 ? "9:00" : "9:39"), "The pressed run must match the selected output.");
  const t = translateFor(locale);
  assert.equal(frame.noteText, t("diagram.history.readOnly"));
  assert.ok(
    frame.headingText.startsWith(t("diagram.history.selectedRun", { time: "" }).trim()),
    "The selected run heading must use the requested locale.",
  );
  assert.ok(frame.outputHit, "The selected output must be inside the visible scroll area.");
}
function assertStableUi(before: UiSelectionFrame, after: UiSelectionFrame): void {
  for (const key of ["panel", "body", "region", "input", "output", "heading", "note"] as const)
    for (const dimension of ["x", "y", "width", "height"] as const)
      assert.ok(
        Math.abs(before[key][dimension] - after[key][dimension]) <= 1,
        `The ${key} box must stay stable through capture.`,
      );
  assert.equal(after.headingText, before.headingText);
  assert.equal(after.pressedText, before.pressedText);
  assert.equal(after.inputText, before.inputText);
  assert.equal(after.outputText, before.outputText);
}
async function captureSelectedUi(
  page: Page,
  file: string,
  locale: "en" | "de",
  run: number,
  rows: number,
): Promise<void> {
  assert.ok(uiEvidence);
  const output = page.locator(".diagram-inspector-history-step").getByText(`Stored output ${run}`, { exact: true });
  await output.waitFor();
  const region = output.locator(
    "xpath=ancestor::section[contains(@class, 'diagram-inspector-history-step')]/parent::section",
  );
  await region.scrollIntoViewIfNeeded();
  await boundedUiTask(`${file}-paint`, () =>
    page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())))),
  );
  const before = await selectedUiFrame(page, `Stored input ${run}`, `Stored output ${run}`);
  assertSelectedUi(before, locale, run, rows);
  await boundedUiTask(`${file}-stable-paint`, () =>
    page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())))),
  );
  const stable = await selectedUiFrame(page, `Stored input ${run}`, `Stored output ${run}`);
  assertSelectedUi(stable, locale, run, rows);
  assertStableUi(before, stable);
  const screenshot = await page.screenshot({ animations: "disabled", fullPage: false, timeout: 10000 });
  const after = await selectedUiFrame(page, `Stored input ${run}`, `Stored output ${run}`);
  assertSelectedUi(after, locale, run, rows);
  assertStableUi(stable, after);
  assert.ok(screenshot.byteLength <= 2 * 1024 * 1024, "The review screenshot must stay bounded.");
  assert.equal(screenshot.readUInt32BE(16), before.viewport.width);
  assert.equal(screenshot.readUInt32BE(20), before.viewport.height);
  const abort = new AbortController();
  try {
    await boundedUiTask(`${file}-write`, () =>
      writeFile(resolve(out, `${file}.png`), screenshot, { signal: abort.signal }),
    );
  } finally {
    abort.abort();
  }
  assert.ok(uiEvidence.captures.length < 5, "The review capture count must stay bounded.");
  uiEvidence.captures.push({
    file: `${file}.png`,
    locale,
    selection: run === 0 ? "older" : "newest",
    sha256: createHash("sha256").update(screenshot).digest("hex"),
    bytes: screenshot.byteLength,
    frame: after,
  });
}

async function group(name: string, work: () => Promise<void>): Promise<void> {
  try {
    await work();
    checks.push({ name, passed: true, detail: null });
    logger.info(name);
  } catch (error) {
    checks.push({ name, passed: false, detail: safeError(error) });
    throw error;
  }
}
function safeError(error: unknown): string {
  return redactText(error instanceof Error ? error.message : String(error)).slice(0, 2000);
}
function currentDatabase(): OpenBotDatabase {
  assert.ok(database);
  return database;
}
function currentFlow(): RoutineFlowsHandle {
  assert.ok(flow);
  return flow;
}
function agent(id: string): AgentSummary {
  return {
    id,
    name: id,
    title: "History fixture",
    description: "Synthetic fixture",
    notifications: false,
    provider: "codex",
    model: defaultProviderModel("codex"),
    reasoningEffort: "medium",
    threadId: `${id}-thread`,
    workspacePath: "",
    preview: "",
    updatedAt: null,
    avatarSeed: id,
    avatarHue: null,
    avatarUrl: null,
  };
}
function deferred<A>() {
  let resolveValue: ((value: A) => void) | undefined;
  const promise = new Promise<A>((resolveValueInput) => {
    resolveValue = resolveValueInput;
  });
  return {
    promise,
    resolve: (value: A) => {
      assert.ok(resolveValue);
      resolveValue(value);
    },
  };
}
async function startFlow(db: OpenBotDatabase): Promise<RoutineFlowsHandle> {
  return Effect.runPromise(
    createRoutineFlows({
      store: new RoutineFlowStore({ database: db }),
      routines: routineFlowRoutines(new AgentRoutineStore(db)),
      delivery: () => {
        counters.deliveries += 1;
        return null;
      },
      turnAnswer: () => {
        counters.providerAnswers += 1;
        return null;
      },
      agentName: (id) => id,
      sendHandoff: () => {
        counters.handoffs += 1;
        return Effect.die("History must not start work.");
      },
      changed: () => {
        counters.changed += 1;
      },
    }),
  );
}
type FixtureHistoryRequest = RoutineFlowHistoryInput | (RoutineFlowHistoryRunInput & { visibleAgentIds?: string[] });

function controllerState(controller: RoutineFlowHistoryController): DiagramRoutineHistoryState {
  return controller.state;
}

async function request<T>(
  actor: "owner" | "admin" | "member",
  path: string,
  body: FixtureHistoryRequest,
  decode: (value: unknown) => T,
): Promise<T> {
  const response = await fetch(fixtureOrigin + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [TEAM_PROTOCOL_VERSION_HEADER]: "7",
      [TEAM_CAPABILITIES_HEADER]: ROUTINE_FLOW_HISTORY_CAPABILITY,
      "X-Fixture-Actor": actor,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new HttpError(response.status, "Fixture host refused the read.");
  const value = await response.json();
  return decode(value);
}
const decodePage = guardedDecoder(isRoutineFlowHistoryPage, "fixture history page");
const decodeRun = guardedDecoder(isRoutineFlowHistoryRunPage, "fixture history run");
function databaseReceipt(): string {
  const db = currentDatabase().connection;
  return createHash("sha256")
    .update(
      JSON.stringify({
        runs: db.prepare("SELECT run_id, status, updated_at FROM projection_routine_runs ORDER BY run_id").all(),
        steps: db
          .prepare("SELECT step_id, input, output, error, status, updated_at FROM routine_flow_steps ORDER BY step_id")
          .all(),
        events: db.prepare("SELECT count(*) AS count, max(sequence) AS sequence FROM orchestration_events").get(),
        deliveries: db.prepare("SELECT count(*) AS count FROM projection_deliveries").get(),
      }),
    )
    .digest("hex");
}
async function finalize(name: string, work: () => Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${name} cleanup timed out.`)), 10000);
      }),
    ]);
  } catch (error) {
    cleanupErrors.push(`${name}: ${safeError(error)}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function artifact(value: FixtureArtifact): string {
  const serialized = `${redactText(JSON.stringify(value, null, 2))}\n`;
  const privatePaths = directory ? [root, directory] : [root];
  const containsPrivatePath = privatePaths.some((path) => {
    const escaped = JSON.stringify(path).slice(1, -1);
    return serialized.includes(path) || serialized.includes(escaped);
  });
  if (Buffer.byteLength(serialized) > 2 * 1024 * 1024 || containsPrivatePath)
    throw new Error("Unsafe fixture artifact.");
  return serialized;
}

async function writeArtifact(
  name: "log" | "report",
  filename: "execution.log" | "report.json",
  value: FixtureArtifact,
): Promise<boolean> {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const serialized = artifact(value);
    await Promise.race([
      writeFile(resolve(out, filename), serialized, { encoding: "utf8", signal: abort.signal }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          abort.abort();
          reject(new Error(`${name} artifact write timed out.`));
        }, 10000);
      }),
    ]);
    return true;
  } catch (error) {
    artifactErrors.push(`${name}: ${safeError(error)}`);
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function createFixtureReport() {
  return {
    schema: 2,
    nonce,
    startedAt,
    finishedAt: new Date().toISOString(),
    sourceHead,
    sourceDigest,
    sourceFiles,
    sourceManifest,
    runtime: {
      bun: process.versions.bun ?? null,
      processNodeCompatibility: process.version,
      actualNode: nodeVersion,
      actualChromium,
      platform: process.platform,
    },
    checks,
    expectedGroups,
    actualGroups: checks.length,
    beforeReads,
    afterReads,
    counters,
    uiRequested,
    uiActions,
    uiReviewActions,
    uiEvidence,
    primaryFailure: failure,
    cleanupComplete: cleanupErrors.length === 0,
    cleanupErrors,
    artifactErrors,
    passed:
      failure === null &&
      checks.length === expectedGroups &&
      checks.every((check) => check.passed) &&
      cleanupErrors.length === 0 &&
      artifactErrors.length === 0,
    limits: {
      perRunPage: 20,
      perStepPage: 10,
      textBytes: 4096,
      responseBytes: 131072,
      fixtureCallMs: 10000,
      childMs: 20000,
      cleanupMs: 10000,
      artifactWriteMs: 10000,
      storybookReadyMs: 30000,
      storybookProbeMs: 2000,
      storybookPollMs: 200,
      browserLaunchMs: 30000,
      browserActionMs: 30000,
      browserNavigationMs: 30000,
      storybookStopGraceMs: 3000,
      artifactBytesIncludingNewline: 2 * 1024 * 1024,
      uiDiagnosticCallMs: 10000,
      uiPageAndPortStartupMs: 10000,
      uiDiagnosticNetworkRows: 64,
      uiDiagnosticConsoleRows: 64,
      uiDiagnosticDomBytes: 16384,
      uiFailureScreenshotBytes: 2 * 1024 * 1024,
      uiReviewCaptures: 5,
      uiReviewScreenshotBytes: 2 * 1024 * 1024,
    },
    limitations: [
      "Synthetic caller contexts drive the actual HTTP route. Full account authentication and Signal/WebRTC transport are not exercised.",
      "The IPC fixture captures the production trusted bindings. It does not launch Electron.",
      "No provider, vault, login, installed agent CLI or external delivery is used.",
      "No routine catalog, execution retry, condition nodes or native mobile UI is covered.",
      "The seven original UI actions remain required. One extra German review selection has its own counter. Five bounded selected-history captures check visible layout before and after screenshot.",
      "UI failure screenshots stay local and are not uploaded. DOM and request receipts use bounded synthetic data and omit headers, bodies and URL queries.",
      "Wall and monotonic UI stage durations locate delays. They do not prove whether the computer slept or the user paused work.",
      "Artifact writes use independent deadlines and best-effort filesystem abort. A timed-out write is a failure, not a valid artifact.",
    ],
  };
}

let sourceManifest: { path: string; sha256: string }[] = [];
let actualChromium: string | null = null;
let sourceDigest = "";
let sourceHead = "";
let nodeVersion = "";
let beforeReads = "";
let afterReads = "";
let uiActions = 0;
let uiReviewActions = 0;
const profiles = [
  agent("history-owner"),
  agent("history-secondary"),
  agent("history-hidden"),
  ...Array.from({ length: 12 }, (_value, i) => agent(`history-step-${String(i).padStart(2, "0")}`)),
];
const hidden = "history-hidden";
let routineId = "";
let emptyRoutineId = "";
let otherRoutineId = "";
const runs: RoutineRun[] = [];
try {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  sourceManifest = await Promise.all(
    sourceFiles.map(async (path) => ({
      path,
      sha256: createHash("sha256")
        .update(await readFile(resolve(root, path)))
        .digest("hex"),
    })),
  );
  sourceDigest = createHash("sha256").update(JSON.stringify(sourceManifest)).digest("hex");
  sourceHead = (await runFile("git", ["rev-parse", "HEAD"], { cwd: root, timeout: 10000 })).stdout.trim();
  nodeVersion = (await runFile("node", ["--version"], { timeout: 10000 })).stdout.trim();
  directory = await mkdtemp(resolve(tmpdir(), "openbot-routine-flow-history-"));
  registerSecretValue(directory);
  registerSecretValue(root);
  database = new OpenBotDatabase(directory);
  await Effect.runPromise(database.initialize());
  database.replaceAgents(`history-fixture-${nonce}`, profiles, "agent.fixture-roster");
  const routines = new AgentRoutineStore(database);
  const routine = routines.create(
    {
      agentId: "history-owner",
      name: "History fixture brief",
      instruction: "Write a synthetic brief.",
      active: false,
      timezone: "UTC",
      schedule: { kind: "hourly", minute: 0 },
    },
    new Date("2026-09-01T00:00:00.000Z"),
  );
  routineId = routine.id;
  emptyRoutineId = routines.create({
    ...routine,
    agentId: routine.agentId,
    name: "Empty history fixture",
    schedule: { kind: "hourly", minute: 1 },
  }).id;
  otherRoutineId = routines.create({
    ...routine,
    agentId: routine.agentId,
    name: "Other history fixture",
    schedule: { kind: "hourly", minute: 2 },
  }).id;
  const store = new RoutineFlowStore({ database });
  for (let i = 0; i < 40; i += 1) {
    const at = new Date(Date.UTC(2026, 9, 1, 9, i < 11 && i >= 7 ? 7 : i)).toISOString();
    const run = routines.createRun(routine, null, i % 2 === 0 ? "test" : "scheduled", at);
    routines.updateRunStatus(run.id, i === 0 ? "cancelled" : i === 1 ? "failed" : i === 38 ? "running" : "succeeded");
    database.connection
      .prepare("UPDATE projection_routine_runs SET created_at = ?, updated_at = ? WHERE run_id = ?")
      .run(at, at, run.id);
    runs.push({ ...run, createdAt: at, updatedAt: at });
    store.addStep(
      {
        runId: run.id,
        agentId: routine.agentId,
        input: `Stored input ${i}`,
        output: i === 38 ? null : `Stored output ${i}`,
        status: i === 0 ? "cancelled" : i === 38 ? "running" : "succeeded",
      },
      at,
    );
    if (i === 1)
      store.addStep(
        {
          runId: run.id,
          agentId: "history-secondary",
          input: "Synthetic failed input",
          output: null,
          error: "Synthetic step failed",
          status: "failed",
        },
        at,
      );
  }
  const oldest = runs[0];
  const failed = runs[1];
  const escaped = runs[3];
  const secret = runs[2];
  const multi = runs[19];
  const huge = runs[20];
  const removed = runs[5];
  assert.ok(oldest && failed && escaped && secret && multi && huge && removed);
  const marker = `history-synthetic-secret-${nonce}`;
  registerSecretValue(marker);
  const secretStep = store.addStep(
    {
      runId: secret.id,
      agentId: "history-secondary",
      input: "Synthetic ordinary input",
      output: `Synthetic credential ${marker}`,
      status: "succeeded",
    },
    secret.createdAt,
  );
  assert.ok(secretStep);
  for (const profile of profiles.filter((entry) => entry.id.startsWith("history-step-")))
    store.addStep(
      {
        runId: escaped.id,
        agentId: profile.id,
        input: "\u0001".repeat(4096),
        output: "\u0001".repeat(4096),
        status: "succeeded",
      },
      escaped.createdAt,
    );
  for (const profile of profiles.filter((entry) => entry.id.startsWith("history-step-")))
    store.addStep(
      {
        runId: multi.id,
        agentId: profile.id,
        input: "Stored multi-step input",
        output: "Stored multi-step output",
        status: "succeeded",
      },
      multi.createdAt,
    );
  const hugeStep = store.addStep(
    {
      runId: huge.id,
      agentId: "history-secondary",
      input: "文".repeat(2000),
      output: "文".repeat(100000),
      error: null,
      status: "succeeded",
    },
    huge.createdAt,
  );
  assert.ok(hugeStep);
  const link = store.createLink(
    routine.agentId,
    { routineId, fromAgentId: routine.agentId, toAgentId: hidden },
    "2026-09-01T01:00:00.000Z",
  );
  store.addStep(
    {
      runId: removed.id,
      agentId: hidden,
      input: "Synthetic hidden old input",
      output: "Synthetic hidden old output",
      status: "succeeded",
    },
    removed.createdAt,
  );
  store.deleteLink(link.id, () => routine.agentId);
  flow = await startFlow(database);
  const owner: TeamMemberSummary = {
    id: "fixture-owner",
    username: "owner",
    email: null,
    name: null,
    role: "owner",
    createdAt: "2026-09-01T00:00:00.000Z",
    disabled: false,
  };
  const actors = {
    owner,
    admin: { ...owner, id: "fixture-admin", role: "admin" } satisfies TeamMemberSummary,
    member: { ...owner, id: "fixture-member", role: "member" } satisfies TeamMemberSummary,
  };
  server = createServer((incoming, response) => {
    const requestUrl = new URL(incoming.url ?? "/", "http://fixture.invalid");
    response.once("finish", () => {
      if (uiEvidence)
        recordUiNetwork(
          uiReceipt(fixtureOrigin + requestUrl.pathname, incoming.method ?? "GET", response.statusCode, null),
          true,
        );
    });
    void (async () => {
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader(
        "Access-Control-Allow-Headers",
        `Content-Type, ${TEAM_PROTOCOL_VERSION_HEADER}, ${TEAM_CAPABILITIES_HEADER}, X-Fixture-Actor`,
      );
      if (incoming.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }
      const url = new URL(incoming.url ?? "/", "http://fixture.invalid");
      if (url.pathname === "/fixture/source") {
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({ canvas: await Effect.runPromise(currentFlow().canvas("history-owner")), agents: profiles }),
        );
        return;
      }
      const actor =
        incoming.headers["x-fixture-actor"] === "member"
          ? actors.member
          : incoming.headers["x-fixture-actor"] === "admin"
            ? actors.admin
            : actors.owner;
      const codec = teamSideRouteCodec(url.pathname);
      const outcome = await routeRoutineFlowHistory(
        {
          request: incoming,
          response,
          method: incoming.method ?? "GET",
          url,
          protocol: requestProtocol(incoming),
          capabilities: requestCapabilities(incoming),
          member: actor,
          token: "synthetic-fixture-context",
          sessionId: actor.id,
          sessionExpiresAt: "2030-01-01T00:00:00.000Z",
          json: (status, value) => {
            response.setHeader("Content-Type", "application/json");
            response.writeHead(status);
            response.end(JSON.stringify(codec ? codec.response(url.pathname, status, value) : value));
            return "handled";
          },
          empty: (status) => {
            response.writeHead(status);
            response.end();
            return "handled";
          },
        },
        currentFlow(),
        { listAgents: () => profiles },
        actor.role === "member" ? new Set([hidden]) : new Set(),
      );
      if (outcome === "unmatched") {
        response.writeHead(404);
        response.end();
      }
    })().catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500;
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: safeError(error) }));
    });
  });
  await new Promise<void>((done, reject) => {
    assert.ok(server);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server?.off("error", reject);
      done();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  fixtureOrigin = `http://127.0.0.1:${address.port}`;
  beforeReads = databaseReceipt();
  const api = teamRoutineFlowHistoryApi((method, path, decode, body) => {
    assert.equal(method, "POST");
    const input =
      path === ROUTINE_FLOW_HISTORY_ROUTES.page ? parseRoutineFlowHistory(body) : parseRoutineFlowHistoryRun(body);
    return request("owner", path, input, decode);
  });
  let firstPage: RoutineFlowHistoryPage | null = null;
  await group("40 runs use stable cursor pages, including tied timestamps", async () => {
    const first = await api.page({ agentId: routine.agentId, routineId });
    firstPage = first;
    assert.equal(first.runs.length, 20);
    assert.ok(first.nextCursor);
    const second = await api.page({ agentId: routine.agentId, routineId, cursor: first.nextCursor });
    assert.equal(second.runs.length, 20);
    assert.equal(second.nextCursor, null);
    const expected = runs
      .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .map((entry) => entry.id);
    assert.deepEqual(
      [...first.runs, ...second.runs].map((entry) => entry.id),
      expected,
    );
  });
  await group("empty history and missing or cross-routine runs do not reveal steps", async () => {
    assert.equal((await api.page({ agentId: routine.agentId, routineId: emptyRoutineId })).runs.length, 0);
    await assert.rejects(api.run({ agentId: routine.agentId, routineId, runId: "missing-fixture-run" }));
    await assert.rejects(api.run({ agentId: routine.agentId, routineId: otherRoutineId, runId: oldest.id }));
    await assert.rejects(api.page({ agentId: "history-secondary", routineId }));
  });
  await group("old input, cancelled steps and failed output remain available", async () => {
    const old = await api.run({ agentId: routine.agentId, routineId, runId: oldest.id });
    assert.equal(old.steps[0]?.input, "Stored input 0");
    assert.equal(old.steps[0]?.output, "Stored output 0");
    assert.equal(old.steps[0]?.status, "cancelled");
    const failureRun = await api.run({ agentId: routine.agentId, routineId, runId: failed.id });
    assert.ok(failureRun.steps.some((entry) => entry.status === "failed" && entry.error === "Synthetic step failed"));
  });
  await group("step pages include all 13 tied-time steps once", async () => {
    const first = await api.run({ agentId: routine.agentId, routineId, runId: multi.id });
    assert.equal(first.steps.length, 10);
    assert.ok(first.nextCursor);
    const second = await api.run({ agentId: routine.agentId, routineId, runId: multi.id, cursor: first.nextCursor });
    assert.equal(second.steps.length, 3);
    assert.equal(second.nextCursor, null);
    assert.equal(new Set([...first.steps, ...second.steps].map((step) => step.id)).size, 13);
  });
  await group("CJK, escaped JSON and redacted fields stay bounded with explicit flags", async () => {
    const result = await api.run({ agentId: routine.agentId, routineId, runId: huge.id });
    const step = result.steps.find((entry) => entry.id === hugeStep.id);
    assert.ok(step);
    assert.equal(Buffer.byteLength(step.input), 4095);
    assert.equal(step.truncated.input, true);
    assert.equal(step.output, null);
    assert.equal(step.truncated.output, true);
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= ROUTINE_FLOW_HISTORY_RESPONSE_BYTES);
    const controlResult = await api.run({ agentId: routine.agentId, routineId, runId: escaped.id });
    assert.ok(Buffer.byteLength(JSON.stringify(controlResult)) <= ROUTINE_FLOW_HISTORY_RESPONSE_BYTES);
    assert.ok(controlResult.steps.some((entry) => entry.truncated.input && entry.truncated.output));
    const secretResult = await api.run({ agentId: routine.agentId, routineId, runId: secret.id });
    assert.ok(!JSON.stringify(secretResult).includes(marker));
    assert.match(secretResult.steps.find((entry) => entry.id === secretStep.id)?.output ?? "", /redacted/u);
  });
  await group("hidden historical participants remain private after link removal", async () => {
    await assert.rejects(
      request(
        "member",
        ROUTINE_FLOW_HISTORY_ROUTES.run,
        { agentId: routine.agentId, routineId, runId: removed.id, visibleAgentIds: [hidden] },
        decodeRun,
      ),
      (error: unknown) => error instanceof HttpError && error.status === 404,
    );
    const result = await request(
      "admin",
      ROUTINE_FLOW_HISTORY_ROUTES.run,
      { agentId: routine.agentId, routineId, runId: removed.id },
      decodeRun,
    );
    assert.ok(result.steps.some((entry) => entry.agentId === hidden));
    const memberPage = await request(
      "member",
      ROUTINE_FLOW_HISTORY_ROUTES.page,
      { agentId: routine.agentId, routineId },
      decodePage,
    );
    assert.ok(memberPage.nextCursor);
    await assert.rejects(
      request(
        "member",
        ROUTINE_FLOW_HISTORY_ROUTES.page,
        { agentId: routine.agentId, routineId, cursor: memberPage.nextCursor },
        decodePage,
      ),
      (error: unknown) => error instanceof HttpError && error.status === 404,
    );
    assert.ok(
      !(await api.page({ agentId: routine.agentId, routineId })).runs.some(
        (entry) => "instruction" in entry || "deliveryId" in entry || "webhookUrl" in entry,
      ),
    );
  });
  await group("current capability codecs round trip and legacy peers omit the feature", async () => {
    const page = await api.page({ agentId: routine.agentId, routineId });
    const codec = ROUTINE_FLOW_HISTORY_CODECS.get(ROUTINE_FLOW_HISTORY_ROUTES.page);
    assert.ok(codec);
    assert.deepEqual(decodePage(codec.response(200, page)), page);
    assert.ok(!new Set<string>(TEAM_BOOTSTRAP_CAPABILITIES).has(ROUTINE_FLOW_HISTORY_CAPABILITY));
    assert.deepEqual(legacyTeamCapabilities([ROUTINE_FLOW_HISTORY_CAPABILITY]), []);
    const response = await fetch(fixtureOrigin + ROUTINE_FLOW_HISTORY_ROUTES.page, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: routine.agentId, routineId }),
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, 400);
  });
  await group("trusted IPC reads use actual bindings and current preload decoders", async () => {
    assert.ok(directory);
    const result = await runFile(
      process.execPath,
      [
        resolve(root, "scripts/routine-flow-history-ipc-fixture.mjs"),
        directory,
        fixtureOrigin,
        routine.agentId,
        routineId,
        oldest.id,
      ],
      { cwd: root, timeout: 20000, maxBuffer: 128 * 1024, env: { ...process.env, ELECTRON_RENDERER_URL: "" } },
    );
    transcript.push(redactText(result.stdout), redactText(result.stderr));
    assert.match(result.stdout, /IPC fixture passed/u);
  });
  await group("controller rejects late pages and late selected-run responses", async () => {
    assert.ok(firstPage);
    const first = firstPage;
    const pageBarrier = deferred<RoutineFlowHistoryPage>();
    const runBarrier = deferred<RoutineFlowHistoryRunPage>();
    let holdPage = true;
    let holdRun = true;
    const controller = new RoutineFlowHistoryController(
      () => ({
        available: () => true,
        api: {
          page: (input) => (holdPage ? pageBarrier.promise : api.page(input)),
          run: (input) => (holdRun ? runBarrier.promise : api.run(input)),
        },
      }),
      () => undefined,
      safeError,
    );
    const late = controller.open(`routine:${routineId}`, routine.agentId, routineId);
    holdPage = false;
    await controller.open(`routine:${emptyRoutineId}`, routine.agentId, emptyRoutineId);
    pageBarrier.resolve(first);
    await late;
    assert.equal(controller.state.routineNodeId, `routine:${emptyRoutineId}`);
    assert.ok(controller.state.page.kind === "ready" && controller.state.page.runs.length === 0);
    await controller.open(`routine:${routineId}`, routine.agentId, routineId);
    const a = first.runs[0];
    const b = first.runs[1];
    assert.ok(a && b);
    const oldSelection = controller.select(a);
    holdRun = false;
    await controller.select(b);
    runBarrier.resolve(await api.run({ agentId: routine.agentId, routineId, runId: a.id }));
    await oldSelection;
    assert.ok(controller.state.selected.kind === "ready" && controller.state.selected.run.id === b.id);
    controller.reset();
  });
  await group("old hosts make no history request and run selection is reversible", async () => {
    let reads = 0;
    let available = false;
    const controller = new RoutineFlowHistoryController(
      () => ({
        available: () => available,
        api: {
          page: (input) => {
            reads += 1;
            return api.page(input);
          },
          run: api.run,
        },
      }),
      () => undefined,
      safeError,
    );
    await controller.open(`routine:${routineId}`, routine.agentId, routineId);
    assert.equal(controller.state.page.kind, "unavailable");
    assert.equal(reads, 0);
    available = true;
    await controller.open(`routine:${routineId}`, routine.agentId, routineId);
    const page = controllerState(controller).page;
    assert.ok(page.kind === "ready");
    const latest = page.runs[0];
    assert.ok(latest);
    const old = (
      await api.page({ agentId: routine.agentId, routineId, ...(page.nextCursor ? { cursor: page.nextCursor } : {}) })
    ).runs.at(-1);
    assert.ok(old);
    await controller.select(old);
    assert.ok(controller.state.selected.kind === "ready" && controller.state.selected.run.id === old.id);
    await controller.select(latest);
    assert.ok(controller.state.selected.kind === "ready" && controller.state.selected.run.id === latest.id);
    controller.reset();
  });
  await group("history reads preserve SQLite rows and do not call execution services", async () => {
    afterReads = databaseReceipt();
    assert.equal(afterReads, beforeReads);
    assert.deepEqual(counters, { deliveries: 0, providerAnswers: 0, handoffs: 0, changed: 0 });
    const canvas = await Effect.runPromise(currentFlow().canvas(routine.agentId));
    assert.equal(canvas.routines.find((entry) => entry.routine.id === routineId)?.recentRuns.length, 10);
    assert.equal(canvas.routines.find((entry) => entry.routine.id === routineId)?.steps[0]?.output, "Stored output 39");
    assert.ok(
      new RoutineFlowStore({ database: currentDatabase() })
        .runningSteps()
        .some((entry) => entry.runId === runs[38]?.id && entry.deliveryId === null),
    );
  });
  await group("restart preserves old steps and a cursor works after its row is deleted", async () => {
    assert.ok(firstPage?.nextCursor);
    const cursor = firstPage.nextCursor;
    await Effect.runPromise(currentFlow().close());
    flow = null;
    currentDatabase().close();
    database = null;
    assert.ok(directory);
    database = new OpenBotDatabase(directory);
    await Effect.runPromise(database.initialize());
    flow = await startFlow(database);
    assert.equal(
      (await api.run({ agentId: routine.agentId, routineId, runId: oldest.id })).steps[0]?.output,
      "Stored output 0",
    );
    currentDatabase().connection.prepare("DELETE FROM projection_routine_runs WHERE run_id = ?").run(cursor.id);
    const page = await api.page({ agentId: routine.agentId, routineId, cursor });
    assert.equal(page.runs.length, 20);
    assert.equal(page.nextCursor, null);
  });
  if (uiRequested)
    await group("headless inspector uses desktop and web adapters, reverse selection and old-host state", async () => {
      const beforeUi = databaseReceipt();
      uiEvidence = {
        stage: "startup",
        stages: [],
        consoleIssues: [],
        droppedConsoleIssues: 0,
        network: [],
        droppedNetwork: 0,
        fixtureRequests: [],
        droppedFixtureRequests: 0,
        failureDom: null,
        failureScreenshot: null,
        diagnosticErrors: [],
        captures: [],
        storybookReadiness: { attempts: 0, lastProbe: "not-started", lastHttpStatus: null },
      };
      await uiStage("source-contract", async () => {
        const response = await fetch(`${fixtureOrigin}/fixture/source`, { signal: AbortSignal.timeout(10000) });
        const source = await response.json();
        assert.ok(
          response.ok &&
            typeof source === "object" &&
            source !== null &&
            "canvas" in source &&
            isRoutineFlowCanvas(source.canvas) &&
            "agents" in source &&
            Array.isArray(source.agents) &&
            source.agents.every(isAgentSummary),
          "The real fixture source must pass the Storybook bootstrap guards.",
        );
      });
      reservation = createServer();
      const ownedReservation = reservation;
      await uiStartup(
        "port-reservation",
        () =>
          new Promise<void>((done, reject) => {
            ownedReservation.once("error", reject);
            ownedReservation.listen(0, "127.0.0.1", () => {
              ownedReservation.off("error", reject);
              done();
            });
          }),
      );
      const address = ownedReservation.address();
      assert.ok(address && typeof address !== "string");
      const port = address.port;
      await uiStartup(
        "port-release",
        () => new Promise<void>((done, reject) => ownedReservation.close((error) => (error ? reject(error) : done()))),
      );
      reservation = null;
      storybook = spawn(
        "node",
        [
          resolve(root, "node_modules/storybook/dist/bin/dispatcher.js"),
          "dev",
          "--ci",
          "--no-open",
          "--exact-port",
          "--host",
          "127.0.0.1",
          "--port",
          String(port),
        ],
        { cwd: root, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] },
      );
      const ownedStorybook = storybook;
      const output = (value: Buffer) => {
        const line = redactText(value.toString());
        const remaining = 128 * 1024 - Buffer.byteLength(transcript.join(""));
        if (remaining > 0) transcript.push(diagnosticText(line, remaining));
      };
      ownedStorybook.stdout?.on("data", output);
      ownedStorybook.stderr?.on("data", output);
      stopStorybookOutput = () => {
        ownedStorybook.stdout?.off("data", output);
        ownedStorybook.stderr?.off("data", output);
      };
      const readiness = uiEvidence.storybookReadiness;
      await uiStage("storybook-ready", () => waitForStorybook(ownedStorybook, `http://127.0.0.1:${port}`, readiness));
      browser = await uiStage("chromium-launch", () => chromium.launch({ headless: true, timeout: 30000 }));
      actualChromium = browser.version();
      const ownedBrowser = browser;
      const page = await uiStartup("chromium-page", () =>
        ownedBrowser.newPage({ viewport: { width: 420, height: 900 }, locale: "en-US", timezoneId: "UTC" }),
      );
      page.setDefaultTimeout(30000);
      page.setDefaultNavigationTimeout(30000);
      const issues = uiEvidence.consoleIssues;
      const issue = (message: string) => {
        if (issues.length < 64) issues.push(diagnosticText(message.split("\n")[0] ?? "UI error.", 2000));
        else if (uiEvidence) uiEvidence.droppedConsoleIssues += 1;
      };
      page.on("pageerror", (error) => issue(error.message));
      page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning") issue(message.text());
      });
      page.on("requestfailed", (request) =>
        recordUiNetwork(
          uiReceipt(request.url(), request.method(), null, request.failure()?.errorText ?? "Request failed."),
        ),
      );
      page.on("response", (response) => {
        if (response.status() >= 400 || new URL(response.url()).origin === fixtureOrigin)
          recordUiNetwork(uiReceipt(response.url(), response.request().method(), response.status(), null));
      });
      try {
        for (const transport of ["desktop", "web"] as const) {
          const url = new URL(`http://127.0.0.1:${port}/iframe.html`);
          url.searchParams.set("id", "features-routine-flow-history--controller-fixture");
          url.searchParams.set("args", `transport:${transport}`);
          url.searchParams.set("historyFixtureHost", fixtureOrigin);
          await uiStage(`${transport}-navigation`, () => page.goto(url.href));
          await uiStage(`${transport}-history-ready`, () =>
            page.getByRole("button", { name: "Load older runs", exact: true }).waitFor(),
          );
          await uiStage(`${transport}-older-selection`, async () => {
            await page.getByRole("button", { name: "Load older runs", exact: true }).click();
            await page.getByRole("button", { name: /Oct 1.*9:00/u }).click();
            await page.getByText("Stored output 0", { exact: true }).waitFor();
          });
          uiActions += 2;
          await uiStage(`${transport}-older-capture`, () =>
            captureSelectedUi(page, `${transport}-history-older`, "en", 0, 39),
          );
          await uiStage(`${transport}-newest-selection`, async () => {
            await page.getByRole("button", { name: /Oct 1.*9:39/u }).click();
            await page.getByText("Stored output 39", { exact: true }).waitFor();
          });
          uiActions += 1;
          await uiStage(`${transport}-newest-capture`, () =>
            captureSelectedUi(page, `${transport}-history`, "en", 39, 39),
          );
        }
        await uiStartup("german-narrow-viewport", () => page.setViewportSize({ width: 320, height: 900 }));
        const germanUrl = new URL(`http://127.0.0.1:${port}/iframe.html`);
        germanUrl.searchParams.set("id", "features-routine-flow-history--controller-fixture");
        germanUrl.searchParams.set("args", "transport:web");
        germanUrl.searchParams.set("globals", "locale:de");
        germanUrl.searchParams.set("historyFixtureHost", fixtureOrigin);
        const german = translateFor("de");
        await uiStage("german-narrow-navigation", () => page.goto(germanUrl.href));
        await page.getByRole("button", { name: german("diagram.history.moreRuns"), exact: true }).waitFor();
        await page.locator(".diagram-inspector-history-select button").first().click();
        await page.getByText("Stored output 39", { exact: true }).waitFor();
        uiReviewActions += 1;
        await uiStage("german-narrow-capture", () => captureSelectedUi(page, "german-history-narrow", "de", 39, 20));
        await uiStartup("old-host-viewport", () => page.setViewportSize({ width: 420, height: 900 }));
        const oldUrl = new URL(`http://127.0.0.1:${port}/iframe.html`);
        oldUrl.searchParams.set("id", "features-routine-flow-history--controller-fixture");
        oldUrl.searchParams.set("args", "transport:web;unavailable:true");
        oldUrl.searchParams.set("historyFixtureHost", fixtureOrigin);
        await uiStage("old-host-navigation", () => page.goto(oldUrl.href));
        await uiStage("old-host-history-ready", () =>
          page.getByText("This host does not support older run inspection.", { exact: true }).waitFor(),
        );
        uiActions += 1;
        assert.deepEqual(issues, []);
        assert.equal(uiEvidence.droppedConsoleIssues, 0);
        assert.equal(uiActions, 7);
        assert.equal(uiReviewActions, 1);
        assert.equal(uiEvidence.captures.length, 5);
        await page.screenshot({ path: resolve(out, "old-host-history.png"), animations: "disabled", fullPage: true });
        assert.equal(databaseReceipt(), beforeUi);
        assert.deepEqual(counters, { deliveries: 0, providerAnswers: 0, handoffs: 0, changed: 0 });
        await page.close();
      } catch (error) {
        try {
          await captureUiFailure(page, `http://127.0.0.1:${port}`);
        } catch (diagnosticError) {
          uiEvidence.diagnosticErrors.push(`UI failure capture: ${safeError(diagnosticError)}`);
        }
        throw error;
      }
    });
} catch (error) {
  failure = safeError(error);
} finally {
  await finalize("browser", async () => {
    if (browser) await browser.close();
    browser = null;
  });
  await finalize("storybook", async () => {
    stopStorybookOutput?.();
    stopStorybookOutput = null;
    if (!storybook || storybook.exitCode !== null || storybook.signalCode !== null) return;
    const owned = storybook;
    await new Promise<void>((done) => {
      const force = setTimeout(() => {
        if (owned.exitCode === null && owned.signalCode === null) owned.kill("SIGKILL");
      }, 3000);
      owned.once("exit", () => {
        clearTimeout(force);
        done();
      });
      owned.kill("SIGTERM");
    });
    storybook = null;
  });
  await finalize("port reservation", async () => {
    if (!reservation) return;
    const owned = reservation;
    await new Promise<void>((done, reject) =>
      owned.close((error) => {
        if (!error || ("code" in error && error.code === "ERR_SERVER_NOT_RUNNING" && !owned.listening)) done();
        else reject(error);
      }),
    );
    reservation = null;
  });
  await finalize("HTTP server", async () => {
    if (!server) return;
    const owned = server;
    owned.closeAllConnections();
    await new Promise<void>((done, reject) =>
      owned.close((error) => {
        if (!error || ("code" in error && error.code === "ERR_SERVER_NOT_RUNNING" && !owned.listening)) done();
        else reject(error);
      }),
    );
    server = null;
  });
  await finalize("flow runtime", async () => {
    if (flow) await Effect.runPromise(flow.close().pipe(Effect.timeout(10000)));
    flow = null;
  });
  await finalize("SQLite", async () => {
    database?.close();
    database = null;
  });
  await finalize("owned temporary data", async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  const logWritten = await writeArtifact("log", "execution.log", { transcript });
  const report = createFixtureReport();
  const reportWritten = await writeArtifact("report", "report.json", report);
  const artifactComplete = logWritten && reportWritten;
  const passed = report.passed && artifactComplete && artifactErrors.length === 0;
  logger.info("Fixture report: .openbot-build/routine-flow-history-e2e/report.json", {
    nonce,
    sourceSHA: sourceHead,
    sourceDigest,
    expectedGroups,
    actualGroups: checks.length,
    passed,
    cleanupComplete: cleanupErrors.length === 0,
    artifactWritten: reportWritten,
    artifactComplete,
    primaryFailure: failure,
    cleanupErrors,
    artifactErrors,
  });
  if (!passed) process.exitCode = 1;
}
