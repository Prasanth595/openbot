import type {
  AgentAccessChange,
  AgentAccessSnapshot,
  HostReleaseStatus,
  HostStatus,
  HostUpdateStatus,
  McpServerConfig,
  McpSignInState,
  McpTestResult,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createSignal, createStore, onSettled, snapshot } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import type { McpPanelSignIn } from "../src/features/servers/ServerMcpPanel";
import type { ServerAgentAccessOptions } from "../src/features/servers/ServerRolesSection";
import { ServerSettingsModal, type ServerSettingsModalProps } from "../src/features/servers/ServerSettingsModal";
import {
  STORY_AGENT_SUMMARIES,
  STORY_HOST_STATUS,
  STORY_HOSTED_SITES,
  STORY_INVITES,
  STORY_MCP_SERVERS,
  STORY_PRESENCE,
  STORY_SERVERS,
} from "../src/preview/fixtures";
import { storyConnectorRegistry } from "./connector-fixtures";
import { createSignInHost } from "./mcp-sign-in-host";
import { createMockOpenBot } from "./mock-openbot";
import { SettingsPageStory } from "./settings-page-story";

const localServer = STORY_SERVERS.find((server) => server.kind === "local") ?? STORY_SERVERS[0];
const remoteServer = STORY_SERVERS.find((server) => server.kind === "remote") ?? STORY_SERVERS[1];
if (!remoteServer) throw new Error("Story server fixtures need a remote server.");

const meta = {
  title: "Settings/ServerSettingsModal",
  component: ServerSettingsModal,
  render: (args) => <RemoteSetupStory settings={args} />,
  args: {
    open: true,
    platform: "darwin",
    server: localServer,
    hostStatus: STORY_HOST_STATUS,
    members: STORY_PRESENCE.members,
    invites: STORY_INVITES,
    loading: false,
    loadError: null,
    onRetry: fn(async () => undefined),
    onSaveIdentity: fn(async () => undefined),
    onSetPublished: fn(async () => undefined),
    onSetMuted: fn(async () => undefined),
    onCreateInvite: fn(async (input) => ({
      id: "invite-story",
      inviteUrl: "https://team.example.com/invite/story",
      expiresAt: "2026-08-29T10:00:00.000Z",
      role: input.role,
      usedAt: null,
      email: input.email ?? null,
      permanent: input.permanent ?? false,
      useCount: 0,
    })),
    onUpdateMember: fn(async () => undefined),
    onRemoveMember: fn(async () => undefined),
    onRevokeInvite: fn(async () => undefined),
    onOpenScreenRecordingSettings: fn(async () => undefined),
    onRecheckScreenRecording: fn(async () => undefined),
  },
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    viewport: {
      options: {
        serverDesktop: {
          name: "Server settings — 1200 × 820",
          styles: { width: "1200px", height: "820px" },
        },
        serverMinimum: {
          name: "Server settings — 960 × 640",
          styles: { width: "960px", height: "640px" },
        },
        serverMobile: {
          name: "Server settings — 640 × 720",
          styles: { width: "640px", height: "720px" },
        },
        serverNarrow: {
          name: "Server settings — 480 × 720",
          styles: { width: "480px", height: "720px" },
        },
      },
    },
  },
} satisfies Meta<typeof ServerSettingsModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LocalFirstSetup: Story = {
  args: {
    server: { ...localServer, name: "Local", state: "online", apiUrl: null },
    hostStatus: {
      ...STORY_HOST_STATUS,
      phase: "unconfigured",
      configured: false,
      enabledOnLaunch: false,
      serverId: null,
      serverName: null,
      logoUrl: null,
      apiUrl: null,
      apiOnline: false,
      remoteDesktopReady: false,
      remoteDesktopScreenRecordingDenied: false,
      remoteDesktopUnattended: false,
      remoteDesktopActiveSessions: 0,
      remoteDesktopMaxSessions: 4,
    },
    members: [],
    invites: [],
  },
};

export const FirstSetupInvalidNameSmallViewport: Story = {
  args: LocalFirstSetup.args,
  parameters: {
    viewport: { defaultViewport: "serverMobile" },
  },
};

/** Members of a server with no name yet: publishing generates one, so the switch is ready. */
export const LocalFirstPublication: Story = {
  args: { ...LocalFirstSetup.args, initialSection: "members" },
};

export const RemoteDesktopAfterPublication: Story = {
  render: (args) => <PublicationSetupStory settings={args} />,
};

function PublicationSetupStory(props: { settings: ServerSettingsModalProps }) {
  const [published, setPublished] = createSignal(false);
  return (
    <RemoteSetupStory
      settings={{
        ...props.settings,
        initialSection: "members",
        get hostStatus(): HostStatus {
          return { ...STORY_HOST_STATUS, configured: true, phase: published() ? "online" : "idle" };
        },
        onSetPublished: async (value) => {
          setPublished(value);
        },
      }}
    />
  );
}

export const LocalOnline: Story = {
  args: {
    hostStatus: {
      ...STORY_HOST_STATUS,
      apiUrl: "https://eu-west-1.gateway.example.com/openbot/servers/team_7f3c19a2",
    },
  },
};

export const ActionError: Story = {
  args: {
    loadError: "The server did not respond. Check the connection and try again.",
  },
};

export const RemoteAdministrator: Story = {
  args: {
    server: { ...remoteServer, role: "admin" },
    hostStatus: null,
  },
};

export const RemoteMember: Story = {
  args: {
    server: { ...remoteServer, role: "member" },
    hostStatus: null,
    invites: [],
  },
};

/**
 * A joined server's MCP list. Granola asks for a sign-in on Test connection; Linear is signed in
 * already. Sign in shows the server's page from the host's browser: Allow finishes the sign-in, and
 * Cancel sign-in stops it.
 */
const REMOTE_MCP_SERVERS: McpServerConfig[] = [
  {
    id: "mcp-granola",
    name: "Granola",
    transport: "http",
    enabled: true,
    command: "",
    args: [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: "https://mcp.granola.ai/mcp",
    headers: [],
  },
  ...STORY_MCP_SERVERS.filter((config) => config.id === "mcp-linear" || config.id === "mcp-sqlite").map((config) => ({
    ...config,
    headers: [],
  })),
];

export const RemoteMcpSignIn: Story = {
  args: {
    server: { ...remoteServer, role: "admin" },
    hostStatus: null,
    initialSection: "mcp",
    mcpServers: REMOTE_MCP_SERVERS,
  },
  render: (args) => <McpSignInStory settings={args} />,
};

export const RemoteMcpMember: Story = {
  args: {
    server: { ...remoteServer, role: "member" },
    hostStatus: null,
    invites: [],
    initialSection: "mcp",
    mcpServers: REMOTE_MCP_SERVERS,
  },
  render: (args) => <McpSignInStory settings={args} />,
};

/**
 * This computer's MCP list after Granola refused its saved sign-in. The row asks for a new sign-in
 * with no test, and Sign in finishes at once. A joined host never reports a lost sign-in.
 */
export const LocalMcpSignInNeeded: Story = {
  args: {
    initialSection: "mcp",
    mcpServers: REMOTE_MCP_SERVERS,
  },
  render: (args) => (
    <McpSignInStory
      settings={args}
      initial={{ "mcp-granola": { mcpServerId: "mcp-granola", signedIn: false, needsSignIn: true } }}
    />
  ),
};

/**
 * This computer's MCP list, to connect Granola. In Connect a custom MCP, paste
 * `https://mcp.granola.ai/mcp` into Command to launch: the form moves to Streamable HTTP. Save
 * tests the server, which asks for a sign-in, signs in, and then saves the row.
 */
export const LocalMcpConnect: Story = {
  args: {
    initialSection: "mcp",
    mcpServers: REMOTE_MCP_SERVERS.filter((config) => config.id !== "mcp-granola"),
  },
  render: (args) => <McpSignInStory settings={args} />,
};

function McpSignInStory(props: { settings: ServerSettingsModalProps; initial?: Record<string, McpSignInState> }) {
  const [states, setStates] = createStore<Record<string, McpSignInState>>({
    "mcp-linear": { mcpServerId: "mcp-linear", signedIn: true },
    ...props.initial,
  });
  const [servers, setServers] = createSignal(props.settings.mcpServers ?? []);
  const save = async (config: McpServerConfig) => {
    const id = config.id || `mcp-${config.name.toLowerCase().replaceAll(" ", "-")}`;
    // A draft signs in before it has an id: the new row keeps that sign-in.
    if (!config.id && states[""]?.signedIn)
      setStates((current) => {
        current[id] = { mcpServerId: id, signedIn: true };
        delete current[""];
      });
    setServers((list) =>
      list.some((server) => server.id === id)
        ? list.map((server) => (server.id === id ? { ...config, id } : server))
        : [...list, { ...config, id }],
    );
  };
  const local = props.settings.server.kind === "local";
  const host = createSignInHost();
  const waiting = new Map<string, (result: McpTestResult) => void>();
  const finish = (url: string, result: McpTestResult) => {
    host.close(url);
    waiting.get(url)?.(result);
    waiting.delete(url);
  };
  const signIn: McpPanelSignIn = {
    states,
    ...(local
      ? {}
      : {
          remote: { hostName: props.settings.server.name, runtime: host.runtime, clipboard: true, pages: host.pages },
        }),
    start: (config) =>
      new Promise((resolve) => {
        waiting.set(config.url, (result) => {
          if (!result.error)
            setStates((current) => {
              current[config.id] = { mcpServerId: config.id, signedIn: true };
            });
          resolve(result);
        });
        if (local) finish(config.url, { toolCount: 6, error: null });
        else host.open(config.url, config.name, () => finish(config.url, { toolCount: 6, error: null }));
      }),
    cancel: async (url) => finish(url, { toolCount: 0, error: sourceText("error.backend.mcpSignInCancelled") }),
    signOut: async (id) =>
      setStates((current) => {
        delete current[id];
      }),
  };
  const test = async (config: McpServerConfig): Promise<McpTestResult> => {
    if (config.transport === "http" && !states[config.id]?.signedIn)
      return { toolCount: 0, error: sourceText("error.backend.mcpSignInRequired") };
    return { toolCount: 6, error: null };
  };
  return (
    <RemoteSetupStory
      settings={{
        ...props.settings,
        get mcpServers() {
          return servers();
        },
        mcpSignIn: signIn,
        onTestMcpServer: test,
        onSaveMcpServer: save,
      }}
    />
  );
}

/** A Starter server with one site of its own and one unlinked site from before it was registered. */
export const Sites: Story = {
  args: {
    initialSection: "sites",
    hostedSites: {
      api: {
        list: async () => ({ sites: STORY_HOSTED_SITES.map((site) => ({ ...site })), limit: 3, used: 2 }),
        delete: fn(async () => undefined),
      },
      onOpenSite: fn(),
    },
  },
};

export const SitesForMember: Story = {
  args: {
    ...Sites.args,
    server: { ...remoteServer, role: "member" },
    hostStatus: null,
  },
};

const STORY_HOST_UPDATE: HostUpdateStatus = {
  phase: "available",
  currentVersion: "0.23.0",
  availableVersion: "0.24.0",
  progress: null,
  errorCode: null,
  remoteUpdates: "allowed",
  autoDownload: true,
  autoInstall: false,
  restart: null,
};

const remoteUpdateArgs = {
  server: { ...remoteServer, role: "admin" as const },
  hostStatus: null,
  hostUpdate: {},
  initialSection: "updates" as const,
};

export const RemoteUpdateAvailable: Story = {
  args: remoteUpdateArgs,
  render: (args) => <RemoteSetupStory settings={args} hostUpdate={STORY_HOST_UPDATE} />,
};

export const RemoteUpdateWaiting: Story = {
  args: remoteUpdateArgs,
  render: (args) => (
    <RemoteSetupStory
      settings={args}
      hostUpdate={{
        ...STORY_HOST_UPDATE,
        phase: "ready",
        progress: 100,
        restart: { requestedBy: "Ada Lovelace", mode: "when-idle", waitingFor: ["agent-turn", "routine-run"] },
      }}
    />
  ),
};

export const RemoteUpdateDownloading: Story = {
  args: remoteUpdateArgs,
  render: (args) => (
    <RemoteSetupStory
      settings={args}
      hostUpdate={{
        ...STORY_HOST_UPDATE,
        phase: "downloading",
        progress: 42,
        restart: { requestedBy: "Ada Lovelace", mode: "when-idle", waitingFor: [] },
      }}
    />
  ),
};

export const RemoteUpdateAutomatic: Story = {
  args: remoteUpdateArgs,
  render: (args) => (
    <RemoteSetupStory
      settings={args}
      hostUpdate={{
        ...STORY_HOST_UPDATE,
        phase: "ready",
        progress: 100,
        autoInstall: true,
        restart: { requestedBy: null, mode: "when-idle", waitingFor: ["agent-turn"] },
      }}
    />
  ),
};

export const RemoteUpdateDisabled: Story = {
  args: remoteUpdateArgs,
  render: (args) => (
    <RemoteSetupStory settings={args} hostUpdate={{ ...STORY_HOST_UPDATE, remoteUpdates: "disabled" }} />
  ),
};

function RemoteSetupStory(props: {
  settings: ServerSettingsModalProps;
  hostUpdate?: HostUpdateStatus;
  hostRelease?: HostReleaseStatus;
}) {
  const previous = window.openbot;
  // Storybook passes the args as a store, and the mock copies its options with `structuredClone`.
  const hostStatus = props.settings.hostStatus;
  const mock = createMockOpenBot({
    ...(hostStatus ? { hostStatus: snapshot(hostStatus) } : {}),
    ...(props.hostUpdate ? { hostUpdate: props.hostUpdate } : {}),
    ...(props.hostRelease ? { hostRelease: props.hostRelease } : {}),
  });
  window.openbot = mock.api;
  onSettled(() => () => {
    mock.dispose();
    window.openbot = previous;
  });
  return (
    <SettingsPageStory title="Server settings">
      {(page) => <ServerSettingsModal {...props.settings} page={page()} />}
    </SettingsPageStory>
  );
}

export const SmallViewport: Story = {
  parameters: {
    viewport: { defaultViewport: "serverMobile" },
  },
};

export const HostedReleaseAvailable: Story = {
  args: remoteUpdateArgs,
  render: (args) => (
    <RemoteSetupStory
      settings={args}
      hostUpdate={{ ...STORY_HOST_UPDATE, currentVersion: "0.25.2", phase: "unsupported", availableVersion: null }}
      hostRelease={{ currentVersion: "0.25.2", latestVersion: "0.26.0", phase: "available", method: "hosted" }}
    />
  ),
};

export const ContainerReleaseAvailable: Story = {
  args: remoteUpdateArgs,
  render: (args) => (
    <RemoteSetupStory
      settings={args}
      hostUpdate={{ ...STORY_HOST_UPDATE, currentVersion: "0.25.2", phase: "unsupported", availableVersion: null }}
      hostRelease={{ currentVersion: "0.25.2", latestVersion: "0.26.0", phase: "available", method: "container" }}
    />
  ),
};

/**
 * This computer's connectors: GitHub is connected; Slack, Discord and Telegram are not set up. Open
 * one to see the header read `Connectors › GitHub`; the parent crumb goes back to the list.
 */
export const Connectors: Story = {
  args: { initialSection: "connectors" },
  render: (args) => <ConnectorsStory settings={args} />,
};

function ConnectorsStory(props: { settings: ServerSettingsModalProps }) {
  const connectors = storyConnectorRegistry(localServer);
  return <RemoteSetupStory settings={{ ...props.settings, connectors }} />;
}

/**
 * The roles of one story server: Research is closed to Everyone, Legal chats with it, and Finance
 * reads Sales. A save keeps its change until Storybook loads the story file again.
 */
function storyAgentAccess(): ServerAgentAccessOptions {
  let stored: AgentAccessChange = {
    revision: 3,
    everyone: { research: "none", sales: "view" },
    roles: [
      { id: "role-legal", name: "Legal", agents: { research: "chat" }, memberIds: ["member-jon"] },
      { id: "role-finance", name: "Finance", agents: { sales: "manage" }, memberIds: ["member-jon", "member-maya"] },
    ],
  };
  const read = (): AgentAccessSnapshot => ({
    ...structuredClone(stored),
    mine: Object.fromEntries(STORY_AGENT_SUMMARIES.map((agent) => [agent.id, "manage" as const])),
  });
  return {
    calls: {
      getAgentAccess: async () => read(),
      setAgentAccess: async (change) => {
        stored = { ...structuredClone(change), revision: change.revision + 1 };
        return read();
      },
    },
    listAgents: async () => STORY_AGENT_SUMMARIES.slice(0, 3),
  };
}

/** Everyone, then the custom roles. A role page sets the level of each agent. */
export const Roles: Story = {
  args: { initialSection: "roles", agentAccess: storyAgentAccess() },
};

/** The role menu of each member row holds the server role and the custom roles. */
export const MembersWithRoles: Story = {
  args: { initialSection: "members", agentAccess: storyAgentAccess() },
};

/** Only the owner and no invitation: sample invitations land behind the invite action, one at a time. */
export const MembersEmpty: Story = {
  args: {
    initialSection: "members",
    members: STORY_PRESENCE.members.filter((member) => member.role === "owner"),
    invites: [],
  },
};
