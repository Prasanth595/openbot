// Drives the existing iOS development client through its local motion preview. No host work is sent.
// Run: bun scripts/mobile-activity-e2e.ts <simulator-uuid> [metro-port]
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import WebSocket from "ws";

const simulator = process.argv[2];
assert.ok(simulator && /^[\da-f-]{36}$/iu.test(simulator), "Supply the existing simulator UUID.");
const port = Number(process.argv[3] ?? 8081);
assert.ok(Number.isInteger(port) && port > 0 && port < 65536, "Supply a valid Metro port.");
const response = await fetch(`http://127.0.0.1:${port}/json/list`);
assert.ok(response.ok, "The existing Metro inspector must be available.");
const targets = await response.json();
assert.ok(Array.isArray(targets), "The inspector must return targets.");
const target = targets.find((item) => item.appId === "run.openbot.mobile");
assert.ok(target && typeof target.webSocketDebuggerUrl === "string", "Open the mobile development client first.");
const socket = new WebSocket(target.webSocketDebuggerUrl, { headers: { Origin: `http://127.0.0.1:${port}` } });
let sequence = 0;
let exceptions = 0;
let consoleErrors = 0;
const pending = new Map<number, (value: string) => void>();
await new Promise<void>((ready, reject) => {
  socket.onopen = () => ready();
  socket.onerror = () => reject(new Error("The native inspector could not connect."));
});
socket.onmessage = (event) => {
  const message = JSON.parse(String(event.data));
  if (message.method === "Runtime.exceptionThrown") exceptions++;
  if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") consoleErrors++;
  if (typeof message.id !== "number") return;
  const resolveReply = pending.get(message.id);
  if (resolveReply && typeof message.result?.result?.value === "string") {
    pending.delete(message.id);
    resolveReply(message.result.result.value);
  }
};
socket.send(JSON.stringify({ id: ++sequence, method: "Runtime.enable" }));
function readPreview() {
  return new Promise<string>((ready, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("The native preview did not answer."));
    }, 5000);
    pending.set(id, (value) => {
      clearTimeout(timer);
      ready(value);
    });
    socket.send(
      JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: {
          expression: "JSON.stringify(globalThis.__OPENBOT_MOTION_PREVIEW__ ?? null)",
          returnByValue: true,
        },
      }),
    );
  });
}
const phases = ["thinking", "generating", "tool", "done", "idle"];
const observations = [];
const output = resolve(import.meta.dirname, "../.openbot-build/mobile-activity-e2e");
await mkdir(output, { recursive: true });
try {
  for (const phase of phases) {
    await promisify(execFile)(
      "/Applications/Xcode.app/Contents/Developer/usr/bin/simctl",
      ["openurl", simulator, `openbot://motion-preview?phase=${phase}`],
      { env: { ...process.env, DEVELOPER_DIR: "/Applications/Xcode.app/Contents/Developer" } },
    );
    const deadline = Date.now() + 15_000;
    let preview = JSON.parse(await readPreview());
    while ((preview?.phase !== phase || !preview.ready) && Date.now() < deadline) {
      // Wait for the requested application state, not for an animation duration.
      await Bun.sleep(100);
      preview = JSON.parse(await readPreview());
    }
    assert.equal(preview?.phase, phase, "The native preview must accept the requested phase.");
    assert.equal(preview.ready, true, "The native header and activity preview must have an agent.");
    assert.ok(preview.checks && Object.values(preview.checks).length >= 19, "The native activity checks must run.");
    for (const [name, passed] of Object.entries(preview.checks)) assert.equal(passed, true, name);
    assert.equal(preview.active, !["done", "idle"].includes(phase), "Only active work retains the activity row.");
    observations.push(preview);
  }
  await promisify(execFile)(
    "/Applications/Xcode.app/Contents/Developer/usr/bin/simctl",
    ["openurl", simulator, "openbot://motion-preview?phase=generating&reply=1"],
    { env: { ...process.env, DEVELOPER_DIR: "/Applications/Xcode.app/Contents/Developer" } },
  );
  const handoffDeadline = Date.now() + 15_000;
  let handoff = JSON.parse(await readPreview());
  while ((!handoff?.showReply || handoff.phase !== "generating" || !handoff.ready) && Date.now() < handoffDeadline) {
    await Bun.sleep(100);
    handoff = JSON.parse(await readPreview());
  }
  assert.equal(handoff?.showReply, true, "The reply must arrive in the native preview.");
  assert.equal(handoff.active, true, "The header must keep the active turn.");
  assert.equal(handoff.rowVisible, false, "A reply must replace the duplicate activity row.");
  for (const [name, passed] of Object.entries(handoff.checks)) assert.equal(passed, true, name);
  observations.push(handoff);
  assert.equal(exceptions, 0, "The native preview must have no runtime exceptions.");
  assert.equal(consoleErrors, 0, "The native preview must have no console errors.");
  await writeFile(
    resolve(output, "report.json"),
    `${JSON.stringify({ observations, exceptions, consoleErrors }, null, 2)}\n`,
  );
  // Machine-readable: only phase names, booleans and counts; no host or chat contents.
  process.stdout.write(
    `${JSON.stringify({ passed: true, phases: phases.length, handoffs: observations.length - phases.length, exceptions, consoleErrors })}\n`,
  );
} finally {
  socket.close();
}
