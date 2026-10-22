// Drives the real host push service, encrypted widget decoder, and native activity sync.
// ActivityKit and host data are local adapters. No account, APNs, or provider is used.
// Run: bun scripts/live-activity-lifecycle-e2e.ts
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentEvent, AgentRuntimeSnapshot } from "@openbot/contracts/ipc";
import type { LiveActivityRelayPush } from "@openbot/contracts/live-activity-relay";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import {
  encodeLiveActivityBytes,
  LIVE_ACTIVITY_SECRET_BYTES,
  liveActivityKeys,
} from "@openbot/team-client/live-activity-seal";
import { Effect } from "effect";
import { openSealedLiveActivity } from "../apps/mobile/src/features/live-activity/model/live-activity-open";
import {
  type LiveActivityInstance,
  LiveActivitySync,
} from "../apps/mobile/src/features/live-activity/model/live-activity-sync";
import { LiveActivityPushService, LiveActivitySendFailure } from "../src/main/live-activity-push";

const output = resolve(import.meta.dirname, "../.openbot-build/live-activity-lifecycle-e2e/report.json");
const events = new EventEmitter<{ event: [AgentEvent] }>();
const secret = randomBytes(LIVE_ACTIVITY_SECRET_BYTES);
const keys = liveActivityKeys(secret);
const checks: string[] = [];
const observations: { mode: string | null; priority: number; at: number }[] = [];
const native: { shown: string | null; starts: number; updates: number; ends: number } = {
  shown: null,
  starts: 0,
  updates: 0,
  ends: 0,
};
let pendingStart: Promise<void> | null = null;
let pendingUpdate: Promise<void> | null = null;
let rejectEnd = false;
let updateEntered = () => {};
const sync = new LiveActivitySync<string>({
  getInstances: () => [],
  async start(props): Promise<LiveActivityInstance<string>> {
    if (pendingStart) await pendingStart;
    native.starts += 1;
    native.shown = props;
    return {
      startedAt: Date.now(),
      async update(next) {
        native.updates += 1;
        updateEntered();
        if (pendingUpdate) await pendingUpdate;
        native.shown = next;
      },
      async end() {
        if (rejectEnd) throw new Error("Synthetic native end failure.");
        native.ends += 1;
        native.shown = null;
      },
      watchPushToken: () => () => {},
    };
  },
});
const snapshot: AgentRuntimeSnapshot = {
  agents: ["a", "b"].map((id) => ({
    id,
    name: `Fixture ${id}`,
    notifications: true,
    preview: "",
    updatedAt: "2026-10-22T00:00:00.000Z",
    avatarSeed: id,
    avatarHue: null,
    avatarUrl: null,
  })),
  activeTurns: [{ agentId: "a", threadId: "thread", turnId: "one" }],
  work: [{ id: "work-a", agentId: "a", turnId: "one", status: "running", text: "First", error: null }],
  latestMessages: [],
  attentionComplete: true,
  pendingPrompts: [],
  pendingApprovals: [],
  pendingBrowserTakeovers: [],
  failedTurns: [],
};
let notify = () => {};
const service = new LiveActivityPushService({
  agents: {
    on: (name, listener) => events.on(name, listener),
    off: (name, listener) => events.off(name, listener),
    getRuntimeSnapshot: () => snapshot,
    listConversationReads: () => ({}),
  },
  randomBytes,
  memberActive: () => true,
  send: (push: LiveActivityRelayPush) =>
    Effect.tryPromise({
      try: async () => {
        let mode: string | null = null;
        if (push.sealed) {
          const text = openSealedLiveActivity(
            push.sealed,
            encodeLiveActivityBytes(keys.seal),
            encodeLiveActivityBytes(keys.tag),
          );
          assert.ok(text, "The widget must decrypt each host update.");
          mode = decodedMode(JSON.parse(text));
          await sync.show(text);
        } else await sync.show(null);
        observations.push({ mode, priority: push.priority, at: Date.now() });
        notify();
        return "sent" as const;
      },
      catch: (cause) => new LiveActivitySendFailure({ cause }),
    }),
});

function decodedMode(props: unknown): string {
  assert.ok(isDynamicRecord(props) && typeof props.mode === "string");
  return props.mode;
}

async function received(count: number) {
  if (observations.length >= count) return;
  await new Promise<void>((done, reject) => {
    const deadline = setTimeout(() => reject(new Error("The activity update did not arrive.")), 10_000);
    notify = () => {
      if (observations.length < count) return;
      clearTimeout(deadline);
      done();
    };
  });
}

let passed = false;
try {
  service.register(
    "fixture",
    {
      memberId: "member",
      hiddenAgentIds: () => new Set(),
      readOptions: {
        excludeRoutineEvents: true,
        excludeRoutineRunEvents: true,
        excludeHostedSiteEvents: true,
        excludeRoutineQuietAnswers: true,
      },
    },
    {
      serverId: "server",
      token: "ab".repeat(32),
      environment: "development",
      secret: encodeLiveActivityBytes(secret),
      locale: "en",
      away: true,
      photos: [],
    },
  );
  await received(1);
  assert.equal(observations[0]?.mode, "working");
  checks.push("The encrypted host update starts the native activity.");

  snapshot.activeTurns.push({ agentId: "b", threadId: "thread-b", turnId: "two" });
  snapshot.work.push({ id: "work-b", agentId: "b", turnId: "two", status: "running", text: "Second", error: null });
  events.emit("event", { type: "turn-started", agentId: "b", threadId: "thread-b", turnId: "two" });
  await received(2);
  assert.equal(observations[1]?.mode, "working");
  assert.equal(observations[1]?.priority, 10);
  assert.ok(native.shown?.includes('"compact":"2"'));
  checks.push("A second start bypasses text spacing while the mode stays working.");

  for (let index = 0; index < 12; index += 1) {
    const work = snapshot.work[0];
    assert.ok(work);
    work.text = `Progress ${index}`;
    events.emit("event", { type: "turn-progress", agentId: "a", threadId: "thread", turnId: "one", detail: work.text });
  }
  await received(3);
  assert.equal(observations.length, 3);
  assert.equal(observations[2]?.priority, 5);
  assert.ok((observations[2]?.at ?? 0) - (observations[1]?.at ?? 0) >= 4_900);
  assert.ok(native.shown?.includes("Progress 11"));
  checks.push("Text bursts send only the newest content and keep the five-second host interval.");

  snapshot.failedTurns = [{ agentId: "a", turnId: "one" }];
  snapshot.activeTurns = snapshot.activeTurns.filter((turn) => turn.agentId !== "a");
  snapshot.work = snapshot.work.filter((work) => work.agentId !== "a");
  events.emit("event", { type: "turn-completed", agentId: "a", threadId: "thread", turnId: "one", status: "failed" });
  await received(4);
  assert.equal(observations[3]?.mode, "failed");
  assert.equal(observations[3]?.priority, 10);
  checks.push("Failure interrupts ordinary text updates.");

  service.remove("fixture");
  assert.equal(events.listenerCount("event"), 0);
  await sync.show(null);

  const releaseStart = Promise.withResolvers<void>();
  pendingStart = releaseStart.promise;
  const creating = sync.show("old workspace");
  const ending = sync.show(null);
  releaseStart.resolve();
  await Promise.all([creating, ending]);
  pendingStart = null;
  assert.equal(native.shown, null);
  checks.push("Sign-out ends a native activity that completes creation late.");

  await sync.show("current workspace");
  const releaseUpdate = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  updateEntered = entered.resolve;
  pendingUpdate = releaseUpdate.promise;
  const before = native.updates;
  const updating = sync.show("first pending update");
  await entered.promise;
  for (let index = 0; index < 100; index += 1) void sync.show(`newest ${index}`);
  releaseUpdate.resolve();
  await updating;
  pendingUpdate = null;
  assert.equal(native.shown, "newest 99");
  assert.equal(native.updates - before, 2);
  checks.push("A busy native operation keeps one newest pending update.");

  const releaseOldUpdate = Promise.withResolvers<void>();
  const oldUpdateEntered = Promise.withResolvers<void>();
  updateEntered = oldUpdateEntered.resolve;
  pendingUpdate = releaseOldUpdate.promise;
  const oldUpdate = sync.show("old host update");
  await oldUpdateEntered.promise;
  void sync.show("old host pending");
  const changedHost = sync.show(null);
  const newHost = sync.show("new host");
  releaseOldUpdate.resolve();
  await Promise.all([oldUpdate, changedHost, newHost]);
  pendingUpdate = null;
  assert.equal(native.shown, "new host");
  assert.equal(native.starts, 4);
  assert.equal(native.ends, 3);
  checks.push("A host switch discards old pending work and ends the old native instance.");

  rejectEnd = true;
  await sync.show(null);
  assert.equal(native.shown, "new host");
  rejectEnd = false;
  await sync.show("after end retry");
  assert.equal(native.shown, "after end retry");
  assert.equal(native.starts, 5);
  checks.push("A failed native end retains its instance and the next state retries it.");

  await sync.show(null);
  assert.equal(native.shown, null);
  passed = true;
} finally {
  await Effect.runPromise(service.dispose());
  await sync.show(null);
  mkdirSync(resolve(output, ".."), { recursive: true });
  writeFileSync(
    output,
    `${JSON.stringify({ passed, checks, observations, native, limits: "Local adapters; no iOS device or APNs delivery." }, null, 2)}\n`,
  );
}
createOpenBotLogger("live-activity-lifecycle-e2e").info(
  `Live Activity lifecycle: ${checks.length} checks passed. Report: ${output}`,
);
