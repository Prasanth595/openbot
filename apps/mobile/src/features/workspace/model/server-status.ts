import type { MobileTextKey, MobileTranslate } from "@openbot/i18n/mobile";
import { type RemoteConnectionFailure, type RemoteRecoveryStatus, remoteRecoveryMessage } from "@openbot/team-client";
import type { MobileServer, MobileServerState } from "./workspace-types";

const LABELS = {
  unknown: "mobile.workspace.status.notConnected",
  connecting: "common.connecting",
  online: "mobile.workspace.status.online",
  offline: "mobile.workspace.status.offline",
  error: "mobile.workspace.status.error",
} as const satisfies Record<MobileServerState, MobileTextKey>;

/**
 * What the screens show: online, also while a return to the app connects again quietly. Actions
 * can use it too, because a request then waits for the connection. Code that needs the live
 * connection itself, such as the outbox or the browser view, reads `state`.
 */
export function showsOnline(server: Pick<MobileServer, "state" | "resuming"> | undefined): boolean {
  return server?.state === "online" || server?.resuming === true;
}

export function serverStatusLabel(
  server: Pick<MobileServer, "state" | "initialConnectionPending" | "resuming">,
  t: MobileTranslate,
): string {
  if (showsOnline(server)) return t(LABELS.online);
  if (server.state === "connecting" && !server.initialConnectionPending) return t(LABELS.offline);
  return t(LABELS[server.state]);
}

export function applyServerRecovery(
  server: MobileServer,
  status: RemoteRecoveryStatus,
  failure: string | null,
  details: RemoteConnectionFailure | null = null,
  resuming = false,
): MobileServer {
  const state: MobileServerState =
    status.phase === "online"
      ? "online"
      : status.phase === "connecting"
        ? "connecting"
        : status.phase === "suspended"
          ? "error"
          : "offline";
  return {
    ...server,
    state,
    connectionMessage: remoteRecoveryMessage(status, failure),
    connectionFailure: status.phase === "online" ? null : details,
    recoveryStatus: status,
    resuming: resuming && state !== "online",
    initialConnectionPending: server.initialConnectionPending && state === "connecting",
  };
}

/** A lost connection reports attempt 0 while its first attempt is due; show that attempt. */
export function recoveryAttempt(status: RemoteRecoveryStatus): number {
  return Math.max(1, status.attempt);
}

/**
 * Seconds for the reconnect countdown, or null to hide it. Connecting shows the wait that follows a
 * failure. A lost connection reports zero before its first attempt starts, with no wait to show.
 */
export function recoveryCountdown(status: RemoteRecoveryStatus): number | null {
  return status.remainingSeconds > 0 ? status.remainingSeconds : null;
}

export function serverKind(hostId: string, pairedHostId: string | undefined): MobileServer["kind"] {
  return hostId === pairedHostId ? "local" : "remote";
}
