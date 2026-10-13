import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/** What the Transfer tab reaches in main: the transfer file and the provider sign-in. */
export interface TransferPort {
  instanceTransfer: OpenBotDesktopApi["instanceTransfer"];
  connectProvider: OpenBotDesktopApi["connectProvider"];
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function transferPort(): TransferPort {
  return window.openbot;
}
