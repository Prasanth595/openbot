// Drives the existing native app. No provider request, task, approval or setting is created.
// Run: bun scripts/mobile-chat-navigation-e2e.ts <simulator-uuid> [metro-port] [--repeat]
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import WebSocket from "ws";

const simulator = process.argv[2];
assert.ok(simulator && /^[\da-f-]{36}$/iu.test(simulator), "Supply the existing simulator UUID.");
const port = Number(process.argv[3] ?? 8081);
assert.ok(Number.isInteger(port) && port > 0 && port < 65536);
const origin = `http://127.0.0.1:${port}`;
const targets = await (await fetch(`${origin}/json/list`)).json();
assert.ok(Array.isArray(targets));
const target = targets.find((item) => item.appId === "run.openbot.mobile");
assert.ok(target && typeof target.webSocketDebuggerUrl === "string", "Open the development client first.");
const socket = new WebSocket(target.webSocketDebuggerUrl, { headers: { Origin: origin } });
await new Promise<void>((ready, reject) => {
  socket.onopen = () => ready();
  socket.onerror = () => reject(new Error("The inspector could not connect."));
});
let sequence = 0;
let exceptions = 0;
let errors = 0;
const pending = new Map<number, (value: string) => void>();
socket.onmessage = (event) => {
  const message = JSON.parse(String(event.data));
  if (message.method === "Runtime.exceptionThrown") exceptions++;
  if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") errors++;
  if (typeof message.id !== "number" || typeof message.result?.result?.value !== "string") return;
  const receive = pending.get(message.id);
  pending.delete(message.id);
  receive?.(message.result.result.value);
};
socket.send(JSON.stringify({ id: ++sequence, method: "Runtime.enable" }));

interface Sample {
  id: number;
  source: string;
  stages: Record<string, number>;
}
interface State {
  route: string;
  externalTaps: number;
  foreground: boolean;
  target: string | null;
  samples: Sample[];
}
function read(): Promise<State | null> {
  return new Promise((ready, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Native navigation did not answer."));
    }, 5000);
    pending.set(id, (value) => {
      clearTimeout(timer);
      ready(JSON.parse(value));
    });
    socket.send(
      JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: {
          expression: "JSON.stringify(globalThis.__OPENBOT_CHAT_NAVIGATION__?.() ?? null)",
          returnByValue: true,
        },
      }),
    );
  });
}
async function waitFor(accept: (state: State) => boolean) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const state = await read();
    if (state && accept(state)) return state;
    await Bun.sleep(100);
  }
  throw new Error("The expected native navigation state did not arrive.");
}
const simctl = (args: string[]) =>
  promisify(execFile)("/Applications/Xcode.app/Contents/Developer/usr/bin/simctl", args, {
    env: { ...process.env, DEVELOPER_DIR: "/Applications/Xcode.app/Contents/Developer" },
  });
const open = (url: string) => simctl(["openurl", simulator, url]);
const samples: Array<{ kind: "warm" | "background"; sample: Sample }> = [];
const repeat = process.argv.includes("--repeat");
try {
  const initial = await waitFor((state) => Boolean(state.target));
  assert.ok(initial.target);
  for (let index = 0; index < (repeat ? 20 : 1); index++) {
    await open("openbot://live-activity");
    const home = await waitFor((state) => state.route === "team");
    const previous = home.samples.at(-1)?.id;
    await open(initial.target);
    const shown = await waitFor(
      (state) =>
        state.route === "chat" &&
        state.samples.at(-1)?.id !== previous &&
        state.samples.at(-1)?.stages.messages !== undefined &&
        state.samples.at(-1)?.stages.composer !== undefined,
    );
    const sample = shown.samples.at(-1);
    assert.ok(sample);
    assert.equal(sample.source, "external", "External taps must use direct navigation.");
    samples.push({ kind: "warm", sample });
    // A repeated tap keeps the mounted chat and its current opening sample.
    await open(initial.target);
    const same = await waitFor((state) => state.externalTaps > shown.externalTaps);
    assert.equal(same?.samples.length, shown.samples.length, "An open chat must not mount again.");
  }
  for (let index = 0; index < (repeat ? 10 : 1); index++) {
    const before = await read();
    const previous = before?.samples.at(-1)?.id;
    await simctl(["launch", simulator, "com.apple.Preferences"]);
    await waitFor((state) => !state.foreground);
    await open(initial.target);
    const shown = await waitFor(
      (state) =>
        state.route === "chat" &&
        state.samples.at(-1)?.id !== previous &&
        state.samples.at(-1)?.source === "background" &&
        state.samples.at(-1)?.stages.messages !== undefined &&
        state.samples.at(-1)?.stages.composer !== undefined,
    );
    const sample = shown.samples.at(-1);
    assert.ok(sample);
    samples.push({ kind: "background", sample });
  }
  assert.equal(exceptions, 0);
  assert.equal(errors, 0);
  const output = resolve(".openbot-build/mobile-chat-navigation-e2e");
  await mkdir(output, { recursive: true });
  await writeFile(
    resolve(output, "report.json"),
    `${JSON.stringify(
      {
        passed: true,
        mode: "development-functional",
        visibility: "layout-and-frame-proxy",
        coldLaunchMeasured: false,
        comparativeSpeedClaim: false,
        samples,
        exceptions,
        errors,
      },
      null,
      2,
    )}\n`,
  );
  // Machine-readable: durations and counts only; the target URL stays in memory.
  process.stdout.write(
    `${JSON.stringify({
      passed: true,
      warm: samples.filter((s) => s.kind === "warm").length,
      background: samples.filter((s) => s.kind === "background").length,
      exceptions,
      errors,
    })}\n`,
  );
} finally {
  socket.close();
}
