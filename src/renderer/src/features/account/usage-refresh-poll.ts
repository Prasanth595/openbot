import { createEffect, untrack } from "solid-js";

/** How old a plan limits reading may get before it is fetched again. The rail rings always show it. */
const USAGE_AUTO_REFRESH_MS = 5 * 60_000;
/** The poll asks more often than it refreshes, and each tick compares the age of the reading. */
const USAGE_AUTO_REFRESH_CHECK_MS = 30_000;

export interface UsageRefreshPollOptions {
  /** The usage target, or null while no reading can be taken. A new target starts the poll again. */
  target: () => string | null;
  refresh: (target: string) => void;
  /**
   * Whether a new target is read at once. False when a reading for the target is already on its way,
   * so its age starts now.
   */
  refreshAtStart: boolean;
}

/**
 * Keeps the plan limits of the usage target fresh, on desktop and on the web. A hidden window or tab
 * does not poll; coming back to it refreshes at once when the interval has passed.
 */
export function createUsageRefreshPoll(options: UsageRefreshPollOptions) {
  let lastRefreshAt = 0;

  function refresh(target: string) {
    lastRefreshAt = Date.now();
    options.refresh(target);
  }

  createEffect(options.target, (target) => {
    if (!target) return;
    const targetKey = target;
    if (options.refreshAtStart) untrack(() => refresh(targetKey));
    else lastRefreshAt = Date.now();
    function refreshWhenDue() {
      if (document.hidden || Date.now() - lastRefreshAt < USAGE_AUTO_REFRESH_MS) return;
      refresh(targetKey);
    }
    const timer = window.setInterval(refreshWhenDue, USAGE_AUTO_REFRESH_CHECK_MS);
    document.addEventListener("visibilitychange", refreshWhenDue);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenDue);
    };
  });
}
