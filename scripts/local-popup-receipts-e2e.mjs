/** Failure modes: lost display ingress, secret retention, duplicate identity, cursor gaps, and retention overflow. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire, registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect } from "effect";
import { ErrorReceiptStore, showStartupErrorReceipt } from "../src/main/error-receipt-store.ts";
import { parseErrorReceiptInput, parseErrorReceiptQuery } from "../src/main/ipc/notification-inputs.ts";
import { decodeErrorReceipt, decodeErrorReceiptBatch } from "../src/preload/app-decoding.ts";

const reportPath = resolve(".openbot-build/local-popup-receipts-e2e.json");
const directory = await mkdtemp(join(tmpdir(), "openbot-local-receipts-"));
const checks = [];
const run = Effect.runPromise;
const input = { presentation: "toast", operation: "attachment", cause: "attachment_upload_failed" };
const secret = "fixture-secret-sk-private /Users/private/account https://private.invalid/token";
const check = (name) => checks.push({ name, status: "pass" });
let disposeUi;
let dom;
let electronHook;
try {
  await mkdir(resolve(".openbot-build"), { recursive: true });
  const path = join(directory, "logs", "error-receipts.ndjson");
  let store = new ErrorReceiptStore(path);

  // Exercise the real handler registrations. Only Electron is replaced; trusted IPC remains active.
  const registrations = new Map();
  globalThis.__receiptIpcRegistrations = registrations;
  electronHook = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === "electron")
        return {
          url:
            "data:text/javascript," +
            encodeURIComponent(`
        export const ipcMain = { handle: (channel, fn) => globalThis.__receiptIpcRegistrations.set(channel, fn) };
        export class Notification { static isSupported() { return true; } }
      `),
          shortCircuit: true,
        };
      return next(specifier, context);
    },
  });
  const { notificationIpcHandlers } = await import("../src/main/ipc/notification-handlers.ts");
  const { registerIpcGroup } = await import("../src/main/ipc/define-ipc-group.ts");
  const { IPC_ENDPOINTS } = await import("@openbot/contracts/ipc");
  const { notifications } = notificationIpcHandlers({
    get errorReceipts() {
      return store;
    },
    notificationPreference: { get: () => ({ desktopNotifications: false, messagePreview: false }) },
    translate: (key) => key,
    requestPermission: async () => {},
    openExternal: async () => {},
  });
  registerIpcGroup("notifications", notifications);
  const sender = { senderFrame: { url: "openbot-app://app/index.html" } };
  const invoke = (endpoint, payload) => registrations.get(endpoint.channel)(sender, payload);
  const record = async (payload) =>
    decodeErrorReceipt(await invoke(IPC_ENDPOINTS.notifications.recordErrorReceipt, payload));
  const read = async (query) =>
    decodeErrorReceiptBatch(await invoke(IPC_ENDPOINTS.notifications.readErrorReceipts, query));
  await assert.rejects(async () => record({ ...input, text: secret }));
  await assert.rejects(async () => record({ ...input, operation: secret }));
  assert.throws(() => parseErrorReceiptInput({ ...input, cause: secret }));
  for (const query of [{ limit: 51 }, { limit: 0 }, { after: secret }, { secret }]) {
    assert.throws(() => parseErrorReceiptQuery(query));
  }
  await assert.rejects(async () =>
    registrations.get(IPC_ENDPOINTS.notifications.recordErrorReceipt.channel)(
      { senderFrame: { url: "https://untrusted.invalid" } },
      input,
    ),
  );
  assert.equal((await read({})).records.length, 0);
  check("validated IPC rejects unknown fields, arbitrary identifiers, oversized queries, and untrusted senders");

  // Compile actual shared UI with the installed Solid compiler. No browser, live app, or new dependency.
  const require = createRequire(import.meta.url);
  const { build, transform } = require("esbuild");
  const babel = require("@babel/core");
  const solidPreset = require("babel-preset-solid");
  const { JSDOM } = require("jsdom");
  dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    url: "https://fixture.invalid",
    pretendToBeVisual: true,
  });
  for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Element",
    "Node",
    "MutationObserver",
    "CustomEvent",
    "Event",
    "MouseEvent",
    "KeyboardEvent",
    "SVGElement",
    "HTMLButtonElement",
    "HTMLInputElement",
    "DocumentFragment",
    "NodeFilter",
  ])
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const pending = [];
  const retained = [];
  window.openbot = {
    notifications: {
      recordErrorReceipt: (value) => {
        const promise = record(value).then((receipt) => {
          retained.push(receipt);
          return receipt;
        });
        pending.push(promise);
        return promise;
      },
    },
  };
  const entry = `
    import { render } from "@solidjs/web";
    import { createSignal, flush } from "solid-js";
    import { Alert, NotificationObserver } from "./packages/ui/src/alert";
    import { ConfirmDialog } from "./packages/ui/src/confirm-dialog";
    import { Toaster, toast } from "./packages/ui/src/toast";
    import { configureErrorReports, reportNotification, retainErrorReceipt } from "./src/renderer/src/error-reports";
    const [banner, setBanner] = createSignal(false);
    const [dialog, setDialog] = createSignal(false);
    const [error, setError] = createSignal("");
    const [noReportError, setNoReportError] = createSignal(false);
    export const shownNotifications = [];
    export { flush, setBanner, setDialog, setError, setNoReportError, toast, configureErrorReports };
    export const dispose = render(() => <NotificationObserver onShown={(report) => { shownNotifications.push(report); reportNotification(report); }} onErrorShown={retainErrorReceipt}>
      <Alert tone={banner() ? "danger" : "neutral"}>{${JSON.stringify(secret)}}</Alert>
      {noReportError() && <Alert tone="danger" report={false}>no-report-error</Alert>}
      <ConfirmDialog open={dialog()} error={error()} title="Fixture" confirmLabel="Confirm" onConfirm={() => {}} onCancel={() => {}} />
      <Toaster onToastShown={reportNotification} onErrorShown={retainErrorReceipt} duration={Infinity} />
    </NotificationObserver>, document.getElementById("root"));
  `;
  const bundlePath = join(directory, "receipt-ui.mjs");
  const bundle = await build({
    stdin: { contents: entry, loader: "tsx", resolveDir: process.cwd(), sourcefile: "receipt-fixture.tsx" },
    outfile: bundlePath,
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    conditions: ["browser", "solid"],
    define: { "import.meta.env.PROD": "false", "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "installed-solid-compiler",
        setup(build) {
          build.onLoad({ filter: /\.[jt]sx$/ }, async ({ path }) => {
            const source = await readFile(path, "utf8");
            const stripped = await transform(source, {
              loader: path.endsWith("tsx") ? "tsx" : "jsx",
              jsx: "preserve",
              format: "esm",
            });
            const result = babel.transformSync(stripped.code, {
              filename: path,
              configFile: false,
              babelrc: false,
              presets: [[solidPreset, { generate: "dom", hydratable: false }]],
            });
            return { contents: result.code, loader: "js" };
          });
        },
      },
    ],
  });
  // stdin also needs the Solid transform; compile it before bundling on the second, entry-only pass.
  const strippedEntry = await transform(entry, { loader: "tsx", jsx: "preserve", format: "esm" });
  const compiledEntry = babel.transformSync(strippedEntry.code, {
    filename: "receipt-fixture.tsx",
    configFile: false,
    babelrc: false,
    presets: [[solidPreset, { generate: "dom", hydratable: false }]],
  });
  const compiled = await build({
    ...{
      stdin: { contents: compiledEntry.code, loader: "js", resolveDir: process.cwd() },
      outfile: bundlePath,
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      conditions: ["browser", "solid"],
      define: { "import.meta.env.PROD": "false", "process.env.NODE_ENV": '"production"' },
    },
    plugins: [
      {
        name: "installed-solid-compiler",
        setup(build) {
          build.onLoad({ filter: /\.[jt]sx$/ }, async ({ path }) => {
            const source = await readFile(path, "utf8");
            const stripped = await transform(source, {
              loader: path.endsWith("tsx") ? "tsx" : "jsx",
              jsx: "preserve",
              format: "esm",
            });
            const result = babel.transformSync(stripped.code, {
              filename: path,
              configFile: false,
              babelrc: false,
              presets: [[solidPreset, { generate: "dom", hydratable: false }]],
            });
            return { contents: result.code, loader: "js" };
          });
        },
      },
    ],
  });
  void bundle;
  await writeFile(bundlePath, compiled.outputFiles[0].contents);
  const ui = await import(pathToFileURL(bundlePath).href);
  disposeUi = ui.dispose;
  const waitForText = (text) => {
    if (document.body.textContent.includes(text)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const deadline = setTimeout(() => {
        observer.disconnect();
        reject(new Error("Display event deadline exceeded"));
      }, 5_000);
      const observer = new MutationObserver(() => {
        if (!document.body.textContent.includes(text)) return;
        clearTimeout(deadline);
        observer.disconnect();
        resolve();
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    });
  };
  const settle = async (count) => {
    ui.flush();
    await Promise.all(pending);
    assert.equal(retained.length, count);
    ui.flush();
    await waitForText(retained.at(-1).id);
  };
  ui.configureErrorReports(false);
  ui.setBanner(true);
  await settle(1);
  ui.setDialog(true);
  ui.setError(secret);
  await settle(2);
  ui.toast.error(secret, {
    error: new Error("Invalid upload request"),
    report: {
      operation: "attachment",
      source: "upload",
      cause_code: "attachment_upload_failed",
    },
  });
  await waitForText("Invalid upload request").catch(() => undefined);
  await settle(3);
  assert.deepEqual(
    retained.map((receipt) => receipt.presentation),
    ["banner", "confirmation_dialog", "toast"],
  );
  await showStartupErrorReceipt(store, (id) => {
    assert.match(id, /^rcpt_/);
  });
  assert.equal((await read({})).records.length, 4);
  check(
    "real toast, banner, confirmation dialog, and native startup ingress each retain one receipt with tracking disabled",
  );
  ui.setBanner(false);
  ui.flush();
  ui.setBanner(true);
  await settle(4);
  assert.notEqual(retained[0].id, retained[3].id);
  const shownCount = ui.shownNotifications.length;
  ui.setNoReportError(true);
  await settle(5);
  assert.equal(retained.at(-1).presentation, "banner");
  assert.ok(document.body.textContent.includes(retained.at(-1).id));
  assert.equal(ui.shownNotifications.length, shownCount);
  check("report=false error banners retain and display receipt IDs without telemetry notifications");
  const beforeRestart = await read({});
  store = new ErrorReceiptStore(path);
  // Handler owns the original store; direct reads below prove the persisted restart state.
  assert.deepEqual(await run(store.read({})), beforeRestart);
  check("repeated displays have distinct IDs; retained IDs and ordered cursors survive restart");
  let cursor;
  const seen = [];
  let batch;
  do {
    batch = await run(store.read({ ...(cursor ? { after: cursor } : {}), limit: 2 }));
    assert.equal(batch.gap, false);
    seen.push(...batch.records.map((receipt) => receipt.id));
    cursor = batch.cursor;
  } while (batch.hasMore);
  assert.deepEqual(
    seen,
    beforeRestart.records.map((receipt) => receipt.id),
  );
  assert.equal((await run(store.read({ after: cursor }))).records.length, 0);
  assert.equal((await run(store.read({ after: cursor }))).cursor, cursor);
  check("incremental boundary reads neither skip nor replay; empty reads preserve the cursor");
  let now = 1_000;
  const rotatingPath = join(directory, "rotation.ndjson");
  let rotating = new ErrorReceiptStore(rotatingPath, { maxBytes: 1_800, maxCount: 3, maxAgeMs: 100, now: () => now });
  const first = await run(rotating.record(input));
  for (let index = 0; index < 6; index++) await run(rotating.record(input));
  rotating = new ErrorReceiptStore(rotatingPath, { maxBytes: 1_800, maxCount: 3, maxAgeMs: 100, now: () => now });
  const pruned = await run(rotating.read({ after: first.cursor }));
  assert.equal(pruned.gap, true);
  assert.equal(pruned.records.length, 3);
  assert.equal((await run(rotating.read({}))).gap, true);
  assert.ok((await stat(rotatingPath)).size + (await stat(`${rotatingPath}.1`)).size <= 1_800);
  const stable = await run(rotating.read({ after: pruned.records[0].cursor, limit: 1 }));
  assert.equal(stable.gap, false);
  assert.equal(stable.records[0].id, pruned.records[1].id);
  now += 101;
  const expired = await run(rotating.read({ after: first.cursor }));
  assert.equal(expired.gap, true);
  assert.equal(expired.records.length, 0);
  assert.equal((await run(rotating.read({ after: expired.cursor }))).gap, false);
  const replaced = await run(new ErrorReceiptStore(join(directory, "replacement.ndjson")).read({ after: cursor }));
  assert.equal(replaced.gap, true);
  check("rotation, count pruning, expiry, and replaced stores explicitly report cursor gaps");
  const boundedPath = join(directory, "bounded.ndjson");
  const bounded = new ErrorReceiptStore(boundedPath, { maxBytes: 16_000 });
  for (let index = 0; index < 60; index++) await run(bounded.record(input));
  assert.equal((await run(bounded.read({}))).records.length, 50);
  assert.equal((await run(bounded.read({}))).hasMore, true);
  assert.ok((await stat(boundedPath)).size + (await stat(`${boundedPath}.1`)).size <= 16_000);
  check("byte retention and maximum 50-record batches are bounded");
  const serialized = (await readFile(path, "utf8")) + (await readFile(`${path}.1`, "utf8"));
  for (const token of [secret, "fixture-secret", "/Users/private", "private.invalid", "Invalid upload request"])
    assert.equal(serialized.includes(token), false);
  for (const receipt of beforeRestart.records)
    assert.deepEqual(
      Object.keys(receipt).sort(),
      ["presentation", "operation", "cause", "id", "cursor", "timestamp"].sort(),
    );
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  check("secret-bearing fixtures retain only allowlisted metadata in private files");
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        task: "OBRI-LOCAL-POPUP-001",
        status: "pass",
        checks,
        limits: { maxBytes: 524288, maxCount: 1000, maxAgeDays: 7, batchSize: 50 },
        environment: "Node with jsdom; actual Solid components, IPC validation, and filesystem store; no native GUI",
      },
      null,
      2,
    ),
  );
  // Machine-readable: acceptance result and artifact location.
  process.stdout.write(`${JSON.stringify({ status: "pass", reportPath, checks: checks.length })}\n`);
} catch (error) {
  await mkdir(resolve(".openbot-build"), { recursive: true });
  await writeFile(
    reportPath,
    JSON.stringify(
      { status: "fail", checks, error: error instanceof Error ? error.message : "Runner failed" },
      null,
      2,
    ),
  );
  process.stderr.write(`${error instanceof Error ? error.stack : "Runner failed"}\n`);
  process.exitCode = 1;
} finally {
  disposeUi?.();
  dom?.window.close();
  electronHook?.deregister();
  delete globalThis.__receiptIpcRegistrations;
  await rm(directory, { recursive: true, force: true });
}
