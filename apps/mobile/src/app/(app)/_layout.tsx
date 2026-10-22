import { router, useGlobalSearchParams, useSegments } from "expo-router";
import { Stack } from "expo-router/stack";
import { useThemeColor } from "heroui-native/hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, TextInput } from "react-native";
import { useCSSVariable } from "uniwind";
import { AgentPinTransitionProvider } from "@/features/agents/components/agent-pin-transition";
import { ChatNavigationGateContext } from "@/features/agents/components/chat-link-pressable";
import { createChatNavigationGate } from "@/features/agents/model/chat-navigation-gate";
import { whenUnlocked } from "@/features/app-lock/model/app-lock";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { AudioWaveformHost } from "@/features/chat/components/audio-waveform-host";
import { MermaidRendererHost } from "@/features/chat/components/mermaid-renderer-host";
import { OutboxProvider } from "@/features/chat/context/outbox-context";
import { QueuedMessagesProvider } from "@/features/chat/context/queued-messages-context";
import {
  beginChatOpen,
  markChatOpen,
  readChatOpenPerformance,
  resetChatOpenPerformance,
} from "@/features/chat/model/chat-open-performance";
import { setLiveActivityNavigator } from "@/features/live-activity/model/live-activity-link";
import type { NotificationTarget } from "@/features/push-notifications/push-notifications-native.types";
import { useNotificationTaps } from "@/features/push-notifications/use-notification-taps";
import type { QuickActionTarget } from "@/features/quick-actions/model/quick-action-items";
import { setQuickActionNavigator } from "@/features/quick-actions/quick-actions-native";
import { requestHomeSearch } from "@/features/search/model/home-search-request";
import { AppDrawerShell, useAppDrawer } from "@/features/servers/components/app-drawer-shell";
import { setShareSheetOpener } from "@/features/share/model/share-sheet-opener";
import {
  MobileWorkspaceProvider,
  useMobileWorkspaceReader,
} from "@/features/workspace/context/mobile-workspace-context";
import { androidBackOptions } from "@/shared/components/android-header-button";
import { useReducedMotion } from "@/shared/lib/motion";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

/** Wait for the target channel list on a cold notification open. */
const NOTIFICATION_CHANNEL_WAIT_MS = 8_000;
declare global {
  var __OPENBOT_CHAT_NAVIGATION__:
    | (() => {
        route: "chat" | "team" | "other";
        externalTaps: number;
        foreground: boolean;
        target: string | null;
        samples: ReturnType<typeof readChatOpenPerformance>;
      })
    | undefined;
}

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

function AuthenticatedStack() {
  const segments = useSegments();
  // Reduced motion, from the device or from Settings, replaces the full-screen slide with a cross-fade.
  const pushAnimation = useReducedMotion() ? "fade" : "slide_from_right";
  const { t } = useText();
  const background = useThemeColor("background");
  const sheetBackground = String(useCSSVariable("--openbot-bg-sheet") ?? background);
  const [navigationGate] = useState(createChatNavigationGate);
  const { closeDrawer } = useAppDrawer();
  const workspace = useMobileWorkspaceReader();
  const externalTaps = useRef(0);
  useEffect(() => resetChatOpenPerformance, []);
  const {
    agentId: openAgentId,
    channelId: openChannelId,
    serverId: openServerId,
  } = useGlobalSearchParams<{
    agentId?: string;
    channelId?: string;
    serverId?: string;
  }>();
  const openServer = useRef<string | null>(null);
  openServer.current = typeof openServerId === "string" ? openServerId : null;
  const openChat = useRef<string | null>(null);
  openChat.current = segments.at(-2) === "chat" && typeof openAgentId === "string" ? openAgentId : null;
  const openChannel = useRef<string | null>(null);
  openChannel.current = segments.at(-2) === "channel" && typeof openChannelId === "string" ? openChannelId : null;
  const onChatList = useRef(false);
  onChatList.current = segments.at(-1) === "connected";
  useEffect(() => {
    if (!__DEV__) return;
    const read = () => {
      const current = workspace();
      const agent = current.agents.find((item) => item.serverId === current.activeServer.id) ?? current.agents[0];
      const route = openChat.current ? "chat" : onChatList.current ? "team" : "other";
      return {
        route,
        externalTaps: externalTaps.current,
        foreground: AppState.currentState === "active",
        target: agent
          ? `openbot://live-activity?${new URLSearchParams({ server: agent.serverId, agent: agent.id })}`
          : null,
        samples: readChatOpenPerformance(),
      } as const;
    };
    globalThis.__OPENBOT_CHAT_NAVIGATION__ = read;
    return () => {
      globalThis.__OPENBOT_CHAT_NAVIGATION__ = undefined;
    };
  }, [workspace]);
  // Native tab focus can precede the Router segment update. Retry after that update too.
  useEffect(() => {
    if (segments.at(-1) === "connected") navigationGate.focus();
  }, [navigationGate, segments]);
  /** Opens a chat, or the chat list for `null`, from a Live Activity or a notification. */
  const openFromOutside = useCallback(
    (agentId: string | null, serverId?: string) =>
      // Signed actions are still validated by their existing request handler after unlock.
      whenUnlocked(() => {
        closeDrawer();
        externalTaps.current += 1;
        const current = workspace();
        const candidates = current.agents.filter((agent) => agent.id === agentId);
        const agent = serverId
          ? candidates.find((item) => item.serverId === serverId)
          : (candidates.find((item) => item.serverId === current.activeServer.id) ??
            (candidates.length === 1 ? candidates[0] : undefined));
        const hostId = serverId ?? agent?.serverId;
        const displayedHostId =
          openServer.current ?? current.agents.find((item) => item.id === openChat.current)?.serverId;
        // Keep the open instance, including its scroll and composer state.
        if (agentId !== null && openChat.current === agentId && (!hostId || displayedHostId === hostId)) return;
        if (agentId === null) {
          if (router.canDismiss()) router.dismissAll();
          router.navigate("/connected");
          return;
        }
        if (hostId) beginChatOpen(hostId, agentId, "external");
        // No Team layout or avatar source is needed. The native stack opens the chat directly.
        const target = {
          pathname: "/chat/[agentId]" as const,
          params: { agentId, ...(hostId ? { serverId: hostId } : {}) },
        };
        if (openChat.current || openChannel.current) router.replace(target);
        else {
          if (router.canDismiss()) router.dismissAll();
          router.push(target);
        }
      }),
    [closeDrawer, workspace],
  );
  /** Opens the screen of a quick action of the app icon, on top of the main screen. */
  const openQuickAction = useCallback(
    (target: QuickActionTarget) => {
      if (target.type === "chat") {
        openFromOutside(target.agentId);
        return;
      }
      whenUnlocked(() => {
        closeDrawer();
        if (router.canDismiss()) router.dismissAll();
        if (target.type === "routines") {
          router.navigate({ pathname: "/server-routines", params: { serverId: target.serverId } });
          return;
        }
        router.navigate("/connected");
        navigationGate.request(requestHomeSearch, () => onChatList.current);
      });
    },
    [closeDrawer, navigationGate, openFromOutside],
  );
  useEffect(() => setLiveActivityNavigator(openFromOutside), [openFromOutside]);
  useEffect(() => setQuickActionNavigator(openQuickAction), [openQuickAction]);
  useEffect(() => setShareSheetOpener(() => whenUnlocked(() => router.push("/share"))), []);
  /** Channel requests open their channel; ordinary requests keep direct agent navigation. */
  const openFromNotification = useCallback(
    ({ agentId, serverId, threadId }: NotificationTarget) => {
      if (!serverId || !threadId) {
        openFromOutside(agentId, serverId ?? undefined);
        return;
      }
      void workspace()
        .channelStore.whenListed(serverId, NOTIFICATION_CHANNEL_WAIT_MS)
        .then((state) => {
          const channel = state.channels.find(
            (item) => !item.archived && item.threads?.some((thread) => thread.threadId === threadId),
          );
          if (!channel) {
            openFromOutside(agentId, serverId);
            return;
          }
          whenUnlocked(() => {
            closeDrawer();
            if (openChannel.current === channel.id && openServer.current === serverId) return;
            const target = {
              pathname: "/channel/[channelId]" as const,
              params: { channelId: channel.id, serverId },
            };
            if (openChat.current || openChannel.current) router.replace(target);
            else {
              if (router.canDismiss()) router.dismissAll();
              router.push(target);
            }
          });
        });
    },
    [workspace, openFromOutside, closeDrawer],
  );
  useNotificationTaps(openFromNotification, (serverId) => {
    const displayedHostId =
      openServer.current ?? workspace().agents.find((agent) => agent.id === openChat.current)?.serverId;
    return serverId && displayedHostId !== serverId ? null : openChat.current;
  });

  return (
    <ChatNavigationGateContext value={navigationGate}>
      <Stack
        initialRouteName="(tabs)"
        screenListeners={({ route }) =>
          route.name === "(tabs)"
            ? {
                transitionStart: () => navigationGate.start(),
                transitionEnd: () => navigationGate.finish(),
                focus: () => navigationGate.focus(),
                blur: () => navigationGate.blur(),
              }
            : {
                gestureCancel: () => navigationGate.cancel(),
                transitionEnd: (event) => {
                  if (event.data.closing || route.name !== "chat/[agentId]") return;
                  const params = route.params;
                  if (params && "agentId" in params && typeof params.agentId === "string") {
                    const agent = workspace().agents.find(
                      (item) =>
                        item.id === params.agentId && (!("serverId" in params) || item.serverId === params.serverId),
                    );
                    if (agent) markChatOpen(agent.serverId, agent.id, "navigation");
                  }
                },
              }
        }
        screenOptions={(props) => ({
          // The full screens put the back arrow in the glass circle, as the home buttons are.
          ...androidBackOptions(props, { glass: true }),
          headerBackButtonDisplayMode: "minimal",
          headerShadowVisible: false,
          headerTransparent: isIOS,
          sheetExpandsWhenScrolledToEdge: false,
          // iOS rounds a sheet by default. Android uses 0, so it gets the Material 3 sheet corner.
          ...(isAndroid && { sheetCornerRadius: 28 }),
        })}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false, animation: "fade", gestureEnabled: false }} />
        <Stack.Protected guard={__DEV__}>
          <Stack.Screen name="motion-preview" />
        </Stack.Protected>
        <Stack.Screen
          name="chat/[agentId]"
          options={{
            animation: pushAnimation,
            contentStyle: { backgroundColor: background },
            fullScreenGestureEnabled: false,
            gestureEnabled: true,
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="task/[taskId]"
          // A task is a chat of its own, so it opens as the agent's chat does.
          options={{
            animation: pushAnimation,
            contentStyle: { backgroundColor: background },
            fullScreenGestureEnabled: false,
            gestureEnabled: true,
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="code-preview/[previewId]"
          options={{
            animation: pushAnimation,
            contentStyle: { backgroundColor: background },
            // The diagram pans with one finger, so only the screen edge goes back.
            fullScreenGestureEnabled: false,
            gestureEnabled: true,
            // The screen draws the app's glass header, as the chat does.
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="browser/[agentId]"
          options={{
            animation: pushAnimation,
            contentStyle: { backgroundColor: background },
            // Every finger on the page is the page's mouse, so only the screen edge goes back.
            fullScreenGestureEnabled: false,
            gestureEnabled: true,
            // The screen draws the app's glass header over the page, as the chat does.
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="browser-help"
          // The header comes from the route's `_layout.tsx`: Android draws no header on a formSheet route.
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [0.85],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="channel/[channelId]"
          options={{
            animation: pushAnimation,
            contentStyle: { backgroundColor: background },
            fullScreenGestureEnabled: false,
            gestureEnabled: true,
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="channel-info/[channelId]"
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [0.85],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="channel-actions/[channelId]"
          // The header comes from the route's `_layout.tsx`: Android draws no header on a formSheet route.
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [0.6],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="add-channel"
          // The header comes from the route's `_layout.tsx`: Android draws no header on a formSheet route.
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [0.85],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="add-agent"
          // The header comes from the route's `_layout.tsx`: Android draws no header on a formSheet route.
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [0.85],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="agent-brain/[agentId]"
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            presentation: "formSheet",
            sheetAllowedDetents: [0.52],
            sheetCornerRadius: 34,
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="agent-info/[agentId]"
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "card",
            animation: pushAnimation,
          }}
        />
        <Stack.Screen
          name="market-install"
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            presentation: "formSheet",
            sheetAllowedDetents: [0.85],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="install-agent"
          // The header comes from the stack in `install-agent/_layout.tsx`: Android draws no header on
          // a formSheet route, so Close and Add agent would not show there.
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            // A page to read before adding: full height, as the agent search. On Android a full-height
            // sheet goes under the status bar and covers its header, so it uses the form height.
            sheetAllowedDetents: isAndroid ? [0.85] : [1],
            sheetInitialDetentIndex: "last",
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="section-form"
          // The header comes from the route's `_layout.tsx`: Android draws no header on a formSheet route.
          // Android: autoFocus focuses the name field while the sheet opens, and Android does not show
          // the keyboard then. Focusing the field again after the opening shows it.
          listeners={
            isAndroid
              ? {
                  transitionEnd: (event) => {
                    if (event.data.closing) return;
                    const input = TextInput.State.currentlyFocusedInput();
                    if (!input) return;
                    input.blur();
                    input.focus();
                  },
                }
              : undefined
          }
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [0.85],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="new-task"
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [0.85],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="add-server"
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [0.85],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="hosted-server"
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [0.85],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="hidden-chats"
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [0.85],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="deleted-chats"
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [0.85],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="server-settings"
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "card",
            animation: pushAnimation,
          }}
        />
        {/* Full screens with a big header that the screen draws: the native bar keeps only its buttons. */}
        <Stack.Screen
          name="server-routines/edit-routine"
          options={{
            animation: pushAnimation,
            contentStyle: { backgroundColor: sheetBackground },
            headerStyle: { backgroundColor: isIOS ? "transparent" : sheetBackground },
            headerBlurEffect: "none",
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            title: t("mobile.app.route.routine"),
          }}
        />
        <Stack.Screen
          name="server-routines/channel-routine"
          options={{
            animation: pushAnimation,
            contentStyle: { backgroundColor: sheetBackground },
            headerStyle: { backgroundColor: isIOS ? "transparent" : sheetBackground },
            headerBlurEffect: "none",
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            title: t("mobile.app.route.routine"),
          }}
        />
        <Stack.Screen
          name="server-routines/agent-routine"
          options={{
            headerShown: false,
            animation: pushAnimation,
            contentStyle: { backgroundColor: sheetBackground },
          }}
        />
        <Stack.Screen
          name="server-usage/index"
          options={{
            animation: pushAnimation,
            title: t("mobile.app.route.usage"),
            contentStyle: { backgroundColor: background },
          }}
        />
        <Stack.Screen
          name="share"
          // The header comes from the route's `_layout.tsx`: Android draws no header on a formSheet route.
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [0.85],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="plan-limits"
          // The header comes from the route's `_layout.tsx`: Android draws no header on a formSheet route.
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [0.85],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="queued-messages"
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [0.85],
            sheetGrabberVisible: true,
          }}
        />
      </Stack>
    </ChatNavigationGateContext>
  );
}

export default function AuthenticatedLayout() {
  const { session } = useMobileSession();
  const workspaceKey = session ? `${session.apiUrl}:${session.user.id}` : "signed-out";

  return (
    <MobileWorkspaceProvider key={workspaceKey}>
      <OutboxProvider>
        <AgentPinTransitionProvider>
          <AppDrawerShell>
            <QueuedMessagesProvider>
              <AuthenticatedStack />
              <MermaidRendererHost />
              <AudioWaveformHost />
            </QueuedMessagesProvider>
          </AppDrawerShell>
        </AgentPinTransitionProvider>
      </OutboxProvider>
    </MobileWorkspaceProvider>
  );
}
