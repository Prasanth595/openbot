import { AppLogo } from "@openbot/brand";
import { readFirstTouch } from "@openbot/contracts/first-touch";
import { createFileRoute } from "@tanstack/solid-router";
import { onSettled } from "solid-js";

/** The page that Stripe Checkout and the Customer Portal open when a desktop user goes back. */
export const Route = createFileRoute("/billing/return")({
  head: () => ({
    meta: [{ title: "OpenBot billing" }, { name: "robots", content: "noindex, nofollow, noarchive" }],
  }),
  headers: () => ({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  }),
  component: BillingReturn,
});

/**
 * After a desktop checkout, sends the Checkout Session ID with the first website visit of this
 * browser, so that reports can name the source of the account. The ID is then removed from the URL.
 */
function sendCheckoutAttribution(): void {
  const url = new URL(window.location.href);
  const sessionId = url.searchParams.get("checkout");
  if (!sessionId) return;
  url.searchParams.delete("checkout");
  window.history.replaceState(window.history.state, "", url);
  const firstTouch = readFirstTouch(() => window.localStorage, Date.now());
  if (!firstTouch) return;
  void fetch("/api/browser/checkout-attribution", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    keepalive: true,
    // The page has no referrer; the account service still needs the Origin header of this site.
    referrerPolicy: "same-origin",
    headers: { "Content-Type": "application/json", "X-OpenBot-Browser": "1" },
    body: JSON.stringify({ sessionId, firstTouch }),
  }).catch(() => undefined);
}

function BillingReturn() {
  onSettled(() => sendCheckoutAttribution());
  return (
    <main class="join-page">
      <section class="join-card" aria-labelledby="billing-return-title">
        <AppLogo variant="production" class="join-card-logo" />
        <h1 id="billing-return-title">Billing updated</h1>
        <p class="join-card-copy">Go back to OpenBot. You can close this page.</p>
      </section>
    </main>
  );
}
