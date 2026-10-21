/**
 * The service events the main process relays to the renderer. They live here rather than in
 * the entry point because every one of them is the same three lines around a different channel, and
 * because they are the part of the entry point most likely to be edited by two agents at once.
 *
 * Every dependency is a **function**, never a nullable value. These are built at module scope, before
 * `app.whenReady()` has constructed anything, so `getHostService()` and `hostService` behave
 * differently at run time - and `() => HostService | null` and `HostService | null` both type-check
 * at every call site, so `tsc` cannot tell you which one you passed. A function-typed field makes
 * the wrong one an error. Each of them now reads one `ApplicationServices` handle rather than its
 * own module-scope `let`.
 *
 * `showMainWindow` is injected rather than imported so that this module stays reachable from a test
 * without pulling in `main-window.ts` and, through it, the whole window and menu surface.
 */

import {
  type AgentEvent,
  type BrowserDisplayState,
  IPC_ENDPOINTS,
  LOCAL_SERVER_ID,
  latestTurnAnswer,
  type ServerNotificationLevel,
  type SpeechModelStatus,
  type VoiceModelStatus,
  type VoiceStreamTranscript,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import type { AppFormat, AppTranslate } from "@openbot/i18n";
import { redactText } from "@openbot/logging";
import {
  agentEventCanNotify,
  notificationForAgentEvent,
  notificationForUsageLimit,
  notificationRequestKey,
} from "@openbot/team-client/agent-notifications";
import { BrowserWindow, Notification } from "electron";
import { isNoUpdateAnswer } from "../backend/agent/routine-quiet-runs";
import type { AgentService } from "../backend/agent-service";
import { runCauseEffect } from "../backend/effect-boundary";
import type { HostAnalytics } from "./analytics";
import {
  closeRetainedNotification,
  desktopShowsAgentEvent,
  RETAINED_NOTIFICATION_LIMIT,
  showRetainedNotification,
} from "./desktop-notifications";
import type { HostService } from "./host-service";
import { withLocalHostSummary } from "./ipc/team-handlers";
import { decodeAgentSummaries } from "./remote-agent-decoding";
import type { RemoteServerManager } from "./remote-server-manager";
import { sendToRenderer } from "./renderer-ipc";

export interface RendererForwarderDependencies {
  getMainWindow: () => BrowserWindow | null;
  getAgentService: () => Pick<AgentService, "listAgents"> | null;
  getHostService: () => HostService | null;
  getHostAnalytics: () => HostAnalytics | null;
  getRemoteServerManager: () => Pick<RemoteServerManager, "list" | "request" | "readAgentConversationPage"> | null;
  showMainWindow: (window: BrowserWindow) => void;
  /** The language every desktop notification is written in, read at the moment one is raised. */
  getTranslate: () => AppTranslate;
  /** The dates and numbers of a desktop notification, in the same language. */
  getFormat: () => AppFormat;
  /** The Settings switch for every desktop notification, read at the moment one is raised. */
  desktopNotificationsEnabled: () => boolean;
  /** The Settings switch that lets a notification show the agent's words. */
  notificationPreviewEnabled: () => boolean;
}

/** The newest messages that a finished turn's answer is looked for in. */
const ANSWER_LOOKUP_LIMIT = 20;

/**
 * Returns the forwarders as an object so the entry point can destructure it and keep every
 * `service.on("event", forwardX)` registration exactly as it was.
 */
export function createRendererForwarders({
  getMainWindow,
  getAgentService,
  getHostService,
  getHostAnalytics,
  getRemoteServerManager,
  showMainWindow,
  getTranslate,
  getFormat,
  desktopNotificationsEnabled,
  notificationPreviewEnabled,
}: RendererForwarderDependencies) {
  function forwardAgentEvent(serverId: string, event: AgentEvent, bufferedLive = false): void {
    if (serverId === LOCAL_SERVER_ID) getHostAnalytics()?.handleAgentEvent(event);
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(
      window,
      IPC_ENDPOINTS.agent.scopedEvent,
      bufferedLive ? { serverId, event, bufferedLive } : { serverId, event },
    );
    void notifyAgentEvent(serverId, event).catch(() => undefined);
  }

  /**
   * The notifications that wait for an answer, by request. An answer on any device withdraws its
   * notification. A request whose notification is still being built has no notification yet, and an
   * answer that arrives then removes the entry, so the notification is not shown.
   */
  const requestNotifications = new Map<string, Notification | null>();

  function withdrawResolvedNotification(serverId: string, event: AgentEvent): void {
    if (event.type !== "agent-input-resolved" && event.type !== "browser-takeover-resolved") return;
    const key = notificationRequestKey(serverId, event);
    if (!key || !requestNotifications.has(key)) return;
    const notification = requestNotifications.get(key);
    requestNotifications.delete(key);
    if (notification) closeRetainedNotification(notification);
  }

  async function notifyAgentEvent(serverId: string, event: AgentEvent): Promise<void> {
    withdrawResolvedNotification(serverId, event);
    // Most events stream while an agent works. Only these can notify, so the others skip the server list.
    if (!agentEventCanNotify(event) && event.type !== "usage-limit-reached") return;
    // Like Discord, nothing pops up while the user is looking at the app. The level is read again
    // after the lookup, with the rest, because the user can change it while the lookup runs.
    const notifyLevel = () => {
      const window = getMainWindow();
      const server = getRemoteServerManager()
        ?.list()
        .find((candidate) => candidate.id === serverId);
      if (!window || window.isDestroyed() || window.isFocused() || !server) return null;
      return desktopShowsAgentEvent(event, server, desktopNotificationsEnabled()) ? server.notificationLevel : null;
    };
    // The level also rules out an event before the remote agent lookup.
    if (!notifyLevel() || !Notification.isSupported()) return;
    const requestKey = notificationRequestKey(serverId, event);
    if (!requestKey) return showAgentNotification(serverId, event, notifyLevel, null);
    // A shown notification of the same request stays until the new one replaces it.
    if (!requestNotifications.has(requestKey)) requestNotifications.set(requestKey, null);
    try {
      await showAgentNotification(serverId, event, notifyLevel, requestKey);
    } finally {
      // Nothing was shown, or the lookup failed.
      if (requestNotifications.get(requestKey) === null) requestNotifications.delete(requestKey);
    }
  }

  async function showAgentNotification(
    serverId: string,
    event: AgentEvent,
    notifyLevel: () => ServerNotificationLevel | null,
    requestKey: string | null,
  ): Promise<void> {
    const remoteManager = getRemoteServerManager();
    const preview = notificationPreviewEnabled();
    const answer =
      preview && event.type === "turn-completed" && event.status === "completed"
        ? turnAnswer(serverId, event.agentId, event.turnId)
        : null;
    const agents =
      serverId === LOCAL_SERVER_ID
        ? (getAgentService()?.listAgents() ?? [])
        : remoteManager
          ? await runCauseEffect(remoteManager.request(serverId, TEAM_API_ROUTES.agents.all, decodeAgentSummaries))
          : [];
    const reply = answer ? await answer : null;
    const level = notifyLevel();
    const content = !level
      ? null
      : event.type === "usage-limit-reached"
        ? notificationForUsageLimit(event, agents, getTranslate(), getFormat(), level)
        : notificationForAgentEvent(
            event,
            agents,
            getTranslate(),
            level,
            // The switch is read again: the user can turn it off while the lookups run.
            preview && notificationPreviewEnabled() ? { reply, redact: redactText } : null,
          );
    // An answer from another device came in while the lookups ran.
    if (!content || (requestKey && !requestNotifications.has(requestKey))) return;
    const notification = new Notification({ title: content.title, body: content.body });
    if (requestKey) {
      // A provider can use a request id again, and a host can send a request again after a reconnect.
      // The newest notification replaces the one before it.
      const previous = requestNotifications.get(requestKey);
      if (previous) closeRetainedNotification(previous);
      requestNotifications.set(requestKey, notification);
      // A lost connection can drop the answer of a remote request, so the oldest entries go.
      for (const oldest of requestNotifications.keys()) {
        if (requestNotifications.size <= RETAINED_NOTIFICATION_LIMIT) break;
        requestNotifications.delete(oldest);
      }
      const release = () => {
        if (requestNotifications.get(requestKey) === notification) requestNotifications.delete(requestKey);
      };
      notification.on("click", release);
      notification.on("close", release);
      notification.on("failed", release);
    }
    notification.on("click", () => {
      // Re-read the window because it can change after the notification is shown.
      const current = getMainWindow();
      if (!current || current.isDestroyed()) return;
      showMainWindow(current);
      sendToRenderer(current, IPC_ENDPOINTS.notifications.opened, {
        serverId,
        agentId: content.agentId,
        threadId: content.threadId,
      });
    });
    showRetainedNotification(notification);
  }

  /** The text of a finished turn's answer, or null when it cannot be read. The notification then shows a fixed text. */
  async function turnAnswer(serverId: string, agentId: string, turnId: string): Promise<string | null> {
    const page =
      serverId === LOCAL_SERVER_ID
        ? getHostService()?.readAgentConversationPage(agentId, { type: "latest" }, ANSWER_LOOKUP_LIMIT)
        : getRemoteServerManager()?.readAgentConversationPage(
            agentId,
            { type: "latest" },
            ANSWER_LOOKUP_LIMIT,
            serverId,
          );
    if (!page) return null;
    const loaded = await runCauseEffect(page).catch(() => null);
    const answer = loaded && latestTurnAnswer(loaded.messages, turnId)?.text;
    // A routine Test run shows the no-update marker in the chat, but it is not news to show.
    return answer && !isNoUpdateAnswer(answer) ? answer : null;
  }

  function forwardBrowserDisplayState(state: BrowserDisplayState): void {
    for (const window of BrowserWindow.getAllWindows()) {
      sendToRenderer(window, IPC_ENDPOINTS.browser.displayState, state);
    }
  }

  function forwardUpdateStatus(status: import("@openbot/contracts/ipc").UpdateStatus): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.update.event, status);
  }

  function forwardUpdatePreference(preference: import("@openbot/contracts/ipc").UpdatePreference): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.update.preference, preference);
  }

  function forwardVoiceModelStatus(status: VoiceModelStatus): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.voice.modelStatus, status);
  }

  function forwardSpeechModelStatus(status: SpeechModelStatus): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.voice.speechModelStatus, status);
  }

  function forwardVoiceStreamTranscript(transcript: VoiceStreamTranscript): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.voice.streamTranscript, transcript);
  }

  function forwardProviderRuntimeStatus(snapshot: import("@openbot/contracts/ipc").ProviderRuntimeSnapshot): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.providerRuntimes.event, snapshot);
  }

  function forwardGitHubConnectorStatus(status: import("@openbot/contracts/ipc").GitHubConnectorStatus): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.githubConnector.changed, status);
  }

  function forwardOnePasswordConnectorStatus(
    status: import("@openbot/contracts/ipc").OnePasswordConnectorStatus,
  ): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.onePasswordConnector.changed, status);
  }

  function forwardBitwardenConnectorStatus(status: import("@openbot/contracts/ipc").BitwardenConnectorStatus): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.bitwardenConnector.changed, status);
  }

  function forwardHostStatus(status: import("@openbot/contracts/ipc").HostStatus): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.host.event, status);
    const remoteServers = getRemoteServerManager();
    if (remoteServers) {
      sendToRenderer(window, IPC_ENDPOINTS.servers.event, withLocalHostSummary(remoteServers.list(), status));
    }
  }

  function forwardRemoteDesktopSessions(sessions: import("@openbot/contracts/ipc").RemoteDesktopSession[]): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.remoteDesktop.event, sessions);
  }

  function forwardServers(servers: import("@openbot/contracts/ipc").ServerSummary[]): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    const host = getHostService();
    sendToRenderer(
      window,
      IPC_ENDPOINTS.servers.event,
      host ? withLocalHostSummary(servers, host.getStatus()) : servers,
    );
  }

  function forwardTeamPresence(
    serverId: string,
    snapshot: import("@openbot/contracts/ipc").TeamPresenceSnapshot,
  ): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.servers.scopedPresence, { serverId, snapshot });
  }

  function forwardDirectMessage(
    serverId: string,
    event: import("@openbot/contracts/ipc").DirectMessageRealtimeEvent,
  ): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.servers.scopedDirectMessage, { serverId, event });
  }

  function forwardDirectTyping(
    serverId: string,
    event: import("@openbot/contracts/ipc").DirectTypingRealtimeEvent,
  ): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.servers.scopedDirectTyping, { serverId, event });
  }

  return {
    forwardAgentEvent,
    forwardBrowserDisplayState,
    forwardUpdateStatus,
    forwardUpdatePreference,
    forwardVoiceModelStatus,
    forwardVoiceStreamTranscript,
    forwardSpeechModelStatus,
    forwardProviderRuntimeStatus,
    forwardGitHubConnectorStatus,
    forwardOnePasswordConnectorStatus,
    forwardBitwardenConnectorStatus,
    forwardHostStatus,
    forwardRemoteDesktopSessions,
    forwardServers,
    forwardTeamPresence,
    forwardDirectMessage,
    forwardDirectTyping,
  };
}
