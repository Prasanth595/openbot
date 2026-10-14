import type {
  AddMessagingOrchestratorResult,
  MessagingDesktopApi,
  MessagingOverview,
  MessagingPlatform,
} from "@openbot/contracts/ipc";
import type { AgentProfile } from "@openbot/ui/data";
import type {
  SlackOrchestratorChoice,
  SlackOrchestratorModels,
  WorkspacePlatform,
} from "@openbot/ui/features/settings/SlackIntegrationPanel";
import type { TelegramChatPlace } from "@openbot/ui/features/settings/TelegramIntegrationPanel";
import { createSignal, untrack } from "solid-js";
import { type ConnectorController, createConnectorActions } from "./connector-controller";

/** A Slack or Discord connect installs the app in a new workspace; a Telegram one opens a chat. */
type MessagingConnectTarget = { platform: WorkspacePlatform } | { platform: "telegram"; place: TelegramChatPlace };

/** A Slack workspace or a Discord server has its own orchestrator; every Telegram chat shares one. */
type MessagingOrchestratorTarget = { platform: WorkspacePlatform; workspaceId: string } | { platform: "telegram" };

/** The Slack, Discord and Telegram connections of one place: this computer or a joined server. */
export interface MessagingApi {
  overview: (platform: MessagingPlatform) => Promise<MessagingOverview>;
  connect: (target: MessagingConnectTarget) => Promise<void>;
  disconnect: (platform: MessagingPlatform, workspaceId: string) => Promise<void>;
  reconnect: (platform: MessagingPlatform, workspaceId: string) => Promise<void>;
  setEnabled: (platform: MessagingPlatform, workspaceId: string, enabled: boolean) => Promise<void>;
  addOrchestrator: (
    target: MessagingOrchestratorTarget,
    choice: SlackOrchestratorChoice | null,
  ) => Promise<AddMessagingOrchestratorResult>;
}

/** The connections of this computer, through main. Read on each call: tests and stories replace `window.openbot`. */
export function localMessagingApi(messaging: () => MessagingDesktopApi = () => window.openbot.messaging): MessagingApi {
  return {
    overview: (platform) =>
      platform === "slack"
        ? messaging().getSlackOverview()
        : platform === "discord"
          ? messaging().getDiscordOverview()
          : messaging().getTelegramOverview(),
    connect: (target) =>
      target.platform === "telegram"
        ? messaging().connectTelegramChat({ place: target.place })
        : target.platform === "slack"
          ? messaging().connectSlackWorkspace()
          : messaging().connectDiscordGuild(),
    disconnect: (platform, workspaceId) =>
      platform === "slack"
        ? messaging().disconnectSlackWorkspace({ workspaceId })
        : platform === "discord"
          ? messaging().disconnectDiscordGuild({ workspaceId })
          : messaging().disconnectTelegramChat({ workspaceId }),
    reconnect: (platform, workspaceId) =>
      platform === "slack"
        ? messaging().reconnectSlackWorkspace({ workspaceId })
        : platform === "discord"
          ? messaging().reconnectDiscordGuild({ workspaceId })
          : messaging().reconnectTelegramChat({ workspaceId }),
    setEnabled: (platform, workspaceId, enabled) =>
      platform === "slack"
        ? messaging().setSlackEnabled({ workspaceId, enabled })
        : platform === "discord"
          ? messaging().setDiscordEnabled({ workspaceId, enabled })
          : messaging().setTelegramEnabled({ workspaceId, enabled }),
    addOrchestrator: (target, choice) =>
      target.platform === "telegram"
        ? messaging().addTelegramOrchestrator({ ...(choice ?? {}) })
        : target.platform === "slack"
          ? messaging().addSlackOrchestrator({ workspaceId: target.workspaceId, ...(choice ?? {}) })
          : messaging().addDiscordOrchestrator({ workspaceId: target.workspaceId, ...(choice ?? {}) }),
  };
}

/** How often a page reads the connections while it shows: a connection changes on its own. */
const POLL_MS = 3_000;

const ACTION_FAILED = {
  slack: "connector.slack.actionFailed",
  discord: "connector.discord.actionFailed",
  telegram: "connector.telegram.actionFailed",
} as const satisfies Record<MessagingPlatform, string>;

export interface MessagingConnectorOptions {
  /** Every agent of the place, to find each orchestrator. */
  agents: () => AgentProfile[];
  /** The joined server's name, when the connections are that server's. */
  hostName?: () => string | undefined;
  /** The joined server the connections belong to. One controller serves each joined server in turn. */
  serverId?: () => string | undefined;
  /** The catalog for the orchestrator's model picker, or undefined to start on a new agent's default. */
  models?: () => SlackOrchestratorModels | undefined;
  /** Called with the sidebar section that main put a new orchestrator in. */
  onOrchestratorSection?: (sectionId: string) => void;
}

/**
 * The Slack workspaces, Discord servers or Telegram chats of one place. Main and a host send no
 * event for a connection, and a connect ends in the browser or in Telegram, so a page that shows the
 * state calls `watch`. Each action reads the connections again when it ends.
 */
export function createMessagingConnector(
  platform: MessagingPlatform,
  api: MessagingApi,
  options: MessagingConnectorOptions,
): ConnectorController {
  const [loaded, setLoaded] = createSignal<{ serverId: string | undefined; overview: MessagingOverview } | null>(null);
  // Another server's connections are not shown, also when this server's read fails.
  const overview = () => {
    const current = loaded();
    return current && current.serverId === options.serverId?.() ? current.overview : null;
  };
  const actions = createConnectorActions(ACTION_FAILED[platform]);
  /** Each read replaces the one before it, so a slow answer never overwrites a newer one. */
  let reads = 0;

  // A failed read keeps the last overview. The next poll or action reads again.
  const reload = () => {
    const read = ++reads;
    const serverId = untrack(() => options.serverId?.());
    void api
      .overview(platform)
      .then((next) => {
        if (!actions.disposed() && read === reads) setLoaded({ serverId, overview: next });
      })
      .catch(() => undefined);
  };
  const run = (action: () => Promise<unknown>) => actions.run(action, { settled: reload });
  const addOrchestrator = (target: MessagingOrchestratorTarget, choice: SlackOrchestratorChoice | null) =>
    run(async () => {
      const { sectionId } = await api.addOrchestrator(target, choice);
      if (sectionId) options.onOrchestratorSection?.(sectionId);
    });
  const connections = () => overview()?.connections ?? [];
  const shared = {
    disconnect: (workspaceId: string) => run(() => api.disconnect(platform, workspaceId)),
    reconnect: (workspaceId: string) => run(() => api.reconnect(platform, workspaceId)),
    setEnabled: (workspaceId: string, enabled: boolean) => run(() => api.setEnabled(platform, workspaceId, enabled)),
  };
  const base = {
    ready: () => overview() !== null,
    available: () => true,
    busy: actions.busy,
    reload,
    watch: () => {
      reload();
      const timer = setInterval(reload, POLL_MS);
      return () => clearInterval(timer);
    },
  };

  if (platform === "telegram")
    return {
      ...base,
      id: platform,
      detail: {
        id: platform,
        props: {
          get agents() {
            return options.agents();
          },
          get connections() {
            return connections();
          },
          get busy() {
            return actions.busy();
          },
          get models() {
            return options.models?.();
          },
          get hostName() {
            return options.hostName?.();
          },
          onConnectChat: (place) => run(() => api.connect({ platform, place })),
          onDisconnectChat: shared.disconnect,
          onReconnect: shared.reconnect,
          onSetEnabled: shared.setEnabled,
          onAddOrchestrator: (choice) => addOrchestrator({ platform }, choice),
        },
      },
    };

  const connect = () => run(() => api.connect({ platform }));
  return {
    ...base,
    id: platform,
    connect,
    detail: {
      id: platform,
      props: {
        platform,
        get agents() {
          return options.agents();
        },
        get connections() {
          return connections();
        },
        get busy() {
          return actions.busy();
        },
        get models() {
          return options.models?.();
        },
        get hostName() {
          return options.hostName?.();
        },
        onConnectWorkspace: connect,
        onDisconnectWorkspace: shared.disconnect,
        onReconnect: shared.reconnect,
        onSetEnabled: shared.setEnabled,
        onAddOrchestrator: (workspaceId, choice) => addOrchestrator({ platform, workspaceId }, choice),
      },
    },
  };
}
