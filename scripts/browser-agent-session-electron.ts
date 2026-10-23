import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { redactText } from "@openbot/logging";
import { app, BrowserWindow, session, type WebContents, webContents } from "electron";
import { z } from "zod";
import { BrowserHost } from "../src/backend/browser-host";
import { agentBrowserSessionKey } from "../src/backend/browser-state";
import { runCauseEffect } from "../src/backend/effect-boundary";

const argument = (name: string) => {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
};
const fixtureRoot = argument("fixture-root");
const reportPath = argument("report-path");
const runId = argument("run-id");

const cases: string[] = [];
const statePath = join(fixtureRoot, "tabs.json");
const storedStateSchema = z.object({
  version: z.literal(2),
  activeTabId: z.string().nullable(),
  tabs: z.array(z.looseObject({ id: z.string(), url: z.string(), agentSession: z.string().optional() })),
});

const storedValuesSchema = z.object({
  cookie: z.string(),
  local: z.string().nullable(),
  indexed: z.string().nullable(),
});
type StoredValues = z.infer<typeof storedValuesSchema>;

const server = createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end('<!doctype html><meta charset="utf-8"><title>Fixture</title><p>Fixture</p>');
});

// Agents A and B have a session of their own. Agent C keeps the shared one.
const ownBrowserSession = (agentId: string) => agentId === "agent-a" || agentId === "agent-b";

let browser: BrowserHost | undefined;
let currentPhase = "entry";

void main().catch((error) => {
  process.stderr.write(`${redactText(String(error))}\n`);
  app.exit(1);
});

async function main(): Promise<void> {
  app.setPath("userData", join(fixtureRoot, "profile"));
  app.setPath("sessionData", join(fixtureRoot, "session"));
  if (process.platform === "darwin") app.setActivationPolicy("accessory");
  phase("entry-start");
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert(address && typeof address === "object", "Fixture server address missing.");
    const origin = `http://127.0.0.1:${address.port}`;
    const page = (name: string) => `${origin}/${name}`;
    await app.whenReady();
    phase("electron-ready");

    browser = new BrowserHost(newWindow(), join(fixtureRoot, "downloads"), statePath, { ownBrowserSession });
    const first = browser;
    const a = await runCauseEffect(first.open(page("a"), "thread-a", "agent-a"));
    const b = await runCauseEffect(first.open(page("b"), "thread-b", "agent-b"));
    const c = await runCauseEffect(first.open(page("c"), "thread-c", "agent-c"));
    const shared = await runCauseEffect(first.open(page("shared")));
    // The last write wins in a session that two tabs share.
    await writeValues(contentsFor(a.url), "a");
    await writeValues(contentsFor(b.url), "b");
    await writeValues(contentsFor(c.url), "c");
    assert.deepEqual(await readValues(contentsFor(a.url)), values("a"));
    assert.deepEqual(await readValues(contentsFor(b.url)), values("b"));
    recordCases("own-sessions-isolate-cookies-storage-indexeddb");
    assert.deepEqual(await readValues(contentsFor(shared.url)), values("c"));
    recordCases("agent-without-setting-uses-shared-session");

    phase("popup");
    const popupUrl = page("popup-a");
    const popupOpened = loadedContents(first, popupUrl);
    await contentsFor(a.url).executeJavaScript(`window.open(${JSON.stringify(popupUrl)}, "_blank"); true`, true);
    assert.deepEqual(await readValues(await popupOpened), values("a"));
    recordCases("popup-inherits-opener-session");

    phase("restart");
    await runCauseEffect(first.destroy());
    browser = undefined;
    const saved = storedStateSchema.parse(JSON.parse(await readFile(statePath, "utf8")));
    const savedSession = (id: string) => saved.tabs.find((tab) => tab.id === id)?.agentSession;
    assert.equal(savedSession(a.id), agentBrowserSessionKey("agent-a"));
    assert.equal(savedSession(b.id), agentBrowserSessionKey("agent-b"));
    assert.equal(savedSession(c.id), undefined);
    assert.equal(savedSession(shared.id), undefined);
    recordCases("saved-tabs-record-their-session");
    // A tab a released build wrote has no session key, even when its agent now has a session of its own.
    // A key that is not a key drops the tab.
    saved.tabs.push(
      { id: "legacy-tab", url: page("legacy"), ownerThreadId: "thread-a", ownerAgentId: "agent-a" },
      {
        id: "malformed-tab",
        url: page("malformed"),
        ownerThreadId: "thread-a",
        ownerAgentId: "agent-a",
        agentSession: "../openbot-browser",
      },
    );
    await writeFile(statePath, `${JSON.stringify(saved, null, 2)}\n`);

    browser = new BrowserHost(newWindow(), join(fixtureRoot, "downloads"), statePath, { ownBrowserSession });
    const second = browser;
    await runCauseEffect(second.restore());
    const restoredIds = second.listTabs().map((tab) => tab.id);
    assert(restoredIds.includes("legacy-tab"), "The legacy tab was not restored.");
    assert(!restoredIds.includes("malformed-tab"), "The tab with a malformed session key was restored.");
    recordCases("malformed-session-key-drops-tab");
    const reload = async (tabId: string, url: string) => {
      const loaded = loadedContents(second, url);
      await runCauseEffect(second.loadUrl(tabId, url));
      return loaded;
    };
    assert.deepEqual(await readValues(await reload(a.id, page("a-restored"))), values("a"));
    assert.deepEqual(await readValues(await reload(b.id, page("b-restored"))), values("b"));
    assert.deepEqual(await readValues(await reload(shared.id, page("shared-restored"))), values("c"));
    recordCases("restored-tabs-keep-session-and-data");
    assert.deepEqual(await readValues(await reload("legacy-tab", page("legacy-restored"))), values("c"));
    recordCases("legacy-tab-stays-in-shared-session");

    phase("clear");
    const partitionCookies = (agentId: string) =>
      session.fromPartition(`persist:openbot-browser-agent-${agentBrowserSessionKey(agentId)}`).cookies.get({});
    // A tab that is still open keeps its session, and the call says so.
    await assert.rejects(runCauseEffect(second.clearAgentSession("agent-b")));
    assert.equal((await partitionCookies("agent-b")).length, 1);
    await runCauseEffect(second.close(b.id));
    await runCauseEffect(second.clearAgentSession("agent-b"));
    assert.equal((await partitionCookies("agent-b")).length, 0);
    assert.equal((await partitionCookies("agent-a")).length, 1);
    assert.deepEqual(await readValues(contentsFor(page("shared-restored"))), values("c"));
    recordCases("clear-agent-session-clears-only-that-agent");
    const partitionDirectory = (agentId: string) =>
      join(fixtureRoot, "session", "Partitions", `openbot-browser-agent-${agentBrowserSessionKey(agentId)}`);
    assert(existsSync(partitionDirectory("agent-a")), "The agent partition is not where the host looks for it.");
    await runCauseEffect(second.clearAgentSession("agent-c"));
    assert(!existsSync(partitionDirectory("agent-c")), "Clearing created a partition for an agent without one.");
    recordCases("clear-agent-session-creates-no-partition");

    const report = {
      status: "passed",
      runId,
      sourceSha: argument("source-sha"),
      harnessRuntime: argument("harness-runtime"),
      bunVersion: argument("bun-version"),
      electron: process.versions.electron,
      cases,
      scope:
        "Owned hidden native process, temporary profile, and a loopback page. BrowserHost with agent sessions, popups, a restart from the saved tab file, and session clearing. No provider calls, no agent service, no Team API transport.",
    };
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(
      reportPath,
      `${JSON.stringify({ status: "failed", runId, sourceSha: argument("source-sha"), phase: currentPhase, cases, reason: redactText(String(error)) }, null, 2)}\n`,
    );
    process.exitCode = 1;
  } finally {
    phase("native-cleanup");
    if (browser) await runCauseEffect(browser.destroy());
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    app.exit(Number(process.exitCode ?? 0));
  }
}

function newWindow(): BrowserWindow {
  return new BrowserWindow({
    show: false,
    width: 1024,
    height: 768,
    focusable: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
}

function values(who: string): StoredValues {
  return { cookie: `who=${who}`, local: who, indexed: who };
}

function contentsFor(url: string): WebContents {
  const contents = webContents.getAllWebContents().find((item) => item.getURL() === url);
  assert(contents, `Missing contents for ${url}.`);
  return contents;
}

/** Resolves with the contents of `url` once its page has loaded, whichever tab it is in. */
function loadedContents(host: BrowserHost, url: string): Promise<WebContents> {
  return new Promise((resolve) => {
    const check = () => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === url && !item.isLoading());
      if (!contents) return false;
      unsubscribe();
      resolve(contents);
      return true;
    };
    const unsubscribe = host.onChanged(() => void check());
    check();
  });
}

const INDEXED_DB = `new Promise((resolve, reject) => {
  const request = indexedDB.open("fixture", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("values");
  request.onerror = () => reject(request.error);
  request.onsuccess = () => resolve(request.result);
})`;

async function writeValues(contents: WebContents, who: string): Promise<void> {
  await contents.executeJavaScript(`(async () => {
    document.cookie = "who=${who}; max-age=3600; path=/";
    localStorage.setItem("who", "${who}");
    const db = await ${INDEXED_DB};
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("values", "readwrite");
      transaction.objectStore("values").put("${who}", "who");
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  })()`);
}

async function readValues(contents: WebContents): Promise<StoredValues> {
  return storedValuesSchema.parse(
    await contents.executeJavaScript(`(async () => {
    const db = await ${INDEXED_DB};
    const indexed = await new Promise((resolve, reject) => {
      const request = db.transaction("values").objectStore("values").get("who");
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return { cookie: document.cookie, local: localStorage.getItem("who"), indexed };
  })()`),
  );
}

function phase(name: string): void {
  currentPhase = name;
  // Machine-readable: phase receipts contain no page data.
  process.stdout.write(`${JSON.stringify({ runId, phase: name, status: "running" })}\n`);
}

function recordCases(...names: string[]): void {
  for (const name of names) {
    cases.push(name);
    process.stdout.write(`${JSON.stringify({ runId, case: name, status: "passed" })}\n`);
  }
}
