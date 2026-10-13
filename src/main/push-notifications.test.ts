import type { AgentEvent, AgentSummary, ConversationMessage } from "@openbot/contracts/ipc";
import type { LiveActivityRelayPush } from "@openbot/contracts/live-activity-relay";
import type { NotificationRelayPush } from "@openbot/contracts/notification-relay";
import type { PushNotificationRegistration } from "@openbot/contracts/team-protocol/push-notifications-v1";
import { decodeLiveActivityBytes } from "@openbot/team-client/live-activity-seal";
import {
  type PushNotificationContent,
  pushNotificationKeys,
  sealPushNotification,
} from "@openbot/team-client/push-notification-seal";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredPushRegistration } from "./push-notification-store";
import {
  type PushNotificationAgents,
  PushNotificationSendFailure,
  PushNotificationService,
} from "./push-notifications";

// Failure modes, each with the test that covers it:
// - The relay or Apple can read an agent name or a reply: "sends sealed".
// - A phone gets an agent its member cannot see: "sends sealed".
// - A phone gets a notification while its app is on screen: "sends sealed".
// - The preview shows an older message, or shows text when the member turned previews off: "keeps".
// - A quiet routine run or a muted phone notifies: "keeps".
// - A phone whose session ended keeps getting notifications, or a restart loses the phones: "forgets".
// - A phone repeats a reply that a desktop app shows already: "stays quiet".
// - A phone shows a notification for an event that its Live Activity shows, and the activity does not alert: "stays quiet".
// - An agent that waits for the member does not notify while the member uses a desktop app: "stays quiet".

const secret = "A".repeat(43);
const keys = pushNotificationKeys(decodeLiveActivityBytes(secret) ?? new Uint8Array());
const nonce = new Uint8Array(16).fill(4);

const summary = (id: string, name: string): AgentSummary => ({
  id,
  provider: "codex",
  name,
  notifications: true,
  title: "",
  description: "",
  model: "gpt-5.6-luna",
  reasoningEffort: "medium",
  threadId: `thread-${id}`,
  workspacePath: `/tmp/${id}`,
  preview: "",
  updatedAt: null,
  avatarSeed: id,
  avatarHue: null,
  avatarUrl: null,
});

const registration: PushNotificationRegistration = {
  serverId: "server-1",
  token: "ab".repeat(32),
  environment: "production",
  secret,
  locale: "en",
  away: true,
  level: "all",
  mutedUntil: null,
  preview: true,
  sound: "openbot",
  liveActivityStartedAt: null,
};

const viewer = { memberId: "member-1", protocol: 7, capabilities: new Set<string>(["push-notifications-v1"]) };

const completed = (
  agentId: string,
  turnId: string,
  extra: { quiet?: true; origin?: "user" | "routine" } = {},
): AgentEvent => ({
  type: "turn-completed",
  agentId,
  threadId: `thread-${agentId}`,
  turnId,
  status: "completed",
  ...extra,
});

const message = (turnId: string, text: string): ConversationMessage => ({
  id: `message-${turnId}`,
  turnId,
  author: "assistant",
  text,
  createdAt: "2026-10-12T10:00:00.000Z",
  status: "completed",
});

let listener: ((event: AgentEvent) => void) | null;
let messages: ConversationMessage[];
let saved: StoredPushRegistration[];
const agents: PushNotificationAgents = {
  on: (_event, receive) => {
    listener = receive;
  },
  off: () => {
    listener = null;
  },
  listAgents: () => [summary("ada", "Ada"), summary("hidden", "Hidden")],
  readConversationPageFor: (agentId) =>
    Effect.succeed({
      agentId,
      threadId: `thread-${agentId}`,
      activeTurnId: null,
      revision: 1,
      messages,
      references: {},
      pageInfo: { hasOlder: false, olderCursor: null },
    }),
};
const store = {
  list: () => saved,
  replace: (registrations: readonly StoredPushRegistration[]) =>
    Effect.sync(() => {
      saved = [...registrations];
    }),
};

const NOW = 1_790_000_000_000;
let lastUseElsewhere: number | null;
let atHostComputer: boolean;
let liveActivity: boolean;
let liveActivityAlerts: Array<{ sessionId: string; alert: LiveActivityRelayPush["alert"]; startedAt: number | null }>;

beforeEach(() => {
  listener = null;
  saved = [];
  lastUseElsewhere = null;
  atHostComputer = false;
  liveActivity = false;
  liveActivityAlerts = [];
  messages = [message("turn-0", "An older answer."), message("turn-1", "Here are **this week's** numbers.")];
});

function service(send: (push: NotificationRelayPush) => Promise<"sent" | "gone">) {
  return new PushNotificationService({
    agents,
    store,
    send: (push) =>
      Effect.tryPromise({ try: () => send(push), catch: (cause) => new PushNotificationSendFailure({ cause }) }),
    hiddenAgentIds: () => new Set(["hidden"]),
    memberActive: () => true,
    lastUseElsewhere: () => lastUseElsewhere,
    atHostComputer: () => atHostComputer,
    liveActivityShows: (sessionId, alert, startedAt) => {
      if (liveActivity) liveActivityAlerts.push({ sessionId, alert, startedAt });
      return liveActivity;
    },
    randomBytes: (size) => new Uint8Array(size).fill(4),
    now: () => NOW,
  });
}

function sealed(content: Omit<PushNotificationContent, "serverId">) {
  return sealPushNotification({ serverId: "server-1", ...content }, keys, nonce);
}

async function emit(event: AgentEvent, send: ReturnType<typeof vi.fn>, calls: number) {
  listener?.(event);
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(calls));
}

describe("PushNotificationService", () => {
  it("sends sealed notifications only while the phone is away, and only for agents the member can see", async () => {
    const send = vi.fn(async (_push: NotificationRelayPush) => "sent" as const);
    const push = service(send);
    push.start();
    push.register("session-1", viewer, { ...registration, away: false });

    listener?.(completed("ada", "turn-1"));
    // iOS suspended the app before it could say so: its connection closed.
    push.disconnected("session-1");
    listener?.(completed("hidden", "turn-2"));
    expect(send).not.toHaveBeenCalled();
    await emit(completed("ada", "turn-1"), send, 1);

    const [sent] = send.mock.calls[0] ?? [];
    expect(sent).toEqual({
      token: registration.token,
      environment: "production",
      sessionId: "session-1",
      sealed: sealed({
        agentId: "ada",
        threadId: "thread-ada",
        kind: "reply",
        title: "Ada",
        body: "Here are this week's numbers.",
      }),
      sound: "openbot",
      timestamp: 1_790_000_000,
    });
    expect(JSON.stringify(sent)).not.toMatch(/Ada|numbers|hidden/iu);
    await Effect.runPromise(push.dispose());
  });

  it("keeps the reply out when previews are off, and keeps quiet runs and a muted phone silent", async () => {
    const send = vi.fn(async (_push: NotificationRelayPush) => "sent" as const);
    const push = service(send);
    push.start();
    push.register("session-1", viewer, { ...registration, preview: false, sound: "none" });

    listener?.(completed("ada", "turn-1", { quiet: true }));
    expect(send).not.toHaveBeenCalled();
    await emit(completed("ada", "turn-1"), send, 1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      sound: null,
      sealed: sealed({
        agentId: "ada",
        threadId: "thread-ada",
        kind: "reply",
        title: "Ada",
        body: "Finished working.",
      }),
    });

    // A turn with no answer of its own does not show an older one.
    push.register("session-1", viewer, registration);
    await emit(completed("ada", "turn-3"), send, 2);
    expect(send.mock.calls[1]?.[0]?.sealed).toBe(
      sealed({ agentId: "ada", threadId: "thread-ada", kind: "reply", title: "Ada", body: "Finished working." }),
    );

    push.register("session-1", viewer, { ...registration, mutedUntil: 1_790_000_060 });
    listener?.(completed("ada", "turn-1"));
    push.register("session-1", viewer, { ...registration, level: "needs-me" });
    listener?.(completed("ada", "turn-1"));
    expect(send).toHaveBeenCalledTimes(2);
    await emit(
      { type: "prompt", agentId: "ada", threadId: "thread-ada", turnId: "turn-4", requestId: 1, questions: [] },
      send,
      3,
    );
    expect(send.mock.calls[2]?.[0]?.sealed).toBe(
      sealed({ agentId: "ada", threadId: "thread-ada", kind: "input", title: "Ada", body: "Needs your input." }),
    );
    await Effect.runPromise(push.dispose());
  });

  it("forgets a phone that the relay refused, and sends to the saved phones after a restart", async () => {
    const refused = vi.fn(async (_push: NotificationRelayPush) => "gone" as const);
    const first = service(refused);
    first.start();
    first.register("session-1", viewer, registration);
    first.register("session-2", viewer, { ...registration, token: "cd".repeat(32) });
    await vi.waitFor(() => expect(saved).toHaveLength(2));
    // The phone's foreground state is not kept: after a restart it is away until it connects.
    expect(saved.every((entry) => entry.value.away)).toBe(true);
    await emit(completed("ada", "turn-1"), refused, 2);
    await vi.waitFor(() => expect(saved).toEqual([]));
    await Effect.runPromise(first.dispose());

    saved = [
      {
        sessionId: "session-3",
        memberId: "member-1",
        protocol: 7,
        capabilities: ["push-notifications-v1"],
        value: registration,
      },
    ];
    const send = vi.fn(async (_push: NotificationRelayPush) => "sent" as const);
    const restarted = service(send);
    restarted.start();
    await emit(completed("ada", "turn-1"), send, 1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({ sessionId: "session-3" });
    await Effect.runPromise(restarted.dispose());
  });

  it("stays quiet about a reply while the member uses a desktop app, and lets the Live Activity alert in place of a notification", async () => {
    const send = vi.fn(async (_push: NotificationRelayPush) => "sent" as const);
    const push = service(send);
    push.start();
    push.register("session-1", viewer, registration);

    lastUseElsewhere = NOW - 10_000;
    listener?.(completed("ada", "turn-1"));
    lastUseElsewhere = NOW - 60_000;
    atHostComputer = true;
    listener?.(completed("ada", "turn-1"));
    atHostComputer = false;
    expect(liveActivityAlerts).toEqual([]);
    liveActivity = true;
    listener?.(completed("ada", "turn-1", { origin: "user" }));
    await vi.waitFor(() =>
      expect(liveActivityAlerts).toEqual([{ sessionId: "session-1", alert: { sound: "openbot" }, startedAt: null }]),
    );
    // With its sound off, the activity updates silently, and still no notification goes. The phone gives
    // the start of the activity, which a host restart does not know.
    push.register("session-1", viewer, { ...registration, sound: "none", liveActivityStartedAt: 1_789_990_000 });
    listener?.(completed("ada", "turn-1"));
    await vi.waitFor(() => expect(liveActivityAlerts).toHaveLength(2));
    expect(liveActivityAlerts[1]).toEqual({ sessionId: "session-1", alert: null, startedAt: 1_789_990_000_000 });
    // A phone with notifications off gets the sound of the activity, and never a notification.
    push.register("session-1", viewer, { ...registration, token: null });
    listener?.(completed("ada", "turn-1"));
    await vi.waitFor(() => expect(liveActivityAlerts).toHaveLength(3));
    expect(liveActivityAlerts[2]).toEqual({ sessionId: "session-1", alert: { sound: "openbot" }, startedAt: null });
    liveActivity = false;
    listener?.(completed("ada", "turn-1"));
    expect(send).not.toHaveBeenCalled();

    // Without the activity, a routine run notifies, and a request that waits for the member notifies also at the desktop.
    push.register("session-1", viewer, registration);
    await emit(completed("ada", "turn-1", { origin: "routine" }), send, 1);
    atHostComputer = true;
    await emit(
      {
        type: "browser-takeover-requested",
        request: { requestId: 1, agentId: "ada", threadId: "thread-ada", turnId: "turn-5", tabId: "tab-1" },
      },
      send,
      2,
    );
    expect(send.mock.calls[1]?.[0]?.sealed).toBe(
      sealed({
        agentId: "ada",
        threadId: "thread-ada",
        kind: "browser",
        title: "Ada",
        body: "Needs you to finish a step in the browser.",
      }),
    );
    await Effect.runPromise(push.dispose());
  });
});
