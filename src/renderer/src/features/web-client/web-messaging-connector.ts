// The Slack, Discord and Telegram connections of the joined server in the browser client
// (`connectors-v1`). The host opens no page; this browser opens the platform's page that the host
// names. A Slack or Discord install returns to a page of this origin, which gives the sealed grant
// back to this tab (`@openbot/contracts/web-messaging-install`). This tab sends it on to the host.

import { type MessagingPlatform, messagingPage } from "@openbot/contracts/ipc";
import {
  decodeWebMessagingInstallGrant,
  WEB_MESSAGING_INSTALL_CHANNEL,
  type WebMessagingInstallPlatform,
  webMessagingInstallKey,
} from "@openbot/contracts/web-messaging-install";
import { sourceText } from "@openbot/i18n/source";
import { runTeamEffect } from "@openbot/team-client";
import {
  type MessagingConnectorPage,
  messagingConnectorAddOrchestrator,
  messagingConnectorComplete,
  messagingConnectorConnect,
  messagingConnectorDisconnect,
  messagingConnectorOverview,
  messagingConnectorReconnect,
  messagingConnectorSetEnabled,
  type TeamAdminRequestError,
} from "@openbot/team-client/team-admin-requests";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { Effect } from "effect";
import type { HostMessagingApi } from "../connectors/host-messaging-port";

/** `request` throws for a server that is not connected. Call `dispose` when the client closes. */
export function webHostMessaging(request: (serverId: string) => TeamApiRequest): {
  api: HostMessagingApi;
  dispose: () => void;
} {
  /** The installs that this tab opened, by nonce: the server that waits for each grant. */
  const pending = new Map<string, { platform: WebMessagingInstallPlatform; serverId: string }>();
  let channel: BroadcastChannel | null = null;

  const forget = (nonce: string) => {
    pending.delete(nonce);
    try {
      localStorage.removeItem(webMessagingInstallKey(nonce));
    } catch {
      // Storage that is not available holds no mark.
    }
    if (pending.size > 0) return;
    channel?.close();
    channel = null;
  };
  const receive = (event: MessageEvent) => {
    const install = decodeWebMessagingInstallGrant(event.data);
    const waiting = install ? pending.get(install.nonce) : undefined;
    if (!install || waiting?.platform !== install.platform) return;
    forget(install.nonce);
    // The Connectors page reads the connections again by itself and shows the result, as on the desktop.
    void runTeamEffect(messagingConnectorComplete(request(waiting.serverId), install)).catch(() => undefined);
  };
  /** Without the mark, the return page opens `openbot://` as for the desktop app. */
  const remember = (platform: WebMessagingInstallPlatform, nonce: string, serverId: string) => {
    try {
      localStorage.setItem(webMessagingInstallKey(nonce), platform);
    } catch {
      return;
    }
    pending.set(nonce, { platform, serverId });
    if (channel) return;
    channel = new BroadcastChannel(WEB_MESSAGING_INSTALL_CHANNEL);
    channel.onmessage = receive;
  };

  const run = <T>(effect: Effect.Effect<T, TeamAdminRequestError>) =>
    runTeamEffect(effect.pipe(Effect.mapError((error) => error.cause)));
  /**
   * A browser blocks a page that the user's click did not open, and the page is known only when the
   * host answers. So the tab opens empty at the click, with no await before it, and goes to the page after.
   */
  const withTab = async (
    serverId: string,
    platform: MessagingPlatform,
    open: (target: TeamApiRequest) => Effect.Effect<MessagingConnectorPage, TeamAdminRequestError>,
  ) => {
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    try {
      const page = await run(open(request(serverId)));
      const address = messagingPage(platform, page.url);
      if (page.url !== null && !address) throw new Error(sourceText("error.team.connectorPageRefused"));
      if (address && platform !== "telegram" && page.nonce !== null) remember(platform, page.nonce, serverId);
      if (tab && address) tab.location.href = address;
      else tab?.close();
    } catch (error) {
      tab?.close();
      throw error;
    }
  };

  return {
    api: {
      hostOverview: (input, serverId) => run(messagingConnectorOverview(request(serverId), input)),
      hostConnect: (input, serverId) =>
        withTab(serverId, input.platform, (target) => messagingConnectorConnect(target, input)),
      hostDisconnect: (input, serverId) => run(messagingConnectorDisconnect(request(serverId), input)),
      // A Discord server that removed the bot installs it again, so the host can answer a page.
      hostReconnect: (input, serverId) =>
        withTab(serverId, input.platform, (target) => messagingConnectorReconnect(target, input)),
      hostSetEnabled: (input, serverId) => run(messagingConnectorSetEnabled(request(serverId), input)),
      hostAddOrchestrator: (input, serverId) => run(messagingConnectorAddOrchestrator(request(serverId), input)),
    },
    dispose: () => {
      for (const nonce of [...pending.keys()]) forget(nonce);
    },
  };
}
