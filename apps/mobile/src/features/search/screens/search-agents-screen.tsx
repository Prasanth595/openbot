import { type MenuAction, MenuView } from "@expo/ui/community/menu";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { ListFilter, Search } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import { KeyboardController } from "react-native-keyboard-controller";
import Animated, { LayoutAnimationConfig } from "react-native-reanimated";

import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { MobileSearchResultRow } from "@/features/search/components/search-result-row";
import { MobileSearchTextInput } from "@/features/search/components/search-text-input";
import type { MobileSearchTextInputHandle } from "@/features/search/components/search-text-input.types";
import {
  MOBILE_SEARCH_FILTERS,
  type MobileSearchFilter,
  type MobileSearchSetting,
  mobileSearchSources,
  mobileSearchView,
  normalizeMobileSearchQuery,
} from "@/features/search/model/mobile-search";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { BlurEnter, BlurSwap, swapItemMotion } from "@/shared/components/blur-swap";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { haptics } from "@/shared/lib/haptics";
import { useTransitionMode } from "@/shared/lib/motion";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

const FILTER_LABEL = {
  all: "mobile.search.filter.all",
  agents: "mobile.search.filter.agents",
  messages: "mobile.search.filter.messages",
  files: "mobile.search.filter.files",
  routines: "mobile.search.filter.routines",
  settings: "mobile.search.filter.settings",
} as const satisfies Record<MobileSearchFilter, MobileTextKey>;

// iOS draws these in the filter menu. Android menus show no SF Symbols.
const FILTER_SYMBOL = {
  all: "square.grid.2x2",
  agents: "person.2",
  messages: "bubble.left.and.bubble.right",
  files: "doc",
  routines: "calendar",
  settings: "gearshape",
} as const;

// "Searching…" waits this long, so an answer that comes sooner never shows it.
const SEARCHING_DELAY = 200;
const CONTROL_SIZE = 48;

/**
 * Keeps the results of the previous host search while the next one loads, when the user is still
 * typing the same words on the same server. A new word starts with no results, not with old ones.
 */
function continuesSearch(previous: readonly unknown[] | undefined, next: readonly unknown[]): boolean {
  if (!previous || previous.length !== next.length || previous.slice(0, -1).some((part, index) => part !== next[index]))
    return false;
  const before = String(previous.at(-1));
  const now = String(next.at(-1));
  return now.startsWith(before) || before.startsWith(now);
}

export function SearchAgentsScreen() {
  const { t } = useText();
  const { activeAgents, activeServer, searchMessages, canSearchFiles, searchFiles, loadRoutineCalendar } =
    useMobileWorkspace();
  const { session, sessionScope } = useMobileSession();
  const serverId = activeServer.id;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MobileSearchFilter>("all");
  const [muted, fieldBackground] = useThemeColor(["muted", "default"]);
  const liquidGlassAvailable = isLiquidGlassAvailable();
  const motion = useTransitionMode("searchTransitions");
  const input = useRef<MobileSearchTextInputHandle>(null);
  // A result closes the search. On Android a closing sheet can give the focused field the keyboard
  // again, so the field gives up its focus and stops taking focus first.
  const [leaving, setLeaving] = useState(false);
  const leave = useCallback(() => {
    setLeaving(true);
    input.current?.blur();
    void KeyboardController.dismiss();
  }, []);
  const filesSupported = canSearchFiles(serverId);
  // As on desktop, a server without file search shows no filter for it.
  const filters = MOBILE_SEARCH_FILTERS.filter((candidate) => candidate !== "files" || filesSupported);
  // The pages of the Settings sheet and of the server sheets. They are not the desktop settings.
  const settings = useMemo(() => {
    const app = t("mobile.app.route.settings");
    const server = activeServer.name;
    const pages: MobileSearchSetting[] = [
      { id: "profile", title: t("mobile.app.route.profile"), detail: app },
      { id: "sessions", title: t("mobile.app.route.accountSessions"), detail: app },
      { id: "appearance", title: t("mobile.settings.appearance.title"), detail: app },
      { id: "animations", title: t("mobile.settings.animations.title"), detail: app },
      { id: "language", title: t("mobile.settings.language.title"), detail: app },
      { id: "haptics", title: t("mobile.settings.feedback.haptics"), detail: app },
    ];
    if (isIOS)
      pages.push(
        { id: "notifications", title: t("mobile.settings.notifications.title"), detail: app },
        { id: "liveActivities", title: t("mobile.settings.liveActivities.title"), detail: app },
      );
    pages.push(
      { id: "privacy", title: t("mobile.settings.privacy.title"), detail: app },
      { id: "hiddenChats", title: t("mobile.settings.conversations.hiddenChats"), detail: app },
      { id: "support", title: t("mobile.settings.home.support"), detail: app },
      { id: "about", title: t("mobile.settings.home.about"), detail: app },
      { id: "serverOptions", title: t("mobile.app.route.serverOptions"), detail: server },
      { id: "serverMembers", title: t("mobile.app.route.members"), detail: server },
      { id: "serverRoutines", title: t("mobile.server.drawer.routines"), detail: server },
      { id: "serverUsage", title: t("mobile.server.drawer.usage"), detail: server },
    );
    return pages;
  }, [t, activeServer.name]);

  // Search the host after typing stops, as the desktop search does, not on each character.
  const [hostQuery, setHostQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setHostQuery(normalizeMobileSearchQuery(query)), 150);
    return () => clearTimeout(timer);
  }, [query]);
  // The host searches run for the query that typing stopped at. The typed query tells what will run.
  const sources = mobileSearchSources(filter, hostQuery);
  const wanted = mobileSearchSources(filter, query);
  const typing = normalizeMobileSearchQuery(query) !== hostQuery;
  const queryScope = [session?.apiUrl, session?.user.id, sessionScope, serverId] as const;
  const messageKey = ["message-search", ...queryScope, hostQuery];
  const messages = useInfiniteQuery({
    queryKey: messageKey,
    queryFn: ({ pageParam }) => searchMessages(hostQuery, serverId, pageParam),
    // An empty cursor asks for the newest matches.
    initialPageParam: "",
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: (previous, previousQuery) =>
      continuesSearch(previousQuery?.queryKey, messageKey) ? previous : undefined,
    enabled: sources.messages,
    retry: false,
  });
  const fileKey = ["file-search", ...queryScope, hostQuery];
  const files = useInfiniteQuery({
    queryKey: fileKey,
    queryFn: ({ pageParam }) => searchFiles(hostQuery, serverId, pageParam),
    initialPageParam: "",
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: (previous, previousQuery) =>
      continuesSearch(previousQuery?.queryKey, fileKey) ? previous : undefined,
    enabled: filesSupported && sources.files,
    retry: false,
  });
  // The phone already has the agents it shows, so it asks the host only for their routines.
  const routineOwners = useMemo(
    () => activeAgents.map((agent) => ({ kind: "agent" as const, agentId: agent.id })),
    [activeAgents],
  );
  const routineOwnerKey = routineOwners.map((owner) => `a:${owner.agentId}`).join(",");
  const routines = useQuery({
    // The routine calendar key, so the events that change routines refresh this list too.
    queryKey: ["server-routines", ...queryScope, "search", routineOwnerKey],
    queryFn: async () => {
      // A range that starts after now reads no run history, and an empty one places no runs.
      const at = new Date(Date.now() + 60_000).toISOString();
      return (await loadRoutineCalendar({ from: at, to: at }, serverId, routineOwners)).routines;
    },
    // The list does not depend on the query, so it loads at once.
    enabled: wanted.routines,
    retry: false,
    staleTime: 60_000,
  });

  const membershipId = activeServer.membershipId;
  const accountUserId = session?.user.id ?? null;
  const messageItems = useMemo(
    () => messages.data?.pages.flatMap((page) => page.results) ?? [],
    [messages.data?.pages],
  );
  const fileItems = useMemo(() => files.data?.pages.flatMap((page) => page.results) ?? [], [files.data?.pages]);
  const messagePageCount = messages.data?.pages.length ?? 0;
  const filePageCount = files.data?.pages.length ?? 0;
  const view = useMemo(
    () =>
      mobileSearchView({
        // Local matches follow each character. The host searches wait for the typing to stop, and the
        // results shown stay until the next ones come.
        query,
        filter,
        reader: { memberId: membershipId || null, accountUserId },
        agents: activeAgents,
        settings,
        routines: !wanted.routines
          ? { status: "idle", items: [] }
          : {
              status: routines.data ? "ready" : routines.isError ? "error" : "loading",
              items: routines.data ?? [],
            },
        messages: !wanted.messages
          ? { status: "idle" }
          : {
              status: typing || messages.isFetching ? "loading" : messages.isError ? "error" : "ready",
              items: sources.messages ? messageItems : [],
              hasMore: !typing && messages.hasNextPage,
              pages: messagePageCount,
            },
        files:
          !filesSupported || !wanted.files
            ? { status: "idle" }
            : {
                status: typing || files.isFetching ? "loading" : files.isError ? "error" : "ready",
                items: sources.files ? fileItems : [],
                hasMore: !typing && files.hasNextPage,
                pages: filePageCount,
              },
      }),
    [
      query,
      filter,
      membershipId,
      accountUserId,
      activeAgents,
      settings,
      wanted.routines,
      wanted.messages,
      wanted.files,
      typing,
      sources.messages,
      sources.files,
      filesSupported,
      routines.data,
      routines.isError,
      messages.isError,
      messages.isFetching,
      messages.hasNextPage,
      messageItems,
      messagePageCount,
      files.isError,
      files.isFetching,
      files.hasNextPage,
      fileItems,
      filePageCount,
    ],
  );
  const { fetchNextPage: fetchMoreMessages, refetch: refetchMessages } = messages;
  const { fetchNextPage: fetchMoreFiles, refetch: refetchFiles } = files;
  useEffect(() => {
    if (view.readOn.messages) void fetchMoreMessages();
  }, [view.readOn.messages, fetchMoreMessages]);
  useEffect(() => {
    if (view.readOn.files) void fetchMoreFiles();
  }, [view.readOn.files, fetchMoreFiles]);
  const retry = () => {
    if (messages.isError) void (messages.isFetchNextPageError ? fetchMoreMessages() : refetchMessages());
    if (files.isError) void (files.isFetchNextPageError ? fetchMoreFiles() : refetchFiles());
    if (routines.isError) void routines.refetch();
  };
  const loadMore = () => void (filter === "files" ? fetchMoreFiles() : fetchMoreMessages());
  const selectFilter = (next: MobileSearchFilter) => {
    if (next === filter) return;
    void haptics.selection();
    setFilter(next);
  };
  const resultCount = view.sections.reduce((count, section) => count + section.results.length, 0);
  const item = swapItemMotion(motion);
  // Under the results: a host search that still loads, a failed one, or its next page.
  const footer =
    view.state !== "results"
      ? "none"
      : view.loading
        ? "loading"
        : view.failed
          ? "failed"
          : view.canLoadMore
            ? "more"
            : "none";

  const searchSummary = useRef({ used: false, count: 0 });
  if (query.trim()) searchSummary.current = { used: true, count: resultCount };
  useEffect(() => {
    const scope = mobileAnalytics.scope();
    return () => {
      if (searchSummary.current.used)
        scope.track("search_action", {
          scope: "global",
          result: "succeeded",
          result_count: searchSummary.current.count,
        });
    };
  }, []);
  return (
    <SheetScrollView
      contentContainerClassName="pb-safe-offset-5"
      contentInsetAdjustmentBehavior="automatic"
      header={
        <View className={`flex-row items-center gap-2 px-5 pb-3 ${isAndroid ? "pt-4" : "pt-7"}`}>
          <GlassView
            glassEffectStyle={liquidGlassAvailable ? "regular" : "none"}
            isInteractive={liquidGlassAvailable}
            style={glassStyle(liquidGlassAvailable, fieldBackground, { flex: 1 })}
          >
            {/* The field is shorter than the capsule, so a tap anywhere on the capsule focuses it. */}
            <Pressable
              accessible={false}
              className="h-12 flex-row items-center gap-2 px-4"
              onPress={() => input.current?.focus()}
            >
              <Search color={String(muted)} size={19} strokeWidth={2} />
              <MobileSearchTextInput ref={input} value={query} onChangeText={setQuery} editable={!leaving} />
            </Pressable>
          </GlassView>
          <SearchFilterButton
            filters={filters}
            value={filter}
            onChange={selectFilter}
            liquidGlass={liquidGlassAvailable}
            fallbackBackground={fieldBackground}
          />
        </View>
      }
      // On Android the field is a React Native input in the sticky header. When it takes focus, the
      // keyboard-aware scroll moves the results under the header. The Android sheet moves over the keyboard.
      keyboardAware={!isAndroid}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* A filter names itself above its results, with a way back to all of them. */}
      <BlurSwap swapKey={filter} mode={motion}>
        {filter === "all" ? null : (
          <SearchCaption
            label={t(FILTER_LABEL[filter])}
            action={{ label: t("mobile.search.clearFilter"), onPress: () => selectFilter("all") }}
          />
        )}
      </BlurSwap>
      <BlurSwap
        swapKey={`${filter}:${view.state}`}
        mode={motion}
        enterDelay={view.state === "loading" ? SEARCHING_DELAY : 0}
      >
        {view.state === "results" ? (
          <>
            {view.sections.map((section) => {
              const label = t(FILTER_LABEL[section.key]);
              return (
                <Animated.View
                  key={section.key}
                  entering={item.entering}
                  exiting={item.exiting}
                  layout={item.layout}
                  className="pb-2"
                >
                  {/* The rows of a section that comes in come in with it. */}
                  <BlurEnter mode={motion}>
                    <LayoutAnimationConfig skipEntering>
                      {filter === "all" ? (
                        <SearchCaption
                          label={label}
                          action={
                            section.more
                              ? {
                                  label: t("mobile.search.seeAll"),
                                  accessibilityLabel: t("mobile.search.seeAllLabel", { section: label }),
                                  onPress: () => selectFilter(section.key),
                                }
                              : undefined
                          }
                        />
                      ) : null}
                      {section.results.map((result) => (
                        <Animated.View
                          key={result.id}
                          entering={item.entering}
                          exiting={item.exiting}
                          layout={item.layout}
                        >
                          <MobileSearchResultRow result={result} query={query} serverId={serverId} onLeave={leave} />
                        </Animated.View>
                      ))}
                    </LayoutAnimationConfig>
                  </BlurEnter>
                </Animated.View>
              );
            })}
            {/* The footer moves with the sections above it. */}
            <Animated.View layout={item.layout}>
              <BlurSwap swapKey={footer} mode={motion} enterDelay={footer === "loading" ? SEARCHING_DELAY : 0}>
                {footer === "loading" ? (
                  <SearchNotice title={t("mobile.search.loading")} />
                ) : footer === "failed" ? (
                  <SearchNotice title={t("mobile.search.failedTitle")} onRetry={retry} />
                ) : footer === "more" ? (
                  <View className="items-center px-8 py-6">
                    <Button size="sm" variant="secondary" onPress={loadMore}>
                      <Button.Label>
                        {filter === "files" ? t("mobile.search.showMoreFiles") : t("mobile.search.showMore")}
                      </Button.Label>
                    </Button>
                  </View>
                ) : null}
              </BlurSwap>
            </Animated.View>
          </>
        ) : view.state === "loading" ? (
          <SearchNotice title={t("mobile.search.loading")} />
        ) : view.state === "error" ? (
          <SearchNotice title={t("mobile.search.failedTitle")} body={t("mobile.search.errorBody")} onRetry={retry} />
        ) : view.state === "hint" ? (
          <SearchNotice title={t("mobile.search.hintTitle")} body={t("mobile.search.hintBody")} />
        ) : (
          <SearchNotice title={t("mobile.search.emptyTitle")} body={t("mobile.search.emptyBody")} />
        )}
      </BlurSwap>
    </SheetScrollView>
  );
}

function glassStyle(liquidGlass: boolean, fallbackBackground: unknown, size: ViewStyle): ViewStyle {
  return {
    backgroundColor: liquidGlass ? "transparent" : String(fallbackBackground),
    borderCurve: "continuous",
    borderRadius: CONTROL_SIZE / 2,
    height: CONTROL_SIZE,
    overflow: "hidden",
    ...size,
  };
}

/** Opens the native menu of the result kinds. A dot marks a filter other than All. */
function SearchFilterButton({
  filters,
  value,
  onChange,
  liquidGlass,
  fallbackBackground,
}: {
  filters: readonly MobileSearchFilter[];
  value: MobileSearchFilter;
  onChange: (value: MobileSearchFilter) => void;
  liquidGlass: boolean;
  fallbackBackground: unknown;
}) {
  const { t } = useText();
  const [foreground, accent] = useThemeColor(["foreground", "accent"]);
  const filtered = value !== "all";
  const actions: MenuAction[] = filters.map((candidate) => ({
    id: candidate,
    title: t(FILTER_LABEL[candidate]),
    image: FILTER_SYMBOL[candidate],
    state: candidate === value ? "on" : "off",
  }));
  return (
    <MenuView
      actions={actions}
      onPressAction={({ nativeEvent }) => {
        const next = filters.find((candidate) => candidate === nativeEvent.event);
        if (next) onChange(next);
      }}
      style={{ height: CONTROL_SIZE, width: CONTROL_SIZE }}
    >
      <GlassView
        glassEffectStyle={liquidGlass ? "regular" : "none"}
        isInteractive={liquidGlass}
        style={glassStyle(liquidGlass, fallbackBackground, { width: CONTROL_SIZE })}
      >
        <View
          accessible
          accessibilityRole="button"
          accessibilityLabel={t("mobile.search.filter.label")}
          accessibilityValue={{ text: t(FILTER_LABEL[value]) }}
          className="flex-1 items-center justify-center"
        >
          <ListFilter color={String(filtered ? accent : foreground)} size={20} strokeWidth={2} />
          {filtered ? <View className="absolute top-3 right-3 size-2 rounded-full bg-accent" /> : null}
        </View>
      </GlassView>
    </MenuView>
  );
}

function SearchCaption({
  label,
  action,
}: {
  label: string;
  action?: { label: string; accessibilityLabel?: string; onPress: () => void };
}) {
  return (
    <View className="min-h-9 flex-row items-center justify-between gap-3 pt-3 pr-3 pl-5">
      <Typography.Paragraph type="body-xs" accessibilityRole="header" className="text-grouped-secondary">
        {label}
      </Typography.Paragraph>
      {action ? (
        <Button size="sm" variant="ghost" accessibilityLabel={action.accessibilityLabel} onPress={action.onPress}>
          <Button.Label>{action.label}</Button.Label>
        </Button>
      ) : null}
    </View>
  );
}

function SearchNotice({ title, body, onRetry }: { title: string; body?: string; onRetry?: () => void }) {
  const { t } = useText();
  return (
    <View className="items-center gap-3 px-8 py-12">
      <View className="items-center gap-1">
        <Typography.Paragraph align="center" weight="semibold">
          {title}
        </Typography.Paragraph>
        {body ? (
          <Typography.Paragraph type="body-xs" align="center" className="text-text-secondary">
            {body}
          </Typography.Paragraph>
        ) : null}
      </View>
      {onRetry ? (
        <Button size="sm" variant="secondary" onPress={onRetry}>
          <Button.Label>{t("mobile.search.retry")}</Button.Label>
        </Button>
      ) : null}
    </View>
  );
}
