import { GlassView } from "expo-glass-effect";
import { type Href, router } from "expo-router";
import { HeaderHeightContext } from "expo-router/react-navigation";
import { Spinner, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import type { LucideIcon } from "lucide-react-native";
import ArrowUp from "lucide-react-native/icons/arrow-up";
import CalendarClock from "lucide-react-native/icons/calendar-clock";
import ChartColumn from "lucide-react-native/icons/chart-column";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import CircleX from "lucide-react-native/icons/circle-x";
import EyeOff from "lucide-react-native/icons/eye-off";
import Plus from "lucide-react-native/icons/plus";
import Search from "lucide-react-native/icons/search";
import Settings from "lucide-react-native/icons/settings";
import SlidersHorizontal from "lucide-react-native/icons/sliders-horizontal";
import UsersRound from "lucide-react-native/icons/users-round";
import X from "lucide-react-native/icons/x";
import {
  type PropsWithChildren,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BackHandler, Keyboard, Pressable, ScrollView, TextInput, View } from "react-native";
import { KeyboardAwareScrollView, useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, {
  cubicBezier,
  Easing,
  type EntryExitAnimationFunction,
  Extrapolation,
  FadeIn,
  FadeOut,
  interpolate,
  LinearTransition,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { ChatNavigationGateContext } from "@/features/agents/components/chat-link-pressable";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { MobileSearchResults, SearchCaption } from "@/features/search/components/mobile-search-results";
import { setHomeSearchOpener } from "@/features/search/model/home-search-request";
import { useAppDrawer } from "@/features/servers/components/app-drawer-shell";
import {
  type MobileAgent,
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { BlurSwap } from "@/shared/components/blur-swap";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion, useTransitionMode } from "@/shared/lib/motion";
import { currentText, useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";
import { useLiquidGlass } from "@/shared/lib/use-liquid-glass";

/** The height of the search field at the bottom of home. */
export const HOME_SEARCH_HEIGHT = 52;
/** The space between the field and the keyboard. */
const KEYBOARD_GAP = 8;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
// The results come in over the list and go back quicker than they came: the user leaves on purpose.
const OPEN = { duration: 220, easing: EASE_OUT };
const CLOSE = { duration: 160, easing: EASE_OUT };
const FIELD_LAYOUT = LinearTransition.duration(220).easing(EASE_OUT);
/** How long the confirmation of a started task stays above the field. */
const NOTICE_DURATION = 3_200;
const PRESS_SCALE = {
  transitionProperty: "transform",
  transitionDuration: 120,
  transitionTimingFunction: cubicBezier(0.23, 1, 0.32, 1),
} as const;

/** The close button grows a little from the field's edge as it comes in, and shrinks as it goes. */
const closeButtonEnter: EntryExitAnimationFunction = () => {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.9 }] },
    animations: {
      opacity: withTiming(1, { duration: 160, easing: EASE_OUT }),
      transform: [{ scale: withTiming(1, OPEN) }],
    },
  };
};
const closeButtonExit: EntryExitAnimationFunction = () => {
  "worklet";
  return {
    initialValues: { opacity: 1, transform: [{ scale: 1 }] },
    animations: {
      opacity: withTiming(0, { duration: 120, easing: EASE_OUT }),
      transform: [{ scale: withTiming(0.9, CLOSE) }],
    },
  };
};

/** The confirmation comes up 12 pt as it fades in, and leaves the way it came. */
const noticeEnter: EntryExitAnimationFunction = () => {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 12 }] },
    animations: {
      opacity: withTiming(1, { duration: 200, easing: EASE_OUT }),
      transform: [{ translateY: withTiming(0, { duration: 240, easing: EASE_OUT }) }],
    },
  };
};
const noticeExit: EntryExitAnimationFunction = () => {
  "worklet";
  return {
    initialValues: { opacity: 1, transform: [{ translateY: 0 }] },
    animations: {
      opacity: withTiming(0, { duration: 180, easing: EASE_OUT }),
      transform: [{ translateY: withTiming(12, { duration: 200, easing: EASE_OUT }) }],
    },
  };
};

export interface HomeSearch {
  open: boolean;
  /** True while the results show or leave. */
  mounted: boolean;
  /** True when the results finished coming in, so they rest with no animated style. */
  settled: boolean;
  query: string;
  setQuery: (query: string) => void;
  openSearch: () => void;
  closeSearch: () => void;
  /** Closes the search for a result that opens another screen. */
  leave: () => void;
  input: RefObject<TextInput | null>;
  progress: SharedValue<number>;
  /** False when the server cannot start tasks: then `@` is plain search text. */
  canStartTasks: boolean;
  /** The agent that the next Return gives the typed text to. */
  target: MobileAgent | null;
  chooseTarget: (agent: MobileAgent) => void;
  clearTarget: () => void;
  /** The agents that match an `@name` query, or null when the query is not one. */
  targetMatches: MobileAgent[] | null;
  startTask: (agent: MobileAgent, text: string) => void;
  /** Return in the field: chooses the first `@name` match, or starts the task. */
  submit: () => void;
  sending: boolean;
  /** The confirmation of the last task that started. */
  notice: { id: number; text: string } | null;
}

/** The agents whose name or title starts with the text after `@`. */
function matchTargets(agents: readonly MobileAgent[], query: string): MobileAgent[] | null {
  const trimmed = query.trimStart();
  if (!trimmed.startsWith("@")) return null;
  const needle = trimmed.slice(1).trim().toLocaleLowerCase();
  return agents.filter(
    (agent) =>
      !needle ||
      agent.name.toLocaleLowerCase().startsWith(needle) ||
      agent.title.trim().toLocaleLowerCase().startsWith(needle),
  );
}

/** The state of the search field at the bottom of home and of the results it opens over the list. */
export function useHomeSearch(): HomeSearch {
  const { setOpeningBlocked } = useAppDrawer();
  const workspace = useMobileWorkspaceReader();
  const serverId = useMobileWorkspaceSelector((current) => current.activeServer.id);
  const agents = useMobileWorkspaceSelector((current) => current.activeAgents);
  const canStartTasks = useMobileWorkspaceSelector((current) => current.canStartTasks(current.activeServer.id));
  const input = useRef<TextInput>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [settled, setSettled] = useState(false);
  const [target, setTarget] = useState<MobileAgent | null>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null);
  const progress = useSharedValue(0);
  const targetMatches = canStartTasks && !target ? matchTargets(agents, query) : null;

  const openSearch = useCallback(() => {
    setOpen(true);
    setMounted(true);
    // The results take the screen, so a swipe right must not open the drawer under them.
    setOpeningBlocked(true);
    setSettled(false);
    progress.set(
      withTiming(1, OPEN, (finished) => {
        if (finished) scheduleOnRN(setSettled, true);
      }),
    );
  }, [progress, setOpeningBlocked]);
  const closeSearch = useCallback(() => {
    input.current?.blur();
    Keyboard.dismiss();
    setOpen(false);
    setSettled(false);
    setQuery("");
    setTarget(null);
    setOpeningBlocked(false);
    progress.set(
      withTiming(0, CLOSE, (finished) => {
        if (finished) scheduleOnRN(setMounted, false);
      }),
    );
  }, [progress, setOpeningBlocked]);
  const chooseTarget = useCallback((agent: MobileAgent) => {
    void haptics.selection();
    setTarget(agent);
    setQuery("");
    input.current?.focus();
  }, []);
  const clearTarget = useCallback(() => {
    setTarget(null);
    input.current?.focus();
  }, []);
  const startTask = useCallback(
    (agent: MobileAgent, text: string) => {
      const task = text.trim();
      if (!task || sending) return;
      setSending(true);
      workspace()
        .startAgentTask(agent.id, task, serverId)
        .then(
          () => {
            void haptics.notification("success");
            setNotice({
              id: Date.now(),
              text: currentText().t("mobile.search.task.started", { name: agent.name, text: task }),
            });
            closeSearch();
          },
          (error: unknown) => {
            void haptics.notification("error");
            const text = currentText();
            showFailureAlert(
              error,
              "agent",
              text.t("mobile.search.task.failedTitle"),
              text.errorMessage(error, text.t("mobile.search.task.failedBody")),
            );
          },
        )
        .finally(() => setSending(false));
    },
    [workspace, serverId, sending, closeSearch],
  );
  const submit = useCallback(() => {
    if (targetMatches) {
      const first = targetMatches[0];
      if (first) chooseTarget(first);
      return;
    }
    if (target) startTask(target, query);
  }, [targetMatches, target, query, chooseTarget, startTask]);

  useEffect(() => () => setOpeningBlocked(false), [setOpeningBlocked]);
  // The confirmation goes after a short read.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_DURATION);
    return () => clearTimeout(timer);
  }, [notice]);
  // A task names an agent of the open server, so another server starts without one.
  useEffect(() => {
    if (serverId) setTarget(null);
  }, [serverId]);
  // A quick action of the app icon opens the search with the keyboard.
  useEffect(() => {
    setHomeSearchOpener(() => input.current?.focus());
    return () => setHomeSearchOpener(null);
  }, []);
  // Android Back closes the results before it leaves the app.
  useEffect(() => {
    if (!open) return;
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      closeSearch();
      return true;
    });
    return () => back.remove();
  }, [open, closeSearch]);

  return {
    open,
    mounted,
    settled,
    query,
    setQuery,
    openSearch,
    closeSearch,
    leave: closeSearch,
    input,
    progress,
    canStartTasks,
    target,
    chooseTarget,
    clearTarget,
    targetMatches,
    startTask,
    submit,
    sending,
    notice,
  };
}

/**
 * The results over the home list. They come in from 8 pt below as the field takes focus, and the
 * native header stays above them.
 */
export function HomeSearchResults({ search }: { search: HomeSearch }) {
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const { progress } = search;
  const style = useAnimatedStyle(() => ({
    // The fade ends before the movement, so the rows are readable while they settle.
    opacity: interpolate(progress.get(), [0, 0.8], [0, 1], Extrapolation.CLAMP),
    transform: [{ translateY: reduced ? 0 : (1 - progress.get()) * 8 }],
  }));
  if (!search.mounted) return null;
  return (
    <Animated.View
      className="absolute inset-0 bg-background"
      pointerEvents={search.open ? "auto" : "none"}
      accessibilityElementsHidden={!search.open}
      importantForAccessibility={search.open ? "auto" : "no-hide-descendants"}
      // At rest the results have no animated style. A render while the user types then cannot put
      // back the first-render opacity of 0 when the animated value has not reached React.
      style={search.settled ? undefined : style}
    >
      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{
          paddingTop: headerHeight,
          paddingBottom: HOME_SEARCH_HEIGHT + Math.max(insets.bottom, 12) + 24,
        }}
        mode="insets"
        bottomOffset={HOME_SEARCH_HEIGHT + KEYBOARD_GAP}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <HomeSearchBody search={search} />
      </KeyboardAwareScrollView>
    </Animated.View>
  );
}

/**
 * What the results show: the agents for `@name`, the task that Return starts, the agents that can
 * take the typed text, and the search results of the text.
 */
function HomeSearchBody({ search }: { search: HomeSearch }) {
  const { t } = useText();
  const motion = useTransitionMode("searchTransitions");
  const text = search.query.trim();
  const { target, targetMatches } = search;
  const agents = useMobileWorkspaceSelector((current) => current.activeAgents);
  const idle = <HomeSearchIdle onLeave={search.leave} canStartTasks={search.canStartTasks} />;
  return (
    <BlurSwap swapKey={targetMatches ? "targets" : "search"} mode={motion}>
      {targetMatches ? (
        <View className="pb-2">
          <SearchCaption label={t("mobile.search.task.giveTo")} />
          {targetMatches.length > 0 ? (
            targetMatches.map((agent) => (
              <TaskTargetRow key={agent.id} agent={agent} onPress={() => search.chooseTarget(agent)} />
            ))
          ) : (
            <SearchHint text={t("mobile.search.task.noAgent")} />
          )}
        </View>
      ) : (
        <>
          {target && text ? (
            <AskTaskRow
              agent={target}
              text={text}
              sending={search.sending}
              onPress={() => search.startTask(target, text)}
            />
          ) : null}
          {target && !text ? <SearchHint text={t("mobile.search.task.typeHint", { name: target.name })} /> : null}
          {!target && text && search.canStartTasks && agents.length > 0 ? (
            <>
              <SearchCaption label={t("mobile.search.task.giveTextTo", { text })} />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerClassName="gap-3.5 px-5 pt-1 pb-1.5"
              >
                {agents.map((agent) => (
                  <AgentChip key={agent.id} agent={agent} onPress={() => search.startTask(agent, text)} />
                ))}
              </ScrollView>
            </>
          ) : null}
          <MobileSearchResults query={search.query} active={search.open} idle={idle} onLeave={search.leave} />
        </>
      )}
    </BlurSwap>
  );
}

function SearchHint({ text }: { text: string }) {
  return (
    <Typography.Paragraph className="px-5 py-4 text-muted" style={typeScale.preview}>
      {text}
    </Typography.Paragraph>
  );
}

/** An agent that an `@name` query matches. */
function TaskTargetRow({ agent, onPress }: { agent: MobileAgent; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={agent.name}
      className="flex-row items-center gap-3 px-5 py-2.5"
      style={({ pressed }) => ({ opacity: pressed ? 0.58 : 1 })}
      onPress={onPress}
    >
      <BloubAvatar
        agentId={agent.id}
        serverId={agent.serverId}
        hue={agent.avatarHue}
        seed={agent.avatarSeed}
        size={36}
        animateIdle={false}
      />
      <View className="min-w-0 flex-1 gap-0.5">
        <Typography.Paragraph className="font-medium" numberOfLines={1} style={typeScale.body}>
          {agent.name}
        </Typography.Paragraph>
        {agent.title.trim() ? (
          <Typography.Paragraph className="text-muted" numberOfLines={1} style={typeScale.caption}>
            {agent.title.trim()}
          </Typography.Paragraph>
        ) : null}
      </View>
    </Pressable>
  );
}

/** The task that Return starts: the agent and the typed text, on a raised card. */
function AskTaskRow({
  agent,
  text,
  sending,
  onPress,
}: {
  agent: MobileAgent;
  text: string;
  sending: boolean;
  onPress: () => void;
}) {
  const { t } = useText();
  const [foreground, background] = useThemeColor(["foreground", "background"]);
  const title = t("mobile.search.task.ask", { name: agent.name, text });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ busy: sending }}
      disabled={sending}
      className="mx-4 mt-2 mb-1.5 flex-row items-center gap-3 rounded-2xl bg-surface py-2.5 pr-2.5 pl-3.5"
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, boxShadow: "0 1px 2px rgba(20, 20, 20, 0.05)" })}
      onPress={onPress}
    >
      <BloubAvatar
        agentId={agent.id}
        serverId={agent.serverId}
        hue={agent.avatarHue}
        seed={agent.avatarSeed}
        size={36}
        animateIdle={false}
      />
      <View className="min-w-0 flex-1 gap-0.5">
        <Typography.Paragraph className="font-medium" style={typeScale.body}>
          {title}
        </Typography.Paragraph>
        <Typography.Paragraph className="text-muted" style={typeScale.caption}>
          {t("mobile.search.task.askHint")}
        </Typography.Paragraph>
      </View>
      <View className="size-9 items-center justify-center rounded-full" style={{ backgroundColor: String(foreground) }}>
        {sending ? (
          <Spinner size="sm" color={String(background)} />
        ) : (
          <ArrowUp color={String(background)} size={18} strokeWidth={2.2} />
        )}
      </View>
    </Pressable>
  );
}

/** The field at the bottom of home. It rides on the keyboard, and a close button comes in beside it. */
export function HomeSearchBar({ search }: { search: HomeSearch }) {
  const { t } = useText();
  const insets = useSafeAreaInsets();
  const liquidGlass = useLiquidGlass();
  const reduced = useReducedMotion();
  const [foreground, muted, fieldBackground, background, accent, onAccent] = useThemeColor([
    "foreground",
    "muted",
    "default",
    "background",
    "accent",
    "accent-foreground",
  ]);
  const bottomGap = Math.max(insets.bottom - 8, 12);
  const { height: keyboardHeight, progress: keyboardProgress } = useReanimatedKeyboardAnimation();
  const barStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.abs(keyboardHeight.get()) + keyboardProgress.get() * (bottomGap - KEYBOARD_GAP) }],
  }));
  const layout = reduced ? undefined : FIELD_LAYOUT;
  const enter = reduced ? undefined : closeButtonEnter;
  const exit = reduced ? undefined : closeButtonExit;
  const { target } = search;
  const canSend = Boolean(target && search.query.trim()) && !search.sending;
  const placeholder = target
    ? t("mobile.search.taskPlaceholder", { name: target.name })
    : search.canStartTasks
      ? t("mobile.search.placeholder")
      : t("common.search");

  return (
    <>
      {search.notice ? (
        <Animated.View
          key={search.notice.id}
          entering={reduced ? FadeIn.duration(160) : noticeEnter}
          exiting={reduced ? FadeOut.duration(120) : noticeExit}
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          className="absolute right-5 left-5 rounded-2xl px-3.5 py-3"
          style={{ bottom: bottomGap + HOME_SEARCH_HEIGHT + 16, backgroundColor: String(foreground) }}
        >
          <Typography.Paragraph numberOfLines={1} style={[typeScale.preview, { color: String(background) }]}>
            {search.notice.text}
          </Typography.Paragraph>
        </Animated.View>
      ) : null}
      <Animated.View
        className="absolute right-4 left-4 flex-row items-center gap-2"
        pointerEvents="box-none"
        style={[{ bottom: bottomGap }, barStyle]}
      >
        {search.open ? (
          <Animated.View entering={enter} exiting={exit}>
            <GlassCapsule liquidGlass={liquidGlass} fallbackBackground={fieldBackground} width={HOME_SEARCH_HEIGHT}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("mobile.search.close")}
                className="flex-1 items-center justify-center"
                hitSlop={4}
                style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
                onPress={() => {
                  void haptics.impact("soft");
                  search.closeSearch();
                }}
              >
                <ChevronDown color={String(foreground)} size={22} strokeWidth={2.2} />
              </Pressable>
            </GlassCapsule>
          </Animated.View>
        ) : null}
        <Animated.View className="min-w-0 flex-1" layout={layout}>
          <GlassCapsule liquidGlass={liquidGlass} fallbackBackground={fieldBackground}>
            {/* The field is shorter than the capsule, so a tap anywhere on the capsule focuses it. */}
            <Pressable
              accessible={false}
              className="flex-1 flex-row items-center gap-2 pr-2 pl-4"
              onPress={() => search.input.current?.focus()}
            >
              {target ? (
                <Animated.View entering={enter} exiting={exit} layout={layout}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("mobile.search.task.removeTarget", { name: target.name })}
                    className="-ml-2 h-7.5 flex-row items-center gap-1 rounded-full px-2.5"
                    style={{ backgroundColor: String(accent) }}
                    onPress={search.clearTarget}
                  >
                    <Typography.Paragraph
                      className="font-semibold"
                      numberOfLines={1}
                      style={[typeScale.preview, { color: String(onAccent) }]}
                    >
                      @{target.name}
                    </Typography.Paragraph>
                    <X color={String(onAccent)} size={14} strokeWidth={2.4} />
                  </Pressable>
                </Animated.View>
              ) : (
                <Search color={String(muted)} size={18} strokeWidth={2} />
              )}
              <TextInput
                ref={search.input}
                accessibilityLabel={placeholder}
                autoCapitalize={target ? "sentences" : "none"}
                autoCorrect={Boolean(target)}
                className="h-10 min-w-0 flex-1 font-sans text-foreground"
                placeholder={placeholder}
                placeholderTextColor={muted}
                returnKeyType={target ? "send" : "search"}
                submitBehavior="submit"
                selectionColor={foreground}
                style={{ fontSize: 16, lineHeight: 20, paddingBottom: 0, paddingTop: 0, textAlignVertical: "center" }}
                value={search.query}
                onChangeText={search.setQuery}
                onSubmitEditing={search.submit}
                onKeyPress={({ nativeEvent }) => {
                  // Backspace in an empty field removes the agent, as in a mail address field.
                  if (nativeEvent.key === "Backspace" && !search.query && target) search.clearTarget();
                }}
                onFocus={() => {
                  if (!search.open) search.openSearch();
                }}
              />
              {search.query && !target ? (
                <Animated.View entering={enter} exiting={exit}>
                  <Pressable
                    accessibilityLabel={t("mobile.search.clear")}
                    accessibilityRole="button"
                    className="size-9 items-center justify-center"
                    hitSlop={6}
                    onPress={() => search.setQuery("")}
                  >
                    <CircleX color={String(background)} fill={String(muted)} size={20} strokeWidth={2} />
                  </Pressable>
                </Animated.View>
              ) : null}
              {search.canStartTasks ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("mobile.search.task.send")}
                  accessibilityState={{ disabled: !canSend, busy: search.sending }}
                  className="size-9 items-center justify-center rounded-full"
                  hitSlop={4}
                  style={{
                    backgroundColor: String(foreground),
                    opacity: canSend || search.sending ? 1 : 0.35,
                  }}
                  onPress={() => {
                    if (canSend) search.submit();
                    else search.input.current?.focus();
                  }}
                >
                  {search.sending ? (
                    <Spinner size="sm" color={String(background)} />
                  ) : (
                    <ArrowUp color={String(background)} size={18} strokeWidth={2.2} />
                  )}
                </Pressable>
              ) : null}
            </Pressable>
          </GlassCapsule>
        </Animated.View>
      </Animated.View>
    </>
  );
}

/** Glass where the system has it; a solid capsule elsewhere, and with Reduce Transparency on. */
function GlassCapsule({
  liquidGlass,
  fallbackBackground,
  width,
  children,
}: PropsWithChildren<{ liquidGlass: boolean; fallbackBackground: unknown; width?: number }>) {
  return (
    <GlassView
      glassEffectStyle={liquidGlass ? "regular" : "none"}
      isInteractive={liquidGlass}
      style={{
        backgroundColor: liquidGlass ? "transparent" : String(fallbackBackground),
        borderCurve: "continuous",
        borderRadius: HOME_SEARCH_HEIGHT / 2,
        height: HOME_SEARCH_HEIGHT,
        overflow: "hidden",
        width,
        boxShadow: liquidGlass ? undefined : "0 6px 18px rgba(0, 0, 0, 0.07)",
      }}
    >
      {children}
    </GlassView>
  );
}

interface Shortcut {
  id: string;
  label: string;
  icon: LucideIcon;
  href: Href;
}

/** Before the user types: the pages to go to, and the agents of the server. */
function HomeSearchIdle({ onLeave, canStartTasks }: { onLeave: () => void; canStartTasks: boolean }) {
  const { t } = useText();
  const gate = useContext(ChatNavigationGateContext);
  const serverId = useMobileWorkspaceSelector((current) => current.activeServer.id);
  const hasServer = useMobileWorkspaceSelector((current) =>
    current.servers.some((server) => server.id === current.activeServer.id),
  );
  const agents = useMobileWorkspaceSelector((current) => current.activeAgents);
  const hasHiddenChats = useMobileWorkspaceSelector((current) => current.hiddenAgents.length > 0);
  const shortcuts = useMemo<Shortcut[]>(
    () => [
      ...(hasServer
        ? [
            {
              id: "routines",
              label: t("mobile.app.route.routines"),
              icon: CalendarClock,
              href: { pathname: "/server-routines", params: { serverId } } as const,
            },
            {
              id: "usage",
              label: t("mobile.app.route.usage"),
              icon: ChartColumn,
              href: { pathname: "/server-usage", params: { serverId } } as const,
            },
            {
              id: "members",
              label: t("mobile.app.route.members"),
              icon: UsersRound,
              href: { pathname: "/server-settings/members", params: { serverId } } as const,
            },
            {
              id: "server",
              label: t("mobile.server.drawer.serverSettings"),
              icon: SlidersHorizontal,
              href: { pathname: "/server-settings", params: { serverId } } as const,
            },
            { id: "add-agent", label: t("mobile.agent.home.addAgent"), icon: Plus, href: "/add-agent" as const },
          ]
        : []),
      ...(hasHiddenChats
        ? [{ id: "hidden", label: t("mobile.agent.hidden.title"), icon: EyeOff, href: "/hidden-chats" as const }]
        : []),
      { id: "settings", label: t("mobile.app.route.settings"), icon: Settings, href: "/settings" as const },
    ],
    [t, hasServer, hasHiddenChats, serverId],
  );
  const openChat = (agent: MobileAgent) => {
    onLeave();
    if (!gate?.openFromHome(agent.id)) router.push({ pathname: "/chat/[agentId]", params: { agentId: agent.id } });
  };
  return (
    <View className="pb-2">
      <SearchCaption label={t("mobile.search.goTo")} />
      <View className="flex-row flex-wrap gap-2 px-4 pt-1.5">
        {shortcuts.map((shortcut) => (
          <ShortcutChip
            key={shortcut.id}
            shortcut={shortcut}
            onPress={() => {
              onLeave();
              router.push(shortcut.href);
            }}
          />
        ))}
      </View>
      {agents.length > 0 ? (
        <>
          <SearchCaption label={t("mobile.search.filter.agents")} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerClassName="gap-3.5 px-5 pt-1 pb-1.5"
          >
            {agents.map((agent) => (
              <AgentChip key={agent.id} agent={agent} onPress={() => openChat(agent)} />
            ))}
          </ScrollView>
        </>
      ) : null}
      {canStartTasks ? <SearchHint text={t("mobile.search.task.atHint")} /> : null}
    </View>
  );
}

function ShortcutChip({ shortcut, onPress }: { shortcut: Shortcut; onPress: () => void }) {
  const secondary = String(useThemeColor("muted"));
  const Icon = shortcut.icon;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        void haptics.impact("soft");
        onPress();
      }}
    >
      {({ pressed }) => (
        <Animated.View
          className="h-9 flex-row items-center gap-1.5 rounded-full bg-control px-3.5"
          style={[{ transform: [{ scale: pressed ? 0.97 : 1 }] }, PRESS_SCALE]}
        >
          <Icon color={secondary} size={16} strokeWidth={1.9} />
          <Typography.Paragraph className="font-medium" style={typeScale.preview}>
            {shortcut.label}
          </Typography.Paragraph>
        </Animated.View>
      )}
    </Pressable>
  );
}

function AgentChip({ agent, onPress }: { agent: MobileAgent; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={agent.name}
      onPress={() => {
        void haptics.impact("soft");
        onPress();
      }}
    >
      {({ pressed }) => (
        <Animated.View
          className="w-15 items-center gap-2"
          style={[{ transform: [{ scale: pressed ? 0.96 : 1 }] }, PRESS_SCALE]}
        >
          <BloubAvatar
            agentId={agent.id}
            serverId={agent.serverId}
            hue={agent.avatarHue}
            seed={agent.avatarSeed}
            size={48}
            animateIdle={false}
          />
          <Typography.Paragraph
            align="center"
            className="w-full text-text-secondary"
            numberOfLines={1}
            style={typeScale.small}
          >
            {agent.name}
          </Typography.Paragraph>
        </Animated.View>
      )}
    </Pressable>
  );
}
