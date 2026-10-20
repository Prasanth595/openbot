import type { SidebarLayoutSnapshot } from "@openbot/contracts/ipc";
import { type Href, router, Stack } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import EllipsisVertical from "lucide-react-native/icons/ellipsis-vertical";
import Layers3 from "lucide-react-native/icons/layers";
import WifiOff from "lucide-react-native/icons/wifi-off";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { CROWD_TOP } from "@/features/agents/components/agent-crowd";
import {
  type AgentListRevealState,
  AgentListRowReveal,
  useAgentListReveal,
} from "@/features/agents/components/agent-list-reveal";
import { AgentListRow } from "@/features/agents/components/agent-list-row";
import { useAgentPinTransition } from "@/features/agents/components/agent-pin-transition";
import { AgentWaitingGroupHeader } from "@/features/agents/components/agent-wait-badge";
import { EmptyAgentsScene, type WelcomeHandOff } from "@/features/agents/components/empty-agents-scene";
import { PinnedAgentsGrid } from "@/features/agents/components/pinned-agents-grid";
import { SidebarSectionHeader } from "@/features/agents/components/sidebar-section-header";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { OnboardingFlow } from "@/features/onboarding/components/onboarding-flow";
import { useOnboardingGate } from "@/features/onboarding/model/use-onboarding-gate";
import {
  HOME_SEARCH_HEIGHT,
  HomeSearchBar,
  HomeSearchResults,
  useHomeSearch,
} from "@/features/search/components/home-search";
import { useAppDrawer } from "@/features/servers/components/app-drawer-shell";
import { ConnectionHeaderStatus } from "@/features/workspace/components/connection-header-status";
import { useWaitingAgentIds } from "@/features/workspace/components/use-agent-activity";
import { useUnreadAgentIds } from "@/features/workspace/components/use-live-workspace";
import {
  type MobileAgent,
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { showsOnline } from "@/features/workspace/model/server-status";
import {
  type MobileSidebarItem,
  mobileSidebarItems,
  mobileWaitingItems,
} from "@/features/workspace/model/sidebar-layout";
import { useAppLoadingOverlay, useScreenLoadingLabel } from "@/shared/components/app-loading-overlay";
import { LargeTitle, LargeTitleBar, useLargeTitleScroll } from "@/shared/components/large-title";
import { type MenuAction, MenuView } from "@/shared/components/menu-view";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { currentText, useText } from "@/shared/lib/text";

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const ONBOARDING_EXIT = FadeOut.duration(220).easing(EASE_OUT);
const ROW_ENTER = FadeIn.duration(180).easing(EASE_OUT).reduceMotion(ReduceMotion.System);
const LIST_REFLOW = LinearTransition.duration(240).easing(EASE_OUT).reduceMotion(ReduceMotion.System);
// A row is about 80 pt high. The list keeps a few screens of rows mounted instead of the default 21,
// so a server with many agents mounts fewer avatars, swipe handlers and menus.
const LIST_WINDOW_SIZE = 7;
const LIST_BATCH = 10;

const TransitioningChatRow = memo(function TransitioningChatRow({
  agent,
  index,
  reveal,
  collapsed,
}: {
  agent: MobileAgent;
  index: number;
  reveal: AgentListRevealState;
  collapsed: boolean;
}) {
  const { transition } = useAgentPinTransition();
  const isTarget = transition?.chatId === agent.id && transition.target === "row";

  const [initiallyExpanded] = useState(!collapsed);
  const [contentMounted, setContentMounted] = useState(!collapsed);
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);
  const height = useSharedValue(0);
  useLayoutEffect(() => {
    if (!collapsed) setContentMounted(true);
    if (measuredHeight === null) return;
    let active = true;
    const releaseContent = () => {
      if (active) setContentMounted(false);
    };
    height.set(
      withTiming(
        collapsed ? 0 : measuredHeight,
        {
          duration: 240,
          easing: EASE_OUT,
          reduceMotion: ReduceMotion.System,
        },
        (finished) => {
          if (finished && collapsed) scheduleOnRN(releaseContent);
        },
      ),
    );
    return () => {
      active = false;
      cancelAnimation(height);
    };
  }, [collapsed, height, measuredHeight]);
  const bodyStyle = useAnimatedStyle(() => ({
    height: measuredHeight === null && initiallyExpanded ? undefined : height.get(),
    overflow: "hidden",
  }));
  // Derive the fade from the same height, so a reversed toggle cannot leave
  // opacity and the accordion at different points in their transitions.
  const contentStyle = useAnimatedStyle(() => ({
    opacity:
      measuredHeight !== null && measuredHeight > 0
        ? Math.min(1, Math.max(0, height.get() / measuredHeight))
        : initiallyExpanded
          ? 1
          : 0,
  }));

  return (
    <Animated.View
      style={bodyStyle}
      pointerEvents={collapsed ? "none" : "auto"}
      accessibilityElementsHidden={collapsed}
      importantForAccessibility={collapsed ? "no-hide-descendants" : "auto"}
    >
      {contentMounted ? (
        <Animated.View
          style={[
            measuredHeight === null && initiallyExpanded
              ? undefined
              : { position: "absolute", top: 0, left: 0, right: 0 },
            contentStyle,
          ]}
          onLayout={({ nativeEvent }) => {
            const nextHeight = nativeEvent.layout.height;
            if (measuredHeight === null && initiallyExpanded) height.set(nextHeight);
            setMeasuredHeight(nextHeight);
          }}
        >
          <Animated.View collapsable={false} entering={isTarget ? ROW_ENTER : undefined}>
            <AgentListRowReveal index={index} reveal={reveal} skip={isTarget}>
              <AgentListRow agent={agent} leftInset={15} rightInset={24} />
            </AgentListRowReveal>
          </Animated.View>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
});

function listItemKey(item: MobileSidebarItem) {
  return `${item.kind}:${item.id}`;
}

function HeaderIconButton({
  accessibilityLabel,
  children,
  onPress,
}: {
  accessibilityLabel: string;
  children: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={4}
      className="size-11 items-center justify-center rounded-full"
      onPress={onPress}
    >
      {children}
    </Pressable>
  );
}

function openFromMenu(href: Href): void {
  void haptics.impact("soft");
  router.push(href);
}

export function ConnectedScreen() {
  const { t, sourceText } = useText();
  const { isLoaderPresent, isLoaderLeaving } = useAppLoadingOverlay();
  const { openDrawer } = useAppDrawer();
  const workspace = useMobileWorkspaceReader();
  const sidebarByServer = useMobileWorkspaceSelector((current) => current.sidebarByServer);
  const agents = useMobileWorkspaceSelector((current) => current.agents);
  const activeAgents = useMobileWorkspaceSelector((current) => current.activeAgents);
  const activeServer = useMobileWorkspaceSelector((current) => current.activeServer);
  const hiddenAgents = useMobileWorkspaceSelector((current) => current.hiddenAgents);
  const markAllRead = useMobileWorkspaceSelector((current) => current.markAllRead);
  const pinnedAgentIds = useMobileWorkspaceSelector((current) => current.pinnedAgentIds);
  const serverDirectoryError = useMobileWorkspaceSelector((current) => current.serverDirectoryError);
  const serverDirectoryState = useMobileWorkspaceSelector((current) => current.serverDirectoryState);
  const servers = useMobileWorkspaceSelector((current) => current.servers);
  const [collapsedByServer, setCollapsedByServer] = useState<Record<string, ReadonlySet<string>>>({});
  const collapsedSectionIds = collapsedByServer[activeServer.id];
  const [foreground, muted] = useThemeColor(["foreground", "muted"]);
  const iconColor = String(foreground);
  const mutedColor = String(muted);
  const hasSelectedServer = servers.some((server) => server.id === activeServer.id);
  const showLoader =
    (serverDirectoryState === "loading" && servers.length === 0) ||
    (hasSelectedServer && activeServer.initialConnectionPending);
  // The list starts to come in while the loader leaves, so the two overlap instead of waiting in turn.
  const listReady = !showLoader && (!isLoaderPresent || isLoaderLeaving);
  // A new account gets the first-run flow in place of the empty home. The flow shows its own
  // connection state, so the loader does not cover it.
  const onboarding = useOnboardingGate();
  const onboardingReady = onboarding.active && (!isLoaderPresent || isLoaderLeaving);
  // Skipped on its welcome, the flow fades off the empty home, which has the welcome's layout. The
  // home reads where the welcome's main action stood when it comes in; later visits do not.
  const [welcomeHandOff, setWelcomeHandOff] = useState<WelcomeHandOff | null>(null);
  useEffect(() => {
    if (welcomeHandOff) setWelcomeHandOff(null);
  }, [welcomeHandOff]);
  // The header actions belong to the list. While the loader shows they have nothing to act on, so
  // they come in with the list. The header itself stays, so its height does not change.
  const headerActions = listReady && !onboarding.active;
  // Connecting to a server continues while the user reads a chat, so the label only
  // belongs to this screen while it is the route on top.
  useScreenLoadingLabel(
    "/connected",
    showLoader && !onboarding.active
      ? t(hasSelectedServer ? "mobile.agent.home.connecting" : "mobile.agent.home.loadingServers")
      : null,
  );
  const pinnedAgents = useMemo(() => {
    const byId = new Map(activeAgents.map((agent) => [agent.id, agent]));
    return pinnedAgentIds.flatMap((agentId) => byId.get(agentId) ?? []);
  }, [activeAgents, pinnedAgentIds]);
  const hasHiddenChats = hiddenAgents.length > 0;
  const hasPins = pinnedAgents.length > 0;
  const unreadAgentIds = useUnreadAgentIds();
  const hasUnread = useMemo(() => {
    const unread = new Set(unreadAgentIds);
    return agents.some((agent) => agent.serverId === activeServer.id && unread.has(agent.id));
  }, [agents, activeServer.id, unreadAgentIds]);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const activeServerOnline = showsOnline(activeServer);
  const canMarkAllRead = hasUnread && !markingAllRead && activeServerOnline;
  const markAllChatsRead = () => {
    if (!canMarkAllRead) return;
    void haptics.impact("soft");
    setMarkingAllRead(true);
    void markAllRead()
      .catch((error: unknown) =>
        showFailureAlert(
          error,
          "settings",
          currentText().t("mobile.workspace.alert.markAllReadTitle"),
          currentText().t("mobile.workspace.alert.markAllReadBody"),
        ),
      )
      .finally(() => setMarkingAllRead(false));
  };
  const unpinnedAgents = useMemo(() => {
    const pinned = new Set(pinnedAgentIds);
    return activeAgents.filter((agent) => !pinned.has(agent.id));
  }, [activeAgents, pinnedAgentIds]);
  const sidebar = sidebarByServer[activeServer.id];
  // A waiting agent leaves its section for "Needs you". A pinned agent stays in its tile, which shows the same badge.
  const waitingAgentIds = useWaitingAgentIds();
  const items = useMemo(
    () => [
      ...mobileWaitingItems(
        sidebar?.layout ?? null,
        unpinnedAgents.filter((agent) => waitingAgentIds.has(agent.id)),
      ),
      ...mobileSidebarItems(
        sidebar?.layout ?? null,
        unpinnedAgents.filter((agent) => !waitingAgentIds.has(agent.id)),
        undefined,
        t,
      ),
    ],
    [sidebar?.layout, unpinnedAgents, waitingAgentIds, t],
  );
  const visibleSectionIds = useMemo(
    () => items.filter((item) => item.kind === "section").map((item) => item.id),
    [items],
  );
  const scroll = useLargeTitleScroll();
  const { headerHeight } = scroll;
  const insets = useSafeAreaInsets();
  const search = useHomeSearch();
  // A new server shows a new list at its top, which sends no scroll event.
  const listServerId = activeServer.id;
  useEffect(() => {
    if (listServerId) scroll.scrolled.set(0);
  }, [listServerId, scroll.scrolled]);
  // With nothing in the list, the scene replaces it. In a list, the native header and safe-area
  // insets add to a content container that already fills the screen, so iOS would scroll it.
  // Pins and a sidebar error still need the list header, so they keep the scene in the list.
  const showAgentsScene =
    hasSelectedServer &&
    activeServerOnline &&
    activeAgents.length === 0 &&
    items.length === 0 &&
    !hasPins &&
    !sidebar?.error;
  const addAgent = () => {
    void haptics.impact("soft");
    router.push("/add-agent");
  };
  const sceneShows = listReady && showAgentsScene;
  // The same condition as the connection state in the bar.
  const statusShows = hasSelectedServer && !activeServer.initialConnectionPending && !activeServerOnline;
  // The empty scene has its own main action where the field would be.
  const searchShows = listReady && hasSelectedServer && !onboarding.active && !sceneShows;
  const { open: searchOpen, closeSearch } = search;
  useEffect(() => {
    if (!searchShows && searchOpen) closeSearch();
  }, [searchShows, searchOpen, closeSearch]);
  const finishGate = onboarding.finish;
  const finishOnboarding = useCallback(
    (welcome?: WelcomeHandOff) => {
      setWelcomeHandOff(welcome ?? null);
      finishGate();
    },
    [finishGate],
  );
  const listReveal = useAgentListReveal(listReady, activeServer.id);
  // Collapse keeps stable list cells and changes their heights on the UI thread.
  // Enable cell reflow again when a host layout update moves agents or sections.
  const [collapseLayout, setCollapseLayout] = useState<SidebarLayoutSnapshot | null>(null);
  const collapsedChatIds = useMemo(() => {
    const ids = new Set<string>();
    let sectionCollapsed = false;
    for (const item of items) {
      if (item.kind === "waiting") sectionCollapsed = false;
      else if (item.kind === "section") sectionCollapsed = collapsedSectionIds?.has(item.id) ?? false;
      else if (sectionCollapsed) ids.add(item.id);
    }
    return ids;
  }, [items, collapsedSectionIds]);
  const sidebarLayout = sidebar?.layout ?? null;
  const serverId = activeServer.id;
  const toggleSection = useCallback(
    (sectionId: string) => {
      setCollapseLayout(sidebarLayout);
      setCollapsedByServer((current) => {
        const next = new Set(current[serverId]);
        if (next.has(sectionId)) next.delete(sectionId);
        else next.add(sectionId);
        return { ...current, [serverId]: next };
      });
    },
    [serverId, sidebarLayout],
  );
  // Rows are memoized, so a new message for one agent renders only that agent's row.
  const rowOffset = hasPins ? 1 : 0;
  const renderItem = useCallback(
    ({ item, index }: { item: MobileSidebarItem; index: number }) =>
      item.kind === "waiting" ? (
        <AgentListRowReveal index={index + rowOffset} reveal={listReveal}>
          <AgentWaitingGroupHeader count={item.count} />
        </AgentListRowReveal>
      ) : item.kind === "section" ? (
        <AgentListRowReveal index={index + rowOffset} reveal={listReveal}>
          <SidebarSectionHeader
            key={`${activeServer.id}:${item.id}`}
            id={item.id}
            name={item.name}
            empty={item.empty}
            visibleSectionIds={visibleSectionIds}
            collapsed={collapsedSectionIds?.has(item.id) ?? false}
            onToggle={toggleSection}
          />
        </AgentListRowReveal>
      ) : (
        <TransitioningChatRow
          agent={item.agent}
          index={index + rowOffset}
          reveal={listReveal}
          collapsed={collapsedChatIds.has(item.id)}
        />
      ),
    [activeServer.id, collapsedChatIds, collapsedSectionIds, listReveal, rowOffset, toggleSection, visibleSectionIds],
  );
  // Add actions come first, then a divider and the actions on existing chats.
  const optionsActions = useMemo<MenuAction[]>(() => {
    const chatActions: MenuAction[] = [
      ...(hasSelectedServer
        ? [
            {
              id: "mark-all-read",
              title: t("mobile.agent.home.markAllRead"),
              attributes: { disabled: !canMarkAllRead },
            },
          ]
        : []),
      ...(hasHiddenChats ? [{ id: "hidden-chats", title: t("mobile.agent.hidden.title") }] : []),
    ];
    return [
      {
        id: "add",
        title: "",
        displayInline: true,
        subactions: [
          { id: "add-agent", title: t("mobile.agent.home.addAgent") },
          ...(sidebar?.layout ? [{ id: "add-section", title: t("mobile.agent.sectionForm.newTitle") }] : []),
        ],
      },
      ...(chatActions.length > 0 ? [{ id: "chats", title: "", displayInline: true, subactions: chatActions }] : []),
    ];
  }, [hasHiddenChats, hasSelectedServer, canMarkAllRead, sidebar?.layout, t]);

  return (
    <View className="flex-1 bg-background">
      {onboarding.active ? null : sceneShows ? (
        // The scene has the insets of the welcome, so the characters stand in the same places on
        // both. Its top leaves the transparent header and its blur clear.
        <EmptyAgentsScene
          onAddAgent={addAgent}
          style={{ paddingTop: insets.top + CROWD_TOP, paddingBottom: insets.bottom + 12 }}
          afterWelcome={welcomeHandOff}
        />
      ) : listReady ? (
        <Animated.FlatList
          key={activeServer.id}
          onLayout={listReveal.onLayout}
          itemLayoutAnimation={listReveal.finished && sidebar?.layout !== collapseLayout ? LIST_REFLOW : undefined}
          skipEnteringExitingAnimations
          removeClippedSubviews={false}
          className="flex-1 bg-background"
          alwaysBounceVertical={false}
          contentContainerClassName={items.length > 0 ? undefined : "grow"}
          // Android has no content inset, so the list starts below the transparent header. The end of
          // the list scrolls clear of the search field.
          contentContainerStyle={{
            paddingTop: isAndroid ? headerHeight : 0,
            paddingBottom: insets.bottom + HOME_SEARCH_HEIGHT + 24,
          }}
          scrollEventThrottle={16}
          onScroll={scroll.onScroll}
          // Keep the native header inset even when short content cannot scroll or bounce.
          contentInsetAdjustmentBehavior="always"
          data={items}
          keyExtractor={listItemKey}
          renderItem={renderItem}
          initialNumToRender={LIST_BATCH}
          maxToRenderPerBatch={LIST_BATCH}
          windowSize={LIST_WINDOW_SIZE}
          ListHeaderComponent={
            <AgentListRowReveal index={0} reveal={listReveal}>
              {hasSelectedServer ? (
                <LargeTitle
                  scroll={scroll}
                  title={activeServer.name}
                  accessibilityLabel={t("mobile.agent.home.serverTitle", { name: activeServer.name })}
                  onPress={openDrawer}
                />
              ) : null}
              {sidebar?.error ? (
                <View className="gap-2 px-4">
                  <Typography.Paragraph className="text-danger-text">{sourceText(sidebar.error)}</Typography.Paragraph>
                  <Button
                    variant="secondary"
                    onPress={() =>
                      void workspace()
                        .refreshServer(activeServer.id)
                        .catch(() => undefined)
                    }
                  >
                    <Button.Label>{t("mobile.agent.home.retrySections")}</Button.Label>
                  </Button>
                </View>
              ) : null}
              <PinnedAgentsGrid agents={pinnedAgents} />
            </AgentListRowReveal>
          }
          ListEmptyComponent={
            serverDirectoryState === "error" && servers.length === 0 ? (
              <View className="flex-1 items-center justify-center gap-5 px-8 py-16">
                <View className="size-16 items-center justify-center rounded-3xl bg-control">
                  <WifiOff color={mutedColor} size={28} strokeWidth={1.6} />
                </View>
                <View className="items-center gap-1.5">
                  <Typography.Heading type="h4">{t("mobile.agent.home.serversFailed")}</Typography.Heading>
                  <Typography.Paragraph align="center" className="text-text-secondary">
                    {serverDirectoryError ? sourceText(serverDirectoryError) : t("mobile.agent.home.serversFailedBody")}
                  </Typography.Paragraph>
                </View>
                <Button
                  size="md"
                  variant="secondary"
                  onPress={() =>
                    void workspace()
                      .refreshServers()
                      .catch(() => undefined)
                  }
                >
                  <Button.Label>{t("common.tryAgain")}</Button.Label>
                </Button>
              </View>
            ) : servers.length === 0 ? (
              <View className="flex-1 items-center justify-center gap-5 px-8 py-16">
                <View className="size-16 items-center justify-center rounded-3xl bg-control">
                  <Layers3 color={mutedColor} size={28} strokeWidth={1.6} />
                </View>
                <View className="items-center gap-1.5">
                  <Typography.Heading type="h4">{t("mobile.agent.home.noServers")}</Typography.Heading>
                  <Typography.Paragraph align="center" className="text-text-secondary">
                    {t("mobile.agent.home.noServersBody")}
                  </Typography.Paragraph>
                </View>
                {/* The drawer holds the ways to add a server. Without this, the next step is hidden. */}
                <Button size="md" variant="secondary" onPress={openDrawer}>
                  <Button.Label>{t("mobile.agent.home.openServers")}</Button.Label>
                </Button>
              </View>
            ) : !hasSelectedServer ? (
              <View className="flex-1 items-center justify-center gap-5 px-8 py-16">
                <Typography.Heading type="h4">{t("mobile.agent.home.chooseServer")}</Typography.Heading>
                <Button size="md" variant="secondary" onPress={openDrawer}>
                  <Button.Label>{t("mobile.agent.home.openServers")}</Button.Label>
                </Button>
              </View>
            ) : activeAgents.length === 0 && !activeServerOnline ? (
              <View className="flex-1 items-center justify-center gap-5 px-8 py-16">
                <WifiOff color={mutedColor} size={28} strokeWidth={1.6} />
                <View className="items-center gap-1.5">
                  <Typography.Heading type="h4">{t("mobile.agent.home.waiting")}</Typography.Heading>
                  <Typography.Paragraph align="center" className="text-text-secondary">
                    {t("mobile.agent.home.waitingBody")}
                  </Typography.Paragraph>
                </View>
              </View>
            ) : activeAgents.length === 0 ? (
              <EmptyAgentsScene onAddAgent={addAgent} />
            ) : null
          }
        />
      ) : null}

      {searchShows ? <HomeSearchResults search={search} /> : null}

      {/* The list scrolls under the transparent header, which gets the blur of the chat header. iOS 27
          shows no native scroll edge effect here. The native top edge is hidden to avoid two effects. */}
      {onboarding.active ? null : (
        <LargeTitleBar
          scroll={scroll}
          title={activeServer.name}
          // The connection state takes the place of the title in the bar.
          hidden={!searchShows || statusShows || search.open}
        />
      )}

      {searchShows ? <HomeSearchBar search={search} /> : null}

      {onboardingReady ? (
        // The flow fades out over the home, which comes in under it with its own reveal.
        <Animated.View exiting={ONBOARDING_EXIT} style={StyleSheet.absoluteFill}>
          <OnboardingFlow onFinish={finishOnboarding} />
        </Animated.View>
      ) : null}

      <Stack.Screen
        options={{
          // The first-run flow is a whole screen with its own back and skip actions.
          headerShown: !onboarding.active,
          headerLeft:
            isAndroid && headerActions
              ? () => (
                  <View className="flex-row items-center gap-2">
                    <HeaderIconButton accessibilityLabel={t("mobile.agent.home.openServers")} onPress={openDrawer}>
                      <Layers3 color={iconColor} size={22} strokeWidth={1.8} />
                    </HeaderIconButton>
                    <ConnectionHeaderStatus server={hasSelectedServer ? activeServer : undefined} />
                  </View>
                )
              : undefined,
          headerRight:
            isAndroid && headerActions
              ? () => (
                  <View className="flex-row items-center gap-1">
                    <MenuView
                      actions={optionsActions}
                      onPressAction={(event) => {
                        if (event.nativeEvent.event === "add-section")
                          router.push({ pathname: "/section-form", params: { serverId: activeServer.id } });
                        if (event.nativeEvent.event === "add-agent") router.push("/add-agent");
                        if (event.nativeEvent.event === "hidden-chats") router.push("/hidden-chats");
                        if (event.nativeEvent.event === "mark-all-read") markAllChatsRead();
                      }}
                      style={{ height: 44, width: 44 }}
                    >
                      <View
                        accessibilityLabel={t("mobile.agent.home.chatOptions")}
                        accessibilityRole="button"
                        accessible
                        className="size-11 items-center justify-center rounded-full"
                      >
                        <EllipsisVertical color={iconColor} size={24} strokeWidth={1.9} />
                      </View>
                    </MenuView>
                  </View>
                )
              : undefined,
          headerTintColor: foreground,
          headerTransparent: true,
          scrollEdgeEffects: { top: "hidden" },
          title: "",
        }}
      />

      {isIOS && headerActions ? (
        <>
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Button icon="square.stack.3d.up.fill" onPress={openDrawer} />
            <Stack.Toolbar.View hidesSharedBackground>
              <ConnectionHeaderStatus server={hasSelectedServer ? activeServer : undefined} />
            </Stack.Toolbar.View>
          </Stack.Toolbar>
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Menu
              icon="ellipsis"
              accessibilityLabel={t("mobile.agent.home.chatOptions")}
              separateBackground
            >
              {/* Add actions come first, then a divider and the actions on existing chats. */}
              <Stack.Toolbar.Menu inline>
                <Stack.Toolbar.MenuAction icon="plus.circle" onPress={() => openFromMenu("/add-agent")}>
                  {t("mobile.agent.home.addAgent")}
                </Stack.Toolbar.MenuAction>
                {sidebar?.layout ? (
                  <Stack.Toolbar.MenuAction
                    icon="folder.badge.plus"
                    onPress={() => openFromMenu({ pathname: "/section-form", params: { serverId: activeServer.id } })}
                  >
                    {t("mobile.agent.sectionForm.newTitle")}
                  </Stack.Toolbar.MenuAction>
                ) : null}
              </Stack.Toolbar.Menu>
              {hasSelectedServer || hasHiddenChats ? (
                <Stack.Toolbar.Menu inline>
                  {hasSelectedServer ? (
                    <Stack.Toolbar.MenuAction
                      icon="envelope.open"
                      disabled={!canMarkAllRead}
                      onPress={markAllChatsRead}
                    >
                      {t("mobile.agent.home.markAllRead")}
                    </Stack.Toolbar.MenuAction>
                  ) : null}
                  {hasHiddenChats ? (
                    <Stack.Toolbar.MenuAction icon="eye.slash" onPress={() => openFromMenu("/hidden-chats")}>
                      {t("mobile.agent.hidden.title")}
                    </Stack.Toolbar.MenuAction>
                  ) : null}
                </Stack.Toolbar.Menu>
              ) : null}
            </Stack.Toolbar.Menu>
          </Stack.Toolbar>
        </>
      ) : null}
    </View>
  );
}
