import { createEffect, createSignal } from "solid-js";

/**
 * How long a browser sign-in runs before the code is offered. A browser that works comes back in a
 * few seconds; one whose callback cannot reach OpenBot never does.
 */
const CODE_FALLBACK_DELAY_MS = 25_000;

/**
 * Whether a browser sign-in should offer the code sign-in: it has run for `CODE_FALLBACK_DELAY_MS`,
 * or it ended and the caller still has no account. Its callback may not reach this computer.
 * A provider status cannot tell a failed sign-in from one never started, so the attempt is kept here.
 *
 * A code sign-in also reports `connecting`, so the caller says which way the user chose. Until the
 * user chooses, a sign-in is taken as the browser one.
 */
export function createCodeSignInFallback(connecting: () => boolean) {
  const [stalled, setStalled] = createSignal(false);
  const [attempted, setAttempted] = createSignal(false);
  const [viaCode, setViaCode] = createSignal(false);
  createEffect(
    () => connecting() && !viaCode(),
    (browserWaiting) => {
      setStalled(false);
      if (!browserWaiting) return;
      setAttempted(true);
      const timer = window.setTimeout(() => setStalled(true), CODE_FALLBACK_DELAY_MS);
      return () => window.clearTimeout(timer);
    },
  );
  return {
    offered: () => !viaCode() && (connecting() ? stalled() : attempted()),
    startedWithCode: () => {
      setViaCode(true);
      setAttempted(false);
    },
    startedInBrowser: () => setViaCode(false),
  };
}
