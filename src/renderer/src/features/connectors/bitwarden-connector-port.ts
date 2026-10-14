import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/** What the Bitwarden page reaches in main: the connection of this computer. */
export type BitwardenConnectorPort = OpenBotDesktopApi["bitwardenConnector"];

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function bitwardenConnectorPort(): BitwardenConnectorPort {
  return window.openbot.bitwardenConnector;
}
