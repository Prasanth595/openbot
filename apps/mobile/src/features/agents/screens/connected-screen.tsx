import type { ChannelSummary, SidebarLayoutSnapshot } from "@openbot/contracts/ipc";
import { BlurTargetView } from "expo-blur";
import { type Href, router } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Layers3 from "lucide-react-native/icons/layers";
import WifiOff from "lucide-react-native/icons/wifi-off";
import {
  memo,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { StyleSheet, View } from "react-native";
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
import { TeamHeader, TeamMoreIcon, TeamTitle } from "@/features/agents/components/team-home-parts";
import { TeamLeadAgent } from "@/features/agents/components/team-lead-agent";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { ChannelListRow } from "@/features/channels/components/channel-list";
import { useChannels } from "@/features/channels/components/use-channels";
import { OnboardingFlow } from "@/features/onboarding/components/onboarding-flow";
import { useOnboardingGate } from "@/features/onboarding/model/use-onboarding-gate";
import {
  HOME_SEARCH_HEIGHT,
  HomeSearchBar,
  HomeSearchList,
  HomeSearchResults,
  useHomeSearch,
} from "@/features/search/components/home-search";
import { setHomeSearchUnavailable } from "@/features/search/model/home-search-request";
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
import { type MenuAction, MenuView } from "@/shared/components/menu-view";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { currentText, useText } from "@/shared/lib/text";

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const ONBOARDING_EXIT = FadeOut.duration(220).easing(EASE_OUT);
const ROW_ENTER = FadeIn.duration(180).easing(EASE_OUT).reduceMotion(ReduceMotion.System);
const LIST_REFLOW = LinearTransition.duration(240).easing(EASE_OUT).reduceMotion(ReduceMotion.System);
// A row is about 80 pt high. The list keeps a few screens of rows mounted instead of the default 21,
// so a server with many agents mounts fewer avatars, swipe handlers and menus.
const LIST_WINDOW_SIZE = 7;
const LIST_BATCH = 10;

/** A chat row: an agent, or a channel with its server and the agents of that server. */
interface ChatRowTarget {
  agent?: MobileAgent;
  channel?: ChannelSummary;
  serverId?: string;
  channelAgents?: ReadonlyMap<string, MobileAgent>;
}

const TransitioningChatRow = memo(function TransitioningChatRow({
  agent,
  channel,
  serverId,
  channelAgents,
  index,
  reveal,
  collapsed,
}: ChatRowTarget & {
  index: number;
  reveal: AgentListRevealState;
  collapsed: boolean;
}) {
  const { transition } = useAgentPinTransition();
  const chatId = agent?.id ?? channel?.id;
  const isTarget = transition !== null && transition.chatId === chatId && transition.target === "row";

  const [initiallyExpanded] = useState(!collapsed);
  const [contentMounted, setContentMounted] = useState(!collapsed);
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);
  // An expanded row at rest lays out in the flow with no animated height. A later render then
  // cannot put back a first-render height of 0 when the animated value has not reached React.
  const [settled, setSettled] = useState(!collapsed);
  const height = useSharedValue(0);
  useLayoutEffect(() => {
    if (!collapsed) setContentMounted(true);
    else setSettled(false);
    if (measuredHeight === null) return;
    let active = true;
    const releaseContent = () => {
      if (active) setContentMounted(false);
    };
    const settle = () => {
      if (active) setSettled(true);
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
          if (!finished) return;
          scheduleOnRN(collapsed ? releaseContent : settle);
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

  const resting = !collapsed && (settled || (measuredHeight === null && initiallyExpanded));

  return (
    <Animated.View
      style={resting ? undefined : bodyStyle}
      pointerEvents={collapsed ? "none" : "auto"}
      accessibilityElementsHidden={collapsed}
      importantForAccessibility={collapsed ? "no-hide-descendants" : "auto"}
    >
      {contentMounted ? (
        <Animated.View
          style={resting ? undefined : [{ position: "absolute", top: 0, left: 0, right: 0 }, contentStyle]}
          onLayout={({ nativeEvent }) => {
            const nextHeight = nativeEvent.layout.height;
            // At rest the row takes its own height, so a collapse starts from the height it has now.
            if (resting) height.set(nextHeight);
            setMeasuredHeight(nextHeight);
          }}
        >
          <Animated.View collapsable={false} entering={isTarget ? ROW_ENTER : undefined}>
            <AgentListRowReveal index={index} reveal={reveal} skip={isTarget}>
              {agent ? (
                <AgentListRow agent={agent} leftInset={20} rightInset={20} />
              ) : channel && serverId && channelAgents ? (
                <ChannelListRow
                  channel={channel}
                  serverId={serverId}
                  agents={channelAgents}
                  leftInset={20}
                  rightInset={20}
                />
              ) : null}
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

/**
 * On Android, the content under the search field, which the field blurs: Android blurs only the
 * content of a `BlurTargetView`. iOS blurs with its glass and needs no target.
 */
function SearchBlurTarget({ target, children }: { target: RefObject<View | null>; children: ReactNode }) {
  if (!isAndroid) return children;
  return (
    <BlurTargetView ref={target} style={{ flex: 1 }}>
      <View className="flex-1 bg-team-canvas">{children}</View>
    </BlurTargetView>
  );
}

function openFromMenu(href: Href): void {
  void haptics.impact("soft");
  if (href === "/settings") router.navigate(href);
  else router.push(href);
}

export function ConnectedScreen() {
  const { t, sourceText } = useText();
  const { isLoaderPresent } = useAppLoadingOverlay();
  const { openDrawer } = useAppDrawer();
  const workspace = useMobileWorkspaceReader();
  const sidebarByServer = useMobileWorkspaceSelector((current) => current.sidebarByServer);
  const agents = useMobileWorkspaceSelector((current) => current.agents);
  const activeAgents = useMobileWorkspaceSelector((current) => current.activeAgents);
  const activeServer = useMobileWorkspaceSelector((current) => current.activeServer);
  const hiddenAgents = useMobileWorkspaceSelector((current) => current.hiddenAgents);
  const markAllRead = useMobileWorkspaceSelector((current) => current.markAllRead);
  const pinnedAgentIds = useMobileWorkspaceSelector((current) => current.pinnedAgentIds);
  const pinnedChannelIds = useMobileWorkspaceSelector((current) => current.pinnedChannelIds);
  const hiddenChannelIds = useMobileWorkspaceSelector((current) => current.hiddenChannelIds);
  const serverDirectoryError = useMobileWorkspaceSelector((current) => current.serverDirectoryError);
  const serverDirectoryState = useMobileWorkspaceSelector((current) => current.serverDirectoryState);
  const servers = useMobileWorkspaceSelector((current) => current.servers);
  const [collapsedByServer, setCollapsedByServer] = useState<Record<string, ReadonlySet<string>>>({});
  const collapsedSectionIds = collapsedByServer[activeServer.id];
  const channels = useChannels(activeServer.id);
  const channelAgents = useMemo(
    () => new Map(agents.filter((agent) => agent.serverId === activeServer.id).map((agent) => [agent.id, agent])),
    [agents, activeServer.id],
  );
  const muted = useThemeColor("muted");
  const searchBlurTarget = useRef<View>(null);
  const mutedColor = String(muted);
  const hasSelectedServer = servers.some((server) => server.id === activeServer.id);
  const showLoader =
    (serverDirectoryState === "loading" && servers.length === 0) ||
    (hasSelectedServer && activeServer.initialConnectionPending);
  // The list comes in as the loader starts to roll up, so the two overlap instead of waiting in turn.
  const listReady = !showLoader && !isLoaderPresent;
  // A new account gets the first-run flow in place of the empty home. The flow shows its own
  // connection state, so the loader does not cover it.
  const onboarding = useOnboardingGate();
  const onboardingReady = onboarding.active && !isLoaderPresent;
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
  // A deleted channel is archived on the host; the list and the pins leave it out.
  const openChannels = useMemo(
    () => channels.channels.filter((channel) => !channel.archived && !hiddenChannelIds.includes(channel.id)),
    [channels.channels, hiddenChannelIds],
  );
  const pinnedChannels = useMemo(
    () => openChannels.filter((channel) => pinnedChannelIds.includes(channel.id)),
    [openChannels, pinnedChannelIds],
  );
  const hasHiddenChats =
    hiddenAgents.length > 0 ||
    channels.channels.some((channel) => !channel.archived && hiddenChannelIds.includes(channel.id));
  const hasPins = pinnedAgents.length + pinnedChannels.length > 0;
  // As Hidden chats, the menu offers Deleted channels only when the server has one to restore or read.
  const hasDeletedChannels = channels.supported && channels.channels.some((channel) => channel.archived);
  const unreadAgentIds = useUnreadAgentIds();
  const hasUnread = useMemo(() => {
    const unread = new Set(unreadAgentIds);
    return (
      channels.channels.some((channel) => channel.unreadCount > 0) ||
      agents.some((agent) => agent.serverId === activeServer.id && unread.has(agent.id))
    );
  }, [agents, activeServer.id, unreadAgentIds, channels.channels]);
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
  const sidebar = sidebarByServer[activeServer.id];
  const leadAgent = useMemo(
    () =>
      pinnedAgents[0] ??
      mobileSidebarItems(sidebar?.layout ?? null, activeAgents, [], undefined, t).find((item) => item.kind === "agent")
        ?.agent,
    [pinnedAgents, sidebar?.layout, activeAgents, t],
  );
  const unpinnedAgents = useMemo(() => {
    const pinned = new Set(pinnedAgentIds);
    return activeAgents.filter((agent) => !pinned.has(agent.id) || agent.id === leadAgent?.id);
  }, [activeAgents, pinnedAgentIds, leadAgent?.id]);
  // A waiting agent leaves its section for "Needs you". A pinned agent stays in its tile, which shows the same badge.
  const waitingAgentIds = useWaitingAgentIds();
  const items = useMemo(
    () =>
      [
        ...mobileWaitingItems(
          sidebar?.layout ?? null,
          unpinnedAgents.filter((agent) => waitingAgentIds.has(agent.id) && agent.id !== leadAgent?.id),
        ),
        ...mobileSidebarItems(
          sidebar?.layout ?? null,
          unpinnedAgents.filter((agent) => !waitingAgentIds.has(agent.id) || agent.id === leadAgent?.id),
          openChannels.filter((channel) => !pinnedChannelIds.includes(channel.id)),
          undefined,
          t,
        ),
      ].filter((item) => item.kind !== "agent" || item.id !== leadAgent?.id),
    [sidebar?.layout, unpinnedAgents, waitingAgentIds, openChannels, pinnedChannelIds, t, leadAgent?.id],
  );
  const visibleSectionIds = useMemo(
    () => items.filter((item) => item.kind === "section").map((item) => item.id),
    [items],
  );
  const insets = useSafeAreaInsets();
  const search = useHomeSearch();
  // Search has no bar: the list and the results move up by the bar's height as it opens.
  const searchBarOffset = 0;
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
  // The empty scene has its own main action where the field would be.
  const searchShows = listReady && hasSelectedServer && !onboarding.active && !sceneShows;
  const { open: searchOpen, closeSearch } = search;
  useEffect(() => {
    if (!searchShows && searchOpen) closeSearch();
  }, [searchShows, searchOpen, closeSearch]);
  // A quick action waits while the list loads. A ready home without the field drops it. When home
  // leaves, a request waits again for the next home.
  useEffect(() => {
    setHomeSearchUnavailable(listReady && !searchShows);
    return () => setHomeSearchUnavailable(false);
  }, [listReady, searchShows]);
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
  const leadSectionId = leadAgent ? (sidebar?.layout?.agentAssignments[leadAgent.id] ?? "unassigned") : null;
  const sectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    let section = "";
    for (const item of items) {
      if (item.kind === "section" || item.kind === "waiting") section = item.id;
      else counts.set(section, (counts.get(section) ?? 0) + 1);
    }
    return counts;
  }, [items]);
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
            count={sectionCounts.get(item.id) ?? 0}
            hasLead={leadSectionId === item.id}
            separated={index > 0}
            visibleSectionIds={visibleSectionIds}
            collapsed={collapsedSectionIds?.has(item.id) ?? false}
            onToggle={toggleSection}
          />
        </AgentListRowReveal>
      ) : item.kind === "channel" ? (
        <TransitioningChatRow
          channel={item.channel}
          serverId={activeServer.id}
          channelAgents={channelAgents}
          index={index + rowOffset}
          reveal={listReveal}
          collapsed={collapsedChatIds.has(item.id)}
        />
      ) : (
        <TransitioningChatRow
          agent={item.agent}
          index={index + rowOffset}
          reveal={listReveal}
          collapsed={collapsedChatIds.has(item.id)}
        />
      ),
    [
      activeServer.id,
      channelAgents,
      collapsedChatIds,
      collapsedSectionIds,
      listReveal,
      rowOffset,
      toggleSection,
      visibleSectionIds,
      sectionCounts,
      leadSectionId,
    ],
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
      ...(hasDeletedChannels ? [{ id: "deleted-chats", title: t("mobile.app.route.deletedChannels") }] : []),
    ];
    return [
      {
        id: "add",
        title: "",
        displayInline: true,
        subactions: [
          { id: "add-agent", title: t("mobile.agent.home.addAgent") },
          ...(sidebar?.layout ? [{ id: "add-section", title: t("mobile.agent.sectionForm.newTitle") }] : []),
          ...(channels.supported ? [{ id: "add-channel", title: t("mobile.agent.home.newChannel") }] : []),
        ],
      },
      ...(chatActions.length > 0 ? [{ id: "chats", title: "", displayInline: true, subactions: chatActions }] : []),
      { id: "settings", title: t("mobile.agent.team.tabSettings") },
    ];
  }, [hasHiddenChats, hasDeletedChannels, hasSelectedServer, canMarkAllRead, channels.supported, sidebar?.layout, t]);

  return (
    <View className="flex-1 bg-team-canvas">
      {headerActions && !search.mounted ? (
        <TeamHeader
          name={activeServer.name}
          onWorkspace={openDrawer}
          onSearch={() => {
            search.openSearch();
            search.input.current?.focus();
          }}
          options={
            <MenuView
              actions={optionsActions}
              onPressAction={({ nativeEvent }) => {
                if (nativeEvent.event === "add-section")
                  openFromMenu({ pathname: "/section-form", params: { serverId: activeServer.id } });
                if (nativeEvent.event === "add-agent") openFromMenu("/add-agent");
                if (nativeEvent.event === "add-channel")
                  openFromMenu({ pathname: "/add-channel", params: { serverId: activeServer.id } });
                if (nativeEvent.event === "settings") openFromMenu("/settings");
                if (nativeEvent.event === "hidden-chats") openFromMenu("/hidden-chats");
                if (nativeEvent.event === "deleted-chats")
                  openFromMenu({ pathname: "/deleted-chats", params: { serverId: activeServer.id } });
                if (nativeEvent.event === "mark-all-read") markAllChatsRead();
              }}
            >
              <View
                accessible
                accessibilityRole="button"
                accessibilityLabel={t("mobile.agent.home.chatOptions")}
                style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
              >
                <TeamMoreIcon />
              </View>
            </MenuView>
          }
        />
      ) : null}
      {headerActions && hasSelectedServer && !activeServer.initialConnectionPending && !activeServerOnline ? (
        <View style={{ paddingHorizontal: 20 }}>
          <ConnectionHeaderStatus server={activeServer} />
        </View>
      ) : null}
      <SearchBlurTarget target={searchBlurTarget}>
        <HomeSearchList search={search} barHeight={searchBarOffset}>
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
              onContentSizeChange={listReveal.onLayout}
              itemLayoutAnimation={listReveal.finished && sidebar?.layout !== collapseLayout ? LIST_REFLOW : undefined}
              skipEnteringExitingAnimations
              removeClippedSubviews={false}
              className="flex-1 bg-team-canvas"
              alwaysBounceVertical={false}
              contentContainerClassName={items.length > 0 ? undefined : "grow"}
              // Android has no content inset, so the list starts below the transparent header. The end of
              // the list scrolls clear of the search field.
              contentContainerStyle={{
                paddingTop: 0,
                paddingBottom: HOME_SEARCH_HEIGHT + 24,
              }}
              scrollEventThrottle={16}
              // Keep the native header inset even when short content cannot scroll or bounce.
              contentInsetAdjustmentBehavior="never"
              data={items}
              keyExtractor={listItemKey}
              renderItem={renderItem}
              initialNumToRender={LIST_BATCH}
              maxToRenderPerBatch={LIST_BATCH}
              windowSize={LIST_WINDOW_SIZE}
              ListHeaderComponent={
                <AgentListRowReveal index={0} reveal={listReveal}>
                  {hasSelectedServer ? (
                    <>
                      <TeamTitle agents={activeAgents.length} groups={visibleSectionIds.length} />
                      {leadAgent ? <TeamLeadAgent agent={leadAgent} total={activeAgents.length} /> : null}
                    </>
                  ) : null}
                  {sidebar?.error ? (
                    <View className="gap-2 px-4">
                      <Typography.Paragraph className="text-danger-text">
                        {sourceText(sidebar.error)}
                      </Typography.Paragraph>
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
                  <PinnedAgentsGrid agents={pinnedAgents.filter((agent) => agent.id !== leadAgent?.id)}>
                    {pinnedChannels.length > 0
                      ? pinnedChannels.map((channel) => (
                          <ChannelListRow
                            key={channel.id}
                            channel={channel}
                            serverId={activeServer.id}
                            agents={channelAgents}
                            pinned
                          />
                        ))
                      : null}
                  </PinnedAgentsGrid>
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
                        {serverDirectoryError
                          ? sourceText(serverDirectoryError)
                          : t("mobile.agent.home.serversFailedBody")}
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
                ) : activeAgents.length === 0 && openChannels.length === 0 && !activeServerOnline ? (
                  <View className="flex-1 items-center justify-center gap-5 px-8 py-16">
                    <WifiOff color={mutedColor} size={28} strokeWidth={1.6} />
                    <View className="items-center gap-1.5">
                      <Typography.Heading type="h4">{t("mobile.agent.home.waiting")}</Typography.Heading>
                      <Typography.Paragraph align="center" className="text-text-secondary">
                        {t("mobile.agent.home.waitingBody")}
                      </Typography.Paragraph>
                    </View>
                  </View>
                ) : activeAgents.length === 0 && openChannels.length === 0 ? (
                  <EmptyAgentsScene onAddAgent={addAgent} />
                ) : null
              }
            />
          ) : null}
        </HomeSearchList>
      </SearchBlurTarget>

      {/* The results lie over the bar's edge, so its blur cannot soften them; they have their own. */}
      {searchShows ? <HomeSearchResults search={search} barHeight={searchBarOffset} /> : null}

      {searchShows ? (
        <View
          pointerEvents={search.mounted ? "box-none" : "none"}
          style={[StyleSheet.absoluteFill, { opacity: search.mounted ? 1 : 0 }]}
        >
          <HomeSearchBar search={search} blurTarget={searchBlurTarget} />
        </View>
      ) : null}

      {onboardingReady ? (
        // The flow fades out over the home, which comes in under it with its own reveal.
        <Animated.View exiting={ONBOARDING_EXIT} style={StyleSheet.absoluteFill}>
          <OnboardingFlow onFinish={finishOnboarding} />
        </Animated.View>
      ) : null}
    </View>
  );
}
