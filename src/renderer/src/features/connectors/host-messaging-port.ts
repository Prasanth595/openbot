import type { MessagingDesktopApi } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";

type HostMessagingMethod =
  | "hostOverview"
  | "hostConnect"
  | "hostDisconnect"
  | "hostReconnect"
  | "hostSetEnabled"
  | "hostAddOrchestrator";

/** What the Slack, Discord and Telegram pages reach: the connections of one server. */
export type MessagingConnectorApi = Omit<MessagingDesktopApi, HostMessagingMethod>;

/** The `connectors-v1` messaging requests to a joined server: main's, or the browser client's. */
export type HostMessagingApi = Pick<MessagingDesktopApi, HostMessagingMethod>;

/**
 * The connections of the joined server that `serverId` names (`connectors-v1`), through main or the
 * browser client's `host`. Each opens the connect page in this computer's browser. The orchestrator
 * starts on the host's default provider and model, so a choice is not sent.
 */
export function hostMessagingApi(
  serverId: () => string | undefined,
  host: () => HostMessagingApi = () => window.openbot.messaging,
): MessagingConnectorApi {
  const call = <T>(method: (api: HostMessagingApi, serverId: string) => Promise<T>) => {
    const id = serverId();
    if (!id) return Promise.reject(new Error(sourceText("error.team.connectorsUnsupported")));
    return method(host(), id);
  };
  return {
    getSlackOverview: () => call((api, id) => api.hostOverview({ platform: "slack" }, id)),
    connectSlackWorkspace: () => call((api, id) => api.hostConnect({ platform: "slack", place: null }, id)),
    disconnectSlackWorkspace: ({ workspaceId }) =>
      call((api, id) => api.hostDisconnect({ platform: "slack", workspaceId }, id)),
    reconnectSlackWorkspace: ({ workspaceId }) =>
      call((api, id) => api.hostReconnect({ platform: "slack", workspaceId }, id)),
    setSlackEnabled: ({ workspaceId, enabled }) =>
      call((api, id) => api.hostSetEnabled({ platform: "slack", workspaceId, enabled }, id)),
    addSlackOrchestrator: ({ workspaceId }) =>
      call((api, id) => api.hostAddOrchestrator({ platform: "slack", workspaceId }, id)),
    getDiscordOverview: () => call((api, id) => api.hostOverview({ platform: "discord" }, id)),
    connectDiscordGuild: () => call((api, id) => api.hostConnect({ platform: "discord", place: null }, id)),
    disconnectDiscordGuild: ({ workspaceId }) =>
      call((api, id) => api.hostDisconnect({ platform: "discord", workspaceId }, id)),
    reconnectDiscordGuild: ({ workspaceId }) =>
      call((api, id) => api.hostReconnect({ platform: "discord", workspaceId }, id)),
    setDiscordEnabled: ({ workspaceId, enabled }) =>
      call((api, id) => api.hostSetEnabled({ platform: "discord", workspaceId, enabled }, id)),
    addDiscordOrchestrator: ({ workspaceId }) =>
      call((api, id) => api.hostAddOrchestrator({ platform: "discord", workspaceId }, id)),
    getTelegramOverview: () => call((api, id) => api.hostOverview({ platform: "telegram" }, id)),
    connectTelegramChat: ({ place }) => call((api, id) => api.hostConnect({ platform: "telegram", place }, id)),
    disconnectTelegramChat: ({ workspaceId }) =>
      call((api, id) => api.hostDisconnect({ platform: "telegram", workspaceId }, id)),
    reconnectTelegramChat: ({ workspaceId }) =>
      call((api, id) => api.hostReconnect({ platform: "telegram", workspaceId }, id)),
    setTelegramEnabled: ({ workspaceId, enabled }) =>
      call((api, id) => api.hostSetEnabled({ platform: "telegram", workspaceId, enabled }, id)),
    addTelegramOrchestrator: () =>
      call((api, id) => api.hostAddOrchestrator({ platform: "telegram", workspaceId: null }, id)),
  };
}
