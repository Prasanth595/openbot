import {
  WEB_MESSAGING_INSTALL_CHANNEL,
  type WebMessagingInstallPlatform,
  webMessagingInstallKey,
} from "@openbot/contracts/web-messaging-install";

/**
 * Gives a Slack or Discord install's sealed grant to the browser client tab that started it. True
 * when that tab marked the nonce: the page then opens no `openbot://` link.
 */
export function handOffToWebClient(platform: WebMessagingInstallPlatform, fragment: URLSearchParams): boolean {
  const nonce = fragment.get("nonce");
  const grant = fragment.get("grant");
  if (!nonce || !grant) return false;
  try {
    if (localStorage.getItem(webMessagingInstallKey(nonce)) !== platform) return false;
    localStorage.removeItem(webMessagingInstallKey(nonce));
  } catch {
    return false;
  }
  const channel = new BroadcastChannel(WEB_MESSAGING_INSTALL_CHANNEL);
  channel.postMessage({ platform, nonce, grant });
  channel.close();
  return true;
}
