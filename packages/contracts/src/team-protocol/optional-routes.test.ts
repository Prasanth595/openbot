import { describe, expect, it } from "vitest";
import { AGENT_ADMIN_ROUTES } from "./agent-admin-v1";
import { AGENT_HOST_SETTINGS_CAPABILITY, AGENT_HOST_SETTINGS_ROUTES } from "./agent-host-settings-v1";
import { AGENT_IMPORT_ROUTES } from "./agent-import-v1";
import { AGENT_INSTALL_ROUTES } from "./agent-install-v1";
import { AGENT_PUBLISH_ROUTES } from "./agent-publish-v1";
import { AGENT_UPDATE_ROUTES } from "./agent-update-v1";
import { CONNECTORS_CAPABILITY, CONNECTORS_ROUTES } from "./connectors-v1";
import { CONTEXT_RESET_ROUTES } from "./context-reset-v1";
import {
  CONVERSATION_FILE_SEARCH_CAPABILITY,
  CONVERSATION_FILE_SEARCH_ROUTES,
  decodeConversationFileSearchResponse,
} from "./conversation-file-search-v1";
import {
  legacyTeamCapabilities,
  TEAM_BOOTSTRAP_CAPABILITIES,
  TEAM_CURRENT_CAPABILITIES,
  teamCapabilitiesForProtocol,
} from "./current";
import { EVENTS_ROUTES } from "./events-v1";
import { HOST_ADMIN_ROUTES } from "./host-admin-v1";
import { HOST_RELEASE_ROUTES } from "./host-release-v1";
import { HOST_UPDATE_ROUTES, hostRestartEvent } from "./host-update-v1";
import { HOSTED_SITES_ROUTES } from "./hosted-sites-v1";
import { LIVE_ACTIVITY_PUSH_ROUTES } from "./live-activity-push-v1";
import { MCP_SIGN_IN_APP_CAPABILITY, MCP_SIGN_IN_APP_ROUTES } from "./mcp-sign-in-app-v1";
import { optionalRouteCodec } from "./optional-routes";
import { PROVIDERS_ADMIN_ROUTES } from "./providers-v1";
import { PROVIDERS_SIGN_IN_V3_ROUTES } from "./providers-v3";
import { PUSH_NOTIFICATIONS_CAPABILITY, PUSH_NOTIFICATIONS_ROUTES } from "./push-notifications-v1";
import { SHARED_TABLES_ROUTES } from "./shared-tables-v1";
import { SIGN_IN_RELAY_CAPABILITY, SIGN_IN_RELAY_ROUTES } from "./sign-in-relay-v1";
import { SKILLS_ADMIN_ROUTES } from "./skills-admin-v1";
import { decodeTeamProtocolSupportV1 } from "./v1";
import { decodeTeamProtocolSupportV6Base } from "./v6-base";
import { decodeTeamProtocolSupportV7Base } from "./v7-base";

function codec(path: string) {
  const found = optionalRouteCodec(path);
  if (!found) throw new Error(`No codec for ${path}.`);
  return found;
}

describe("optional admin routes", () => {
  it("matches only listed paths, with or without a query", () => {
    expect(optionalRouteCodec(`${AGENT_ADMIN_ROUTES.settings}?x=1`)).toBeDefined();
    expect(optionalRouteCodec("/v1/admin/agents")).toBeUndefined();
    expect(optionalRouteCodec("/v1/storage/usage")).toBeUndefined();
  });

  it("errors keep the message and an optional code", () => {
    const { response } = codec(AGENT_ADMIN_ROUTES.settings);
    expect(response(403, { error: "Administrator access is required." })).toEqual({
      error: "Administrator access is required.",
    });
    expect(response(400, { error: "No.", code: "protocol_error", extra: 1 })).toEqual({
      error: "No.",
      code: "protocol_error",
    });
    expect(() => response(500, {})).toThrow();
  });
});

describe("agent-admin-v1", () => {
  const settings = { access: "workspace", autoApprove: true, autoApproveLocked: false };

  it("round-trips requests and drops an absent optional field", () => {
    expect(codec(AGENT_ADMIN_ROUTES.settings).request({ agentId: "chief" })).toEqual({ agentId: "chief" });
    expect(codec(AGENT_ADMIN_ROUTES.update).request({ agentId: "chief", autoApprove: false })).toEqual({
      agentId: "chief",
      autoApprove: false,
    });
    expect(codec(AGENT_ADMIN_ROUTES.update).response(200, { ...settings, secret: "x" })).toEqual(settings);
  });

  it("rejects malformed payloads", () => {
    expect(() => codec(AGENT_ADMIN_ROUTES.settings).request({ agentId: "" })).toThrow();
    expect(() => codec(AGENT_ADMIN_ROUTES.update).request({ agentId: "chief", access: "root" })).toThrow();
    expect(() => codec(AGENT_ADMIN_ROUTES.update).response(200, { ...settings, access: "root" })).toThrow();
    expect(() => codec(AGENT_ADMIN_ROUTES.update).response(200, { access: "full" })).toThrow();
  });
});

describe("agent-host-settings-v1", () => {
  const settings = {
    computerUse: true,
    allowAutomation: false,
    busyMessageMode: null,
    defaultBusyMessageMode: "queue",
  };

  it("carries a null mode to the host and drops an absent optional field", () => {
    expect(codec(AGENT_HOST_SETTINGS_ROUTES.settings).request({ agentId: "chief" })).toEqual({ agentId: "chief" });
    expect(codec(AGENT_HOST_SETTINGS_ROUTES.update).request({ agentId: "chief", busyMessageMode: null })).toEqual({
      agentId: "chief",
      busyMessageMode: null,
    });
    expect(codec(AGENT_HOST_SETTINGS_ROUTES.update).response(200, { ...settings, access: "full" })).toEqual(settings);
  });

  it("rejects malformed payloads", () => {
    expect(() => codec(AGENT_HOST_SETTINGS_ROUTES.update).request({ agentId: "chief", computerUse: "yes" })).toThrow();
    expect(() =>
      codec(AGENT_HOST_SETTINGS_ROUTES.update).request({ agentId: "chief", busyMessageMode: "interrupt" }),
    ).toThrow();
    expect(() =>
      codec(AGENT_HOST_SETTINGS_ROUTES.settings).response(200, { ...settings, defaultBusyMessageMode: null }),
    ).toThrow();
  });

  // A released host reads no capability from a header with more than 64, and a released client
  // refuses a host that advertises more than 64.
  it("keeps bootstrap and old-client advertisements within the released limit", () => {
    expect(TEAM_CURRENT_CAPABILITIES).toContain(AGENT_HOST_SETTINGS_CAPABILITY);
    expect(TEAM_BOOTSTRAP_CAPABILITIES.length).toBeLessThanOrEqual(64);
    expect(legacyTeamCapabilities(TEAM_CURRENT_CAPABILITIES).length).toBeLessThanOrEqual(64);
    expect(TEAM_CURRENT_CAPABILITIES.length).toBeLessThanOrEqual(128);
    for (const released of legacyTeamCapabilities(TEAM_CURRENT_CAPABILITIES)) {
      expect(TEAM_BOOTSTRAP_CAPABILITIES).toContain(released);
    }
    expect(teamCapabilitiesForProtocol(6)).toEqual(TEAM_BOOTSTRAP_CAPABILITIES);
    expect(teamCapabilitiesForProtocol(7)).toEqual(TEAM_CURRENT_CAPABILITIES);
    const support = {
      appVersion: "1.0.0",
      protocol: { minimum: 1, maximum: 7 },
      capabilities: [...TEAM_CURRENT_CAPABILITIES],
    };
    expect(() => decodeTeamProtocolSupportV1(support)).toThrow();
    expect(() => decodeTeamProtocolSupportV6Base(support)).toThrow();
    expect(decodeTeamProtocolSupportV7Base(support).capabilities).toEqual(TEAM_CURRENT_CAPABILITIES);
  });
});

describe("events-v1", () => {
  const owner = { kind: "agent", id: "chief" } as const;
  const routine = {
    id: "routine-1",
    owner,
    name: "Deploy",
    instruction: "Check the deploy",
    active: true,
    timezone: "UTC",
    trigger: { kind: "webhook", url: "https://signal.example/hooks/route-1", eventType: null, filters: [] },
    createdAt: "2026-10-07T10:00:00.000Z",
    updatedAt: "2026-10-07T10:00:00.000Z",
  };

  it("never returns stored secrets", () => {
    expect(
      codec(EVENTS_ROUTES.listRoutines).response(200, [
        { ...routine, trigger: { ...routine.trigger, secret: "raw-secret" } },
      ]),
    ).toEqual([routine]);
    expect(codec(EVENTS_ROUTES.saveRoutine).response(200, { routine, secret: "shown-once" })).toEqual({
      routine,
      secret: "shown-once",
    });
    expect(codec(EVENTS_ROUTES.rotateSecret).request({ id: "routine-1", owner })).toEqual({ id: "routine-1", owner });
  });

  it("bounds event payloads and rejects malformed event routes", () => {
    expect(() => codec(EVENTS_ROUTES.listActivity).request({ owner })).toThrow();
    expect(() =>
      codec(EVENTS_ROUTES.saveRoutine).request({
        owner,
        name: "Routine",
        instruction: "Run it",
        active: true,
        timezone: "UTC",
        trigger: { kind: "webhook", eventType: "example.received", filters: [{ pointer: "/data/~2key", value: "v" }] },
      }),
    ).toThrow();
    let nested: unknown = "value";
    for (let index = 0; index < 34; index += 1) nested = { nested };
    expect(() =>
      codec(EVENTS_ROUTES.saveRoutine).request({
        owner,
        name: "Routine",
        instruction: "Run it",
        active: true,
        timezone: "UTC",
        trigger: { kind: "schedule", schedule: nested },
      }),
    ).toThrow();
    expect(() => codec(EVENTS_ROUTES.status).response(200, { supported: true })).toThrow();
  });

  it("allows the wider delivery identifier bound without widening generic identifiers", () => {
    const activity = {
      kind: "received",
      id: "receipt-1",
      deliveryId: "d".repeat(512),
      eventType: "build.completed",
      status: "started",
      reason: null,
      runId: "run-1",
      occurredAt: "2026-10-07T10:00:00.000Z",
    };
    expect(codec(EVENTS_ROUTES.listActivity).response(200, [activity])).toEqual([activity]);
    expect(() =>
      codec(EVENTS_ROUTES.listActivity).response(200, [{ ...activity, deliveryId: "d".repeat(513) }]),
    ).toThrow();
    expect(() => codec(EVENTS_ROUTES.listActivity).response(200, [{ ...activity, id: "d".repeat(512) }])).toThrow();
  });
});

describe("skills-admin-v1 and shared-tables-v1", () => {
  const skill = {
    skillId: "deploy",
    slug: "deploy",
    name: "Deploy",
    installedVersion: 1,
    availableVersion: 2,
    state: "update-available",
  };

  it("carries only ids to the host and drops fields the contract does not name", () => {
    expect(codec(SKILLS_ADMIN_ROUTES.install).request({ agentId: "chief", skillId: "deploy", bundle: "x" })).toEqual({
      agentId: "chief",
      skillId: "deploy",
    });
    expect(codec(SKILLS_ADMIN_ROUTES.list).response(200, [{ ...skill, path: "/Users/host" }])).toEqual([skill]);
    expect(
      codec(SHARED_TABLES_ROUTES.list).response(200, [{ name: "leads", ownerAgentId: null, rowCount: null }]),
    ).toEqual([{ name: "leads", ownerAgentId: null, rowCount: null }]);
  });

  it("rejects malformed payloads", () => {
    expect(() => codec(SKILLS_ADMIN_ROUTES.setEnabled).request({ agentId: "chief", skillId: "deploy" })).toThrow();
    expect(() => codec(SKILLS_ADMIN_ROUTES.list).response(200, [{ ...skill, state: "broken" }])).toThrow();
    expect(() => codec(SHARED_TABLES_ROUTES.delete).request({})).toThrow();
  });
});

describe("agent-install-v1", () => {
  const listing = { listingId: "researcher", timezone: "Europe/Warsaw", receiptId: "receipt-1" };

  it("carries only ids to the host and only the new agent's id and name back", () => {
    // An id to update is not part of the contract, so an old client cannot make a host overwrite an agent.
    expect(codec(AGENT_INSTALL_ROUTES.marketplace).request({ ...listing, agentId: "chief" })).toEqual(listing);
    expect(
      codec(AGENT_INSTALL_ROUTES.template).response(200, { agentId: "writer", name: "Writer", workspacePath: "/x" }),
    ).toEqual({ agentId: "writer", name: "Writer" });
  });

  it("rejects malformed payloads", () => {
    expect(() => codec(AGENT_INSTALL_ROUTES.marketplace).request({ ...listing, receiptId: "" })).toThrow();
    expect(() => codec(AGENT_INSTALL_ROUTES.template).request({ templateId: "writer", timezone: "UTC" })).toThrow();
    expect(() => codec(AGENT_INSTALL_ROUTES.template).response(200, { name: "Writer" })).toThrow();
  });
});

describe("agent-update-v1", () => {
  const update = { agentId: "chief", listingId: "researcher", timezone: "Europe/Warsaw" };

  it("carries only ids to the host and only the agent's id and name back", () => {
    expect(codec(AGENT_UPDATE_ROUTES.marketplace).request({ ...update, receiptId: "receipt-1" })).toEqual(update);
    expect(
      codec(AGENT_UPDATE_ROUTES.marketplace).response(200, { agentId: "chief", name: "Chief", workspacePath: "/x" }),
    ).toEqual({ agentId: "chief", name: "Chief" });
  });

  it("rejects an update without the agent to update", () => {
    expect(() =>
      codec(AGENT_UPDATE_ROUTES.marketplace).request({ listingId: "researcher", timezone: "UTC" }),
    ).toThrow();
  });
});

describe("providers-v1", () => {
  const ready = { phase: "ready", progress: 100, message: null, version: "1.0.0" };
  const snapshot = {
    revision: 1,
    providers: { codex: ready, claude: ready, grok: ready, opencode: ready },
    toolRuntimes: { bun: ready },
  };

  it("carries a key towards the host and only a status or a flag back", () => {
    expect(codec(PROVIDERS_ADMIN_ROUTES.apiKeySet).request({ provider: "codex", key: "sk-1" })).toEqual({
      provider: "codex",
      key: "sk-1",
    });
    expect(codec(PROVIDERS_ADMIN_ROUTES.apiKeySet).response(200, { key: "sk-1" })).toEqual({});
    expect(codec(PROVIDERS_ADMIN_ROUTES.apiKeyState).response(200, { status: "saved", key: "sk-1" })).toEqual({
      status: "saved",
    });
    const endpoint = { id: "studio", name: "Studio", baseUrl: "http://127.0.0.1/v1", hasApiKey: true, models: [] };
    expect(codec(PROVIDERS_ADMIN_ROUTES.customList).response(200, [{ ...endpoint, apiKey: "k", headers: [] }])).toEqual(
      [endpoint],
    );
    expect(codec(PROVIDERS_ADMIN_ROUTES.runtimesStatus).response(200, snapshot)).toEqual(snapshot);
    expect(
      codec(PROVIDERS_ADMIN_ROUTES.codeLoginStart).response(200, { kind: "connected", userCode: undefined }),
    ).toEqual({ kind: "connected" });
  });

  it("rejects malformed payloads", () => {
    expect(() => codec(PROVIDERS_ADMIN_ROUTES.apiKeySet).request({ provider: "cursor", key: "sk-1" })).toThrow();
    expect(() =>
      codec(PROVIDERS_ADMIN_ROUTES.apiKeySet).request({ provider: "codex", key: "k".repeat(513) }),
    ).toThrow();
    expect(() =>
      codec(PROVIDERS_ADMIN_ROUTES.runtimesStatus).response(200, {
        ...snapshot,
        providers: { ...snapshot.providers, codex: { ...ready, progress: 0.5 } },
      }),
    ).toThrow();
    expect(() => codec(PROVIDERS_ADMIN_ROUTES.customList).response(200, [{ id: "studio" }])).toThrow();
  });
});

describe("providers-v3", () => {
  const routes = PROVIDERS_SIGN_IN_V3_ROUTES;

  it("carries a pasted code towards the host and never back", () => {
    expect(codec(routes.codeLoginStart).request({ provider: "claude" })).toEqual({ provider: "claude" });
    const paste = { kind: "paste", verificationUrl: "https://claude.com/cai/oauth/authorize?code=true", expiresAt: 1 };
    expect(codec(routes.codeLoginStart).response(200, { ...paste, userCode: "extra" })).toEqual(paste);
    const device = {
      kind: "code",
      userCode: "6Z9Q-HAAK",
      verificationUrl: "https://accounts.x.ai/oauth2/device",
      verificationUrlComplete: "https://accounts.x.ai/oauth2/device?user_code=6Z9Q-HAAK",
      expiresAt: 1,
    };
    expect(codec(routes.codeLoginStart).response(200, device)).toEqual(device);
    expect(codec(routes.codeLoginSubmit).request({ provider: "claude", code: "abc#state" })).toEqual({
      provider: "claude",
      code: "abc#state",
    });
    expect(codec(routes.codeLoginSubmit).response(200, { code: "abc#state" })).toEqual({});
    expect(codec(routes.codeLoginCancel).request({ provider: "grok" })).toEqual({ provider: "grok" });
  });

  it("rejects malformed payloads", () => {
    expect(() => codec(routes.codeLoginStart).request({ provider: "opencode" })).toThrow();
    expect(() => codec(routes.codeLoginStart).response(200, { kind: "paste", expiresAt: 1 })).toThrow();
    expect(() => codec(routes.codeLoginSubmit).request({ provider: "claude", code: "x".repeat(2049) })).toThrow();
    expect(() => codec(routes.codeLoginSubmit).request({ provider: "claude" })).toThrow();
  });
});

describe("host-admin-v1", () => {
  const logo = { mimeType: "image/png", data: "iVBORw0KGgo=" };

  it("keeps an absent field absent, carries a null logo, and sends nothing back", () => {
    expect(codec(HOST_ADMIN_ROUTES.identity).request({ serverName: "Studio" })).toEqual({ serverName: "Studio" });
    expect(codec(HOST_ADMIN_ROUTES.identity).request({ logo: null })).toEqual({ logo: null });
    expect(codec(HOST_ADMIN_ROUTES.identity).request({ serverName: "Studio", logo })).toEqual({
      serverName: "Studio",
      logo,
    });
    expect(codec(HOST_ADMIN_ROUTES.identity).response(200, { serverName: "Studio" })).toEqual({});
  });

  it("rejects malformed payloads", () => {
    expect(() => codec(HOST_ADMIN_ROUTES.identity).request({ serverName: "s".repeat(33) })).toThrow();
    expect(() => codec(HOST_ADMIN_ROUTES.identity).request({ logo: { ...logo, mimeType: "image/gif" } })).toThrow();
    expect(() => codec(HOST_ADMIN_ROUTES.identity).request({ logo: { ...logo, data: "A".repeat(699_053) } })).toThrow();
  });
});

describe("host-update-v1", () => {
  const snapshot = {
    phase: "ready",
    currentVersion: "0.24.0",
    availableVersion: "0.25.0",
    progress: 100,
    errorCode: null,
    remoteUpdates: "allowed",
    autoDownload: true,
    autoInstall: false,
    restart: { requestedBy: "Ada", mode: "when-idle", waitingFor: ["agent-turn", "other"] },
  };

  it("sends only the restart mode and answers every route with one snapshot", () => {
    expect(codec(HOST_UPDATE_ROUTES.start).request({ restart: "now", force: true })).toEqual({ restart: "now" });
    for (const route of Object.values(HOST_UPDATE_ROUTES)) {
      expect(codec(route).response(200, { ...snapshot, message: "/Users/ada/Library" })).toEqual(snapshot);
    }
    expect(
      codec(HOST_UPDATE_ROUTES.status).response(200, {
        ...snapshot,
        restart: { ...snapshot.restart, requestedBy: null },
      }),
    ).toEqual({
      ...snapshot,
      restart: { ...snapshot.restart, requestedBy: null },
    });
    expect(codec(HOST_UPDATE_ROUTES.settings).request({ autoInstall: true, allowRemoteUpdates: true })).toEqual({
      autoInstall: true,
    });
  });

  it("tells members about the restart and fails closed on a malformed restart event", () => {
    const event = { type: "host-restart", state: "waiting", version: "0.25.0" };
    expect(hostRestartEvent({ ...event, requestedBy: "Ada" })).toEqual(event);
    expect(hostRestartEvent({ type: "channels-changed", channelId: "c1", revision: 1 })).toBeNull();
    expect(() => hostRestartEvent({ ...event, state: "paused" })).toThrow();
    expect(() => hostRestartEvent({ ...event, version: "" })).toThrow();
    expect(() => hostRestartEvent({ type: "host-restart", state: "none" })).toThrow();
  });

  it("rejects malformed payloads, including a wait reason the contract does not list", () => {
    expect(() => codec(HOST_UPDATE_ROUTES.start).request({})).toThrow();
    expect(() => codec(HOST_UPDATE_ROUTES.start).request({ restart: "later" })).toThrow();
    const restart = (waitingFor: string[]) => ({ ...snapshot, restart: { ...snapshot.restart, waitingFor } });
    expect(() => codec(HOST_UPDATE_ROUTES.status).response(200, restart(["new-blocker"]))).toThrow();
    expect(() => codec(HOST_UPDATE_ROUTES.status).response(200, restart(Array(17).fill("other")))).toThrow();
    expect(() => codec(HOST_UPDATE_ROUTES.status).response(200, { ...snapshot, progress: 12.5 })).toThrow();
    expect(() => codec(HOST_UPDATE_ROUTES.status).response(200, { ...snapshot, phase: "paused" })).toThrow();
    expect(() => codec(HOST_UPDATE_ROUTES.status).response(200, { ...snapshot, remoteUpdates: "maybe" })).toThrow();
    expect(() => codec(HOST_UPDATE_ROUTES.status).response(200, { ...snapshot, autoInstall: undefined })).toThrow();
    expect(() => codec(HOST_UPDATE_ROUTES.settings).request({ autoInstall: "yes" })).toThrow();
  });
});

describe("context-reset-v1", () => {
  it("carries only the agent id and sends nothing back", () => {
    expect(codec(CONTEXT_RESET_ROUTES.clear).request({ agentId: "chief", threadId: "t1" })).toEqual({
      agentId: "chief",
    });
    expect(() => codec(CONTEXT_RESET_ROUTES.clear).request({})).toThrow();
    expect(codec(CONTEXT_RESET_ROUTES.clear).response(200, {})).toEqual({});
  });
});

describe("agent-publish-v1", () => {
  const publication = {
    templateId: "tpl_chief",
    shareUrl: "https://openbot.run/agents/tpl_chief",
    publishedAt: "2026-09-29T00:00:00Z",
  };
  const preview = {
    agentId: "chief",
    name: "Chief",
    title: "Chief of staff",
    description: "Plan the week.",
    avatarSeed: "chief",
    avatarHue: 30,
    avatarImage: { mimeType: "image/png", data: "iVBORw0KGgo=" },
    skills: [
      { kind: "marketplace", skillId: "s1", versionId: "v1", slug: "notes", name: "Notes", version: 2 },
      { kind: "embedded", slug: "brief", name: "Brief", markdown: "# Brief" },
    ],
    routines: [
      {
        name: "Weekly plan",
        instruction: "Plan the week.",
        active: true,
        schedule: {
          kind: "advanced",
          months: [1, 6],
          days: { kind: "days-of-week", days: [1] },
          time: { kind: "at-time", time: "09:00" },
        },
      },
    ],
    updatedAt: null,
    publication,
    skillsError: null,
  };

  it("carries the agent id and a card to the host, and the preview and link back", () => {
    expect(codec(AGENT_PUBLISH_ROUTES.preview).response(200, { ...preview, avatarUrl: "file:///a.png" })).toEqual(
      preview,
    );
    expect(codec(AGENT_PUBLISH_ROUTES.publish).request({ agentId: "chief", card: null, snapshot: {} })).toEqual({
      agentId: "chief",
      card: null,
    });
    expect(codec(AGENT_PUBLISH_ROUTES.publish).response(200, publication)).toEqual(publication);
    expect(codec(AGENT_PUBLISH_ROUTES.unpublish).response(200, {})).toEqual({});
  });

  it("rejects malformed payloads", () => {
    expect(() =>
      codec(AGENT_PUBLISH_ROUTES.publish).request({ agentId: "chief", card: "A".repeat(699_053) }),
    ).toThrow();
    expect(() =>
      codec(AGENT_PUBLISH_ROUTES.preview).response(200, { ...preview, skills: [{ kind: "folder", slug: "x" }] }),
    ).toThrow();
    expect(() =>
      codec(AGENT_PUBLISH_ROUTES.preview).response(200, {
        ...preview,
        routines: [{ ...preview.routines[0], schedule: { kind: "yearly" } }],
      }),
    ).toThrow();
  });
});

describe("agent-import-v1", () => {
  const agent = {
    key: "research",
    name: "Research",
    title: "Analyst",
    description: "You are research.",
    skillCount: 1,
    routineCount: 0,
    memoryCount: 2,
    fileCount: 3,
    fileBytes: 400,
    nameExists: false,
  };
  const preview = {
    token: "token-1",
    sourceApp: "grok-bot",
    exportedAt: null,
    agents: [agent],
    channels: [
      {
        key: "desk",
        name: "Desk",
        title: "",
        memberKeys: ["research"],
        leadKey: null,
        memoryCount: 0,
        routineCount: 0,
      },
    ],
    warnings: [],
  };

  it("sends the preview without avatars and the result with only the new agents' ids and names", () => {
    const withAvatar = { ...preview, agents: [{ ...agent, avatarUrl: "data:image/png;base64,AAAA" }] };
    expect(codec(AGENT_IMPORT_ROUTES.stage).response(200, withAvatar)).toEqual(preview);
    const result = {
      agents: [{ agentId: "a1", name: "Research", workspacePath: "/Users/host/OpenBot/a1" }],
      skipped: [],
      channels: [{ id: "c1", name: "Desk" }],
      skippedChannels: [],
      warnings: [],
    };
    expect(codec(AGENT_IMPORT_ROUTES.apply).response(200, result)).toEqual({
      ...result,
      agents: [{ agentId: "a1", name: "Research" }],
    });
    const input = { token: "token-1", keys: ["research"], channelKeys: [], timezone: "Europe/Warsaw" };
    expect(codec(AGENT_IMPORT_ROUTES.apply).request(input)).toEqual(input);
    expect(codec(AGENT_IMPORT_ROUTES.discard).request({ token: "token-1" })).toEqual({ token: "token-1" });
  });

  it("rejects malformed payloads", () => {
    expect(() =>
      codec(AGENT_IMPORT_ROUTES.stage).response(200, { ...preview, agents: [{ ...agent, key: 1 }] }),
    ).toThrow();
    expect(() => codec(AGENT_IMPORT_ROUTES.apply).request({ token: "token-1", keys: ["research"] })).toThrow();
    expect(() => codec(AGENT_IMPORT_ROUTES.discard).request({})).toThrow();
  });
});

describe("live-activity-push-v1", () => {
  const registration = {
    serverId: "server-1",
    token: "ab".repeat(32),
    environment: "production",
    secret: "A".repeat(43),
    locale: "fr",
    away: true,
    photos: [{ agentId: "chief", file: "avatar-server_2d_1-chief-3.jpg" }],
  };

  it("carries the push registration and nothing else", () => {
    expect(codec(LIVE_ACTIVITY_PUSH_ROUTES.register).request({ ...registration, name: "Ada" })).toEqual(registration);
    expect(codec(LIVE_ACTIVITY_PUSH_ROUTES.register).response(200, {})).toEqual({});
    expect(codec(LIVE_ACTIVITY_PUSH_ROUTES.remove).request({})).toEqual({});
  });

  it("refuses a token, secret or file name that could reach a path or a header", () => {
    const request = codec(LIVE_ACTIVITY_PUSH_ROUTES.register).request;
    expect(() => request({ ...registration, token: "../../3/device" })).toThrow();
    expect(() => request({ ...registration, secret: "short" })).toThrow();
    expect(() => request({ ...registration, photos: [{ agentId: "chief", file: "../secret.png" }] })).toThrow();
    expect(() => request({ ...registration, environment: "staging" })).toThrow();
  });
});

describe("push-notifications-v1", () => {
  const registration = {
    serverId: "server-1",
    token: "ab".repeat(32),
    environment: "production",
    secret: "A".repeat(43),
    locale: "pl",
    away: true,
    level: "needs-me",
    mutedUntil: 1_800_000_000,
    preview: false,
    sound: "openbot",
    liveActivityStartedAt: 1_790_000_000,
  };

  it("carries the push registration and nothing else", () => {
    expect(codec(PUSH_NOTIFICATIONS_ROUTES.register).request({ ...registration, name: "Ada" })).toEqual(registration);
    expect(codec(PUSH_NOTIFICATIONS_ROUTES.register).request({ ...registration, mutedUntil: null })).toEqual({
      ...registration,
      mutedUntil: null,
    });
    // A phone with notifications off registers for the sound of the Live Activity only.
    expect(codec(PUSH_NOTIFICATIONS_ROUTES.register).request({ ...registration, token: null })).toEqual({
      ...registration,
      token: null,
    });
    expect(codec(PUSH_NOTIFICATIONS_ROUTES.register).response(200, {})).toEqual({});
    expect(codec(PUSH_NOTIFICATIONS_ROUTES.remove).request({})).toEqual({});
  });

  it("refuses a token or secret that could reach a path or a header, and unknown choices", () => {
    const request = codec(PUSH_NOTIFICATIONS_ROUTES.register).request;
    expect(() => request({ ...registration, token: "../../3/device" })).toThrow();
    expect(() => request({ ...registration, secret: "short" })).toThrow();
    expect(() => request({ ...registration, environment: "staging" })).toThrow();
    expect(() => request({ ...registration, level: "nothing" })).toThrow();
    expect(() => request({ ...registration, sound: "../alarm.caf" })).toThrow();
    expect(() => request({ ...registration, mutedUntil: -1 })).toThrow();
  });

  it("is advertised only to a protocol 7 peer", () => {
    expect(TEAM_CURRENT_CAPABILITIES).toContain(PUSH_NOTIFICATIONS_CAPABILITY);
    expect(TEAM_BOOTSTRAP_CAPABILITIES).not.toContain(PUSH_NOTIFICATIONS_CAPABILITY);
  });
});

describe("hosted-sites-v1", () => {
  const site = {
    id: "site-1",
    hostname: "budget-planner.openbot.site",
    url: "https://budget-planner.openbot.site/",
    title: "Budget planner",
    description: "A planner.",
    framework: "vanilla",
    status: "active",
    fileCount: 1,
    size: 20,
    expiresAt: "2026-10-30T12:00:00.000Z",
    updatedAt: "2026-09-30T12:00:00.000Z",
    serverId: null,
  };

  it("sends site summaries with the limit, and only a site id towards the host", () => {
    expect(codec(HOSTED_SITES_ROUTES.list).request({ scope: "account" })).toEqual({});
    expect(
      codec(HOSTED_SITES_ROUTES.list).response(200, { sites: [{ ...site, token: "x" }], limit: 3, used: 1, extra: 1 }),
    ).toEqual({ sites: [site], limit: 3, used: 1 });
    expect(codec(HOSTED_SITES_ROUTES.remove).request({ siteId: "site-1", serverId: "server-1" })).toEqual({
      siteId: "site-1",
    });
    expect(codec(HOSTED_SITES_ROUTES.remove).response(200, { deleted: true })).toEqual({});
  });

  it("rejects malformed payloads", () => {
    expect(() => codec(HOSTED_SITES_ROUTES.remove).request({})).toThrow();
    expect(() => codec(HOSTED_SITES_ROUTES.list).response(200, { sites: [site], limit: 3 })).toThrow();
    expect(() =>
      codec(HOSTED_SITES_ROUTES.list).response(200, { sites: [{ ...site, status: "uploading" }], limit: 3, used: 1 }),
    ).toThrow();
  });
});

describe("host-release-v1", () => {
  const snapshot = { currentVersion: "0.25.2", latestVersion: "0.26.0", phase: "available", method: "hosted" };
  it("round-trips release status and omits private fields", () => {
    for (const path of Object.values(HOST_RELEASE_ROUTES)) {
      expect(codec(path).request({})).toEqual({});
      expect(codec(path).response(200, { ...snapshot, privatePath: "/private" })).toEqual(snapshot);
      expect(() => codec(path).response(200, { ...snapshot, phase: "restart" })).toThrow();
      expect(() => codec(path).response(200, { ...snapshot, currentVersion: "x".repeat(65) })).toThrow();
    }
  });
});

describe("mcp-sign-in-app-v1", () => {
  const app = { clientId: "openbot-client", secretSaved: true, scope: "read offline_access" };
  const state = { redirectUrl: "http://127.0.0.1:28417/mcp-auth", app };

  // The secret goes to the host once, in a save. No answer may carry it back to a client.
  it("sends the secret only towards the host and drops it from every answer", () => {
    const save = { mcpServerId: "mcp-1", clientId: "openbot-client", clientSecret: "s3cret", scope: "read" };
    expect(codec(MCP_SIGN_IN_APP_ROUTES.save).request(save)).toEqual(save);
    expect(codec(MCP_SIGN_IN_APP_ROUTES.save).request({ ...save, clientSecret: null })).toEqual({
      ...save,
      clientSecret: null,
    });
    for (const path of Object.values(MCP_SIGN_IN_APP_ROUTES)) {
      expect(
        codec(path).response(200, { ...state, clientSecret: "s3cret", app: { ...app, clientSecret: "s3cret" } }),
      ).toEqual(state);
      expect(codec(path).response(200, { redirectUrl: null, app: null })).toEqual({ redirectUrl: null, app: null });
    }
    expect(codec(MCP_SIGN_IN_APP_ROUTES.get).request({ mcpServerId: "mcp-1", clientSecret: "s3cret" })).toEqual({
      mcpServerId: "mcp-1",
    });
  });

  it("rejects malformed payloads", () => {
    expect(() => codec(MCP_SIGN_IN_APP_ROUTES.remove).request({ mcpServerId: "" })).toThrow();
    expect(() =>
      codec(MCP_SIGN_IN_APP_ROUTES.save).request({ mcpServerId: "mcp-1", clientId: "x", scope: "" }),
    ).toThrow();
    expect(() =>
      codec(MCP_SIGN_IN_APP_ROUTES.get).response(200, { ...state, app: { ...app, secretSaved: "yes" } }),
    ).toThrow();
  });

  // A protocol 6 peer reads at most 64 capabilities.
  it("is advertised only to a protocol 7 peer", () => {
    expect(TEAM_CURRENT_CAPABILITIES).toContain(MCP_SIGN_IN_APP_CAPABILITY);
    expect(TEAM_BOOTSTRAP_CAPABILITIES).not.toContain(MCP_SIGN_IN_APP_CAPABILITY);
  });
});

describe("sign-in-relay-v1", () => {
  const flow = {
    authorizeUrl: "https://auth.example.com/authorize?client_id=openbot",
    callback: { port: 28417, path: "/mcp-auth", state: "state-1" },
    result: null,
  };

  // The client sends only the query of the callback. It cannot name the host address it reaches.
  it("sends only a flow and a query to the host", () => {
    const complete = { flowId: "flow-1", query: "code=abc&state=state-1" };
    expect(codec(SIGN_IN_RELAY_ROUTES.complete).request({ ...complete, port: 22, path: "/admin" })).toEqual(complete);
    expect(() => codec(SIGN_IN_RELAY_ROUTES.complete).request({ ...complete, query: "x".repeat(8_193) })).toThrow();
    expect(() => codec(SIGN_IN_RELAY_ROUTES.status).request({ flowId: "" })).toThrow();
  });

  it("round-trips a flow and rejects malformed answers", () => {
    for (const path of [SIGN_IN_RELAY_ROUTES.status, SIGN_IN_RELAY_ROUTES.complete]) {
      expect(codec(path).response(200, flow)).toEqual(flow);
      expect(
        codec(path).response(200, { authorizeUrl: null, callback: null, result: { error: null, toolCount: 3 } }),
      ).toEqual({ authorizeUrl: null, callback: null, result: { error: null, toolCount: 3 } });
      expect(() => codec(path).response(200, { ...flow, callback: { ...flow.callback, port: -1 } })).toThrow();
    }
    expect(codec(SIGN_IN_RELAY_ROUTES.mcpStart).response(200, { flowId: "flow-1", expiresAt: 1 })).toEqual({
      flowId: "flow-1",
      expiresAt: 1,
    });
  });

  it("is advertised only to a protocol 7 peer", () => {
    expect(TEAM_CURRENT_CAPABILITIES).toContain(SIGN_IN_RELAY_CAPABILITY);
    expect(TEAM_BOOTSTRAP_CAPABILITIES).not.toContain(SIGN_IN_RELAY_CAPABILITY);
  });
});

describe("connectors-v1", () => {
  const status = {
    available: true,
    state: "pending",
    login: null,
    avatarUrl: null,
    userCode: "ABCD-1234",
    verificationUri: "https://github.com/login/device",
    error: null,
    installUrl: "https://github.com/apps/openbotgit/installations/new",
    revokeUrl: null,
  };

  // No route carries a token: a field the codec does not name never reaches the client.
  it("round-trips a status and drops what it does not name", () => {
    expect(codec(CONNECTORS_ROUTES.githubConnect).response(200, { ...status, accessToken: "gho_secret" })).toEqual(
      status,
    );
    expect(() => codec(CONNECTORS_ROUTES.githubStatus).response(200, { ...status, state: "unknown" })).toThrow();
    expect(codec(CONNECTORS_ROUTES.githubConnect).request({ url: "https://evil.example" })).toEqual({});
  });

  // A bot token stays on the host. Only Slack and Discord installs end in a grant for the host.
  it("keeps messaging tokens on the host", () => {
    const connection = {
      workspaceId: "T1",
      platform: "slack",
      enabled: true,
      state: "connected",
      workspaceName: "Acme",
      botUserId: "U1",
      missingScopes: [],
      retryAt: null,
      credentials: "saved",
      orchestratorAgentId: null,
    };
    expect(
      codec(CONNECTORS_ROUTES.messagingOverview).response(200, {
        connections: [{ ...connection, botToken: "xoxb-secret" }],
      }),
    ).toEqual({ connections: [connection] });
    expect(() =>
      codec(CONNECTORS_ROUTES.messagingComplete).request({ platform: "telegram", nonce: "n", grant: "g" }),
    ).toThrow();
  });

  it("is advertised only to a protocol 7 peer", () => {
    expect(TEAM_CURRENT_CAPABILITIES).toContain(CONNECTORS_CAPABILITY);
    expect(TEAM_BOOTSTRAP_CAPABILITIES).not.toContain(CONNECTORS_CAPABILITY);
  });
});

describe("conversation-file-search-v1", () => {
  const attachment = {
    id: "attachment-1",
    name: "report.pdf",
    size: 2_048,
    kind: "file",
    mimeType: "application/pdf",
    previewKind: "pdf",
    previewUrl: "openbot-attachment://file/attachment-1",
  };
  const result = { agentId: "chief", messageId: "message-1", createdAt: "2026-10-12T08:00:00.000Z", attachment };
  const page = { results: [result], nextCursor: "eyJ2ZXJzaW9uIjoxLCJvZmZzZXQiOjUwfQ" };

  // An empty query lists the newest files. A field the contract does not name never reaches the host.
  it("carries the query, the cursor and an optional limit to the host", () => {
    const search = codec(CONVERSATION_FILE_SEARCH_ROUTES.search);
    expect(search.request({ query: "", cursor: null, agentId: "chief" })).toEqual({ query: "", cursor: null });
    expect(search.request({ query: "report", cursor: "next", limit: 20 })).toEqual({
      query: "report",
      cursor: "next",
      limit: 20,
    });
  });

  it("round-trips a page and drops what it does not name", () => {
    const search = codec(CONVERSATION_FILE_SEARCH_ROUTES.search);
    const sent = {
      ...page,
      total: 1,
      results: [{ ...result, threadId: "thread-1", attachment: { ...attachment, path: "/x" } }],
    };
    expect(search.response(200, sent)).toEqual(page);
    expect(decodeConversationFileSearchResponse(search.response(200, page))).toEqual(page);
    expect(search.response(200, { results: [], nextCursor: null })).toEqual({ results: [], nextCursor: null });
  });

  it("rejects malformed payloads", () => {
    const search = codec(CONVERSATION_FILE_SEARCH_ROUTES.search);
    expect(() => search.request({ query: "x".repeat(256), cursor: null })).toThrow();
    expect(() => search.request({ query: "report" })).toThrow();
    expect(() => search.request({ query: "report", cursor: "x".repeat(2_049) })).toThrow();
    expect(() => search.request({ query: "report", cursor: null, limit: -1 })).toThrow();
    expect(() => search.response(200, { ...page, results: Array.from({ length: 101 }, () => result) })).toThrow();
    expect(() => search.response(200, { results: [{ ...result, agentId: "" }], nextCursor: null })).toThrow();
    expect(() =>
      search.response(200, {
        results: [{ ...result, attachment: { ...attachment, kind: "folder" } }],
        nextCursor: null,
      }),
    ).toThrow();
    expect(() =>
      search.response(200, {
        results: [{ ...result, attachment: { ...attachment, previewUrl: "x".repeat(2_049) } }],
        nextCursor: null,
      }),
    ).toThrow();
    expect(() =>
      decodeConversationFileSearchResponse({ results: [{ ...result, attachment: null }], nextCursor: null }),
    ).toThrow();
  });

  // A protocol 6 peer reads at most 64 capabilities.
  it("is advertised only to a protocol 7 peer", () => {
    expect(TEAM_CURRENT_CAPABILITIES).toContain(CONVERSATION_FILE_SEARCH_CAPABILITY);
    expect(TEAM_BOOTSTRAP_CAPABILITIES).not.toContain(CONVERSATION_FILE_SEARCH_CAPABILITY);
    expect(legacyTeamCapabilities(TEAM_CURRENT_CAPABILITIES)).not.toContain(CONVERSATION_FILE_SEARCH_CAPABILITY);
  });
});
