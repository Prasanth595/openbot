// A Slack or Discord install that the browser client starts for a joined server (`connectors-v1`)
// returns to `/slack/connect` or `/discord/connect`, which have the same origin as the client. The
// client marks the install's nonce in local storage. When the page finds the mark, it gives the
// sealed grant to the client tab on a broadcast channel and opens no `openbot://` link. The client
// sends the grant on to the host; only the host can open it.

import { isBoundedString } from "./ipc-bounded-values";
import { isDynamicRecord, isOneOf } from "./runtime-values";

export const WEB_MESSAGING_INSTALL_CHANNEL = "openbot:messaging-install";

export const WEB_MESSAGING_INSTALL_PLATFORMS = ["slack", "discord"] as const;
export type WebMessagingInstallPlatform = (typeof WEB_MESSAGING_INSTALL_PLATFORMS)[number];

/** The local storage key that marks an install the client started. Its value is the platform. */
export function webMessagingInstallKey(nonce: string): string {
  return `openbot:messaging-install:${nonce}`;
}

export interface WebMessagingInstallGrant {
  platform: WebMessagingInstallPlatform;
  nonce: string;
  grant: string;
}

/** The same limits as the `connectors-v1` complete route. */
export function decodeWebMessagingInstallGrant(value: unknown): WebMessagingInstallGrant | null {
  return isDynamicRecord(value) &&
    isOneOf(WEB_MESSAGING_INSTALL_PLATFORMS, value.platform) &&
    isBoundedString(value.nonce, 128) &&
    isBoundedString(value.grant, 16_384)
    ? { platform: value.platform, nonce: value.nonce, grant: value.grant }
    : null;
}
