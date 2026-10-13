import {
  type AgentEvent,
  type CreateAgentInput,
  isQueuedMessageReceipt,
  type SidebarLayoutSnapshot,
  type TeamRealtimeEvent,
  type UpdateAgentInput,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_ADMIN_CAPABILITY } from "@openbot/contracts/team-protocol/agent-admin-v1";
import { AGENT_HOST_SETTINGS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-host-settings-v1";
import { AGENT_PUBLISH_CAPABILITY } from "@openbot/contracts/team-protocol/agent-publish-v1";
import {
  TEAM_BROWSER_VIEW_CAPABILITY,
  TEAM_BROWSER_VIEW_CLIPBOARD_CAPABILITY,
  TEAM_BROWSER_VIEW_CONTEXT_MENU_CAPABILITY,
  TEAM_BROWSER_VIEW_CURSOR_CAPABILITY,
  TEAM_BROWSER_VIEW_FRAME_POINT_CAPABILITY,
  TEAM_BROWSER_VIEW_VIEWPORT_CAPABILITY,
} from "@openbot/contracts/team-protocol/browser-view-v1";
import { TEAM_CONVERSATION_UNREAD_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { EVENTS_CAPABILITY } from "@openbot/contracts/team-protocol/events-v1";
import { HOST_ADMIN_CAPABILITY } from "@openbot/contracts/team-protocol/host-admin-v1";
import { LIVE_ACTIVITY_PUSH_CAPABILITY } from "@openbot/contracts/team-protocol/live-activity-push-v1";
import { PUSH_NOTIFICATIONS_CAPABILITY } from "@openbot/contracts/team-protocol/push-notifications-v1";
import { SHARED_TABLES_CAPABILITY } from "@openbot/contracts/team-protocol/shared-tables-v1";
import { SKILLS_ADMIN_CAPABILITY } from "@openbot/contracts/team-protocol/skills-admin-v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { TEAM_PROTOCOL_V3 } from "@openbot/contracts/team-protocol/v3";
import { decodeTeamProtocolSupportV7Base } from "@openbot/contracts/team-protocol/v7-base";
import { sourceText } from "@openbot/i18n/source";
import {
  createRemoteAccountRefresh,
  createRemoteReadRefresh,
  createWorkspacePreferences,
  mergeRemoteUnreadIds,
  type RemoteConnectionFailure,
  type RemoteConnectionStage,
  type RemoteRecoveryStatus,
  RemoteTeamDirectoryClient,
  type RemoteTeamHost,
  type RemoteWorkspacePreferences,
  readAgentAnalytics,
  runTeamEffect,
} from "@openbot/team-client";
import { createHostedServerWake, WAKE_RECONNECT_DELAY_MS } from "@openbot/team-client/hosted-server-wake";
import type { RemoteFileUpload } from "@openbot/team-client/remote-peer";
import { reconcilePendingRequests } from "@openbot/team-client/runtime-attention";
import { updateHostIdentity } from "@openbot/team-client/team-admin-requests";
import {
  deleteAgent,
  discardAttachmentDraft,
  interruptAgentTurn,
  respondToApproval,
  respondToBrowserSecret,
  respondToBrowserTakeover,
  type TeamApiRequest,
  uploadAttachmentDraft,
} from "@openbot/team-client/team-api-requests";
import { replaceEqualDeep, useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";
import * as SecureStore from "expo-secure-store";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { View } from "react-native";
import { showFailureAlert, showWarningAlert } from "@/features/analytics/failure-reports";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { trackWorkspaceActions } from "@/features/analytics/workspace-actions";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import {
  decodeMobileBrowserTab,
  decodeMobileBrowserTabs,
  withBrowserTab,
  withoutBrowserTab,
} from "@/features/browser/model/browser-tabs";
import { BROWSER_VIEW_PAGE_SIZE } from "@/features/browser/model/browser-view-bridge";
import { useLiveActivity } from "@/features/live-activity/use-live-activity";
import { usePushNotifications } from "@/features/push-notifications/use-push-notifications";
import { fetch } from "@/features/support/model/logged-fetch";
import { supportLog } from "@/features/support/model/support-log";
import type { RemoteTeamTransportRef } from "@/features/workspace/components/remote-team-transport";
import {
  ServerConnection,
  type ServerConnectionHandle,
  type ServerLoadContext,
} from "@/features/workspace/components/server-connection";
import { createHostRequestActions, requestAgentAvatar } from "@/features/workspace/context/host-request-actions";
import { reduceAgentActivity } from "@/features/workspace/model/agent-activity";
import { canToggleAgentPin, reconcileAgentPins } from "@/features/workspace/model/agent-pins";
import { conversationMessageId, decodeConversationPage } from "@/features/workspace/model/conversation";
import { MobileConversationStore } from "@/features/workspace/model/conversation-store";
import { LiveWorkspaceStore } from "@/features/workspace/model/live-workspace-store";
import {
  dropApproval,
  InactiveRequestError,
  reducePendingApprovals,
} from "@/features/workspace/model/pending-approvals";
import { applyMobileQueueEvent } from "@/features/workspace/model/queue-cache";
import {
  decodeDefaultServer,
  decodeServerOrder,
  defaultServerKey,
  serverAccent,
  serverOrderKey,
  sortServers,
} from "@/features/workspace/model/server-order";
import { applyServerRecovery, serverKind } from "@/features/workspace/model/server-status";
import { trustedHostKeys } from "@/features/workspace/model/trusted-host-keys";
import {
  decodeAgent,
  decodeAgentSummaries,
  decodeConversationReads,
  decodeSidebarLayout,
  ignoreResponse,
  projectAgent,
  type RemoteAgent,
  updateAgentPayload,
} from "@/features/workspace/model/workspace-records";
import type {
  MobileAgent,
  MobileServer,
  MobileServerDirectoryState,
  MobileWorkspaceContextValue,
} from "@/features/workspace/model/workspace-types";
import { currentText } from "@/shared/lib/text";
import { useAppForeground } from "@/shared/lib/use-app-foreground";

export type {
  MobileAgent,
  MobileServer,
  MobileServerDirectoryState,
  MobileWorkspaceContextValue,
} from "@/features/workspace/model/workspace-types";

const NO_IDS: string[] = [];
/** The longest that the servers which are not selected wait for the selected one on a return to the app. */
const OTHER_SERVERS_RETURN_DELAY_MS = 3_000;
const EMPTY_SERVER: MobileServer = {
  id: "unavailable",
  name: "OpenBot",
  logoKey: null,
  kind: "local",
  state: "connecting",
  initialConnectionPending: true,
  connectionMessage: null,
  address: null,
  accent: serverAccent("unavailable"),
  publicKey: "",
  membershipId: "",
  role: "member",
};

const MobileWorkspaceContext = createContext<MobileWorkspaceContextValue | null>(null);

export function MobileWorkspaceProvider({ children }: PropsWithChildren) {
  const { session, sessionScope } = useMobileSession();
  const queryClient = useQueryClient();
  useEffect(() => () => queryClient.removeQueries({ queryKey: ["chat-queue"] }), [queryClient]);
  const presenceSignatures = useRef(new Map<string, string>());
  if (!session) throw new Error("MobileWorkspaceProvider requires a signed-in mobile session.");

  const directory = useMemo(
    () =>
      new RemoteTeamDirectoryClient({
        apiUrl: session.apiUrl,
        token: session.sessionToken,
        fetch,
        hostKeys: trustedHostKeys(session.apiUrl, session.user.id),
        pairedHost: session.host,
      }),
    [session.apiUrl, session.sessionToken, session.user.id, session.host],
  );
  const connections = useRef(new Map<string, ServerConnectionHandle>());
  const loadGeneration = useRef(0);
  const directoryGeneration = useRef(0);
  const foreground = useAppForeground();
  const [servers, setServers] = useState<MobileServer[]>([]);
  const [serverDirectoryState, setServerDirectoryState] = useState<MobileServerDirectoryState>("loading");
  const [serverDirectoryError, setServerDirectoryError] = useState<string | null>(null);
  const serversRef = useRef(servers);
  serversRef.current = servers;
  const [sidebarByServer, setSidebarByServer] = useState<
    Record<string, { layout: SidebarLayoutSnapshot | null; error: string | null }>
  >({});
  const applySidebarLayout = useCallback((serverId: string, layout: SidebarLayoutSnapshot) => {
    if (removedServers.current.has(serverId)) return;
    setSidebarByServer((current) => {
      const previous = current[serverId]?.layout;
      if (previous && previous.revision > layout.revision) return current;
      return { ...current, [serverId]: { layout, error: null } };
    });
  }, []);
  const [agents, setAgents] = useState<MobileAgent[]>([]);
  // Keep former agent IDs too, so leaving also removes cached chats of deleted agents.
  const serverAgentIds = useRef(new Map<string, Set<string>>());
  const removedServers = useRef(new Set<string>());
  const readRefresh = useMemo(() => createRemoteReadRefresh(), []);
  const serverCapabilities = useRef(new Map<string, string[]>());
  const orderKey = serverOrderKey(session.apiUrl, session.user.id);
  const storedServerOrder = useMemo(() => {
    try {
      return decodeServerOrder(SecureStore.getItem(orderKey));
    } catch {
      return [];
    }
  }, [orderKey]);
  const [savedServerOrder, setSavedServerOrder] = useState<{ key: string; ids: string[] } | null>(null);
  const serverOrder = savedServerOrder?.key === orderKey ? savedServerOrder.ids : storedServerOrder;
  const serverOrderRef = useRef(serverOrder);
  serverOrderRef.current = serverOrder;
  const defaultKey = defaultServerKey(session.apiUrl, session.user.id);
  const storedDefaultServer = useMemo(() => {
    try {
      return decodeDefaultServer(SecureStore.getItem(defaultKey), session.host?.hostId);
    } catch {
      return session.host?.hostId ?? null;
    }
  }, [defaultKey, session.host?.hostId]);
  const [savedDefaultServer, setSavedDefaultServer] = useState<{ key: string; id: string | null } | null>(null);
  const defaultServerId = savedDefaultServer?.key === defaultKey ? savedDefaultServer.id : storedDefaultServer;
  const defaultServerIdRef = useRef(defaultServerId);
  defaultServerIdRef.current = defaultServerId;
  const orderedServers = useMemo(
    () => sortServers(servers, serverOrder, defaultServerId),
    [servers, serverOrder, defaultServerId],
  );
  // The app opens on the first server of the list. The directory corrects a saved server that is gone.
  const [activeServerId, setActiveServerId] = useState<string | null>(() => defaultServerId ?? serverOrder[0] ?? null);
  const activeServerIdRef = useRef(activeServerId);
  activeServerIdRef.current = activeServerId;
  const conversationStore = useMemo(
    () =>
      new MobileConversationStore((flush) => {
        const frame = requestAnimationFrame(flush);
        return () => cancelAnimationFrame(frame);
      }),
    [],
  );
  useEffect(() => () => conversationStore.dispose(), [conversationStore]);
  const [liveState] = useState(() => new LiveWorkspaceStore());
  const preferenceStore = useMemo(
    () =>
      createWorkspacePreferences(session.apiUrl, session.user.id, {
        get: (key) => SecureStore.getItem(key),
        set: (key, value) =>
          SecureStore.setItem(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
      }),
    [session.apiUrl, session.user.id],
  );
  const [preferences, setPreferences] = useState<Record<string, RemoteWorkspacePreferences>>({});
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const hiddenAgentIds = (activeServerId ? preferences[activeServerId]?.hidden : null) ?? NO_IDS;
  const pinnedAgentIds = (activeServerId ? preferences[activeServerId]?.pinned : null) ?? NO_IDS;
  const readWrites = useRef(new Map<string, Promise<void>>());
  /** Applies host read state. The Live Activity also shows the message counts. */
  const applyConversationReads = useCallback(
    (reads: Record<string, { unreadCount: number }>) => {
      liveState.update("unreadAgentIds", (current) => mergeRemoteUnreadIds(current, reads));
      liveState.update("unreadCounts", (current) => ({
        ...current,
        ...Object.fromEntries(Object.entries(reads).map(([agentId, read]) => [agentId, read.unreadCount])),
      }));
    },
    [liveState],
  );

  const installHosts = useCallback(
    (hosts: RemoteTeamHost[]) => {
      const available = new Set(hosts.map((host) => host.hostId));
      const removed = serversRef.current.filter((server) => !available.has(server.id));
      const removedAgentIds = new Set<string>();
      for (const server of removed) {
        removedServers.current.add(server.id);
        readRefresh.invalidate(server.id);
        for (const id of serverAgentIds.current.get(server.id) ?? []) removedAgentIds.add(id);
        serverAgentIds.current.delete(server.id);
        presenceSignatures.current.delete(server.id);
        queryClient.removeQueries({ queryKey: ["chat-queue", server.id] });
        for (const kind of ["server-members", "server-invites", "agent-avatar", "server-logo"]) {
          queryClient.removeQueries({ queryKey: [kind, session.apiUrl, session.user.id, sessionScope, server.id] });
        }
      }
      for (const host of hosts) removedServers.current.delete(host.hostId);
      if (removed.length) {
        setSidebarByServer((current) =>
          Object.fromEntries(Object.entries(current).filter(([id]) => available.has(id))),
        );
        setAgents((current) => current.filter((agent) => available.has(agent.serverId)));
        for (const id of removedAgentIds) conversationStore.remove(id);
        liveState.update("unreadAgentIds", (current) => current.filter((id) => !removedAgentIds.has(id)));
        liveState.update("activityByServer", (current) =>
          Object.fromEntries(Object.entries(current).filter(([id]) => available.has(id))),
        );
        liveState.update("approvalRequests", (current) =>
          Object.fromEntries(Object.entries(current).filter(([id]) => available.has(id))),
        );
      }
      setServers((current) => {
        const previousServers = new Map(current.map((server) => [server.id, server]));
        return hosts.map((host) => {
          const previous = previousServers.get(host.hostId);
          return {
            id: host.hostId,
            name: host.name,
            logoKey: host.logoKey,
            kind: serverKind(host.hostId, session.host?.hostId),
            state: previous?.state ?? "unknown",
            initialConnectionPending: previous?.initialConnectionPending ?? true,
            connectionMessage: previous?.connectionMessage ?? null,
            connectionFailure: previous?.connectionFailure,
            recoveryStatus: previous?.recoveryStatus,
            address: null,
            accent: serverAccent(host.hostId),
            publicKey: previous?.publicKey ?? host.devicePublicKey,
            membershipId: host.membershipId,
            role: host.role,
            ...(host.memberLimit === undefined ? {} : { memberLimit: host.memberLimit }),
          };
        });
      });
      setActiveServerId((current) =>
        hosts.some((host) => host.hostId === current)
          ? current
          : (sortServers(
              hosts.map((host) => ({ id: host.hostId })),
              serverOrderRef.current,
              defaultServerIdRef.current,
            )[0]?.id ?? null),
      );
    },
    [
      liveState,
      session.host?.hostId,
      session.apiUrl,
      session.user.id,
      sessionScope,
      queryClient,
      readRefresh,
      conversationStore,
    ],
  );

  const directoryRefresh = useMemo(
    () =>
      createRemoteAccountRefresh(() =>
        Effect.gen(function* () {
          const generation = ++directoryGeneration.current;
          setServerDirectoryState("loading");
          setServerDirectoryError(null);
          const hosts = yield* directory.listHosts().pipe(
            Effect.tapError((error) =>
              Effect.sync(() => {
                if (generation !== directoryGeneration.current) return;
                setServerDirectoryState("error");
                const text = currentText();
                setServerDirectoryError(
                  text.errorMessage(error, text.t("mobile.workspace.error.directoryUnavailable")),
                );
              }),
            ),
          );
          if (generation !== directoryGeneration.current) return;
          installHosts(hosts);
          setServerDirectoryState("ready");
        }),
      ),
    [directory, installHosts],
  );
  const refreshHosts = useCallback(() => runTeamEffect(directoryRefresh.refresh(true)), [directoryRefresh]);
  const refreshMemberships = useCallback(() => {
    directoryGeneration.current += 1;
    directoryRefresh.invalidate();
    return runTeamEffect(directoryRefresh.refresh(true));
  }, [directoryRefresh]);

  useEffect(() => {
    return () => {
      directoryGeneration.current += 1;
      directoryRefresh.setActive(false);
    };
  }, [directoryRefresh]);

  const attachmentDownloads = useRef<Promise<void>>(Promise.resolve());
  const request = useCallback(
    async <T,>(
      method: string,
      path: string,
      decode: (value: unknown) => T,
      body?: TeamProtocolV2Json,
      serverId = activeServerIdRef.current,
      upload?: RemoteFileUpload,
      onUploadProgress?: (fraction: number) => void,
    ): Promise<T> => {
      const client = serverId ? connections.current.get(serverId)?.client : null;
      if (!client) throw new Error(currentText().t("mobile.workspace.error.transportNotReady"));
      return client.request(method, path, decode, body, upload, onUploadProgress);
    },
    [],
  );
  const loadAgentAvatar = useCallback(
    (agentId: string, avatarUrl: string, serverId: string) => requestAgentAvatar(request, agentId, avatarUrl, serverId),
    [request],
  );
  const postLiveActivityAction = useCallback(
    (serverId: string, path: string, body: TeamProtocolV2Json) => request("POST", path, ignoreResponse, body, serverId),
    [request],
  );
  const supportsLiveActivityPush = useCallback(
    (serverId: string) => serverCapabilities.current.get(serverId)?.includes(LIVE_ACTIVITY_PUSH_CAPABILITY) === true,
    [],
  );
  const applyLiveActivityEvent = useLiveActivity({
    servers,
    activeServerId,
    agents,
    liveState,
    foreground,
    post: postLiveActivityAction,
    loadAgentAvatar,
    supportsPush: supportsLiveActivityPush,
  });
  const supportsPushNotifications = useCallback(
    (serverId: string) => serverCapabilities.current.get(serverId)?.includes(PUSH_NOTIFICATIONS_CAPABILITY) === true,
    [],
  );
  usePushNotifications({
    servers,
    foreground,
    post: postLiveActivityAction,
    supportsPush: supportsPushNotifications,
  });
  /** The shared Team API requests, sent to one server. */
  const teamApi = useCallback(
    (serverId?: string, onUploadProgress?: (fraction: number) => void): TeamApiRequest =>
      (method, path, decode, body, upload) =>
        request(method, path, decode, body, serverId, upload, onUploadProgress),
    [request],
  );

  const replaceServerAgents = useCallback(
    (serverId: string, summaries: RemoteAgent[]) => {
      try {
        const saved = reconcileAgentPins(preferenceStore, serverId, summaries);
        // agents-changed arrives for each delivered message. Keep unchanged preferences and agents,
        // so the workspace context does not notify every consumer for each message.
        setPreferences((current) => {
          const next = replaceEqualDeep(current[serverId], saved);
          return next === current[serverId] ? current : { ...current, [serverId]: next };
        });
      } catch (error) {
        showFailureAlert(
          error,
          "settings",
          currentText().t("mobile.workspace.alert.preferencesTitle"),
          currentText().t("mobile.workspace.alert.preferencesBody"),
        );
      }
      const knownIds = serverAgentIds.current.get(serverId) ?? new Set<string>();
      for (const agent of summaries) knownIds.add(agent.id);
      serverAgentIds.current.set(serverId, knownIds);
      setAgents((current) => {
        const previous = new Map(
          current.filter((agent) => agent.serverId === serverId).map((agent) => [agent.id, agent]),
        );
        const next = [
          ...current.filter((agent) => agent.serverId !== serverId),
          ...summaries.map((agent) => replaceEqualDeep(previous.get(agent.id), projectAgent(serverId, agent))),
        ];
        return next.length === current.length && next.every((agent, index) => agent === current[index])
          ? current
          : next;
      });
    },
    [preferenceStore],
  );

  const loadServer = useCallback(
    async (serverId: string, publicKey: string, client: RemoteTeamTransportRef, context: ServerLoadContext) => {
      // Runtime events and snapshots own activity; workspace reads must preserve it.
      context.stage = "preferences";
      const saved = preferenceStore.read(serverId);
      setPreferences((current) => ({ ...current, [serverId]: saved }));
      context.stage = "connection";
      await client.connect(serverId, publicKey);
      if (!context.isCurrent()) return;
      context.stage = "compatibility";
      const compatibility = await client.request("GET", TEAM_API_ROUTES.compatibility, decodeTeamProtocolSupportV7Base);
      if (!context.isCurrent()) return;
      supportLog.add(
        "info",
        "connection",
        `${serverId} host OpenBot ${compatibility.appVersion}, protocol ${compatibility.protocol.minimum}-${compatibility.protocol.maximum}, capabilities: ${compatibility.capabilities.join(" ")}`,
      );
      if (compatibility.protocol.minimum > TEAM_PROTOCOL_V3 || compatibility.protocol.maximum < TEAM_PROTOCOL_V3) {
        throw new Error(sourceText("error.remote.mobileUpdateRequired"));
      }
      serverCapabilities.current.set(serverId, compatibility.capabilities);
      if (supportsBrowserView(compatibility.capabilities)) {
        // The tabs only add the browser button. A host that cannot list them still loads.
        void client
          .request("GET", TEAM_API_ROUTES.browser.tabs, decodeMobileBrowserTabs)
          .then((tabs) => {
            if (!context.isCurrent()) return;
            liveState.update("browserTabs", (current) => ({
              ...current,
              [serverId]: { tabs, activeTabId: current[serverId]?.activeTabId ?? null },
            }));
          })
          .catch(() => undefined);
      }
      // The sections, the agents and the read state do not depend on each other, so they load together.
      // The first read that fails names the stage.
      let failed = false;
      const step = <T,>(stage: RemoteConnectionStage, read: Promise<T>) =>
        read.catch((error: unknown) => {
          if (!failed) context.stage = stage;
          failed = true;
          throw error;
        });
      const sections = compatibility.capabilities.includes("sidebar-layout")
        ? client.request("GET", TEAM_API_ROUTES.sidebarLayout.state, decodeSidebarLayout).then(
            (layout) => {
              if (context.isCurrent()) applySidebarLayout(serverId, layout);
            },
            (error: unknown) => {
              if (!context.isCurrent()) return;
              const text = currentText();
              const message = text.errorMessage(error, text.t("mobile.workspace.error.sectionsLoadFailed"));
              setSidebarByServer((current) => ({
                ...current,
                [serverId]: {
                  layout: current[serverId]?.layout ?? null,
                  error: message,
                },
              }));
            },
          )
        : setSidebarByServer((current) => ({ ...current, [serverId]: { layout: null, error: null } }));
      const [summaries] = await Promise.all([
        step(
          "agents",
          client.request("GET", TEAM_API_ROUTES.agents.all, decodeAgentSummaries).then((summaries) => {
            if (context.isCurrent()) replaceServerAgents(serverId, summaries);
            return summaries;
          }),
        ),
        step(
          "reads",
          runTeamEffect(
            readRefresh.refresh(
              serverId,
              () =>
                Effect.tryPromise(() =>
                  client.request("GET", TEAM_API_ROUTES.agents.conversationReads, decodeConversationReads),
                ),
              applyConversationReads,
              () => context.isCurrent() && !removedServers.current.has(serverId),
            ),
          ),
        ),
        sections,
      ]);
      if (!context.isCurrent()) return;
      // The server is usable now, so the reconnect status does not wait for every cached chat. They
      // load again after it, the open chat first. A lost connection stops them, and the next attempt
      // loads them again; a chat that does not load here loads when it opens.
      const ordered = [...summaries].sort(
        (a, b) => Number(conversationStore.isObserved(b.id)) - Number(conversationStore.isObserved(a.id)),
      );
      void (async () => {
        for (const agent of ordered) {
          if (!context.isCurrent()) return;
          if (!conversationStore.get(agent.id)) continue;
          await conversationStore
            .loadLatest(
              agent.id,
              () =>
                client.request(
                  "GET",
                  `${TEAM_API_ROUTES.agent.conversationPage(agent.id)}?limit=50`,
                  decodeConversationPage,
                ),
              context.isCurrent,
              true,
            )
            .catch(() => undefined);
        }
      })();
      context.stage = "connection";
    },
    [
      replaceServerAgents,
      preferenceStore,
      readRefresh,
      conversationStore,
      applySidebarLayout,
      applyConversationReads,
      liveState,
    ],
  );

  const registerConnection = useCallback((hostId: string, handle: ServerConnectionHandle | null) => {
    if (handle) connections.current.set(hostId, handle);
    else connections.current.delete(hostId);
  }, []);
  const wakeHostedServer = useMemo(
    () =>
      createHostedServerWake((hostId) =>
        Effect.tryPromise((signal) =>
          fetch(new URL(`/v2/hosting/servers/${encodeURIComponent(hostId)}/wake`, session.apiUrl).toString(), {
            method: "POST",
            headers: { Authorization: `Bearer ${session.sessionToken}` },
            signal,
          }),
        ),
      ),
    [session.apiUrl, session.sessionToken],
  );
  const foregroundRef = useRef(foreground);
  foregroundRef.current = foreground;
  /**
   * Set on background entry with the selected server. Until it clears, the other servers stay
   * inactive. A new selection ends it, so the server that the user leaves keeps its attempt.
   */
  const [hold, setHold] = useState<{ serverId: string | null } | null>(null);
  const othersHeld = hold !== null && hold.serverId === activeServerId;
  const wakeReconnect = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(wakeReconnect.current), []);
  /** The account server says that the hosted server starts, so the app connects to it again soon. */
  const hostedServerStarting = useCallback((hostId: string) => {
    clearTimeout(wakeReconnect.current);
    wakeReconnect.current = setTimeout(() => connections.current.get(hostId)?.refresh(), WAKE_RECONNECT_DELAY_MS);
  }, []);
  // A hosted server that stopped for no use starts again only for use: the selected server, with the
  // app in the foreground. It connects again when the account server says that it starts.
  const wakeSelectedServer = useCallback(
    (hostId: string) => {
      if (!foregroundRef.current || hostId !== activeServerIdRef.current) return;
      void runTeamEffect(wakeHostedServer(hostId)).then((waking) => {
        if (!waking || hostId !== activeServerIdRef.current) return;
        hostedServerStarting(hostId);
      });
    },
    [wakeHostedServer, hostedServerStarting],
  );
  /** The last failed attempt of each server that asked for a wake. */
  const wakeAttempts = useRef(new Map<string, number>());
  const handleConnectionStatus = useCallback(
    (hostId: string, status: RemoteRecoveryStatus, failure: RemoteConnectionFailure | null) => {
      setServers((current) =>
        current.map((server) =>
          server.id === hostId ? applyServerRecovery(server, status, failure?.message ?? null, failure) : server,
        ),
      );
      if (status.phase === "online" && hostId === activeServerIdRef.current) setHold(null);
      // The status repeats each second while it waits, so each failed attempt asks once.
      if (status.phase === "online") wakeAttempts.current.delete(hostId);
      if (status.phase !== "waiting" && status.phase !== "cooldown") return;
      if (wakeAttempts.current.get(hostId) === status.attempt) return;
      wakeAttempts.current.set(hostId, status.attempt);
      wakeSelectedServer(hostId);
    },
    [wakeSelectedServer],
  );
  // The next retry of an offline server can be two minutes away, so a server starts when it is selected.
  useEffect(() => {
    if (!foreground || !activeServerId) return;
    if (serversRef.current.find((server) => server.id === activeServerId)?.state === "offline") {
      wakeSelectedServer(activeServerId);
    }
  }, [foreground, activeServerId, wakeSelectedServer]);

  useEffect(() => {
    if (!foreground) {
      loadGeneration.current += 1;
      conversationStore.cancelRequests();
      conversationStore.flush();
    }
    directoryRefresh.setActive(foreground);
  }, [foreground, directoryRefresh, conversationStore]);

  // On a return to the app the selected server connects first; the others follow when it is online,
  // or after a short wait. The phone then sets up the connection the user waits for alone, and the
  // tickets of the other servers reach the account service later.
  useEffect(() => {
    if (!foreground) {
      setHold({ serverId: activeServerIdRef.current });
      return;
    }
    if (!activeServerIdRef.current) {
      setHold(null);
      return;
    }
    const timer = setTimeout(() => setHold(null), OTHER_SERVERS_RETURN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [foreground]);
  // A selection made during the hold ends it, also when the user then selects the first server again.
  useEffect(() => {
    if (hold && hold.serverId !== activeServerId) setHold(null);
  }, [hold, activeServerId]);

  const loadConversation = useCallback(
    async (agentId: string, serverId = activeServerIdRef.current, refresh = false, attach = false) => {
      const generation = loadGeneration.current;
      return conversationStore.loadLatest(
        agentId,
        () =>
          request(
            "GET",
            `${TEAM_API_ROUTES.agent.conversationPage(agentId)}?limit=50`,
            decodeConversationPage,
            undefined,
            serverId,
          ),
        () => generation === loadGeneration.current && Boolean(serverId) && !removedServers.current.has(serverId ?? ""),
        refresh,
        attach,
      );
    },
    [request, conversationStore],
  );
  // A stable function: an open chat reloads its history when this changes.
  const loadLatestMessages = useCallback(
    async (agentId: string, serverId?: string) => {
      await loadConversation(agentId, serverId, true, true);
    },
    [loadConversation],
  );
  const loadConversationAround = useCallback(
    async (agentId: string, messageId: string, serverId = activeServerIdRef.current) => {
      const generation = loadGeneration.current;
      // A query parameter never reaches the JSON adapters. A host that does not know `around` sends the
      // latest page, which does not hold an older message, so the chat then opens at the latest message.
      const page = await request(
        "GET",
        `${TEAM_API_ROUTES.agent.conversationPage(agentId)}?limit=50&around=${encodeURIComponent(messageId)}`,
        decodeConversationPage,
        undefined,
        serverId,
      );
      if (page.agentId !== agentId) throw new Error("The server returned a page for another conversation.");
      const current =
        generation === loadGeneration.current && Boolean(serverId) && !removedServers.current.has(serverId ?? "");
      if (!current || !page.messages.some((message) => message.id === messageId)) return false;
      conversationStore.applyAround(page);
      return true;
    },
    [request, conversationStore],
  );
  const loadOlderMessages = useCallback(
    async (agentId: string, serverId = activeServerIdRef.current) => {
      const generation = loadGeneration.current;
      await conversationStore.loadOlder(
        agentId,
        (cursor) =>
          request(
            "GET",
            `${TEAM_API_ROUTES.agent.conversationPage(agentId)}?limit=50&before=${encodeURIComponent(cursor ?? "")}`,
            decodeConversationPage,
            undefined,
            serverId,
          ),
        () => generation === loadGeneration.current && Boolean(serverId) && !removedServers.current.has(serverId ?? ""),
      );
    },
    [request, conversationStore],
  );

  const refreshConversationReads = useCallback(
    async (serverId = activeServerIdRef.current) => {
      if (!serverId) return;
      await runTeamEffect(
        readRefresh.refresh(
          serverId,
          () =>
            Effect.tryPromise(() =>
              request("GET", TEAM_API_ROUTES.agents.conversationReads, decodeConversationReads, undefined, serverId),
            ),
          applyConversationReads,
          () => !removedServers.current.has(serverId),
        ),
      );
    },
    [request, readRefresh, applyConversationReads],
  );

  const handleTeamEvent = useCallback(
    (serverId: string, event: AgentEvent | TeamRealtimeEvent) => {
      if (removedServers.current.has(serverId)) return;
      applyLiveActivityEvent(serverId, event);
      liveState.update("approvalRequests", (current) => {
        const previous = current[serverId] ?? [];
        const next = reducePendingApprovals(previous, event);
        return next === previous ? current : { ...current, [serverId]: next };
      });
      if (event.type === "runtime-snapshot") {
        liveState.update("browserRequests", (current) => {
          const next = replaceEqualDeep(
            current[serverId],
            reconcilePendingRequests(
              current[serverId] ?? [],
              event.snapshot.pendingBrowserTakeovers,
              event.snapshot.attentionComplete,
            ),
          );
          return next === current[serverId] ? current : { ...current, [serverId]: next };
        });
      } else if (event.type === "browser-takeover-requested") {
        liveState.update("browserRequests", (current) => ({
          ...current,
          [serverId]: [
            ...(current[serverId] ?? []).filter((item) => item.requestId !== event.request.requestId),
            event.request,
          ],
        }));
      } else if (event.type === "browser-takeover-resolved") {
        liveState.update("browserRequests", (current) => ({
          ...current,
          [serverId]: (current[serverId] ?? []).filter((item) => item.requestId !== event.requestId),
        }));
      } else if (event.type === "browser-changed") {
        const tabs = decodeMobileBrowserTabs(event.tabs);
        liveState.update("browserTabs", (current) => ({
          ...current,
          [serverId]: { tabs, activeTabId: event.activeTabId },
        }));
      }
      if (event.type === "sidebar-layout-changed") {
        applySidebarLayout(serverId, event.layout);
        return;
      }
      if (event.type === "queue-changed" || event.type === "queue-invalidated") {
        void applyMobileQueueEvent(queryClient, serverId, event);
      }
      if (
        event.type === "routines-changed" ||
        event.type === "agents-changed" ||
        // A routine run ends as a turn: its slot changes from planned to its outcome.
        (event.type === "turn-completed" && event.origin === "routine")
      ) {
        void queryClient.invalidateQueries({
          queryKey: ["server-routines", session.apiUrl, session.user.id, sessionScope, serverId],
        });
        // Webhook history: a host also sends a routine change when it ignores a request.
        void queryClient.invalidateQueries({ queryKey: ["routine-webhooks", serverId] });
      }
      if (event.type === "team-presence") {
        const signature = JSON.stringify(
          event.snapshot.members.map((member) => [member.id, member.role, member.disabled, member.online]),
        );
        if (presenceSignatures.current.get(serverId) !== signature) {
          presenceSignatures.current.set(serverId, signature);
          for (const kind of ["server-members", "server-invites"]) {
            void queryClient.invalidateQueries({
              queryKey: [kind, session.apiUrl, session.user.id, sessionScope, serverId],
            });
          }
        }
        return;
      }
      if (
        event.type !== "conversation" ||
        event.snapshot.revision >= (conversationStore.get(event.snapshot.agentId)?.revision ?? 0)
      ) {
        liveState.update("activityByServer", (current) => {
          const previous = current[serverId] ?? {};
          const next = reduceAgentActivity(previous, event);
          return next === previous ? current : { ...current, [serverId]: next };
        });
      }
      if (
        event.type === "conversation" ||
        event.type === "conversation-invalidated" ||
        event.type === "turn-completed"
      ) {
        void refreshConversationReads(serverId).catch(() => undefined);
      }
      if (
        event.type === "memories-changed" ||
        event.type === "routines-changed" ||
        event.type === "skills-changed" ||
        event.type === "turn-completed"
      ) {
        void queryClient.invalidateQueries({
          queryKey: ["agent-info", session.apiUrl, session.user.id, sessionScope, serverId, event.agentId],
        });
      }
      if (event.type === "agent-session-settings-changed") {
        void queryClient.invalidateQueries({
          queryKey: ["agent-info", session.apiUrl, session.user.id, sessionScope, serverId, event.agentId],
          predicate: (query) => query.queryKey.at(-1) === "session-settings",
        });
      }
      if (event.type === "agents-changed") {
        replaceServerAgents(serverId, event.agents);
        // The admin and host settings of an agent are not in the agent summary. The host sends this event
        // when one of them changes, so an open settings page reads them again.
        void queryClient.invalidateQueries({
          queryKey: ["agent-info", session.apiUrl, session.user.id, sessionScope, serverId],
          predicate: (query) => ["admin", "host", "session-settings"].includes(String(query.queryKey.at(-1))),
        });
      } else if (event.type === "conversation") {
        const knownIds = serverAgentIds.current.get(serverId) ?? new Set<string>();
        knownIds.add(event.snapshot.agentId);
        serverAgentIds.current.set(serverId, knownIds);
        if (conversationStore.get(event.snapshot.agentId))
          void loadConversation(event.snapshot.agentId, serverId, true).catch(() => undefined);
      } else if (event.type === "conversation-delta") {
        conversationStore.enqueue(event);
      } else if (event.type === "conversation-page") {
        const readState = event.page.readState;
        if (readState) {
          readRefresh.invalidate(serverId);
          applyConversationReads({ [event.page.agentId]: readState });
        } else void refreshConversationReads(serverId).catch(() => undefined);
        if (conversationStore.get(event.page.agentId)) conversationStore.applyPage(event.page);
      } else if (event.type === "conversation-invalidated" || event.type === "turn-completed") {
        if (conversationStore.get(event.agentId))
          void loadConversation(event.agentId, serverId, true).catch(() => undefined);
      } else if (event.type === "team-identity") {
        // The host uploads its logo to the account service under its own version, so that version
        // is also the directory key that loads the image.
        setServers((current) =>
          current.map((server) =>
            server.id === serverId ? { ...server, name: event.serverName, logoKey: event.logoVersion } : server,
          ),
        );
      }
    },
    [
      liveState,
      applyLiveActivityEvent,
      applySidebarLayout,
      loadConversation,
      replaceServerAgents,
      conversationStore,
      refreshConversationReads,
      readRefresh,
      queryClient,
      session.apiUrl,
      session.user.id,
      sessionScope,
      applyConversationReads,
    ],
  );

  /**
   * Writes one agent's read cursor on `serverId` after its earlier writes. It rejects when the host refuses it.
   */
  const writeAgentRead = useCallback(
    (agentId: string, visibleMessageId?: string | null, serverId = activeServerId): Promise<void> => {
      if (!serverId) return Promise.resolve();
      const isCurrentRead = readRefresh.invalidate(serverId);
      const generation = loadGeneration.current;
      liveState.update("unreadAgentIds", (current) =>
        visibleMessageId === null ? [...new Set([...current, agentId])] : current.filter((id) => id !== agentId),
      );
      const write = (readWrites.current.get(agentId) ?? Promise.resolve())
        .then(async () => {
          if (generation !== loadGeneration.current) return;
          const cached = conversationStore.get(agentId);
          // A window around a searched message does not hold the latest message.
          const snapshot =
            visibleMessageId !== undefined
              ? null
              : cached && !cached.detached
                ? cached
                : await loadConversation(agentId, serverId);
          if (generation !== loadGeneration.current) return;
          const throughMessageId = visibleMessageId !== undefined ? visibleMessageId : snapshot?.messages.at(-1)?.id;
          if (throughMessageId === undefined) return;
          const reads = await request(
            "POST",
            visibleMessageId === null
              ? TEAM_API_ROUTES.agent.conversationUnread(agentId)
              : TEAM_API_ROUTES.agent.conversationRead(agentId),
            (value) => decodeConversationReads({ [agentId]: value }),
            visibleMessageId === null ? {} : { throughMessageId },
            serverId,
          );
          if (generation === loadGeneration.current && isCurrentRead()) {
            readRefresh.invalidate(serverId);
            applyConversationReads(reads);
          }
        })
        .catch((error: unknown) => {
          if (generation === loadGeneration.current) void refreshConversationReads(serverId).catch(() => undefined);
          throw error;
        });
      // A failed write must not stop the next write for this agent.
      const settled = write.catch(() => undefined);
      readWrites.current.set(agentId, settled);
      void settled.finally(() => {
        if (readWrites.current.get(agentId) === settled) readWrites.current.delete(agentId);
      });
      return write;
    },
    [
      liveState,
      request,
      refreshConversationReads,
      loadConversation,
      activeServerId,
      readRefresh,
      conversationStore,
      applyConversationReads,
    ],
  );

  const markAgentRead = useCallback(
    (agentId: string, visibleMessageId?: string | null, targetServerId?: string) => {
      const serverId = targetServerId ?? activeServerId;
      if (
        visibleMessageId === null &&
        (!serverId || !serverCapabilities.current.get(serverId)?.includes(TEAM_CONVERSATION_UNREAD_CAPABILITY))
      ) {
        showWarningAlert(
          "team",
          currentText().t("mobile.workspace.alert.updateRequiredTitle"),
          currentText().t("mobile.workspace.alert.updateRequiredUnread"),
        );
        return;
      }
      void writeAgentRead(agentId, visibleMessageId, serverId ?? undefined).catch((error: unknown) => {
        if (visibleMessageId === null)
          showFailureAlert(
            error,
            "settings",
            currentText().t("mobile.workspace.alert.markUnreadTitle"),
            currentText().t("mobile.workspace.alert.markUnreadBody"),
          );
      });
    },
    [activeServerId, writeAgentRead],
  );

  /** Marks every unread agent of the active server read through its newest message. */
  const markAllRead = useCallback(async () => {
    const serverId = activeServerIdRef.current;
    if (!serverId) return;
    // Only listed agents: a read of an id the host no longer knows creates that agent again.
    const listed = new Set(agents.filter((agent) => agent.serverId === serverId).map((agent) => agent.id));
    const unread = liveState.get().unreadAgentIds.filter((agentId) => listed.has(agentId));
    // A cached chat can be older than the read state, so each receipt uses the host's newest message.
    const results = await Promise.allSettled(
      unread.map(async (agentId) => {
        const page = await request(
          "GET",
          `${TEAM_API_ROUTES.agent.conversationPage(agentId)}?limit=1`,
          decodeConversationPage,
          undefined,
          serverId,
        );
        const latestId = page.messages.at(-1)?.id;
        if (latestId) await writeAgentRead(agentId, latestId, serverId);
      }),
    );
    const failure = results.find((result) => result.status === "rejected");
    if (!failure) return;
    // A later successful write discards the refresh of a refused one, so read the host state once more.
    await refreshConversationReads(serverId).catch(() => undefined);
    throw failure.reason;
  }, [agents, liveState, request, writeAgentRead, refreshConversationReads]);

  const updatePreferences = useCallback(
    (serverId: string, change: (current: RemoteWorkspacePreferences) => RemoteWorkspacePreferences) => {
      try {
        const next = change(preferenceStore.read(serverId));
        preferenceStore.write(serverId, next);
        setPreferences((current) => ({ ...current, [serverId]: next }));
        return next;
      } catch (error) {
        showFailureAlert(
          error,
          "settings",
          currentText().t("mobile.workspace.alert.preferencesTitle"),
          currentText().t("mobile.workspace.alert.preferencesBody"),
        );
        return null;
      }
    },
    [preferenceStore],
  );

  const value = useMemo<MobileWorkspaceContextValue>(() => {
    const activeServer = servers.find((server) => server.id === activeServerId) ?? EMPTY_SERVER;
    /** An owner or admin of an online host that serves `capability`. The host checks the role again. */
    const administers = (serverId: string, capability: string) => {
      const server = servers.find((candidate) => candidate.id === serverId);
      return Boolean(
        server &&
          server.state === "online" &&
          (server.role === "owner" || server.role === "admin") &&
          serverCapabilities.current.get(serverId)?.includes(capability),
      );
    };
    /** Drops a server that this account left or removed, and its local state. */
    const forgetServer = (serverId: string) => {
      removedServers.current.add(serverId);
      readRefresh.invalidate(serverId);
      directoryGeneration.current += 1;
      directoryRefresh.invalidate();
      setServerDirectoryState("ready");
      setServerDirectoryError(null);
      const removedIds = serverAgentIds.current.get(serverId) ?? new Set<string>();
      serverAgentIds.current.delete(serverId);
      if (activeServerId === serverId) {
        loadGeneration.current += 1;
        const remaining = servers.filter((candidate) => candidate.id !== serverId);
        setActiveServerId(sortServers(remaining, serverOrder, defaultServerId)[0]?.id ?? null);
      }
      setServers((current) => current.filter((candidate) => candidate.id !== serverId));
      setSidebarByServer((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== serverId)));
      setAgents((current) => current.filter((agent) => agent.serverId !== serverId));
      liveState.update("activityByServer", (current) => {
        const next = { ...current };
        delete next[serverId];
        return next;
      });
      liveState.update("approvalRequests", (current) => {
        const next = { ...current };
        delete next[serverId];
        return next;
      });
      for (const id of removedIds) conversationStore.remove(id);
      updatePreferences(serverId, () => ({ hidden: [], pinned: [] }));
      liveState.update("unreadAgentIds", (current) => current.filter((id) => !removedIds.has(id)));
    };
    const workspace: MobileWorkspaceContextValue = {
      browserViewSupport: (serverId) => {
        const capabilities = serverCapabilities.current.get(serverId) ?? [];
        const view = supportsBrowserView(capabilities);
        return {
          view,
          clipboard: view && capabilities.includes(TEAM_BROWSER_VIEW_CLIPBOARD_CAPABILITY),
          contextMenu: view && capabilities.includes(TEAM_BROWSER_VIEW_CONTEXT_MENU_CAPABILITY),
          viewport: view && capabilities.includes(TEAM_BROWSER_VIEW_VIEWPORT_CAPABILITY),
        };
      },
      openBrowserView: (serverId, tabId, listener) => {
        const client = connections.current.get(serverId)?.client;
        const capabilities = serverCapabilities.current.get(serverId) ?? [];
        if (!client || !supportsBrowserView(capabilities)) return null;
        return client.openBrowserView(
          {
            tabId,
            namesFrames: capabilities.includes(TEAM_BROWSER_VIEW_FRAME_POINT_CAPABILITY),
            cursor: capabilities.includes(TEAM_BROWSER_VIEW_CURSOR_CAPABILITY),
            clipboard: capabilities.includes(TEAM_BROWSER_VIEW_CLIPBOARD_CAPABILITY),
            contextMenu: capabilities.includes(TEAM_BROWSER_VIEW_CONTEXT_MENU_CAPABILITY),
            viewport: capabilities.includes(TEAM_BROWSER_VIEW_VIEWPORT_CAPABILITY) ? BROWSER_VIEW_PAGE_SIZE : null,
          },
          listener,
        );
      },
      controlBrowserTab: async (serverId, action) => {
        // The host also sends `browser-changed` for an open or a close. The phone does not wait for
        // it: the tab list changes at once, and is read again in case the event does not arrive.
        const readTabs = () =>
          void request("GET", TEAM_API_ROUTES.browser.tabs, decodeMobileBrowserTabs, undefined, serverId)
            .then((tabs) =>
              liveState.update("browserTabs", (current) => ({
                ...current,
                [serverId]: { tabs, activeTabId: current[serverId]?.activeTabId ?? null },
              })),
            )
            .catch(() => undefined);
        if (action.type === "open") {
          // The desktop opens a new tab for the agent in the same way. `focus` stays false: the
          // phone does not move the host's own browser to the tab.
          const opened = await request(
            "POST",
            TEAM_API_ROUTES.browser.open,
            decodeMobileBrowserTab,
            { url: action.url, ownerThreadId: action.ownerThreadId, ownerAgentId: action.ownerAgentId, focus: false },
            serverId,
          );
          liveState.update("browserTabs", (current) => ({
            ...current,
            [serverId]: withBrowserTab(current[serverId], opened),
          }));
          readTabs();
          return opened;
        }
        if (action.type === "navigate") {
          const body = { tabId: action.tabId, direction: action.direction };
          await request("POST", TEAM_API_ROUTES.browser.navigate, ignoreResponse, body, serverId);
        } else if (action.type === "reload") {
          await request("POST", TEAM_API_ROUTES.browser.reload, ignoreResponse, { tabId: action.tabId }, serverId);
        } else {
          await request("POST", TEAM_API_ROUTES.browser.close, ignoreResponse, { tabId: action.tabId }, serverId);
          liveState.update("browserTabs", (current) => ({
            ...current,
            [serverId]: withoutBrowserTab(current[serverId], action.tabId),
          }));
          readTabs();
        }
        return null;
      },
      sidebarByServer,
      mutateSidebarLayout: async (serverId, action) => {
        if (!serverCapabilities.current.get(serverId)?.includes("sidebar-layout")) {
          throw new Error(currentText().t("mobile.workspace.error.sectionsUnsupported"));
        }
        const layout = await request(
          "POST",
          TEAM_API_ROUTES.sidebarLayout.actions,
          decodeSidebarLayout,
          action,
          serverId,
        );
        applySidebarLayout(serverId, layout);
      },
      servers: orderedServers,
      reorderServers: (serverIds) => {
        try {
          SecureStore.setItem(orderKey, JSON.stringify(serverIds), {
            keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          });
          setSavedServerOrder({ key: orderKey, ids: serverIds });
          return true;
        } catch (error) {
          showFailureAlert(
            error,
            "settings",
            currentText().t("mobile.workspace.alert.serverOrderTitle"),
            currentText().t("mobile.workspace.alert.serverOrderBody"),
          );
          return false;
        }
      },
      defaultServerId,
      setDefaultServer: (serverId) => {
        const previous = servers.some((server) => server.id === defaultServerId) ? defaultServerId : null;
        const listed = orderedServers
          .filter((server) => server.id !== defaultServerId && server.id !== serverId)
          .map((server) => server.id);
        // The server that is no longer the default goes to the top of the list.
        const order = previous && previous !== serverId ? [previous, ...listed] : listed;
        try {
          SecureStore.setItem(orderKey, JSON.stringify(order), {
            keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          });
          SecureStore.setItem(defaultKey, JSON.stringify(serverId), {
            keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          });
          setSavedServerOrder({ key: orderKey, ids: order });
          setSavedDefaultServer({ key: defaultKey, id: serverId });
          return true;
        } catch (error) {
          showFailureAlert(
            error,
            "settings",
            currentText().t("mobile.workspace.alert.serverOrderTitle"),
            currentText().t("mobile.workspace.alert.serverOrderBody"),
          );
          return false;
        }
      },
      teamDirectory: directory,
      serverDirectoryState,
      serverDirectoryError,
      agents,
      activeServer,
      activeAgents: preferences[activeServer.id]
        ? agents.filter((agent) => agent.serverId === activeServer.id && !hiddenAgentIds.includes(agent.id))
        : [],
      hiddenAgents: agents.filter((agent) => agent.serverId === activeServer.id && hiddenAgentIds.includes(agent.id)),
      pinnedAgentIds,
      conversationStore,
      liveState,
      respondToApproval: async (serverId, input) => {
        const pending = liveState
          .get()
          .approvalRequests[serverId]?.some((item) => String(item.requestId) === String(input.requestId));
        if (!pending) throw new InactiveRequestError(currentText().t("mobile.workspace.error.approvalInactive"));
        if (serversRef.current.find((server) => server.id === serverId)?.state !== "online")
          throw new Error(currentText().t("mobile.workspace.error.approvalOffline"));
        try {
          await Effect.runPromise(
            respondToApproval(teamApi(serverId), input).pipe(Effect.mapError((error) => error.cause)),
          );
        } catch (error) {
          // Another device answered first, or the turn ended. The request is gone on the host too.
          if (error instanceof InactiveRequestError)
            liveState.update("approvalRequests", (current) => dropApproval(current, serverId, input.requestId));
          throw error;
        }
        // The host answered the agent. Its resolved event can arrive after this, or not at all on a
        // connection that drops now, so the card goes at once.
        liveState.update("approvalRequests", (current) => dropApproval(current, serverId, input.requestId));
      },
      respondToBrowserTakeover: (serverId, input) =>
        Effect.runPromise(
          respondToBrowserTakeover(teamApi(serverId), input).pipe(Effect.mapError((error) => error.cause)),
        ),
      respondToBrowserSecret: (serverId, input) =>
        Effect.runPromise(
          respondToBrowserSecret(teamApi(serverId), input).pipe(Effect.mapError((error) => error.cause)),
        ),
      selectServer: (id) => {
        loadGeneration.current += 1;
        conversationStore.cancelRequests();
        setActiveServerId(id);
      },
      leaveServer: async (serverId) => {
        const server = serversRef.current.find((candidate) => candidate.id === serverId);
        if (!server || server.role === "owner")
          throw new Error(currentText().t("mobile.workspace.error.leaveOwnServer"));
        await runTeamEffect(directory.leaveHost(server.id, server.membershipId));
        forgetServer(serverId);
      },
      removeServer: async (serverId) => {
        const server = serversRef.current.find((candidate) => candidate.id === serverId);
        if (server?.role !== "owner") throw new Error(currentText().t("mobile.workspace.error.removeOwnedServerOnly"));
        await runTeamEffect(directory.removeOwnedHost(server.id));
        forgetServer(serverId);
      },
      refreshServer: async (serverId) => {
        connections.current.get(serverId)?.refresh();
        await refreshHosts();
      },
      hostedServerStarting,
      canEditServerIdentity: (serverId) => administers(serverId, HOST_ADMIN_CAPABILITY),
      canSendNotifications: (serverId) =>
        servers.some((server) => server.id === serverId && server.state === "online") &&
        supportsPushNotifications(serverId),
      canManageEvents: (serverId) => administers(serverId, EVENTS_CAPABILITY),
      canManageAgentSkills: (serverId) => administers(serverId, SKILLS_ADMIN_CAPABILITY),
      canManageSharedTables: (serverId) => administers(serverId, SHARED_TABLES_CAPABILITY),
      canManageAgentAccess: (serverId) => administers(serverId, AGENT_ADMIN_CAPABILITY),
      canManageAgentHostSettings: (serverId) => administers(serverId, AGENT_HOST_SETTINGS_CAPABILITY),
      canPublishAgent: (serverId) => administers(serverId, AGENT_PUBLISH_CAPABILITY),
      updateServerIdentity: async (serverId, input) => {
        const server = serversRef.current.find((candidate) => candidate.id === serverId);
        if (!server || server.role === "member")
          throw new Error(currentText().t("mobile.server.settings.identityNotAllowed"));
        if (!serverCapabilities.current.get(serverId)?.includes(HOST_ADMIN_CAPABILITY))
          throw new Error(currentText().t("mobile.server.settings.identityUnsupported"));
        await runTeamEffect(updateHostIdentity(teamApi(serverId), input).pipe(Effect.mapError((error) => error.cause)));
        if (input.serverName !== undefined) {
          const serverName = input.serverName;
          setServers((current) =>
            current.map((candidate) => (candidate.id === serverId ? { ...candidate, name: serverName } : candidate)),
          );
        }
        // The host has written the name and logo to the account service; read the new logo key.
        // A new generation drops a directory read that started before the save, and the refresh
        // reads again after it. The change is saved, so a failed read must not report a failure.
        await refreshMemberships().catch(() => undefined);
      },
      refreshServers: async () => {
        for (const connection of connections.current.values()) connection.refresh();
        await refreshHosts();
      },
      addRemoteServer: async ({ inviteUrl }) => {
        const host = await runTeamEffect(directory.acceptInvite(inviteUrl));
        directoryGeneration.current += 1;
        directoryRefresh.invalidate();
        removedServers.current.delete(host.hostId);
        setServers((current) => [
          ...current.filter((server) => server.id !== host.hostId),
          {
            id: host.hostId,
            name: host.name,
            logoKey: host.logoKey,
            kind: "remote",
            state: "unknown",
            initialConnectionPending: true,
            connectionMessage: null,
            address: null,
            accent: serverAccent(host.hostId),
            publicKey: host.devicePublicKey,
            membershipId: host.membershipId,
            role: host.role,
            ...(host.memberLimit === undefined ? {} : { memberLimit: host.memberLimit }),
          },
        ]);
        setActiveServerId(host.hostId);
        // Membership is already committed. Directory failure must not reuse the consumed invite.
        void refreshHosts().catch(() => undefined);
        return host.hostId;
      },
      ...createHostRequestActions({
        request,
        teamApi,
        queryClient,
        queryScope: [session.apiUrl, session.user.id, sessionScope],
        capabilities: serverCapabilities.current,
        attachmentDownloads,
      }),
      loadAgentAnalytics: async (input, serverId) => {
        if (!agents.some((agent) => agent.id === input.agentId && agent.serverId === serverId))
          throw new Error(currentText().t("mobile.workspace.error.agentNotOnHost"));
        return runTeamEffect(
          readAgentAnalytics(
            (method, path, decode) => request(method, path, decode, undefined, serverId),
            serverCapabilities.current.get(serverId) ?? [],
            input,
          ).pipe(Effect.mapError((error) => error.cause)),
        );
      },
      createAgent: async (input: CreateAgentInput) => {
        const created = await request("POST", TEAM_API_ROUTES.agents.all, decodeAgent, {
          name: input.name,
          description: input.description,
          avatarSeed: input.avatarSeed,
          avatarHue: input.avatarHue,
          initialMessage: input.initialMessage,
        });
        setAgents((current) => [
          ...current.filter((agent) => agent.id !== created.id),
          projectAgent(activeServer.id, created),
        ]);
      },
      updateAgent: async (input: UpdateAgentInput, serverId = activeServerIdRef.current ?? undefined) => {
        if (!serverId || !agents.some((agent) => agent.id === input.agentId && agent.serverId === serverId))
          throw new Error(currentText().t("mobile.workspace.error.agentUnavailableOnHost"));
        const updated = await request(
          "PATCH",
          TEAM_API_ROUTES.agent.one(input.agentId),
          decodeAgent,
          updateAgentPayload(input),
          serverId,
        );
        setAgents((current) =>
          current.map((agent) =>
            agent.id === updated.id && agent.serverId === serverId ? projectAgent(serverId, updated) : agent,
          ),
        );
      },
      setAgentAvatar: async (agentId, image, serverId) => {
        if (!agents.some((agent) => agent.id === agentId && agent.serverId === serverId))
          throw new Error(currentText().t("mobile.workspace.error.agentUnavailableOnHost"));
        const updated = await request(
          image ? "PUT" : "DELETE",
          TEAM_API_ROUTES.agent.avatar(agentId),
          decodeAgent,
          undefined,
          serverId,
          image ?? undefined,
        );
        if (image && updated.avatarUrl) {
          queryClient.setQueryData(
            ["agent-avatar", session.apiUrl, session.user.id, sessionScope, serverId, agentId, updated.avatarUrl],
            `data:${image.mimeType};base64,${image.base64}`,
          );
        }
        setAgents((current) =>
          current.map((agent) =>
            agent.id === updated.id && agent.serverId === serverId ? projectAgent(serverId, updated) : agent,
          ),
        );
      },
      deleteAgent: (agentId) =>
        Effect.runPromise(deleteAgent(teamApi(), agentId).pipe(Effect.mapError((error) => error.cause))),
      interruptTurn: (agentId, turnId, serverId) =>
        Effect.runPromise(
          interruptAgentTurn(teamApi(serverId), agentId, turnId).pipe(Effect.mapError((error) => error.cause)),
        ),
      loadConversation,
      loadConversationAround,
      loadLatestMessages,
      loadOlderMessages,
      uploadAttachment: async (agentId, input, targetServerId, onProgress) => {
        const serverId = targetServerId ?? agents.find((candidate) => candidate.id === agentId)?.serverId;
        if (!serverId) throw new Error(currentText().t("mobile.workspace.error.agentUnavailable"));
        return Effect.runPromise(
          uploadAttachmentDraft(teamApi(serverId, onProgress), input).pipe(Effect.mapError((error) => error.cause)),
        );
      },
      discardAttachment: async (agentId, attachmentId, targetServerId) => {
        const serverId = targetServerId ?? agents.find((candidate) => candidate.id === agentId)?.serverId;
        if (!serverId) throw new Error(currentText().t("mobile.workspace.error.agentUnavailable"));
        await Effect.runPromise(
          discardAttachmentDraft(teamApi(serverId), attachmentId).pipe(Effect.mapError((error) => error.cause)),
        );
      },
      sendMessage: async (
        agentId,
        text,
        attachmentDraftIds = [],
        replyToMessageId = null,
        targetServerId,
        clientMessageId,
      ) => {
        const serverId = targetServerId ?? agents.find((candidate) => candidate.id === agentId)?.serverId;
        if (!serverId) throw new Error(currentText().t("mobile.workspace.error.agentUnavailable"));
        const receipt = await request(
          "POST",
          TEAM_API_ROUTES.agent.messages(agentId),
          (value) => {
            if (!isQueuedMessageReceipt(value)) throw new Error("The host returned an invalid message receipt.");
            return value;
          },
          {
            text,
            attachmentDraftIds,
            replyToMessageId,
            // The host uses this phone's zone for a routine the agent creates from the message.
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            ...(clientMessageId ? { clientMessageId } : {}),
          },
          serverId,
        );
        return conversationMessageId(receipt, agentId);
      },
      respondToPrompt: async (agentId, input) => {
        const agent = agents.find((candidate) => candidate.id === agentId);
        const snapshot = conversationStore.get(agentId);
        const message = snapshot?.messages.find(
          (item) =>
            item.turnId === snapshot.activeTurnId &&
            item.questionPrompt?.requestId === input.requestId &&
            item.questionPrompt.resolution === null,
        );
        if (
          agent?.serverId !== activeServer.id ||
          activeServer.state !== "online" ||
          !message?.questionPrompt ||
          message.questionPrompt.resolution ||
          !snapshot?.activeTurnId ||
          message.turnId !== snapshot.activeTurnId
        ) {
          throw new Error(currentText().t("mobile.workspace.error.formUnavailable"));
        }
        await request("POST", TEAM_API_ROUTES.respond.prompt, ignoreResponse, {
          requestId: input.requestId,
          answers: input.answers,
        });
        // The answer is committed even if a subsequent refresh loses connection.
        void loadConversation(agentId).catch(() => undefined);
      },
      hideAgent: (agentId) => {
        const saved = updatePreferences(activeServer.id, (current) => ({
          ...current,
          hidden: [...new Set([...current.hidden, agentId])],
          pinned: current.pinned.filter((id) => id !== agentId),
        }));
        mobileAnalytics.track("conversation_action", { action: "hide", result: saved ? "succeeded" : "failed" });
      },
      unhideAgent: (agentId) => {
        const saved = updatePreferences(activeServer.id, (current) => ({
          ...current,
          hidden: current.hidden.filter((id) => id !== agentId),
        }));
        mobileAnalytics.track("conversation_action", { action: "unhide", result: saved ? "succeeded" : "failed" });
      },
      markAgentRead,
      markAllRead,
      markAgentUnread: (agentId) => {
        markAgentRead(agentId, null);
      },
      toggleAgentPin: (agentId) => {
        if (!canToggleAgentPin(pinnedAgentIds, agentId)) return "error";
        if (pinnedAgentIds.includes(agentId)) {
          return updatePreferences(activeServer.id, (current) => ({
            ...current,
            pinned: current.pinned.filter((id) => id !== agentId),
          }))
            ? "unpinned"
            : "error";
        }
        return updatePreferences(activeServer.id, (current) => ({
          ...current,
          pinned: [...new Set([...current.pinned, agentId])],
        }))
          ? "pinned"
          : "error";
      },
    };
    return trackWorkspaceActions(workspace);
  }, [
    sidebarByServer,
    applySidebarLayout,
    activeServerId,
    agents,
    conversationStore,
    directory,
    directoryRefresh,
    hiddenAgentIds,
    loadConversation,
    loadConversationAround,
    loadLatestMessages,
    loadOlderMessages,
    markAgentRead,
    markAllRead,
    pinnedAgentIds,
    refreshHosts,
    refreshMemberships,
    readRefresh,
    hostedServerStarting,
    request,
    serverDirectoryError,
    teamApi,
    serverDirectoryState,
    servers,
    orderedServers,
    orderKey,
    defaultKey,
    defaultServerId,
    serverOrder,
    session.apiUrl,
    session.user.id,
    sessionScope,
    queryClient,
    liveState,
    preferences,
    updatePreferences,
    supportsPushNotifications,
  ]);

  return (
    <MobileWorkspaceContext.Provider value={value}>
      <View className="flex-1">
        {children}
        {servers.map((server) => (
          <ServerConnection
            key={server.id}
            hostId={server.id}
            publicKey={server.publicKey}
            active={foreground && (!othersHeld || server.id === activeServerId)}
            directory={directory}
            register={registerConnection}
            load={loadServer}
            onStatus={handleConnectionStatus}
            onMembershipChanged={refreshMemberships}
            onTeamEvent={handleTeamEvent}
          />
        ))}
      </View>
    </MobileWorkspaceContext.Provider>
  );
}

export function useMobileWorkspace(): MobileWorkspaceContextValue {
  const value = useContext(MobileWorkspaceContext);
  if (!value) throw new Error("useMobileWorkspace must be used within MobileWorkspaceProvider.");
  return value;
}

/** The host lists its tabs to a member (`browser-control`) and streams one of them (`browser-view`). */
function supportsBrowserView(capabilities: readonly string[]): boolean {
  return capabilities.includes("browser-control") && capabilities.includes(TEAM_BROWSER_VIEW_CAPABILITY);
}
