import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeLiveActivityBytes } from "@openbot/team-client/live-activity-seal";
import { pushNotificationKeys } from "@openbot/team-client/push-notification-seal";
import { Effect } from "effect";
import { openSealedLiveActivity } from "../apps/mobile/src/features/live-activity/model/live-activity-open.ts";
import { PushNotificationStore } from "../src/main/push-notification-store.ts";
import { PushNotificationService } from "../src/main/push-notifications.ts";

const artifact = fileURLToPath(new URL("../.openbot-build/approval-preview-e2e.json", import.meta.url));
const longCommand = `echo ${"x".repeat(196)}`;
const longPreview = `echo ${"x".repeat(194)}…`;
const cases = [
  { name: "short-command", command: "pwd", shown: "pwd", approvable: true },
  { name: "multiline", command: "pwd\nwhoami", shown: "pwd whoami", approvable: false },
  { name: "crlf", command: "pwd\r\nwhoami", shown: "pwd whoami", approvable: false },
  { name: "quoted-double-spaces", command: 'echo "a  b"', shown: 'echo "a b"', approvable: false },
  { name: "tab", command: "echo\tvalue", shown: "echo value", approvable: false },
  { name: "leading-space", command: " pwd", shown: "pwd", approvable: false },
  { name: "trailing-space", command: "pwd ", shown: "pwd", approvable: false },
  { name: "empty-command", command: "", shown: null, approvable: false },
  { name: "whitespace-only", command: " \t\n", shown: null, approvable: false },
  { name: "exactly-200", command: longCommand.slice(0, 200), shown: longCommand.slice(0, 200), approvable: true },
  { name: "over-200", command: longCommand, shown: longPreview, approvable: false },
  { name: "redacted", command: "echo password=fixture-only", shown: "echo password=[redacted]", approvable: false },
  { name: "preview-disabled", command: "pwd", shown: null, preview: false, approvable: false },
  { name: "folder-grant", command: "pwd", shown: "pwd", grantRoot: "/fixture", approvable: false },
  {
    name: "permissions",
    command: "pwd",
    shown: "pwd",
    permissions: { fileSystem: { read: [], write: [] }, network: true },
    approvable: false,
  },
  { name: "file-change", kind: "file-change", reason: "Update notes", shown: "Update notes", approvable: true },
  {
    name: "file-change-whitespace",
    kind: "file-change",
    reason: "Update  notes",
    shown: "Update notes",
    approvable: true,
  },
  {
    name: "file-change-markdown",
    kind: "file-change",
    reason: "**Update notes**",
    shown: "Update notes",
    approvable: false,
  },
  {
    name: "file-change-redacted",
    kind: "file-change",
    reason: "password=fixture-only",
    shown: "password=[redacted]",
    approvable: false,
  },
  {
    name: "file-change-grant",
    kind: "file-change",
    reason: "Update notes",
    shown: "Update notes",
    grantRoot: "/fixture",
    approvable: false,
  },
];

async function run() {
  const directory = await mkdtemp(join(tmpdir(), "openbot-approval-preview-"));
  const path = join(directory, "registrations.json");
  const secret = randomBytes(32);
  const keys = pushNotificationKeys(secret);
  // These emitters are the external agent-event and relay boundaries. Service state and storage are real.
  const events = new EventEmitter();
  const relay = new EventEmitter();
  const agents = {
    on: events.on.bind(events),
    off: events.off.bind(events),
    listAgents: () => [{ id: "fixture-agent", name: "Fixture agent", threadId: "fixture-thread", notifications: true }],
    readConversationPageFor: () => Effect.die(new Error("An approval must not read a conversation.")),
  };
  const makeService = (store) =>
    new PushNotificationService({
      agents,
      store,
      send: (push) =>
        Effect.sync(() => {
          relay.emit("send", push);
          return "sent";
        }),
      hiddenAgentIds: () => new Set(),
      memberActive: () => true,
      lastUseElsewhere: () => null,
      atHostComputer: () => false,
      liveActivityShows: () => false,
      randomBytes,
    });
  const results = [];
  let service;
  try {
    for (const testCase of cases) {
      const store = new PushNotificationStore(path);
      await Effect.runPromise(store.load());
      service = makeService(store);
      service.start();
      service.register(
        "fixture-session",
        { memberId: "fixture-member", protocol: 3, capabilities: new Set() },
        {
          serverId: "fixture-server",
          token: "ab".repeat(32),
          environment: "development",
          secret: encodeLiveActivityBytes(secret),
          locale: "en",
          away: true,
          level: "needs-me",
          mutedUntil: null,
          preview: testCase.preview ?? true,
          sound: "none",
          liveActivityStartedAt: null,
        },
      );
      // Dispose waits for registration saves. Reload from disk, as after a host restart.
      await Effect.runPromise(service.dispose());
      assert.equal(events.listenerCount("event"), 0);
      const saved = JSON.parse(await readFile(path, "utf8"));
      assert.equal(saved.registrations.length, 1);
      assert.equal(saved.registrations[0].value.preview, testCase.preview ?? true);
      assert.equal((await stat(path)).mode & 0o777, 0o600);
      const reloaded = new PushNotificationStore(path);
      await Effect.runPromise(reloaded.load());
      assert.equal(reloaded.list().length, 1);
      service = makeService(reloaded);
      service.start();
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 5_000);
      const sent = once(relay, "send", { signal: controller.signal });
      events.emit("event", {
        type: "approval",
        approval: {
          agentId: "fixture-agent",
          threadId: "fixture-thread",
          requestId: testCase.name,
          turnId: "fixture-turn",
          kind: testCase.kind ?? "command",
          command: testCase.command ?? null,
          cwd: null,
          reason: testCase.reason ?? null,
          grantRoot: testCase.grantRoot ?? null,
          permissions: testCase.permissions ?? null,
        },
      });
      let push;
      try {
        [push] = await sent;
      } finally {
        clearTimeout(deadline);
      }
      const opened = openSealedLiveActivity(
        push.sealed,
        encodeLiveActivityBytes(keys.seal),
        encodeLiveActivityBytes(keys.tag),
      );
      assert.notEqual(opened, null, `${testCase.name}: mobile must open the production seal`);
      const payload = JSON.parse(opened);
      const body = testCase.shown === null ? "Needs your approval." : `Needs your approval: ${testCase.shown}`;
      assert.deepEqual(
        payload,
        {
          serverId: "fixture-server",
          agentId: "fixture-agent",
          threadId: "fixture-thread",
          kind: "approval",
          title: "Fixture agent",
          body,
          // Deny keeps the request and turn even when Approve is disabled.
          approval: { requestId: testCase.name, turnId: "fixture-turn", approvable: testCase.approvable },
        },
        testCase.name,
      );
      results.push({
        name: testCase.name,
        body: payload.body,
        approvable: payload.approval.approvable,
        status: "pass",
      });
      await Effect.runPromise(service.dispose());
      assert.equal(events.listenerCount("event"), 0);
      assert.equal(relay.listenerCount("send"), 0);
    }
    return { status: "pass", diskRegistration: true, productionSealAndMobileOpen: true, cases: results };
  } finally {
    if (service) await Effect.runPromise(service.dispose());
    await rm(directory, { recursive: true, force: true });
  }
}

await mkdir(fileURLToPath(new URL("../.openbot-build/", import.meta.url)), { recursive: true });
try {
  const report = await run();
  await writeFile(artifact, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `PASS: ${report.cases.length} approval preview cases. Artifact: .openbot-build/approval-preview-e2e.json\n`,
  );
} catch {
  // Do not export registration secrets, tokens, or captured payloads on failure.
  await writeFile(artifact, `${JSON.stringify({ status: "fail" })}\n`);
  process.stderr.write("FAIL: approval preview E2E. Artifact: .openbot-build/approval-preview-e2e.json\n");
  process.exitCode = 1;
}
