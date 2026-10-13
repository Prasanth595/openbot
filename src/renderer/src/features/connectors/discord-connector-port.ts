import type { MessagingConnectorApi } from "./host-messaging-port";

/** What the Discord page reaches in main: the Discord servers of this computer or of a joined server. */
export interface DiscordConnectorPort {
  messaging: MessagingConnectorApi;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function discordConnectorPort(): DiscordConnectorPort {
  return { messaging: window.openbot.messaging };
}
