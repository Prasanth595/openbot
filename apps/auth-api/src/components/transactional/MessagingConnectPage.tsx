import { AppLogo } from "@openbot/brand";
import type { WebMessagingInstallPlatform } from "@openbot/contracts/web-messaging-install";
import { DiscordMark, SlackMark } from "@openbot/ui/features/settings/brand-marks";
import type { JSX } from "@solidjs/web";
import { createSignal, onSettled, Show } from "solid-js";
import { handOffToWebClient } from "../landing/web-messaging-handoff";
import { Button } from "../ui/button";
import { createOpenAppFallback, OpenAppFallbackDialog } from "./OpenAppFallback";
import { TransactionalPage } from "./TransactionalPage";

/** Why the connection did not finish. Each provider maps its own error codes to one of these. */
type FailureKind =
  | "cancelled"
  | "expired"
  | "exchange"
  | "enterprise"
  | "taken"
  | "unavailable"
  | "tabClosed"
  | "failed";

interface MessagingProvider {
  name: string;
  /** What one install connects: a Slack workspace or a Discord server. */
  place: string;
  /** The provider's logo, from the shared integration settings. */
  mark: () => JSX.Element;
  /** The `openbot://` host that takes the sealed grant. `src/main/deep-link-router.ts` owns these. */
  deepLinkHost: string;
  /** The page's own code when the fragment has no grant and no error. */
  failedCode: string;
  /** The page's own code when the browser client tab that started the install did not answer. */
  tabClosedCode: string;
  /** The codes that the install callback puts in the fragment. Unknown codes show `failed`. */
  errors: Record<string, FailureKind>;
}

const MESSAGING_PROVIDERS: Record<WebMessagingInstallPlatform, MessagingProvider> = {
  // Codes from `routes/v2/slack/callback.ts` and `server/slack-app.ts`.
  slack: {
    name: "Slack",
    place: "Slack workspace",
    mark: () => <SlackMark class="transactional-provider-mark" />,
    deepLinkHost: "slack-workspace",
    failedCode: "slack_failed",
    tabClosedCode: "slack_tab_closed",
    errors: {
      slack_cancelled: "cancelled",
      access_denied: "cancelled",
      slack_state_invalid: "expired",
      slack_exchange_failed: "exchange",
      slack_enterprise_install: "enterprise",
      slack_workspace_taken: "taken",
      slack_not_configured: "unavailable",
      slack_tab_closed: "tabClosed",
    },
  },
  // Codes from `routes/v2/discord/callback.ts` and `server/discord-app.ts`.
  discord: {
    name: "Discord",
    place: "Discord server",
    mark: () => <DiscordMark class="transactional-provider-mark" />,
    deepLinkHost: "discord-guild",
    failedCode: "discord_failed",
    tabClosedCode: "discord_tab_closed",
    errors: {
      discord_cancelled: "cancelled",
      access_denied: "cancelled",
      discord_state_invalid: "expired",
      discord_exchange_failed: "exchange",
      discord_guild_taken: "taken",
      discord_not_configured: "unavailable",
      discord_tab_closed: "tabClosed",
    },
  },
};

const COPY = {
  title: "Return to OpenBot",
  failedTitle: "The connection did not finish",
  openApp: "Open OpenBot",
  tryAgainApp: "Try again in OpenBot",
  tryAgainBrowser: "Try again in browser",
  doneInWebClient: (name: string) => `Your OpenBot tab finishes the ${name} connection. You can close this tab.`,
  doneInApp: (name: string) => `OpenBot finishes the ${name} connection on your computer.`,
  failure: {
    cancelled: (p: MessagingProvider) => `The ${p.name} connection was cancelled. Nothing changed.`,
    expired: (p: MessagingProvider) => `The ${p.name} sign-in expired. Start the connection again.`,
    exchange: (p: MessagingProvider) => `${p.name} did not confirm the connection. Try again.`,
    enterprise: (p: MessagingProvider) => `Connect one ${p.place}, not a whole organization.`,
    taken: (p: MessagingProvider) =>
      `Another OpenBot server already answers this ${p.place}. Disconnect it on that server, then try again.`,
    unavailable: (p: MessagingProvider) => `OpenBot cannot connect to ${p.name} now. Try again later.`,
    tabClosed: (p: MessagingProvider) =>
      `The OpenBot tab that started the ${p.name} connection did not answer. Open OpenBot in your browser and connect ${p.name} again.`,
    failed: (p: MessagingProvider) => `${p.name} did not finish the connection. Try again.`,
  } satisfies Record<FailureKind, (provider: MessagingProvider) => string>,
  restartHint: (name: string) =>
    `In OpenBot, open Server settings, then Connectors, then ${name}, and select Connect ${name}.`,
  notOpened: (name: string) =>
    `Start OpenBot, then try again. If OpenBot is not on this computer, download it and connect ${name} from the app.`,
} as const;

/**
 * The connect flow starts in the app: `/v2/<provider>/authorize` needs the signed-in account, a new
 * nonce and the server's public key. So this page cannot start it again. "Try again" brings the
 * visitor back to the app or to the browser client, where the connect button is.
 */
const APP_URL = "openbot://";
const WEB_CLIENT_URL = "/app";

/** The code comes from the address bar, so only the map's own keys count, not `constructor` and others. */
function failureKind(provider: MessagingProvider, code: string): FailureKind {
  return Object.hasOwn(provider.errors, code) ? (provider.errors[code] ?? "failed") : "failed";
}

function deepLink(provider: MessagingProvider, fragment: URLSearchParams): string | null {
  const nonce = fragment.get("nonce");
  const grant = fragment.get("grant");
  return nonce && grant ? `openbot://${provider.deepLinkHost}?${new URLSearchParams({ nonce, grant })}` : null;
}

/**
 * The page that returns a Slack or Discord install to the desktop app, or to the browser client tab
 * that started it. The install callback redirects here with a sealed grant, or an error code, in the
 * fragment. The page only builds the `openbot://` link or passes the grant on: only the server can
 * open the grant.
 */
export function MessagingConnectPage(props: { provider: WebMessagingInstallPlatform }) {
  const [openUrl, setOpenUrl] = createSignal("");
  const [failure, setFailure] = createSignal<string | null>(null);
  const [webClient, setWebClient] = createSignal(false);

  onSettled(() => {
    const provider = MESSAGING_PROVIDERS[props.provider];
    const page = new URL(window.location.href);
    const fragment = new URLSearchParams(page.hash.slice(1));
    const target = deepLink(provider, fragment);
    // The grant is no use to anyone who reads the address bar later.
    window.history.replaceState(null, "", page.pathname);
    if (!target) {
      setFailure(fragment.get("error") ?? provider.failedCode);
      return;
    }
    // When the client tab that started the install is gone, the start-again message shows.
    const handoff = handOffToWebClient(props.provider, fragment);
    if (handoff) {
      void handoff.then((received) => (received ? setWebClient(true) : setFailure(provider.tabClosedCode)));
      return;
    }
    setOpenUrl(target);
    window.location.assign(target);
  });

  return (
    <MessagingConnectView provider={props.provider} openUrl={openUrl()} failure={failure()} webClient={webClient()} />
  );
}

/** The page's card: the link back to OpenBot, or why the install did not finish and how to try again. */
export function MessagingConnectView(props: {
  provider: WebMessagingInstallPlatform;
  openUrl: string;
  failure: string | null;
  webClient?: boolean;
}) {
  const provider = () => MESSAGING_PROVIDERS[props.provider];
  const kind = () => (props.failure ? failureKind(provider(), props.failure) : null);
  const fallback = createOpenAppFallback();
  const titleId = () => `${props.provider}-connect-title`;

  return (
    <TransactionalPage titleId={titleId()}>
      <AppLogo variant="production" animation="blink" class="join-card-logo" />
      <p class="join-card-eyebrow transactional-provider">
        {provider().mark()}
        {provider().name}
      </p>
      <Show
        when={kind()}
        fallback={
          <>
            <h1 id={titleId()}>{COPY.title}</h1>
            <p class="join-card-copy">
              {props.webClient ? COPY.doneInWebClient(provider().name) : COPY.doneInApp(provider().name)}
            </p>
            <Show when={props.openUrl}>
              {(href) => (
                <div class="join-card-actions join-card-actions-single">
                  <Button href={href()} variant="primary" size="lg" icon="open" onClick={fallback.arm}>
                    {COPY.openApp}
                  </Button>
                </div>
              )}
            </Show>
          </>
        }
      >
        {(failed) => (
          <>
            <h1 id={titleId()}>{COPY.failedTitle}</h1>
            <p class="join-card-error" role="alert">
              {COPY.failure[failed()](provider())}
            </p>
            <div class="join-card-actions">
              {/* The browser client is the first action when its tab started the install. */}
              <Show
                when={failed() === "tabClosed"}
                fallback={
                  <>
                    <Button href={APP_URL} variant="primary" size="lg" icon="open" onClick={fallback.arm}>
                      {COPY.tryAgainApp}
                    </Button>
                    <Button href={WEB_CLIENT_URL} variant="secondary" size="lg" icon="arrow-right">
                      {COPY.tryAgainBrowser}
                    </Button>
                  </>
                }
              >
                <Button href={WEB_CLIENT_URL} variant="primary" size="lg" icon="arrow-right">
                  {COPY.tryAgainBrowser}
                </Button>
                <Button href={APP_URL} variant="secondary" size="lg" icon="open" onClick={fallback.arm}>
                  {COPY.tryAgainApp}
                </Button>
              </Show>
            </div>
            <p class="join-card-note">{COPY.restartHint(provider().name)}</p>
          </>
        )}
      </Show>
      <OpenAppFallbackDialog fallback={fallback} copy={COPY.notOpened(provider().name)} />
    </TransactionalPage>
  );
}
