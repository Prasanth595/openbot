import { AppLogo } from "@openbot/brand";
import { createWebAppInvitePath, OPENBOT_INVITE_ORIGIN, toOpenBotInviteUrl } from "@openbot/contracts/invite-links";
import { createSignal, onSettled, Show } from "solid-js";
import { landingAnalytics } from "../../lib/analytics";
import { detectDownloadPlatform } from "../../lib/download-platforms";
import { OPENBOT_DOWNLOAD_LINKS } from "../../lib/landing-links";
import { TransactionalPage } from "../transactional/TransactionalPage";
import { Button } from "../ui/button";

const COPY = {
  eyebrow: "Private invitation",
  title: "Join an OpenBot server",
  intro: "Open this invitation in OpenBot. The app checks the server and asks you to confirm before it connects.",
  invalid: "This invitation link is not valid or is not complete. Ask the server owner for a new invitation.",
  open: "Open OpenBot",
  browser: "Open in browser",
  download: "Download OpenBot",
  notOpened:
    "If OpenBot did not open, install it with Download OpenBot, or start OpenBot once so that it can open invitation links. You can also use Open in browser.",
  mobile: "If OpenBot is installed, tap Open OpenBot. You can also paste this link into Add server in the app.",
  // The link carries no expiry, use limit or email, and the page does not send the token anywhere to
  // ask. So these notes give the rules, and the app shows the details before the visitor joins.
  singleUse:
    "A single-use link works one time and then expires. A permanent link works until the owner revokes it. OpenBot shows the expiry before you join.",
  email: "If the invitation came by email, sign in to OpenBot with that email address.",
  share: "This link gives access to a server. Share it only with people you want to invite.",
} as const;

export function JoinPage() {
  const [openUrl, setOpenUrl] = createSignal("");
  const [browserUrl, setBrowserUrl] = createSignal("");
  const [downloadUrl, setDownloadUrl] = createSignal<string>(OPENBOT_DOWNLOAD_LINKS.macos);
  const [mobile, setMobile] = createSignal(false);
  const [invalid, setInvalid] = createSignal(false);
  const [openAttempted, setOpenAttempted] = createSignal(false);

  onSettled(() => {
    setMobile(
      /android|iphone|ipad|ipod/iu.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
    );
    const platform = detectDownloadPlatform(globalThis.navigator) ?? "macos";
    let validInvite = true;
    try {
      const pageUrl = new URL(window.location.href);
      const canonicalUrl = new URL(`${pageUrl.pathname}${pageUrl.search}`, OPENBOT_INVITE_ORIGIN);
      setOpenUrl(toOpenBotInviteUrl(canonicalUrl.toString()));
      setBrowserUrl(createWebAppInvitePath(canonicalUrl.toString()));
    } catch {
      validInvite = false;
      setInvalid(true);
    }
    setDownloadUrl(OPENBOT_DOWNLOAD_LINKS[platform]);
    const cleanup = landingAnalytics.startJoin(document, window.location.hostname, { validInvite, platform });
    return cleanup;
  });

  return (
    <TransactionalPage titleId="join-title">
      <div class="join-card-signal" aria-hidden="true">
        <span />
        <i />
        <span />
      </div>
      <AppLogo variant="production" animation="blink" class="join-card-logo" />
      <p class="join-card-eyebrow">{COPY.eyebrow}</p>
      <h1 id="join-title">{COPY.title}</h1>
      <p class="join-card-copy">{COPY.intro}</p>

      <Show when={!invalid()} fallback={<p class="join-card-error">{COPY.invalid}</p>}>
        <div class="join-card-actions">
          {/* Until the page reads the link, the app cannot open it. The button is then a real
              disabled button, so it is not a link that goes nowhere. */}
          <Show
            when={openUrl()}
            fallback={
              <Button as="button" type="button" disabled variant="primary" size="lg" icon="open">
                {COPY.open}
              </Button>
            }
          >
            {(href) => (
              <Button href={href()} variant="primary" size="lg" icon="open" onClick={() => setOpenAttempted(true)}>
                {COPY.open}
              </Button>
            )}
          </Show>
          <Show when={browserUrl()}>
            {(href) => (
              <Button href={href()} variant="secondary" size="lg" icon="arrow-right">
                {COPY.browser}
              </Button>
            )}
          </Show>
          <Show when={!mobile()}>
            <Button href={downloadUrl()} variant="secondary" size="lg" icon="download">
              {COPY.download}
            </Button>
          </Show>
        </div>
      </Show>

      <Show when={!mobile()}>
        {/* The live region exists before the click, so screen readers announce the text when it appears. */}
        <p class={openAttempted() ? "join-card-note" : "join-card-status-empty"} role="status">
          <Show when={openAttempted()}>{COPY.notOpened}</Show>
        </p>
      </Show>
      <Show when={mobile()}>
        <p class="join-card-note">{COPY.mobile}</p>
      </Show>
      <ul class="transactional-notes">
        <li>{COPY.singleUse}</li>
        <li>{COPY.email}</li>
        <li>{COPY.share}</li>
      </ul>
    </TransactionalPage>
  );
}
