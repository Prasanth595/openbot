import { remoteCall } from "./remote-service-effects";
// @vitest-environment node

import type { AgentEvent, AgentSummary, ConversationMessage, ServerSummary } from "@openbot/contracts/ipc";
import { createFormat, translateFor } from "@openbot/i18n";
import type { AgentNotificationContent } from "@openbot/team-client/agent-notifications";
import { BrowserWindow } from "electron";
import { assert, beforeEach, expect, it, vi } from "vitest";
import { createRendererForwarders } from "./renderer-forwarders";

const mocks = vi.hoisted(() => {
  const state: {
    clickListeners: (() => void)[];
    focused: boolean;
    desktopNotifications: boolean;
    preview: boolean;
  } = {
    clickListeners: [],
    focused: false,
    desktopNotifications: true,
    preview: true,
  };
  return Object.assign(state, { show: vi.fn(), content: vi.fn(), send: vi.fn() });
});
vi.mock("electron", () => ({
  BrowserWindow: class {
    isDestroyed = () => false;
    isFocused = () => mocks.focused;
    webContents = {
      isDestroyed: () => false,
      isLoadingMainFrame: () => false,
      mainFrame: { isDestroyed: () => false, detached: false },
      send: mocks.send,
    };
  },
  Notification: class {
    static isSupported = () => true;
    constructor(content: AgentNotificationContent) {
      mocks.content(content);
    }
    on = (name: string, listener: () => void) => {
      if (name === "click") mocks.clickListeners.push(listener);
    };
    show = mocks.show;
  },
}));

const agent: AgentSummary = {
  id: "chief",
  provider: "codex",
  name: "Local Chief",
  notifications: true,
  title: "Lead",
  description: "",
  model: "gpt-5.6-luna",
  reasoningEffort: "medium",
  threadId: "thread-chief",
  workspacePath: "/tmp/chief",
  preview: "",
  updatedAt: null,
  avatarSeed: "chief",
  avatarHue: null,
  avatarUrl: null,
};
const event: AgentEvent = {
  type: "turn-completed",
  agentId: "chief",
  threadId: "thread-chief",
  turnId: "turn-1",
  status: "completed",
};
function server(id: string): ServerSummary {
  return {
    id,
    name: id,
    kind: id === "local" ? "local" : "remote",
    state: "online",
    apiUrl: null,
    remoteDesktopAvailable: false,
    logoUrl: null,
    role: null,
    active: false,
    notificationsMuted: false,
    notificationsMutedUntil: null,
    notificationLevel: "all",
  };
}
function setup() {
  const servers = [server("local"), server("alpha"), server("beta")];
  const request = vi.fn(async (_serverId: string): Promise<AgentSummary[]> => [{ ...agent, name: "Remote Chief" }]);
  const messages = vi.fn(async (_serverId: string): Promise<ConversationMessage[]> => []);
  let lookupSettled = Promise.resolve();
  const window = new BrowserWindow();
  const forwarders = createRendererForwarders({
    getMainWindow: () => window,
    getAgentService: () => ({ listAgents: () => [agent] }),
    getHostService: () => null,
    getHostAnalytics: () => null,
    getRemoteServerManager: () => ({
      list: () => servers,
      request: (serverId, _path, decoder) =>
        remoteCall(() => {
          const result = request(serverId).then(decoder);
          lookupSettled = result.then(
            () => undefined,
            () => undefined,
          );
          return result;
        }),
      readAgentConversationPage: (agentId, _anchor, _limit, serverId) =>
        remoteCall(async () => ({
          agentId,
          threadId: "thread-chief",
          activeTurnId: null,
          revision: 1,
          messages: await messages(serverId ?? ""),
          references: {},
          pageInfo: { hasOlder: false, olderCursor: null },
        })),
    }),
    showMainWindow: vi.fn(),
    getTranslate: () => translateFor("en"),
    getFormat: () => createFormat("en"),
    desktopNotificationsEnabled: () => mocks.desktopNotifications,
    notificationPreviewEnabled: () => mocks.preview,
  });
  return { ...forwarders, servers, request, messages, waitForLookup: () => lookupSettled };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.clickListeners = [];
  mocks.focused = false;
  mocks.desktopNotifications = true;
  mocks.preview = true;
});

it("mutes only the selected server while forwarding its live events", async () => {
  const fixture = setup();
  const [, alpha] = fixture.servers;
  assert(alpha);
  alpha.notificationsMuted = true;
  fixture.forwardAgentEvent("alpha", event);
  expect(mocks.send).toHaveBeenCalledWith("agent:event", { serverId: "alpha", event });
  expect(mocks.show).not.toHaveBeenCalled();
  expect(fixture.request).not.toHaveBeenCalled();
  fixture.forwardAgentEvent("beta", event);
  await vi.waitFor(() => expect(mocks.show).toHaveBeenCalledOnce());
  expect(mocks.content).toHaveBeenLastCalledWith({ title: "Remote Chief", body: "Finished working." });
  expect(fixture.request.mock.calls[0]?.[0]).toBe("beta");
  alpha.notificationsMuted = false;
  fixture.forwardAgentEvent("alpha", event);
  await vi.waitFor(() => expect(mocks.show).toHaveBeenCalledTimes(2));
});

it("uses the local mute preference and local agent settings", async () => {
  const fixture = setup();
  const [local] = fixture.servers;
  assert(local);
  local.notificationsMuted = true;
  fixture.forwardAgentEvent("local", event);
  expect(mocks.show).not.toHaveBeenCalled();
  local.notificationsMuted = false;
  fixture.forwardAgentEvent("local", event);
  await vi.waitFor(() => expect(mocks.show).toHaveBeenCalledOnce());
  expect(mocks.content).toHaveBeenCalledWith({ title: "Local Chief", body: "Finished working." });
  expect(fixture.request).not.toHaveBeenCalled();
});

it.each(["mute", "remove", "focus", "agent-disabled"])(
  "rechecks notification eligibility after lookup: %s",
  async (change) => {
    const fixture = setup();
    let resolve = (_agents: (typeof agent)[]) => {};
    const promise = new Promise<(typeof agent)[]>((done) => {
      resolve = done;
    });
    fixture.request.mockReturnValue(promise);
    const [, alpha] = fixture.servers;
    assert(alpha);
    fixture.forwardAgentEvent("alpha", event);
    if (change === "mute") alpha.notificationsMuted = true;
    if (change === "remove") fixture.servers.splice(1, 1);
    if (change === "focus") mocks.focused = true;
    resolve([{ ...agent, notifications: change !== "agent-disabled" }]);
    await fixture.waitForLookup();
    expect(mocks.show).not.toHaveBeenCalled();
  },
);

it("does not use local agents when the remote lookup fails", async () => {
  const fixture = setup();
  const promise = Promise.reject(new Error("offline"));
  fixture.request.mockReturnValue(promise);
  fixture.forwardAgentEvent("alpha", event);
  await fixture.waitForLookup();
  expect(mocks.show).not.toHaveBeenCalled();
});

it("stays quiet when desktop notifications are off or the server level rules the event out", () => {
  const fixture = setup();
  const [local] = fixture.servers;
  assert(local);
  mocks.desktopNotifications = false;
  fixture.forwardAgentEvent("local", event);
  mocks.desktopNotifications = true;
  local.notificationLevel = "nothing";
  fixture.forwardAgentEvent("local", event);
  local.notificationLevel = "needs-me";
  fixture.forwardAgentEvent("local", event);
  expect(mocks.show).not.toHaveBeenCalled();
  fixture.forwardAgentEvent("local", {
    type: "prompt",
    agentId: "chief",
    threadId: "thread-chief",
    turnId: "turn-1",
    requestId: 1,
    questions: [],
  });
  expect(mocks.content).toHaveBeenCalledWith({ title: "Local Chief", body: "Needs your input." });
});

it("opens the agent's conversation when the user clicks the notification", async () => {
  const fixture = setup();
  fixture.forwardAgentEvent("local", event);
  await vi.waitFor(() => expect(mocks.show).toHaveBeenCalledOnce());
  mocks.send.mockClear();
  for (const listener of mocks.clickListeners) listener();
  expect(mocks.send).toHaveBeenCalledWith("notifications:opened-event", {
    serverId: "local",
    agentId: "chief",
    threadId: "thread-chief",
  });
});

it("shows the answer of the finished turn only while the preview switch is on", async () => {
  const fixture = setup();
  fixture.messages.mockResolvedValue([
    {
      id: "answer",
      turnId: "turn-1",
      author: "assistant",
      text: "**Two** tests fail: the fixture is old.",
      createdAt: "2026-10-12T10:00:00.000Z",
      status: "completed",
    },
  ]);
  fixture.forwardAgentEvent("alpha", event);
  await vi.waitFor(() => expect(mocks.show).toHaveBeenCalledOnce());
  expect(mocks.content).toHaveBeenLastCalledWith({
    title: "Remote Chief",
    body: "Two tests fail: the fixture is old.",
  });
  mocks.preview = false;
  fixture.forwardAgentEvent("alpha", event);
  await vi.waitFor(() => expect(mocks.show).toHaveBeenCalledTimes(2));
  expect(mocks.content).toHaveBeenLastCalledWith({ title: "Remote Chief", body: "Finished working." });
});

it("shows a command to approve without its secrets, and only with the preview on", async () => {
  const fixture = setup();
  const approval: AgentEvent = {
    type: "approval",
    approval: {
      requestId: 1,
      agentId: "chief",
      threadId: "thread-chief",
      turnId: "turn-1",
      kind: "command",
      command: "OPENAI_API_KEY=sk-proj-abcdefghijklmnop1234567890 node run.js",
      cwd: null,
      reason: null,
      grantRoot: null,
      permissions: null,
    },
  };
  fixture.forwardAgentEvent("local", approval);
  await vi.waitFor(() => expect(mocks.show).toHaveBeenCalledOnce());
  expect(mocks.content).toHaveBeenLastCalledWith({
    title: "Local Chief",
    body: "Needs your approval: OPENAI_API_KEY=[redacted] node run.js",
  });
  mocks.preview = false;
  fixture.forwardAgentEvent("local", approval);
  await vi.waitFor(() => expect(mocks.show).toHaveBeenCalledTimes(2));
  expect(mocks.content).toHaveBeenLastCalledWith({ title: "Local Chief", body: "Needs your approval." });
});
