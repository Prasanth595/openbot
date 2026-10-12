import type { MessagingConnectorApi } from "./host-messaging-port";

/** What the Slack page reaches in main: the Slack workspaces of this computer or of a joined server. */
export interface SlackConnectorPort {
  messaging: MessagingConnectorApi;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function slackConnectorPort(): SlackConnectorPort {
  return { messaging: window.openbot.messaging };
}
