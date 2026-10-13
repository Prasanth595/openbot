import type { MessagingConnectorApi } from "./host-messaging-port";

/** What the Telegram page reaches in main: the Telegram chats of this computer or of a joined server. */
export interface TelegramConnectorPort {
  messaging: MessagingConnectorApi;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function telegramConnectorPort(): TelegramConnectorPort {
  return { messaging: window.openbot.messaging };
}
