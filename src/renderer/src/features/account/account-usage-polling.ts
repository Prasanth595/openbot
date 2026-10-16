import { createEffect, createMemo, untrack } from "solid-js";
import { useAgents } from "../agents/agents-context";
import { useServers } from "../servers/servers-context";
import { useAuth } from "./account-context";

/** How old a reading may get before it is fetched again. The rail rings always show it. */
const USAGE_AUTO_REFRESH_MS = 5 * 60_000;
/**
 * The poll asks more often than it refreshes, and each tick compares the age of
 * the reading. A tick right after a manual refresh then costs nothing.
 */
const USAGE_AUTO_REFRESH_CHECK_MS = 30_000;

/**
 * Selects the usage target of the active server and keeps its plan limits fresh
 * for the rail rings and the usage page. A hidden window does not poll; coming
 * back to it refreshes at once when the interval has passed.
 */
export function useAccountUsagePolling() {
  const auth = useAuth();
  const { agentStatus, refreshHostAccountUsage } = useAgents();
  const { activeServerId } = useServers();
  const usageReady = createMemo(() => {
    const status = agentStatus();
    return (
      status.phase === "ready" ||
      Boolean(status.providers?.some((item) => item.state === "available" && item.connectionState !== "connecting"))
    );
  });
  const usageTargetKey = createMemo(() => {
    const serverId = activeServerId();
    if (!serverId) return null;
    const connected = (agentStatus().providers ?? [])
      .filter((item) => item.state === "available" && item.connectionState !== "connecting")
      .map((item) => item.id)
      .sort()
      .join(",");
    return `${serverId}:${connected}`;
  });
  let lastRefreshAt = 0;

  function refresh(targetKey: string) {
    lastRefreshAt = Date.now();
    void refreshHostAccountUsage().catch(() => undefined);
    void auth.refreshAccountUsage(targetKey).catch(() => undefined);
  }

  createEffect(
    () => usageTargetKey(),
    (targetKey) => untrack(() => auth.selectAccountUsageTarget(targetKey)),
  );

  createEffect(
    () => (usageReady() ? usageTargetKey() : null),
    (target) => {
      if (!target) return;
      const targetKey = target;
      function refreshWhenDue() {
        if (document.hidden || Date.now() - lastRefreshAt < USAGE_AUTO_REFRESH_MS) return;
        refresh(targetKey);
      }
      untrack(() => refresh(targetKey));
      const timer = window.setInterval(refreshWhenDue, USAGE_AUTO_REFRESH_CHECK_MS);
      document.addEventListener("visibilitychange", refreshWhenDue);
      return () => {
        window.clearInterval(timer);
        document.removeEventListener("visibilitychange", refreshWhenDue);
      };
    },
  );
}
