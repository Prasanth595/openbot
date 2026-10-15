/**
 * Run: bun scripts/approval-preview-e2e.ts
 * Report: .openbot-build/approval-preview-e2e.json
 * Uses the real notification service, disk store, production seal, and mobile seal opener.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentApproval, AgentEvent, AgentSummary } from "@openbot/contracts/ipc";
import type { NotificationRelayPush } from "@openbot/contracts/notification-relay";
import type { PushNotificationRegistration } from "@openbot/contracts/team-protocol/push-notifications-v1";
import { encodeLiveActivityBytes } from "@openbot/team-client/live-activity-seal";
import { type PushNotificationContent, pushNotificationKeys } from "@openbot/team-client/push-notification-seal";
import { Effect } from "effect";
import { openSealedLiveActivity } from "../apps/mobile/src/features/live-activity/model/live-activity-open";
import { PushNotificationStore } from "../src/main/push-notification-store";
import { PushNotificationService } from "../src/main/push-notifications";

const artifact = fileURLToPath(new URL("../.openbot-build/approval-preview-e2e.json", import.meta.url));
const longCommand = `echo ${"x".repeat(196)}`;
const longPreview = `echo ${"x".repeat(194)}…`;
interface PreviewCase {
  name: string;
  command?: string;
  kind?: AgentApproval["kind"];
  reason?: string;
  grantRoot?: string;
  permissions?: AgentApproval["permissions"];
  shown: string | null;
  preview?: boolean;
  approvable: boolean;
}

interface CaseResult {
  name: string;
  body: string;
  approvable: boolean;
  status: "pass";
}

let activeCase = "setup";
let failureReason = "Could not create the temporary directory.";
const cases: readonly PreviewCase[] = [
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

async function waitForPush(
  relay: EventEmitter<{ send: [NotificationRelayPush] }>,
  signal: AbortSignal,
): Promise<NotificationRelayPush> {
  return new Promise<NotificationRelayPush>((resolve, reject) => {
    const onSend = (push: NotificationRelayPush) => {
      signal.removeEventListener("abort", onAbort);
      resolve(push);
    };
    const onAbort = () => {
      relay.off("send", onSend);
      reject(new Error("No notification arrived before the deadline."));
    };
    relay.once("send", onSend);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function run() {
  const directory = await mkdtemp(join(tmpdir(), "openbot-approval-preview-"));
  const path = join(directory, "registrations.json");
  const secret = randomBytes(32);
  const keys = pushNotificationKeys(secret);
  // These emitters are the external agent-event and relay boundaries. Service state and storage are real.
  const events = new EventEmitter<{ event: [AgentEvent] }>();
  const relay = new EventEmitter<{ send: [NotificationRelayPush] }>();
  const agents = {
    on: events.on.bind(events),
    off: events.off.bind(events),
    listAgents: (): AgentSummary[] => [
      {
        id: "fixture-agent",
        name: "Fixture agent",
        title: "",
        description: "",
        threadId: "fixture-thread",
        notifications: true,
        provider: "codex",
        model: "default",
        reasoningEffort: "medium",
        workspacePath: directory,
        preview: "",
        updatedAt: null,
        avatarSeed: "fixture-agent",
        avatarHue: null,
        avatarUrl: null,
      },
    ],
    readConversationPageFor: () => Effect.die(new Error("An approval must not read a conversation.")),
  };
  const makeService = (store: PushNotificationStore): PushNotificationService =>
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
  const results: CaseResult[] = [];
  let service: PushNotificationService | undefined;
  try {
    for (const testCase of cases) {
      activeCase = testCase.name;
      failureReason = "Could not load or register the notification service.";
      const store = new PushNotificationStore(path);
      await Effect.runPromise(store.load());
      service = makeService(store);
      service.start();
      const registration: PushNotificationRegistration = {
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
      };
      service.register(
        "fixture-session",
        { memberId: "fixture-member", protocol: 3, capabilities: new Set() },
        registration,
      );
      // Dispose waits for registration saves. Reload from disk, as after a host restart.
      failureReason = "Registration save or listener cleanup failed.";
      await Effect.runPromise(service.dispose());
      assert.equal(events.listenerCount("event"), 0);
      failureReason = "Saved registration does not match the registered phone.";
      const saved = JSON.parse(await readFile(path, "utf8"));
      assert.deepEqual(saved, {
        version: 1,
        registrations: [
          {
            sessionId: "fixture-session",
            memberId: "fixture-member",
            protocol: 3,
            capabilities: [],
            value: registration,
          },
        ],
      });
      failureReason = "Registration file permissions are not 0600.";
      assert.equal((await stat(path)).mode & 0o777, 0o600);
      failureReason = "Registration did not survive a service restart.";
      const reloaded = new PushNotificationStore(path);
      await Effect.runPromise(reloaded.load());
      assert.equal(reloaded.list().length, 1);
      service = makeService(reloaded);
      service.start();
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 5_000);
      failureReason = "No notification arrived before the deadline.";
      const sent = waitForPush(relay, controller.signal);
      const event: AgentEvent = {
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
      };
      events.emit("event", event);
      let push: NotificationRelayPush;
      try {
        push = await sent;
      } finally {
        clearTimeout(deadline);
      }
      failureReason = "The mobile code could not open the production seal.";
      const opened = openSealedLiveActivity(
        push.sealed,
        encodeLiveActivityBytes(keys.seal),
        encodeLiveActivityBytes(keys.tag),
      );
      if (opened === null) throw new Error("The mobile code could not open the production seal.");
      const payload = JSON.parse(opened);
      const body = testCase.shown === null ? "Needs your approval." : `Needs your approval: ${testCase.shown}`;
      const expected: PushNotificationContent = {
        serverId: "fixture-server",
        agentId: "fixture-agent",
        threadId: "fixture-thread",
        kind: "approval",
        title: "Fixture agent",
        body,
        // Deny keeps the request and turn even when Approve is disabled.
        approval: { requestId: testCase.name, turnId: "fixture-turn", approvable: testCase.approvable },
      };
      failureReason = "Notification content or approval action differs from the expected value.";
      assert.deepEqual(payload, expected, testCase.name);
      results.push({
        name: testCase.name,
        body,
        approvable: testCase.approvable,
        status: "pass",
      });
      failureReason = "Service disposal did not remove event or relay listeners.";
      await Effect.runPromise(service.dispose());
      assert.equal(events.listenerCount("event"), 0);
      assert.equal(relay.listenerCount("send"), 0);
    }
    activeCase = "cleanup";
    failureReason = "Could not dispose the service or remove temporary files.";
    return { status: "pass", diskRegistration: true, productionSealAndMobileOpen: true, cases: results };
  } finally {
    if (service) await Effect.runPromise(service.dispose());
    await rm(directory, { recursive: true, force: true });
  }
}

try {
  await mkdir(fileURLToPath(new URL("../.openbot-build/", import.meta.url)), { recursive: true });
  const report = await run();
  activeCase = "report";
  failureReason = "Could not write the report.";
  await writeFile(artifact, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `PASS: ${report.cases.length} approval preview cases. Artifact: .openbot-build/approval-preview-e2e.json\n`,
  );
} catch {
  // Do not export registration secrets, tokens, or captured payloads on failure.
  await writeFile(artifact, `${JSON.stringify({ status: "fail", case: activeCase, reason: failureReason })}\n`);
  process.stderr.write("FAIL: approval preview E2E. Artifact: .openbot-build/approval-preview-e2e.json\n");
  process.exitCode = 1;
}
