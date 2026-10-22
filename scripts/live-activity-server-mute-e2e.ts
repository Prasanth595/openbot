// Checks that the iOS Live Activity follows the notification settings of each server (#2344): a
// server that the user muted, or set to notify about "Nothing", does not start or update the
// activity, and its host does not get the push token that updates it. A change ends or starts the
// activity at once, also while it runs, and a timed mute that ends shows the server again.
// Avatar failures also recover with a bounded retry before the host can name the saved files.
//
// It renders the real mobile hook (`useLiveActivity`) with React, with the real settings stores, the
// Dynamic Island coordinator, the Live Activity view, and `LiveActivitySync`. Only the boundaries
// that need a phone are replaced: the ActivityKit module that `agentLiveActivity()` returns, the
// keychain, and the host requests. It sends nothing. Run it with
// `bun scripts/live-activity-server-mute-e2e.ts`. Writes .openbot-build/live-activity-server-mute-e2e/report.json.
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AgentEvent, AgentSummary } from "@openbot/contracts/ipc";
import { LIVE_ACTIVITY_PUSH_ROUTES } from "@openbot/contracts/team-protocol/live-activity-push-v1";
import { createOpenBotLogger } from "@openbot/logging";
import { LIVE_ACTIVITY_MOODS, liveActivityBloubFile } from "@openbot/team-client/live-activity-props";
import { plugin } from "bun";

const OUT = resolve(import.meta.dirname, "../.openbot-build/live-activity-server-mute-e2e");
const MOBILE_SRC = resolve(import.meta.dirname, "../apps/mobile/src");
const WAIT_TIMEOUT_MS = 10_000;
/** Long enough for the hook to apply the mute before it ends. */
const TIMED_MUTE_MS = 1_500;
const PUSH_TOKEN = "e2e-activity-push-token";
const SERVER_A = "server-a";
const SERVER_B = "server-b";
const logger = createOpenBotLogger("live-activity-server-mute-e2e");
const require = createRequire(import.meta.url);

// --- The ActivityKit module of the iOS build, as the hook uses it. ---

interface ActivityRecord {
  id: number;
  starts: string[];
  updates: string[];
  ended: boolean;
}

const activities: ActivityRecord[] = [];
const avatarFiles = new Set<string>();
const avatarAttempts = new Map<string, number>();
type AvatarFailure = "render-null" | "render-throw" | "save-null" | "save-throw";
let avatarFault: { kind: AvatarFailure; remaining: number; onFailure?: () => void } | null = null;
let avatarFailures = 0;
let invalidAvatarRegistrations = 0;
const FAILED_AVATAR = liveActivityBloubFile(`seed-${SERVER_A}`, null, "responded");

function failAvatar(file: string, operation: "render" | "save"): boolean {
  if (file !== FAILED_AVATAR || !avatarFault?.kind.startsWith(operation) || avatarFault.remaining <= 0) return false;
  avatarFault.remaining -= 1;
  avatarFailures += 1;
  avatarFault.onFailure?.();
  if (avatarFault.kind.endsWith("throw")) throw new Error("Injected avatar failure.");
  return true;
}

function createActivity(props: unknown) {
  const record: ActivityRecord = {
    id: activities.length + 1,
    starts: [JSON.stringify(props)],
    updates: [],
    ended: false,
  };
  activities.push(record);
  return {
    startedAt: Date.now(),
    async update(next: unknown) {
      if (record.ended) throw new Error("The activity ended.");
      record.updates.push(JSON.stringify(next));
    },
    async end() {
      record.ended = true;
    },
    watchPushToken(receive: (token: string) => void) {
      receive(PUSH_TOKEN);
      return () => undefined;
    },
  };
}

const native = {
  starter: {
    start: createActivity,
    // Each case starts with no activity from an earlier launch.
    getInstances: () => [],
  },
  setSealKeys: () => undefined,
  saveAvatar: (name: string) => {
    const file = `avatar-${name}.png`;
    if (failAvatar(file, "save")) return null;
    avatarFiles.add(file);
    return file;
  },
  hasAvatar: (file: string) => avatarFiles.has(file),
  renderBloub: (seed: string, hue: null, mood: (typeof LIVE_ACTIVITY_MOODS)[number]) => {
    const file = liveActivityBloubFile(seed, hue, mood);
    avatarAttempts.set(file, (avatarAttempts.get(file) ?? 0) + 1);
    return failAvatar(file, "render") ? null : "data:image/png;base64,e2e";
  },
  removeAvatars: (keep: ReadonlySet<string>) => {
    for (const file of avatarFiles) if (!keep.has(file)) avatarFiles.delete(file);
  },
};

/** The content that the running activity shows, or `null` when none runs. */
function shownContent(): string | null {
  const running = activities.filter((activity) => !activity.ended);
  assert.ok(running.length <= 1, "More than one Live Activity runs.");
  const activity = running[0];
  if (!activity) return null;
  return activity.updates.at(-1) ?? activity.starts[0] ?? null;
}

// --- The phone modules that have no Bun build. The hook reaches them only through these names. ---

const keychain = new Map<string, string>();
plugin({
  name: "live-activity-phone-boundaries",
  setup(build) {
    build.module("react-native", () => ({
      loader: "object",
      exports: {
        Alert: { alert: () => undefined },
        AppState: { currentState: "active", addEventListener: () => ({ remove: () => undefined }) },
      },
    }));
    build.module("expo-secure-store", () => ({
      loader: "object",
      exports: {
        getItemAsync: async (key: string) => keychain.get(key) ?? null,
        setItemAsync: async (key: string, value: string) => {
          keychain.set(key, value);
        },
        deleteItemAsync: async (key: string) => {
          keychain.delete(key);
        },
      },
    }));
    build.module("expo-crypto", () => ({
      loader: "object",
      exports: { getRandomBytes: (count: number) => webcrypto.getRandomValues(new Uint8Array(count)) },
    }));
    // The app aliases `@/` to `apps/mobile/src`.
    build.onResolve({ filter: /^@\// }, ({ path }) => ({ path: require.resolve(join(MOBILE_SRC, path.slice(2))) }));
    build.onLoad({ filter: /live-activity[/\\]agent-live-activity\.tsx$/ }, () => ({
      loader: "object",
      exports: { agentLiveActivity: () => native },
    }));
    // The language comes from the phone. The test uses English.
    build.onLoad({ filter: /shared[/\\]lib[/\\]text\.ts$/ }, async () => {
      const { textFor }: { textFor: (locale: "en") => unknown } = await import(mobileUrl("shared/lib/text-value.ts"));
      return { loader: "object", exports: { currentText: () => textFor("en"), currentLocale: () => "en" } };
    });
    build.onLoad({ filter: /analytics[/\\]mobile-analytics\.ts$/ }, () => ({
      loader: "object",
      exports: { mobileAnalytics: { track: () => undefined } },
    }));
    build.onLoad({ filter: /analytics[/\\]failure-reports\.ts$/ }, () => ({
      loader: "object",
      exports: { showFailureAlert: () => undefined },
    }));
    build.onLoad({ filter: /shared[/\\]lib[/\\]push-environment\.ts$/ }, () => ({
      loader: "object",
      exports: { pushEnvironment: () => "development" },
    }));
    build.onLoad({ filter: /agents[/\\]model[/\\]bloub-activity\.ts$/ }, () => ({
      loader: "object",
      exports: { getBloubAvatarColor: () => "#5E5CE6" },
    }));
  },
});

/** The mobile modules load at run time, so the Node typecheck does not read the app sources. */
function mobileUrl(path: string): string {
  return pathToFileURL(join(MOBILE_SRC, path)).href;
}

// React is a dependency of the mobile app, so it loads from there, as the hook does.
interface Root {
  render: (element: unknown) => void;
  unmount: () => void;
}
const mobileRequire = createRequire(join(MOBILE_SRC, "../package.json"));
const { createElement }: { createElement: (component: () => null) => unknown } = mobileRequire("react");
const { createRoot }: { createRoot: (container: Element) => Root } = mobileRequire("react-dom/client");
const { flushSync }: { flushSync: (run: () => void) => void } = mobileRequire("react-dom");

// React DOM reads the global window. The hook renders nothing.
const { JSDOM }: { JSDOM: new (html: string) => { window: Window & typeof globalThis } } = require("jsdom");
const dom = new JSDOM("<!doctype html><div></div>");
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  requestAnimationFrame: (callback: FrameRequestCallback) =>
    dom.window.setTimeout(() => callback(performance.now()), 0),
  cancelAnimationFrame: (frame: number) => dom.window.clearTimeout(frame),
});

// --- The real mobile modules. ---

type ServerState = "online" | "offline";
interface Server {
  id: string;
  state: ServerState;
}
interface Agent {
  id: string;
  serverId: string;
  name: string;
  title: string;
  description: string;
  preview: string;
  updatedLabel: string;
  avatarUrl: null;
  avatarSeed: string;
  avatarHue: null;
  notifications: boolean;
}
type Post = (serverId: string, path: string, body: unknown) => Promise<void>;
interface LiveActivityInput {
  servers: readonly Server[];
  activeServerId: string | null;
  agents: readonly Agent[];
  liveState: { get(): { unreadAgentIds: string[]; unreadCounts: Record<string, number> }; subscribe(): () => void };
  foreground: boolean;
  post: Post;
  loadAgentAvatar: () => Promise<string>;
  supportsPush: () => boolean;
}
interface ServerNotificationSetting {
  level: "all" | "needs-me" | "nothing";
  mute: { until: number | null } | null;
}
interface PreferenceStore<State> {
  getState(): State;
  setState(state: Partial<State>): void;
}

const {
  useLiveActivity,
}: { useLiveActivity: (input: LiveActivityInput) => (serverId: string, event: AgentEvent) => void } = await import(
  mobileUrl("features/live-activity/use-live-activity.ts")
);
const notifications: {
  usePushNotificationPreference: PreferenceStore<{
    ready: boolean;
    saving: boolean;
    servers: Record<string, ServerNotificationSetting>;
  }>;
  saveServerNotificationSetting: (serverId: string, change: Partial<ServerNotificationSetting>) => Promise<void>;
} = await import(mobileUrl("features/settings/model/push-notifications.ts"));
const liveActivities: { useLiveActivitiesPreference: PreferenceStore<{ enabled: boolean; ready: boolean }> } =
  await import(mobileUrl("features/settings/model/live-activities.ts"));

// --- The harness. ---

const requests: { serverId: string; path: string; token?: string; away?: boolean }[] = [];
const post: Post = async (serverId, path, body) => {
  if (path === LIVE_ACTIVITY_PUSH_ROUTES.register) {
    // The real host derives these fallback names when no agent photo was registered.
    if (LIVE_ACTIVITY_MOODS.some((mood) => !avatarFiles.has(liveActivityBloubFile(`seed-${serverId}`, null, mood))))
      invalidAvatarRegistrations += 1;
  }
  const token = typeof body === "object" && body !== null && "token" in body ? String(body.token) : undefined;
  const away = typeof body === "object" && body !== null && "away" in body ? body.away === true : undefined;
  requests.push({ serverId, path, ...(token === undefined ? {} : { token }), ...(away === undefined ? {} : { away }) });
};
const liveState = {
  get: () => ({ unreadAgentIds: [], unreadCounts: {} }),
  subscribe: () => () => undefined,
};

function agent(serverId: string): Agent {
  return {
    id: `agent-${serverId}`,
    serverId,
    name: `Agent on ${serverId}`,
    title: "",
    description: "",
    preview: "",
    updatedLabel: "",
    avatarUrl: null,
    avatarSeed: `seed-${serverId}`,
    avatarHue: null,
    notifications: true,
  };
}

function summary(fixture: Agent): AgentSummary {
  return {
    id: fixture.id,
    name: fixture.name,
    title: fixture.title,
    description: fixture.description,
    notifications: true,
    provider: "codex",
    model: "gpt-5.5",
    reasoningEffort: "low",
    threadId: `thread-${fixture.id}`,
    workspacePath: "/tmp",
    preview: "",
    updatedAt: null,
    avatarSeed: fixture.avatarSeed,
    avatarHue: null,
    avatarUrl: null,
  };
}

/** Waits for a state of the activity or the host requests that the hook reaches on its own. */
async function waitFor(label: string, probe: () => boolean): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (!probe()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting until ${label}.`);
    await new Promise((done) => setImmediate(done));
  }
}

interface Session {
  apply: (serverId: string, event: AgentEvent) => void;
  root: Root;
  selectServer: (serverId: string) => void;
  setForeground: (foreground: boolean) => void;
}

async function startSession(
  serverIds: readonly string[],
  settings: Record<string, ServerNotificationSetting>,
  foreground = true,
) {
  activities.length = 0;
  requests.length = 0;
  keychain.clear();
  avatarFiles.clear();
  avatarAttempts.clear();
  avatarFailures = 0;
  invalidAvatarRegistrations = 0;
  liveActivities.useLiveActivitiesPreference.setState({ enabled: true, ready: true });
  notifications.usePushNotificationPreference.setState({ ready: true, saving: false, servers: settings });
  const servers = serverIds.map((id) => ({ id, state: "online" as const }));
  const agents = serverIds.map(agent);
  let activeServerId = serverIds[0] ?? null;
  let isForeground = foreground;
  const session: Partial<Session> = {};
  function Harness() {
    session.apply = useLiveActivity({
      servers,
      activeServerId,
      agents,
      liveState,
      foreground: isForeground,
      post,
      loadAgentAvatar: async () => "",
      supportsPush: () => true,
    });
    return null;
  }
  const root = createRoot(dom.window.document.createElement("div"));
  root.render(createElement(Harness));
  await waitFor("the hook renders", () => session.apply !== undefined);
  const apply = session.apply;
  assert.ok(apply);
  // Each server reports a working agent, so each one has something for the activity to show.
  for (const fixture of agents) {
    apply(fixture.serverId, { type: "agents-changed", agents: [summary(fixture)] });
    apply(fixture.serverId, {
      type: "conversation",
      snapshot: {
        agentId: fixture.id,
        threadId: `thread-${fixture.id}`,
        activeTurnId: "turn-1",
        revision: 1,
        messages: [],
      },
    });
  }
  return {
    apply,
    root,
    selectServer: (serverId: string) => {
      activeServerId = serverId;
      flushSync(() => root.render(createElement(Harness)));
    },
    setForeground: (next: boolean) => {
      isForeground = next;
      flushSync(() => root.render(createElement(Harness)));
    },
  };
}

function shows(serverId: string): boolean {
  return shownContent()?.includes(`Agent on ${serverId}`) ?? false;
}

function registeredWith(serverId: string): boolean {
  const last = requests.filter((request) => request.serverId === serverId).at(-1);
  return last?.path === LIVE_ACTIVITY_PUSH_ROUTES.register && last.token === PUSH_TOKEN;
}

function removedFrom(serverId: string): boolean {
  return requests.filter((request) => request.serverId === serverId).at(-1)?.path === LIVE_ACTIVITY_PUSH_ROUTES.remove;
}

const MUTED_FOREVER: ServerNotificationSetting = { level: "all", mute: { until: null } };
const NOTHING: ServerNotificationSetting = { level: "nothing", mute: null };
const BOTH: ServerNotificationSetting = { level: "nothing", mute: { until: null } };

interface CaseResult {
  name: string;
  passed: boolean;
  checks: Record<string, boolean>;
  error?: string;
}

/** Every content that the activity started or updated with, in this case. */
function everShown(serverId: string): boolean {
  return activities.some((activity) =>
    [...activity.starts, ...activity.updates].some((content) => content.includes(`Agent on ${serverId}`)),
  );
}

function everRegisteredWith(serverId: string): boolean {
  return requests.some(
    (request) => request.serverId === serverId && request.path === LIVE_ACTIVITY_PUSH_ROUTES.register,
  );
}

/**
 * Server A is active and has `setting`. Server B has notifications on. The activity shows the active
 * server first, so when it shows server B, the hook has published with server A hidden.
 */
async function hiddenAtStart(name: string, setting: ServerNotificationSetting): Promise<CaseResult> {
  const { root } = await startSession([SERVER_A, SERVER_B], { [SERVER_A]: setting });
  await waitFor("the activity shows server B", () => shows(SERVER_B));
  const checks = {
    activityNeverShowedServer: !everShown(SERVER_A),
    hostNeverGotToken: !everRegisteredWith(SERVER_A),
    otherServerShown: true,
  };
  // With the other server off too, nothing is left to show.
  await notifications.saveServerNotificationSetting(SERVER_B, { level: "nothing" });
  await waitFor("the activity ends", () => shownContent() === null);
  root.unmount();
  return { name, passed: Object.values(checks).every(Boolean), checks: { ...checks, endsWithNoServerLeft: true } };
}

const cases: [string, () => Promise<CaseResult>][] = [
  [
    "baseline: a server with notifications on starts the activity",
    async () => {
      const { root } = await startSession([SERVER_A], {});
      await waitFor("the activity shows server A", () => shows(SERVER_A));
      await waitFor("server A has the push token", () => registeredWith(SERVER_A));
      root.unmount();
      return { name: "baseline", passed: true, checks: { activityShowsServer: true, tokenForHost: true } };
    },
  ],
  ...(["render-null", "render-throw", "save-null", "save-throw"] as const).map(
    (kind): [string, () => Promise<CaseResult>] => [
      `a transient ${kind} avatar failure recovers`,
      async () => {
        avatarFault = { kind, remaining: 1 };
        let root: Root | undefined;
        try {
          ({ root } = await startSession([SERVER_A], {}));
          await waitFor("the host registers after the avatar retry", () => registeredWith(SERVER_A));
          assert.equal(avatarFailures, 1);
          assert.equal(avatarAttempts.get(FAILED_AVATAR), 2);
          assert.equal(invalidAvatarRegistrations, 0, "The host must name only saved avatar files.");
          return {
            name: `transient ${kind} avatar failure`,
            passed: true,
            checks: { recoveredWithoutRemount: true, retriedOnce: true, registeredWithSavedFiles: true },
          };
        } finally {
          root?.unmount();
          avatarFault = null;
        }
      },
    ],
  ),
  [
    "a permanent avatar failure stops and a later foreground change can recover",
    async () => {
      avatarFault = { kind: "render-null", remaining: Number.POSITIVE_INFINITY };
      let session: Awaited<ReturnType<typeof startSession>> | undefined;
      try {
        session = await startSession([SERVER_A], {});
        await waitFor("both bounded avatar attempts fail", () => avatarFailures === 2);
        // Let queued React work finish. A failed preparation must not schedule another render.
        await new Promise((done) => setImmediate(done));
        assert.equal(avatarAttempts.get(FAILED_AVATAR), 2);
        assert.equal(everRegisteredWith(SERVER_A), false, "Missing fallback files must block host registration.");
        assert.ok(shows(SERVER_A), "The app can still show the current activity.");
        avatarFault = null;
        session.setForeground(false);
        await waitFor("a new preparation repairs the cached failure", () => registeredWith(SERVER_A));
        assert.equal(avatarAttempts.get(FAILED_AVATAR), 3);
        assert.equal(invalidAvatarRegistrations, 0);
        return {
          name: "permanent avatar failure and later recovery",
          passed: true,
          checks: { attemptsBounded: true, noUnsafeRegistration: true, foregroundChangeRecovers: true },
        };
      } finally {
        session?.root.unmount();
        avatarFault = null;
      }
    },
  ],
  [
    "a host change cancels the failed avatar preparation before its retry",
    async () => {
      let session: Awaited<ReturnType<typeof startSession>> | undefined;
      avatarFault = {
        kind: "render-null",
        remaining: 1,
        onFailure: () => {
          assert.ok(session, "The session must exist before avatar preparation.");
          session.selectServer(SERVER_B);
        },
      };
      try {
        session = await startSession([SERVER_A, SERVER_B], {});
        await waitFor("the new host has the push token", () => registeredWith(SERVER_B));
        assert.equal(avatarFailures, 1);
        assert.equal(avatarAttempts.get(FAILED_AVATAR), 1, "Cancelled work must not draw the failed face again.");
        assert.equal(everRegisteredWith(SERVER_A), false);
        assert.equal(invalidAvatarRegistrations, 0);
        return {
          name: "host change during avatar failure",
          passed: true,
          checks: { cancelledBeforeRetry: true, previousHostNeverRegistered: true, newHostRegistered: true },
        };
      } finally {
        session?.root.unmount();
        avatarFault = null;
      }
    },
  ],
  [
    "background registration does not need an animation frame",
    async () => {
      const previousFrame = globalThis.requestAnimationFrame;
      let frameRequests = 0;
      globalThis.requestAnimationFrame = () => {
        frameRequests += 1;
        return 0;
      };
      let root: Root | undefined;
      try {
        ({ root } = await startSession([SERVER_A], {}, false));
        await waitFor("the background host has the push token", () => registeredWith(SERVER_A));
        assert.equal(frameRequests, 0, "A background registration must not request an animation frame.");
        assert.ok(requests.some((request) => request.path === LIVE_ACTIVITY_PUSH_ROUTES.register && request.away));
        return {
          name: "background registration",
          passed: true,
          checks: { registeredWithoutFrame: true, hostMarkedAway: true },
        };
      } finally {
        root?.unmount();
        globalThis.requestAnimationFrame = previousFrame;
      }
    },
  ],
  ["mute on", () => hiddenAtStart("mute on", MUTED_FOREVER)],
  ["notifications off", () => hiddenAtStart("notifications off", NOTHING)],
  ["mute on and notifications off", () => hiddenAtStart("mute on and notifications off", BOTH)],
  [
    "toggle while the activity runs",
    async () => {
      const { root } = await startSession([SERVER_A], {});
      await waitFor("the activity shows server A", () => shows(SERVER_A));
      await waitFor("server A has the push token", () => registeredWith(SERVER_A));
      const checks: Record<string, boolean> = { startedBeforeToggle: true };
      for (const [label, change] of [
        ["mute", { mute: { until: null } }],
        ["notificationsOff", { mute: null, level: "nothing" }],
        ["both", { mute: { until: null }, level: "nothing" }],
      ] as const) {
        await notifications.saveServerNotificationSetting(SERVER_A, change);
        await waitFor(`the activity ends after ${label}`, () => shownContent() === null);
        await waitFor(`server A loses the push token after ${label}`, () => removedFrom(SERVER_A));
        checks[`${label}EndsActivity`] = true;
        await notifications.saveServerNotificationSetting(SERVER_A, { mute: null, level: "all" });
        await waitFor(`the activity shows server A again after ${label}`, () => shows(SERVER_A));
        await waitFor(`server A has the push token again after ${label}`, () => registeredWith(SERVER_A));
        checks[`${label}UndoStartsActivity`] = true;
      }
      root.unmount();
      return { name: "toggle while the activity runs", passed: true, checks };
    },
  ],
  [
    "settings are per server",
    async () => {
      const { root } = await startSession([SERVER_A, SERVER_B], {});
      // Both servers have a working agent. The activity shows the active server first.
      await waitFor("the activity shows server A", () => shows(SERVER_A));
      await waitFor("server A has the push token", () => registeredWith(SERVER_A));
      await notifications.saveServerNotificationSetting(SERVER_A, { level: "nothing" });
      // Server B is still on, so the activity shows it instead. Only the active host updates the
      // activity, and it is off, so no host has the token.
      await waitFor("the activity shows server B", () => shows(SERVER_B));
      await waitFor("server A loses the push token", () => removedFrom(SERVER_A));
      const checks: Record<string, boolean> = { activeOffShowsOther: true, activeOffRemovesToken: true };
      // Muting server B ends the activity. Server A then comes back on its own, with B still muted.
      await notifications.saveServerNotificationSetting(SERVER_B, { mute: { until: null } });
      await waitFor("the activity ends", () => shownContent() === null);
      await notifications.saveServerNotificationSetting(SERVER_A, { level: "all" });
      await waitFor("the activity shows server A", () => shows(SERVER_A));
      await waitFor("server A has the push token", () => registeredWith(SERVER_A));
      checks.otherMuteKeepsServer = true;
      checks.otherServerNeverGotToken = !everRegisteredWith(SERVER_B);
      root.unmount();
      return { name: "settings are per server", passed: Object.values(checks).every(Boolean), checks };
    },
  ],
  [
    "a timed mute that ends shows the server again",
    async () => {
      const { root } = await startSession([SERVER_A, SERVER_B], {
        [SERVER_A]: { level: "all", mute: { until: Date.now() + TIMED_MUTE_MS } },
      });
      await waitFor("the activity shows server B while server A is muted", () => shows(SERVER_B));
      const checks: Record<string, boolean> = { hiddenWhileMuted: !everShown(SERVER_A) };
      // No setting changes: the hook shows server A when its mute ends.
      await waitFor("the activity shows server A after the mute", () => shows(SERVER_A));
      await waitFor("server A has the push token after the mute", () => registeredWith(SERVER_A));
      checks.shownAfterMute = true;
      root.unmount();
      return { name: "a timed mute that ends", passed: Object.values(checks).every(Boolean), checks };
    },
  ],
];

mkdirSync(OUT, { recursive: true });
const results: CaseResult[] = [];
for (const [name, run] of cases) {
  logger.info(`Case: ${name}.`);
  try {
    results.push(await run());
  } catch (error) {
    results.push({ name, passed: false, checks: {}, error: error instanceof Error ? error.message : String(error) });
  }
}
const passed = results.every((result) => result.passed);
writeFileSync(join(OUT, "report.json"), `${JSON.stringify({ passed, results }, null, 2)}\n`);
logger.info(`Checked ${results.length} cases. Wrote ${join(OUT, "report.json")}.`);
if (!passed) {
  for (const result of results.filter((candidate) => !candidate.passed)) {
    logger.error(`${result.name}: ${result.error ?? JSON.stringify(result.checks)}`);
  }
  process.exit(1);
}
process.exit(0);
