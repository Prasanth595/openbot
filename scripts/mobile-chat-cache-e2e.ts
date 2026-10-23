// Drives the existing native development client and its real conversation-cache service.
// Run: bun scripts/mobile-chat-cache-e2e.ts <simulator-uuid> [metro-port]
// Or run the real service without a native client: bun scripts/mobile-chat-cache-e2e.ts --service
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import WebSocket from "ws";

if (process.argv[2] === "--service") {
  const { runConversationCacheProbe } = await import(
    "../apps/mobile/src/features/workspace/model/conversation-cache-probe"
  );
  const checks = await runConversationCacheProbe();
  const output = resolve(import.meta.dirname, "../.openbot-build/mobile-chat-cache-e2e");
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, "service-report.json"), `${JSON.stringify({ mode: "service", checks }, null, 2)}\n`);
  for (const [name, passed] of Object.entries(checks)) assert.equal(passed, true, name);
  process.stdout.write(`${JSON.stringify({ passed: true, mode: "service", checks: Object.keys(checks).length })}\n`);
  process.exit(0);
}

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
  const ready = pending.get(message.id);
  if (ready && typeof message.result?.result?.value === "string") {
    pending.delete(message.id);
    ready(message.result.result.value);
  }
};
socket.send(JSON.stringify({ id: ++sequence, method: "Runtime.enable" }));
function readProbe() {
  return new Promise<string>((ready, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("The native cache preview did not answer."));
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
          expression: "JSON.stringify(globalThis.__OPENBOT_CHAT_CACHE_PREVIEW__ ?? null)",
          returnByValue: true,
        },
      }),
    );
  });
}
const output = resolve(import.meta.dirname, "../.openbot-build/mobile-chat-cache-e2e");
await mkdir(output, { recursive: true });
try {
  await promisify(execFile)(
    "/Applications/Xcode.app/Contents/Developer/usr/bin/simctl",
    ["openurl", simulator, "openbot://motion-preview?phase=idle&cache=1"],
    { env: { ...process.env, DEVELOPER_DIR: "/Applications/Xcode.app/Contents/Developer" } },
  );
  const deadline = Date.now() + 30_000;
  let preview = JSON.parse(await readProbe());
  while (!preview?.ready && Date.now() < deadline) {
    // Poll a completion state, not an animation duration.
    await Bun.sleep(100);
    preview = JSON.parse(await readProbe());
  }
  assert.equal(preview?.ready, true, "The native cache service probe must complete.");
  assert.ok(preview.checks && Object.keys(preview.checks).length >= 20, "The native cache checks must run.");
  await writeFile(
    resolve(output, "report.json"),
    `${JSON.stringify({ ...preview, exceptions, consoleErrors }, null, 2)}\n`,
  );
  for (const [name, passed] of Object.entries(preview.checks)) assert.equal(passed, true, name);
  assert.equal(exceptions, 0, "The cache preview must have no runtime exceptions.");
  assert.equal(consoleErrors, 0, "The cache preview must have no console errors.");
  // Only test names, booleans and counts. No account, host or conversation content.
  process.stdout.write(
    `${JSON.stringify({ passed: true, checks: Object.keys(preview.checks).length, exceptions, consoleErrors })}\n`,
  );
} finally {
  socket.close();
}
