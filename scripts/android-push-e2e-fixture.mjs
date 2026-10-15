// Owned synthetic native/OAuth/FCM boundaries. No device, account or external push service is used.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  ANDROID_NOTIFICATION_SEALED_LIMIT,
  readAndroidNotificationRelayPush,
} from "@openbot/contracts/android-notification-relay";
import {
  ANDROID_PUSH_NOTIFICATIONS_CAPABILITY,
  ANDROID_PUSH_NOTIFICATIONS_CODECS,
  ANDROID_PUSH_NOTIFICATIONS_ROUTES,
} from "@openbot/contracts/team-protocol/android-push-notifications-v1";
import {
  legacyTeamCapabilities,
  TEAM_BOOTSTRAP_CAPABILITIES,
  TEAM_CURRENT_CAPABILITIES,
} from "@openbot/contracts/team-protocol/current";
import {
  PUSH_NOTIFICATIONS_CAPABILITY,
  PUSH_NOTIFICATIONS_CODECS,
  PUSH_NOTIFICATIONS_ROUTES,
} from "@openbot/contracts/team-protocol/push-notifications-v1";
import { redactText, registerSecretValue } from "@openbot/logging";
import { encodeLiveActivityBytes, liveActivityHostSecret } from "@openbot/team-client/live-activity-seal";
import { pushNotificationKeys, sealPushNotification } from "@openbot/team-client/push-notification-seal";
import { Effect } from "effect";
import { exportJWK, exportPKCS8, generateKeyPair, jwtVerify } from "jose";
import { FcmRelaySender } from "../apps/auth-api/src/server/android-notification-relay.ts";
import { relayAndroidNotification } from "../apps/auth-api/src/server/android-notification-route.ts";
import { runApiEffect } from "../apps/auth-api/src/server/effect-runtime.ts";
import { ApnsRelaySender } from "../apps/auth-api/src/server/live-activity-relay.ts";
import { RemoteControlPlane } from "../apps/auth-api/src/server/remote-control-plane.ts";
import { AndroidNotificationTaps } from "../apps/mobile/src/features/push-notifications/android-notification-taps.ts";
import { createAndroidPushNative } from "../apps/mobile/src/features/push-notifications/android-push-native.ts";
import { AndroidPushRegistration } from "../apps/mobile/src/features/push-notifications/android-push-registration.ts";
import { PushNotificationStore } from "../src/main/push-notification-store.ts";
import { PushNotificationSendFailure, PushNotificationService } from "../src/main/push-notifications.ts";
import { routePushNotifications } from "../src/main/team-api/route-push-notifications.ts";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const nonce = process.env.OPENBOT_ANDROID_PUSH_E2E_NONCE;
if (!nonce || !/^[0-9a-f-]{36}$/u.test(nonce)) throw new Error("A run nonce is required.");
const owned = await mkdtemp(join(tmpdir(), `openbot-android-push-${nonce}-`));
const cases = [];
const httpFailures = [];
const servers = new Set();
const serverSockets = new Map();
const serverPorts = new Map();
const services = new Set();
const controllers = new Set();
const taps = new Set();
const databases = new Set();
const ownedOrigins = new Set();
let externalRequests = 0;
const networkFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!ownedOrigins.has(url.origin)) {
    externalRequests += 1;
    return Promise.reject(new Error("An unowned network request was refused."));
  }
  return networkFetch(input, init);
};
const canaries = [
  ROOT,
  owned,
  `private-name-${nonce}`,
  `private-answer-${nonce}`,
  `private-agent-${nonce}`,
  `private-thread-${nonce}`,
];
let now = Date.now();
const phoneSecret = randomBytes(32);
const serverId = `server-${nonce}`;
const hostId = `host-${nonce}`;
const otherHost = `other-${nonce}`;
const sessionId = `session-${nonce}`;
const memberId = `member-${nonce}`;
const machineToken = randomBytes(32).toString("base64url");
const authHash = randomBytes(32).toString("base64url");
const deviceToken = `fcm:${randomBytes(30).toString("base64url")}`;
const nextToken = `fcm:${randomBytes(30).toString("base64url")}`;
for (const value of [machineToken, authHash, deviceToken, nextToken, phoneSecret.toString("hex")]) {
  registerSecretValue(value);
  canaries.push(value);
}
const secret = encodeLiveActivityBytes(liveActivityHostSecret(phoneSecret, serverId));
registerSecretValue(secret);
canaries.push(secret);
const registration = {
  serverId,
  transport: "fcm",
  token: deviceToken,
  environment: "production",
  secret,
  locale: "en",
  away: true,
  level: "all",
  mutedUntil: null,
  preview: false,
  sound: "default",
  liveActivityStartedAt: null,
};
const apnsRegistration = { ...registration, token: "ab".repeat(32), preview: true };
delete apnsRegistration.transport;
const viewer = {
  memberId,
  protocol: 7,
  capabilities: new Set([PUSH_NOTIFICATIONS_CAPABILITY, ANDROID_PUSH_NOTIFICATIONS_CAPABILITY]),
};
const agent = {
  id: canaries[4],
  name: canaries[2],
  title: "",
  description: "",
  notifications: true,
  provider: "codex",
  model: "default",
  reasoningEffort: "medium",
  threadId: canaries[5],
  workspacePath: owned,
  preview: canaries[3],
  updatedAt: null,
  avatarSeed: "fixture",
  avatarHue: null,
  avatarUrl: null,
};
const completed = {
  type: "turn-completed",
  agentId: agent.id,
  threadId: agent.threadId,
  turnId: "fixture-turn",
  status: "completed",
};

function safe(text) {
  let value = redactText(String(text));
  for (const item of canaries)
    value = value.replaceAll(item, "[private]").replaceAll(JSON.stringify(item).slice(1, -1), "[private]");
  return value.slice(0, 1_500);
}
async function check(name, run) {
  try {
    await run();
    assert.equal(httpFailures.length, 0, httpFailures.join("; "));
    cases.push({ name, passed: true });
  } catch (error) {
    cases.push({ name, passed: false, error: safe(error instanceof Error ? error.message : "Fixture failed.") });
    throw error;
  }
}
async function deadline(operation, label, ms = 10_000) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out.`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function until(predicate, label) {
  const end = performance.now() + 5_000;
  while (!predicate()) {
    if (performance.now() >= end) throw new Error(`${label} was not observed.`);
    await setImmediate();
  }
}
async function listen(handler) {
  const server = createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch((error) => {
      if (httpFailures.length < 10)
        httpFailures.push(safe(error instanceof Error ? error.message : "HTTP fixture failed."));
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  const sockets = new Set();
  serverSockets.set(server, sockets);
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  servers.add(server);
  await deadline(
    new Promise((accept, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", accept);
    }),
    "HTTP listen",
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  serverPorts.set(server, address.port);
  ownedOrigins.add(url);
  return { server, url };
}
async function bodyOf(request) {
  const chunks = [];
  let size = 0;
  for await (const part of request) {
    size += part.length;
    assert.ok(size <= 24_576);
    chunks.push(part);
  }
  return Buffer.concat(chunks).toString("utf8");
}
function hostService(options = {}) {
  const events = new EventEmitter();
  const sent = [];
  const store = new PushNotificationStore(join(owned, `${randomUUID()}.json`));
  const service = new PushNotificationService({
    agents: {
      on: (name, listener) => events.on(name, listener),
      off: (name, listener) => events.off(name, listener),
      listAgents: () => [agent],
      readConversationPageFor: () => Effect.succeed(null),
    },
    store,
    send: (push) =>
      Effect.sync(() => {
        sent.push(push);
        return "sent";
      }),
    hiddenAgentIds: () => new Set(),
    memberActive: () => true,
    lastUseElsewhere: () => null,
    atHostComputer: () => false,
    liveActivityShows: () => false,
    randomBytes: (size) => randomBytes(size),
    now: () => now,
    ...options,
  });
  service.start();
  services.add(service);
  return { service, events, sent, store };
}
function mobile(options = {}) {
  let permission = "granted";
  let token = deviceToken;
  let listener = null;
  let subscribed = 0;
  const posts = [];
  const permissions = [];
  const retries = new Set();
  const native = {
    permission: async () => permission,
    deviceToken: async () => token,
    onDeviceToken: (next) => {
      listener = next;
      subscribed += 1;
      return () => {
        listener = null;
        subscribed -= 1;
      };
    },
  };
  const controller = new AndroidPushRegistration({
    native,
    supports: (id) => id !== "old-host",
    post: async (id, path, body) => {
      posts.push({ id, path, body });
    },
    permission: (value) => permissions.push(value),
    now: () => now,
    schedule: (run) => {
      retries.add(run);
      return () => retries.delete(run);
    },
    ...options,
  });
  controllers.add(controller);
  const state = {
    servers: [
      { id: serverId, state: "online" },
      { id: "old-host", state: "online" },
    ],
    foreground: true,
    ready: true,
    enabled: true,
    playSound: true,
    sound: "default",
    locale: "en",
    settings: {},
    secret: () => secret,
  };
  return {
    controller,
    state,
    posts,
    permissions,
    retries,
    permission: (value) => {
      permission = value;
    },
    token: (value) => {
      token = value;
    },
    refresh: (value) => listener?.(value),
    subscribed: () => subscribed,
  };
}

let receipt = null;
let controlPlane = null;
let fcm = null;
let relayUrl = "";
let transportMode = "sent";
let oauthCalls = 0;
let fcmCalls = 0;
let jwtChecks = 0;
let relayAllowed = true;
let relayEnabled = true;
let database = null;
let failure = null;
let cleanupPassed = true;
const cleanupReceipts = [];
const cleanupErrors = [];
async function clean(resource, operation) {
  try {
    await deadline(Promise.resolve().then(operation), `${resource} cleanup`);
    cleanupReceipts.push({ resource, passed: true });
  } catch (error) {
    cleanupPassed = false;
    const receipt = {
      resource,
      name: safe(error instanceof Error ? error.name : "Error").slice(0, 80),
      code: safe(typeof error?.code === "string" ? error.code : "cleanup_failed").slice(0, 80),
      message: safe(error instanceof Error ? error.message : "Resource cleanup failed."),
    };
    cleanupErrors.push(receipt);
    cleanupReceipts.push({ resource, passed: false });
  }
}
async function listenerRefuses(port) {
  let probe;
  try {
    await deadline(
      new Promise((accept, reject) => {
        probe = createConnection({ host: "127.0.0.1", port });
        probe.once("connect", () => reject(new Error("An owned HTTP listener still accepts connections.")));
        probe.once("error", (error) => (error.code === "ECONNREFUSED" ? accept() : reject(error)));
      }),
      "Closed HTTP listener check",
      5_000,
    );
  } finally {
    probe?.destroy();
  }
}
try {
  await check("native channel, permission and token boundary", async () => {
    const order = [];
    let status = "undetermined";
    let callback;
    let detached = false;
    const native = createAndroidPushNative({
      ensureChannels: async () => {
        order.push("channels");
      },
      permission: async () => {
        order.push("permission");
        return { status, canAskAgain: true };
      },
      requestPermission: async () => {
        order.push("request");
        return { status: "granted" };
      },
      token: async () => ({ type: "android", data: deviceToken }),
      onToken: (listener) => {
        callback = listener;
        return () => {
          detached = true;
        };
      },
      previewSound: async () => undefined,
    });
    assert.equal(await native.permission(), "granted");
    assert.deepEqual(order, ["channels", "permission", "request"]);
    assert.equal(await native.deviceToken(), deviceToken);
    const heard = [];
    const stop = native.onDeviceToken((value) => heard.push(value));
    callback({ type: "android", data: nextToken });
    callback({ type: "ios", data: nextToken });
    callback({ type: "android", data: "bad\nvalue" });
    assert.deepEqual(heard, [nextToken, null, null]);
    stop();
    assert.equal(detached, true);
    status = "denied";
    order.length = 0;
    assert.equal(await native.permission(), "denied");
    assert.deepEqual(order, ["channels", "permission"]);
  });

  await check("additive capability and frozen APNs codec", async () => {
    assert.ok(TEAM_CURRENT_CAPABILITIES.includes(ANDROID_PUSH_NOTIFICATIONS_CAPABILITY));
    assert.ok(!TEAM_BOOTSTRAP_CAPABILITIES.includes(ANDROID_PUSH_NOTIFICATIONS_CAPABILITY));
    assert.ok(!legacyTeamCapabilities(TEAM_CURRENT_CAPABILITIES).includes(ANDROID_PUSH_NOTIFICATIONS_CAPABILITY));
    assert.deepEqual(
      PUSH_NOTIFICATIONS_CODECS.get(PUSH_NOTIFICATIONS_ROUTES.register).request(apnsRegistration),
      apnsRegistration,
    );
    assert.throws(() => PUSH_NOTIFICATIONS_CODECS.get(PUSH_NOTIFICATIONS_ROUTES.register).request(registration));
    const codec = ANDROID_PUSH_NOTIFICATIONS_CODECS.get(ANDROID_PUSH_NOTIFICATIONS_ROUTES.register);
    assert.deepEqual(codec.request(registration), registration);
    for (const changed of [
      { token: "a\n".repeat(20) },
      { token: "a".repeat(4097) },
      { preview: true },
      { environment: "development" },
      { liveActivityStartedAt: 1 },
      { secret: "bad" },
    ])
      assert.throws(() => codec.request({ ...registration, ...changed }));
  });

  await check("mobile permission revocation, host reconnect and opt-out", async () => {
    const m = mobile();
    m.permission("denied");
    m.controller.update(m.state);
    await until(() => m.posts.length === 1, "Denied removal");
    assert.equal(m.posts[0].path, ANDROID_PUSH_NOTIFICATIONS_ROUTES.remove);
    m.permission("granted");
    m.controller.update({ ...m.state, foreground: false });
    m.controller.update(m.state);
    await until(() => m.posts.length === 2, "Grant registration");
    assert.equal(m.posts[1].body.token, deviceToken);
    m.controller.update({ ...m.state, foreground: false });
    await until(() => m.posts.length === 3, "Away registration");
    assert.equal(m.posts[2].body.away, true);
    m.permission("denied");
    m.controller.update(m.state);
    await until(() => m.posts.length === 4, "Revocation removal");
    assert.equal(m.posts[3].path, ANDROID_PUSH_NOTIFICATIONS_ROUTES.remove);
    assert.ok(m.posts.every((post) => post.id !== "old-host"));
    m.controller.update({ ...m.state, enabled: false });
    await m.controller.dispose();
    assert.equal(m.subscribed(), 0);
    assert.equal(m.retries.size, 0);
    let resolvePermission;
    let permissionReads = 0;
    const ordered = [];
    const held = new AndroidPushRegistration({
      native: {
        permission: () =>
          ++permissionReads === 1
            ? Promise.resolve("granted")
            : new Promise((accept) => {
                resolvePermission = accept;
              }),
        deviceToken: async () => deviceToken,
        onDeviceToken: () => () => undefined,
      },
      supports: (id) => id === serverId,
      post: async (_id, path) => {
        ordered.push(path);
      },
      permission: () => undefined,
    });
    controllers.add(held);
    held.update(m.state);
    await until(() => ordered.length === 1, "Initial held-permission registration");
    held.update({ ...m.state, foreground: false });
    await until(() => ordered.length === 2, "Held-permission away registration");
    held.update(m.state);
    await until(() => typeof resolvePermission === "function", "Foreground permission read");
    await setImmediate();
    assert.equal(ordered.length, 2, "An unchecked previous permission registered again.");
    held.update({ ...m.state, enabled: false });
    await until(() => ordered.length === 3, "Opt-out while permission is pending");
    assert.equal(ordered[2], ANDROID_PUSH_NOTIFICATIONS_ROUTES.remove);
    resolvePermission("granted");
    await setImmediate();
    assert.equal(ordered.length, 3, "A stale permission result restored an opted-out registration.");
    await held.dispose();
  });

  await check("mobile token refresh, mute and sound reverse actions", async () => {
    const m = mobile();
    m.controller.update(m.state);
    await until(() => m.posts.length === 1, "Initial registration");
    m.refresh(nextToken);
    await until(() => m.posts.length === 2, "Token replacement");
    assert.equal(m.posts[1].body.token, nextToken);
    m.controller.update({ ...m.state, playSound: false });
    await until(() => m.posts.length === 3, "Silent registration");
    assert.equal(m.posts[2].body.sound, "none");
    m.controller.update({ ...m.state, settings: { [serverId]: { level: "all", mute: { until: null } } } });
    await until(() => m.posts.length === 4, "Mute removal");
    assert.equal(m.posts[3].path, ANDROID_PUSH_NOTIFICATIONS_ROUTES.remove);
    m.controller.update(m.state);
    await until(() => m.posts.length === 5, "Unmute registration");
    m.controller.update({ ...m.state, servers: [{ id: serverId, state: "offline" }] });
    m.controller.update(m.state);
    await until(() => m.posts.length === 6, "Reconnect registration");
    await m.controller.dispose();
    assert.equal(m.posts.at(-1).path, ANDROID_PUSH_NOTIFICATIONS_ROUTES.remove);
    let releaseToken;
    let listener;
    const observed = [];
    const race = new AndroidPushRegistration({
      native: {
        permission: async () => "granted",
        deviceToken: () =>
          new Promise((accept) => {
            releaseToken = accept;
          }),
        onDeviceToken: (value) => {
          listener = value;
          return () => undefined;
        },
      },
      supports: () => true,
      post: async (_id, _path, value) => {
        observed.push(value);
      },
      permission: () => undefined,
    });
    controllers.add(race);
    race.update({ ...m.state, servers: [{ id: serverId, state: "online" }] });
    await until(() => typeof releaseToken === "function", "Initial token request");
    listener(nextToken);
    await until(() => observed.length === 1, "Refreshed token during initial request");
    releaseToken(deviceToken);
    await setImmediate();
    assert.equal(observed.length, 1);
    assert.equal(observed[0].token, nextToken);
    await race.dispose();
  });

  await check("per-host queue order, independent progress and retry", async () => {
    let release;
    const held = new Promise((accept) => {
      release = accept;
    });
    const calls = [];
    let fail = true;
    const m = mobile({
      post: async (id, path, body) => {
        calls.push({ id, path, body });
        if (id === serverId && calls.filter((item) => item.id === serverId).length === 1) await held;
        if (id === "second-host" && fail) throw new Error("Synthetic transport unavailable.");
      },
    });
    const state = {
      ...m.state,
      servers: [
        { id: serverId, state: "online" },
        { id: "second-host", state: "online" },
      ],
    };
    m.controller.update(state);
    await until(() => calls.length === 2, "Independent host requests");
    m.controller.update({ ...state, enabled: false });
    await until(() => calls.filter((item) => item.id === "second-host").length === 2, "Independent removal");
    assert.equal(calls.filter((item) => item.id === serverId).length, 1);
    fail = false;
    release();
    await until(() => calls.filter((item) => item.id === serverId).length === 2, "Ordered removal");
    assert.equal(calls.filter((item) => item.id === serverId)[1].path, ANDROID_PUSH_NOTIFICATIONS_ROUTES.remove);
    for (const retry of [...m.retries]) {
      m.retries.delete(retry);
      retry();
    }
    await until(() => calls.filter((item) => item.id === "second-host").length >= 3, "Failed host removal retry");
    assert.equal(
      calls.filter((item) => item.id === "second-host").at(-1).path,
      ANDROID_PUSH_NOTIFICATIONS_ROUTES.remove,
    );
    await m.controller.dispose();
    assert.equal(m.subscribed(), 0);
  });

  await check("actual Team HTTP registration and legacy APNs persistence", async () => {
    const host = hostService();
    const http = await listen(async (request, response) => {
      const capabilities = new Set(
        request.headers["x-fixture-legacy"] === "true" ? [PUSH_NOTIFICATIONS_CAPABILITY] : viewer.capabilities,
      );
      try {
        const result = await routePushNotifications(
          {
            request,
            response,
            method: request.method,
            url: new URL(request.url, "http://fixture.invalid"),
            protocol: 7,
            capabilities,
            member: { id: memberId },
            sessionId,
            token: "fixture",
            sessionExpiresAt: new Date(now + 100_000).toISOString(),
            json: (status, value) => {
              response.writeHead(status, { "Content-Type": "application/json" });
              response.end(JSON.stringify(value));
              return "handled";
            },
            empty: (status) => {
              response.writeHead(status);
              response.end();
              return "handled";
            },
          },
          host.service,
        );
        if (result === "unmatched") {
          response.writeHead(404);
          response.end();
        }
      } catch (error) {
        response.writeHead(typeof error?.status === "number" ? error.status : 500);
        response.end();
      }
    });
    const post = (path, value, headers = {}) =>
      fetch(http.url + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(value),
        signal: AbortSignal.timeout(5_000),
      });
    assert.equal(
      (await post(ANDROID_PUSH_NOTIFICATIONS_ROUTES.register, registration, { "x-fixture-legacy": "true" })).status,
      400,
    );
    assert.equal((await post(ANDROID_PUSH_NOTIFICATIONS_ROUTES.register, registration)).status, 200);
    assert.equal(
      (await post(ANDROID_PUSH_NOTIFICATIONS_ROUTES.register, { ...registration, preview: true })).status,
      400,
    );
    host.service.register("replacement-session", viewer, registration);
    assert.equal((await post(ANDROID_PUSH_NOTIFICATIONS_ROUTES.register, registration)).status, 200);
    assert.equal(
      (await post(ANDROID_PUSH_NOTIFICATIONS_ROUTES.register, { ...registration, token: nextToken })).status,
      200,
    );
    host.service.register("apns-session", viewer, apnsRegistration);
    await Effect.runPromise(host.service.dispose());
    services.delete(host.service);
    await Effect.runPromise(host.store.load());
    assert.equal(host.store.list().length, 2);
    assert.equal(host.store.list().find((item) => item.sessionId === sessionId).value.transport, "fcm");
    assert.equal(host.store.list().find((item) => item.sessionId === sessionId).value.token, nextToken);
    assert.equal(
      host.store.list().find((item) => item.sessionId === "apns-session").value.token,
      apnsRegistration.token,
    );
    const restarted = hostService({ store: host.store });
    restarted.events.emit("event", completed);
    await until(() => restarted.sent.length === 2, "Restarted host notifications");
    assert.ok(restarted.sent.some((push) => push.transport === "fcm"));
    assert.ok(restarted.sent.some((push) => !Object.hasOwn(push, "transport")));
    await Effect.runPromise(restarted.service.dispose());
    services.delete(restarted.service);
  });

  await check("host five event kinds and notification policy", async () => {
    const host = hostService({ liveActivityShows: () => true });
    host.service.register(sessionId, viewer, registration);
    const events = [
      completed,
      { ...completed, status: "failed" },
      {
        type: "prompt",
        requestId: "question",
        agentId: agent.id,
        threadId: agent.threadId,
        turnId: "turn",
        questions: [],
      },
      {
        type: "approval",
        approval: {
          requestId: "approval",
          agentId: agent.id,
          threadId: agent.threadId,
          turnId: "turn",
          kind: "command",
          command: "true",
          cwd: null,
          reason: null,
          grantRoot: null,
          permissions: null,
        },
      },
      {
        type: "browser-takeover-requested",
        request: { requestId: "browser", agentId: agent.id, threadId: agent.threadId, turnId: "turn", tabId: "tab" },
      },
    ];
    for (const event of events) host.events.emit("event", event);
    await until(() => host.sent.length === 5, "Five Android notifications");
    receipt = host.sent[0];
    for (const event of [
      { ...completed, quiet: true },
      { ...completed, status: "interrupted" },
    ])
      host.events.emit("event", event);
    await setImmediate();
    assert.equal(host.sent.length, 5);
    await Effect.runPromise(host.service.dispose());
    services.delete(host.service);
    for (const [name, value, options] of [
      ["foreground", { ...registration, away: false }, {}],
      ["mute", { ...registration, mutedUntil: Math.ceil(now / 1000) + 60 }, {}],
      ["hidden", registration, { hiddenAgentIds: () => new Set([agent.id]) }],
      ["disabled member", registration, { memberActive: () => false }],
      ["desktop", registration, { atHostComputer: () => true }],
      ["needs-me", { ...registration, level: "needs-me" }, {}],
    ]) {
      const filtered = hostService(options);
      filtered.service.register(sessionId, viewer, value);
      filtered.events.emit("event", completed);
      await setImmediate();
      assert.equal(filtered.sent.length, 0, name);
      await Effect.runPromise(filtered.service.dispose());
      services.delete(filtered.service);
    }
    agent.notifications = false;
    const disabled = hostService();
    disabled.service.register(sessionId, viewer, registration);
    disabled.events.emit("event", completed);
    await setImmediate();
    assert.equal(disabled.sent.length, 0);
    agent.notifications = true;
  });

  await check("actual D1 session and host authorization with owned OAuth/FCM", async () => {
    database = new DatabaseSync(":memory:");
    databases.add(database);
    database.exec("PRAGMA foreign_keys=ON");
    for (const path of (await readdir(join(ROOT, "apps/auth-api/migrations")))
      .filter((name) => name.endsWith(".sql"))
      .sort())
      database.exec(await readFile(join(ROOT, "apps/auth-api/migrations", path), "utf8"));
    database
      .prepare("INSERT INTO users(id,identity_key,email,created_at,updated_at) VALUES(?,?,?,?,?)")
      .run("fixture-user", "fixture-identity", "fixture@example.invalid", now, now);
    for (const id of [hostId, otherHost])
      database
        .prepare(
          "INSERT INTO remote_hosts(host_id,owner_user_id,name,machine_token_hash,created_at,updated_at) VALUES(?,?,?,?,?,?)",
        )
        .run(
          id,
          "fixture-user",
          "Fixture",
          createHash("sha256")
            .update(id === hostId ? machineToken : "other-credential")
            .digest("base64url"),
          now,
          now,
        );
    database
      .prepare(
        "INSERT INTO auth_sessions(id,user_id,token_hash,expires_at,created_at,last_used_at) VALUES(?,?,?,?,?,?)",
      )
      .run("auth-fixture", "fixture-user", authHash, now + 9_000_000, now, now);
    database
      .prepare(
        "INSERT INTO remote_memberships(membership_id,host_id,user_id,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(memberId, hostId, "fixture-user", "owner", "active", now, now);
    database
      .prepare(
        "INSERT INTO remote_sessions(session_id,host_id,user_id,membership_id,started_at,expires_at,auth_session_hash) VALUES(?,?,?,?,?,?,?)",
      )
      .run(sessionId, hostId, "fixture-user", memberId, now, now + 9_000_000, authHash);
    const ticketKeys = await generateKeyPair("ES256", { extractable: true });
    const privateJwk = await exportJWK(ticketKeys.privateKey);
    const publicJwk = await exportJWK(ticketKeys.publicKey);
    const statement = (sql, values = []) => ({
      bind: (...next) => statement(sql, next),
      first: async (column) => {
        const row = database.prepare(sql).get(...values);
        return row ? (column ? row[column] : row) : null;
      },
      all: async () => ({ success: true, results: database.prepare(sql).all(...values), meta: {} }),
      run: async () => ({ success: true, results: [], meta: database.prepare(sql).run(...values) }),
    });
    controlPlane = new RemoteControlPlane(
      {
        DB: { prepare: (sql) => statement(sql) },
        REMOTE_TICKET_PRIVATE_JWK: JSON.stringify(privateJwk),
        REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({ keys: [{ ...publicJwk, kid: nonce }] }),
        REMOTE_TICKET_KEY_ID: nonce,
      },
      {
        now: () => now,
        fetch: async () => {
          throw new Error("Unexpected external account request.");
        },
      },
    );
    const signing = await generateKeyPair("RS256", { extractable: true });
    const config = {
      projectId: "openbot-fixture",
      clientEmail: "fixture@openbot-fixture.iam.gserviceaccount.com",
      privateKey: await exportPKCS8(signing.privateKey),
    };
    registerSecretValue(config.privateKey);
    canaries.push(config.privateKey);
    const transport = await listen(async (request, response) => {
      const text = await bodyOf(request);
      if (request.url === "/oauth") {
        oauthCalls += 1;
        const params = new URLSearchParams(text);
        assert.equal(params.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
        const verified = await jwtVerify(params.get("assertion"), signing.publicKey, {
          algorithms: ["RS256"],
          issuer: config.clientEmail,
          audience: "https://oauth2.googleapis.com/token",
          currentDate: new Date(now),
        });
        assert.equal(verified.payload.scope, "https://www.googleapis.com/auth/firebase.messaging");
        assert.equal(verified.payload.iat, Math.floor(now / 1000));
        assert.equal(verified.payload.exp, Math.floor(now / 1000) + 3600);
        jwtChecks += 1;
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({ access_token: "synthetic-access-token", token_type: "Bearer", expires_in: 3600 }),
        );
        return;
      }
      assert.equal(request.url, "/fcm");
      fcmCalls += 1;
      assert.equal(request.headers.authorization, "Bearer synthetic-access-token");
      const value = JSON.parse(text);
      assert.equal(value.message.token, deviceToken);
      assert.deepEqual(value.message.notification, { title: "OpenBot", body: "OpenBot" });
      for (const marker of [agent.id, agent.name, agent.threadId, agent.preview, serverId])
        assert.ok(!text.includes(marker), "Private content reached FCM.");
      assert.ok(
        Buffer.byteLength(JSON.stringify(value.message.notification) + JSON.stringify(value.message.data)) < 4096,
      );
      assert.deepEqual(JSON.parse(value.message.data.body), { sealed: receipt.sealed });
      assert.ok(value.message.android.notification.channel_id.startsWith("openbot-events-v1-"));
      assert.ok(value.message.android.ttl.endsWith("s"));
      if (transportMode === "oversized") {
        response.writeHead(200);
        response.end("x".repeat(9000));
        return;
      }
      if (transportMode === "gone") {
        response.writeHead(404);
        response.end(
          JSON.stringify({
            error: {
              details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }],
            },
          }),
        );
        return;
      }
      if (transportMode === "invalid") {
        response.writeHead(400);
        response.end(JSON.stringify({ error: { status: "INVALID_ARGUMENT" } }));
        return;
      }
      if (transportMode === "auth") {
        response.writeHead(401);
        response.end("{}");
        return;
      }
      if (transportMode === "transient") {
        response.writeHead(503);
        response.end("{}");
        return;
      }
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ name: `projects/${config.projectId}/messages/fixture` }));
    });
    fcm = new FcmRelaySender(
      config,
      (input, init) => {
        if (input === "https://oauth2.googleapis.com/token") return fetch(`${transport.url}/oauth`, init);
        assert.equal(input, "https://fcm.googleapis.com/v1/projects/openbot-fixture/messages:send");
        return fetch(`${transport.url}/fcm`, init);
      },
      () => now,
    );
    const relay = await listen(async (request, response) => {
      const text = await bodyOf(request);
      const requestedHost = request.url === "/other" ? otherHost : hostId;
      try {
        const result = await runApiEffect(
          relayAndroidNotification(
            new Request("http://fixture.invalid/android-notification", { method: "POST", body: text }),
            requestedHost,
            {
              controlPlane,
              relay: relayEnabled ? { sender: fcm, allow: () => Effect.succeed(relayAllowed) } : null,
            },
          ),
        );
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(await result.text());
      } catch (error) {
        response.writeHead(typeof error?.status === "number" ? error.status : 500);
        response.end();
      }
    });
    relayUrl = relay.url;
    const send = (values = {}, path = "/") =>
      fetch(relay.url + path, {
        method: "POST",
        body: JSON.stringify({ ...receipt, machineToken, ...values }),
        signal: AbortSignal.timeout(10_000),
      });
    assert.equal((await send({ machineToken: "incorrect" })).status, 401);
    assert.equal(fcmCalls, 0);
    assert.equal((await send({}, "/other")).status, 401);
    assert.equal(fcmCalls, 0);
    assert.equal((await send({ machineToken: "other-credential" }, "/other")).status, 410);
    assert.equal(fcmCalls, 0);
    assert.equal((await send({ sessionId: "foreign-session" })).status, 410);
    assert.equal(fcmCalls, 0);
    relayAllowed = false;
    assert.equal((await send()).status, 429);
    relayAllowed = true;
    relayEnabled = false;
    assert.equal((await send()).status, 503);
    relayEnabled = true;
    assert.equal((await send()).status, 204);
    assert.equal(fcmCalls, 1);
    assert.equal(oauthCalls, 1);
    assert.equal(jwtChecks, 1);
    database.prepare("UPDATE auth_sessions SET revoked_at=? WHERE token_hash=?").run(now, authHash);
    assert.equal((await send()).status, 410);
    database.prepare("UPDATE auth_sessions SET revoked_at=NULL WHERE token_hash=?").run(authHash);
    database.prepare("UPDATE remote_memberships SET status='revoked' WHERE membership_id=?").run(memberId);
    assert.equal((await send()).status, 410);
    database.prepare("UPDATE remote_memberships SET status='active' WHERE membership_id=?").run(memberId);
    database.prepare("UPDATE remote_sessions SET ended_at=? WHERE session_id=?").run(now, sessionId);
    assert.equal((await send()).status, 410);
    database.prepare("UPDATE remote_sessions SET ended_at=NULL WHERE session_id=?").run(sessionId);
  });

  await check("FCM token cache, expiry and failure classification", async () => {
    const send = () =>
      fetch(relayUrl, {
        method: "POST",
        body: JSON.stringify({ ...receipt, machineToken }),
        signal: AbortSignal.timeout(10_000),
      });
    assert.equal((await send()).status, 204);
    assert.equal(oauthCalls, 1);
    now += 3_550_000;
    assert.equal((await send()).status, 204);
    assert.equal(oauthCalls, 2);
    assert.equal(jwtChecks, 2);
    transportMode = "invalid";
    assert.equal((await send()).status, 400);
    transportMode = "transient";
    assert.equal((await send()).status, 503);
    transportMode = "oversized";
    assert.equal((await send()).status, 503);
    transportMode = "auth";
    assert.equal((await send()).status, 503);
    transportMode = "sent";
    assert.equal((await send()).status, 204);
    assert.equal(oauthCalls, 3);
    transportMode = "gone";
    assert.equal((await send()).status, 410);
    transportMode = "sent";
  });

  await check("host retires only an explicitly unregistered FCM token", async () => {
    let result = "unavailable";
    const host = hostService({
      send: () =>
        result === "gone"
          ? Effect.succeed("gone")
          : Effect.fail(new PushNotificationSendFailure({ cause: new Error("Synthetic transient refusal.") })),
    });
    host.service.register(sessionId, viewer, registration);
    host.events.emit("event", completed);
    await setImmediate();
    await Effect.runPromise(host.service.dispose());
    services.delete(host.service);
    await Effect.runPromise(host.store.load());
    assert.equal(host.store.list().length, 1);
    result = "gone";
    const next = hostService({ store: host.store, send: () => Effect.succeed("gone") });
    next.events.emit("event", completed);
    await setImmediate();
    await Effect.runPromise(next.service.dispose());
    services.delete(next.service);
    await Effect.runPromise(host.store.load());
    assert.equal(host.store.list().length, 0);
  });

  await check("authenticated cold tap, duplicate and exact host routing", async () => {
    const opened = [];
    const make = (options = {}) => {
      const value = new AndroidNotificationTaps({
        servers: () => [{ id: serverId }],
        secret: async () => phoneSecret,
        open: (agentId, id) => opened.push({ agentId, serverId: id }),
        ...options,
      });
      taps.add(value);
      return value;
    };
    const current = make();
    await current.receive("cold-response", { sealed: receipt.sealed });
    assert.deepEqual(opened, [{ agentId: agent.id, serverId }]);
    await current.receive("cold-response", { sealed: receipt.sealed });
    const remount = make();
    await remount.receive("cold-response", { sealed: receipt.sealed });
    assert.equal(opened.length, 1);
    await remount.receive("new-response", { sealed: receipt.sealed });
    assert.equal(opened.length, 2);
    const wrong = make({ secret: async () => randomBytes(32) });
    await wrong.receive("wrong-secret", { sealed: receipt.sealed });
    await current.receive("plaintext", { agentId: agent.id, serverId });
    await current.receive("edited", { sealed: (receipt.sealed[0] === "A" ? "B" : "A") + receipt.sealed.slice(1) });
    await current.receive("too-large", { sealed: "A".repeat(ANDROID_NOTIFICATION_SEALED_LIMIT + 1) });
    const foreign = sealPushNotification(
      { serverId: otherHost, agentId: agent.id, threadId: agent.threadId, kind: "reply", title: agent.name, body: "" },
      pushNotificationKeys(liveActivityHostSecret(phoneSecret, serverId)),
      randomBytes(16),
    );
    await current.receive("foreign-host", { sealed: foreign });
    assert.equal(opened.length, 2);
    let release;
    const delayed = make({
      secret: () =>
        new Promise((accept) => {
          release = accept;
        }),
    });
    const pending = delayed.receive("signed-out", { sealed: receipt.sealed });
    delayed.dispose();
    release(phoneSecret);
    await pending;
    assert.equal(opened.length, 2);
    let knownServers = [];
    const waitingForServer = make({ servers: () => knownServers });
    await waitingForServer.receive("late-server", { sealed: receipt.sealed });
    assert.equal(opened.length, 2);
    knownServers = [{ id: serverId }];
    await waitingForServer.receive("late-server", { sealed: receipt.sealed });
    assert.equal(opened.length, 3);
    assert.deepEqual(opened.at(-1), { agentId: agent.id, serverId });
  });

  await check("malformed relay data fails before OAuth or FCM", async () => {
    const before = fcmCalls;
    for (const changed of [
      { token: "\ninvalid-token" },
      { sealed: "A".repeat(ANDROID_NOTIFICATION_SEALED_LIMIT + 1) },
      { timestamp: -1 },
      { sound: "unknown" },
      { transport: "apns" },
    ]) {
      assert.equal(readAndroidNotificationRelayPush({ ...receipt, ...changed }), null);
      const response = await fetch(relayUrl, {
        method: "POST",
        body: JSON.stringify({ ...receipt, machineToken, ...changed }),
        signal: AbortSignal.timeout(5_000),
      });
      assert.equal(response.status, 400);
    }
    assert.equal(fcmCalls, before);
  });

  await check("legacy APNs sender keeps its sealed alert envelope", async () => {
    const pair = await generateKeyPair("ES256", { extractable: true });
    const sent = [];
    const sender = new ApnsRelaySender(
      {
        privateKey: await exportPKCS8(pair.privateKey),
        keyId: "fixture-key",
        teamId: "fixture-team",
        topic: "run.openbot.mobile",
      },
      async (url, init) => {
        sent.push({ url, headers: init.headers, body: JSON.parse(init.body) });
        return new Response(null, { status: 200 });
      },
      () => now,
    );
    const value = {
      token: apnsRegistration.token,
      environment: "production",
      sessionId,
      sealed: receipt.sealed,
      sound: "default",
      timestamp: Math.floor(now / 1000),
    };
    assert.equal(await Effect.runPromise(sender.sendNotification(value)), "sent");
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].body, {
      aps: { alert: { title: "OpenBot" }, "mutable-content": 1, sound: "default" },
      sealed: receipt.sealed,
    });
    assert.ok(sent[0].url.startsWith("https://api.push.apple.com/3/device/"));
  });

  await check("Android config copies valid sounds without changing iOS names", async () => {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const plugin = require("../apps/mobile/plugins/with-android-push.js");
    const app = JSON.parse(await readFile(join(ROOT, "apps/mobile/app.json"), "utf8"));
    const options = app.expo.plugins.find(
      (entry) => Array.isArray(entry) && entry[0] === "./plugins/with-android-push",
    )[1];
    const configFile = join(owned, "synthetic-google-services.json");
    process.env.OPENBOT_ANDROID_GOOGLE_SERVICES_FILE = configFile;
    const config = plugin({ ...app.expo, mods: {} }, options);
    delete process.env.OPENBOT_ANDROID_GOOGLE_SERVICES_FILE;
    assert.equal(config.android.googleServicesFile, configFile);
    const mod = config.mods.android.dangerous;
    await mod({
      ...config,
      modResults: {},
      modRequest: {
        projectRoot: join(ROOT, "apps/mobile"),
        platformProjectRoot: join(owned, "android"),
        platform: "android",
        modName: "dangerous",
        introspect: false,
        ignoreExistingNativeFiles: true,
      },
    });
    for (const source of options.sounds) {
      const name = source.split("/").at(-1);
      assert.ok(name.includes("-"));
      const original = await readFile(join(ROOT, "apps/mobile", source));
      const copied = await readFile(join(owned, "android/app/src/main/res/raw", name.replaceAll("-", "_")));
      assert.deepEqual(copied, original);
    }
  });

  await check("disposed mobile permission and token callbacks cannot register", async () => {
    let resolvePermission;
    let posts = 0;
    let detached = false;
    const controller = new AndroidPushRegistration({
      native: {
        permission: () =>
          new Promise((accept) => {
            resolvePermission = accept;
          }),
        deviceToken: async () => deviceToken,
        onDeviceToken: () => () => {
          detached = true;
        },
      },
      supports: () => true,
      post: async () => {
        posts += 1;
      },
      permission: () => undefined,
    });
    controllers.add(controller);
    const m = mobile();
    controller.update(m.state);
    await controller.dispose();
    resolvePermission("granted");
    await setImmediate();
    assert.equal(posts, 0);
    assert.equal(detached, true);
    await m.controller.dispose();
  });
} catch (error) {
  failure = safe(error instanceof Error ? error.message : "Fixture failed.");
} finally {
  let index = 0;
  for (const value of controllers) {
    await clean(`mobile-${++index}`, () => value.dispose());
  }
  index = 0;
  for (const value of taps) await clean(`tap-${++index}`, () => value.dispose());
  index = 0;
  for (const value of services) {
    await clean(`host-${++index}`, () => Effect.runPromise(value.dispose()));
  }
  index = 0;
  for (const server of servers) {
    await clean(`http-${++index}`, async () => {
      const sockets = serverSockets.get(server);
      const closed = server.listening
        ? new Promise((accept, reject) => server.close((error) => (error ? reject(error) : accept())))
        : Promise.resolve();
      // Bun 1.4.2 stops the listener in closeAllConnections. Register close's callback first.
      // Track and destroy our own sockets because Bun clears its native handle in close().
      for (const socket of sockets ?? []) socket.destroy();
      server.closeAllConnections();
      await closed;
      await until(() => (sockets?.size ?? 0) === 0, "Owned HTTP sockets closed");
      assert.equal(server.listening, false);
      assert.equal(server.address(), null);
      const port = serverPorts.get(server);
      if (port !== undefined) await listenerRefuses(port);
    });
  }
  index = 0;
  for (const value of databases) {
    await clean(`database-${++index}`, () => value.close());
  }
  await clean("fixture-files", async () => {
    await rm(owned, { recursive: true, force: true });
    try {
      await stat(owned);
      throw new Error("Owned fixture files remain.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  });
}
const cleanupRequired = controllers.size + taps.size + services.size + servers.size + databases.size + 1;
cleanupPassed &&=
  cleanupReceipts.length === cleanupRequired &&
  cleanupReceipts.every((receipt) => receipt.passed) &&
  cleanupErrors.length === 0;
const result = {
  nonce,
  passed: failure === null && cases.length === 15 && cleanupPassed && externalRequests === 0,
  requiredCases: 15,
  executedCases: cases.length,
  passedCases: cases.filter((value) => value.passed).length,
  cases,
  cleanupPassed,
  cleanupRequired,
  cleanupReceipts,
  cleanupErrors,
  failure,
  runtime: { bun: process.versions.bun ?? null, nodeCompatibility: process.versions.node },
  nativeDeliveryVerified: false,
  externalRequests,
};
const output = JSON.stringify(result);
for (const item of canaries)
  if (output.includes(item) || output.includes(JSON.stringify(item).slice(1, -1)))
    throw new Error("The fixture report contains private data.");
// Machine-readable: the parent owns bounded artifact writes and redaction guards.
process.stdout.write(`${output}\n`);
process.exitCode = result.passed ? 0 : 1;
