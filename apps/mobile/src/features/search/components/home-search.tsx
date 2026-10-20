import { isAgentTaskOpen, taskNeedsYou } from "@openbot/team-client/agent-tasks";
import * as Crypto from "expo-crypto";
import { GlassView } from "expo-glass-effect";
import { type Href, router } from "expo-router";
import { Spinner, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import type { LucideIcon } from "lucide-react-native";
import ArrowUp from "lucide-react-native/icons/arrow-up";
import CalendarClock from "lucide-react-native/icons/calendar-clock";
import ChartColumn from "lucide-react-native/icons/chart-column";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import CircleX from "lucide-react-native/icons/circle-x";
import EyeOff from "lucide-react-native/icons/eye-off";
import ListRestart from "lucide-react-native/icons/list-restart";
import Plus from "lucide-react-native/icons/plus";
import Search from "lucide-react-native/icons/search";
import Settings from "lucide-react-native/icons/settings";
import SlidersHorizontal from "lucide-react-native/icons/sliders-horizontal";
import SquareCheck from "lucide-react-native/icons/square-check";
import UsersRound from "lucide-react-native/icons/users-round";
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
import { getBloubAvatarColor } from "@/features/agents/model/bloub-activity";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { MobileSearchResults, SearchCaption } from "@/features/search/components/mobile-search-results";
import { setHomeSearchOpener } from "@/features/search/model/home-search-request";
import { useAppDrawer } from "@/features/servers/components/app-drawer-shell";
import { TaskListRow } from "@/features/servers/components/task-list-row";
import { useServerTasks } from "@/features/servers/model/use-server-tasks";
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

/**
 * The close button grows a little from the field's edge as it comes in, and shrinks as it goes.
 * Glass does not render under a parent with opacity 0, so the glass appears with its own native
 * animation and this wrapper only scales.
 */
const closeButtonGrow: EntryExitAnimationFunction = () => {
  "worklet";
  return {
    initialValues: { transform: [{ scale: 0.9 }] },
    animations: { transform: [{ scale: withTiming(1, OPEN) }] },
  };
};
const closeButtonShrink: EntryExitAnimationFunction = () => {
  "worklet";
  return {
    initialValues: { transform: [{ scale: 1 }] },
    animations: { transform: [{ scale: withTiming(0.9, CLOSE) }] },
  };
};
/** The clear button and the agent chip: no glass, so they fade too. */
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
  canUseTasks: boolean;
  /** The agent that the next Return gives the typed text to. */
  target: MobileAgent | null;
  /** Opens the task editor for the agent. `text` fills the field, else the text kept from before. */
  chooseTarget: (agent: MobileAgent, text?: string) => void;
  /** Back to choosing an agent: the field shows `@`, and the task text waits for the next agent. */
  clearTarget: () => void;
  /** Puts a task text in the field, such as an idea. */
  fillTask: (text: string) => void;
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
  const canUseTasks = useMobileWorkspaceSelector((current) => current.canUseTasks(current.activeServer.id));
  const input = useRef<TextInput>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [settled, setSettled] = useState(false);
  const [target, setTarget] = useState<MobileAgent | null>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null);
  // The task text while the person chooses another agent.
  const draft = useRef("");
  const progress = useSharedValue(0);
  const targetMatches = canUseTasks && !target ? matchTargets(agents, query) : null;

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
    draft.current = "";
    setOpeningBlocked(false);
    progress.set(
      withTiming(0, CLOSE, (finished) => {
        if (finished) scheduleOnRN(setMounted, false);
      }),
    );
  }, [progress, setOpeningBlocked]);
  const chooseTarget = useCallback((agent: MobileAgent, text?: string) => {
    void haptics.selection();
    setTarget(agent);
    setQuery(text ?? draft.current);
    draft.current = "";
    input.current?.focus();
  }, []);
  const clearTarget = useCallback(() => {
    setQuery((current) => {
      draft.current = current;
      return "@";
    });
    setTarget(null);
    input.current?.focus();
  }, []);
  const fillTask = useCallback((text: string) => {
    void haptics.selection();
    setQuery(text);
    input.current?.focus();
  }, []);
  const startTask = useCallback(
    (agent: MobileAgent, text: string) => {
      const task = text.trim();
      if (!task || sending) return;
      setSending(true);
      workspace()
        .startAgentTask({ agentId: agent.id, text: task, clientMessageId: Crypto.randomUUID() }, serverId)
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
    canUseTasks,
    target,
    chooseTarget,
    clearTarget,
    fillTask,
    targetMatches,
    startTask,
    submit,
    sending,
    notice,
  };
}

/** The room between the status bar and the first result. */
const RESULTS_TOP_GAP = 8;

/**
 * The results over the home list. They come in from 8 pt below as the field takes focus. The bar
 * hides its buttons while they show, so they start under the status bar, not under the bar.
 */
export function HomeSearchResults({ search }: { search: HomeSearch }) {
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
          paddingTop: insets.top + RESULTS_TOP_GAP,
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
  const idle = <HomeSearchIdle onLeave={search.leave} canUseTasks={search.canUseTasks} />;
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
          {target ? <TaskEditorPage agent={target} search={search} /> : null}
          {!target && text && search.canUseTasks && agents.length > 0 ? (
            <>
              <SearchCaption label={t("mobile.search.task.newTextFor", { text })} />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerClassName="gap-3.5 px-5 pt-1 pb-1.5"
              >
                {agents.map((agent) => (
                  <AgentChip key={agent.id} agent={agent} onPress={() => search.chooseTarget(agent, text)} />
                ))}
              </ScrollView>
            </>
          ) : null}
          {!target && text && search.canUseTasks ? <SearchTasks query={text} onLeave={search.leave} /> : null}
          {/* Text to an agent is a task, not a search. */}
          {target ? null : (
            <MobileSearchResults query={search.query} active={search.open} idle={idle} onLeave={search.leave} />
          )}
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

/** The field at the bottom of home. It rides on the keyboard, and a close button comes in beside it. */
export function HomeSearchBar({ search }: { search: HomeSearch }) {
  const { t } = useText();
  const insets = useSafeAreaInsets();
  const liquidGlass = useLiquidGlass();
  const reduced = useReducedMotion();
  const [foreground, muted, fieldBackground, background] = useThemeColor([
    "foreground",
    "muted",
    "default",
    "background",
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
    ? t("mobile.search.task.placeholder")
    : search.canUseTasks
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
          <Animated.View
            entering={reduced ? undefined : closeButtonGrow}
            exiting={reduced ? undefined : closeButtonShrink}
          >
            <GlassCapsule
              liquidGlass={liquidGlass}
              fallbackBackground={fieldBackground}
              width={HOME_SEARCH_HEIGHT}
              animateGlass
            >
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
                  <TargetChip agent={target} onPress={search.clearTarget} />
                </Animated.View>
              ) : (
                <Search color={String(muted)} size={18} strokeWidth={2} />
              )}
              <TextInput
                ref={search.input}
                accessibilityLabel={target ? t("mobile.search.task.fieldLabel", { name: target.name }) : placeholder}
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
              {/* Search updates as you type; only a task has a send button. */}
              {target ? (
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

/** The widest name in the agent chip of the search field. */
const TARGET_NAME_WIDTH = 80;

/**
 * The agent that gets the task: its avatar and name in its own color. A tap chooses another agent,
 * as Backspace in the empty field does; it has no remove mark, so the text field keeps the width.
 */

function TargetChip({ agent, onPress }: { agent: MobileAgent; onPress: () => void }) {
  const { t } = useText();
  const color = getBloubAvatarColor(agent.avatarSeed, agent.avatarHue);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("mobile.search.task.changeAgent")}
      className="-ml-2.5 h-10 flex-row items-center gap-1 rounded-full pr-2.5 pl-1"
      // 40 pt in the 52 pt field: the same 6 pt inset above, below and at the left edge.
      // The agent color at 18% opacity, so the avatar in the same color stays visible on it.
      style={{ backgroundColor: `${color}2e` }}
      onPress={onPress}
    >
      <BloubAvatar
        agentId={agent.id}
        serverId={agent.serverId}
        hue={agent.avatarHue}
        seed={agent.avatarSeed}
        size={28}
        animateIdle={false}
      />
      {/* A long name ends in an ellipsis, so the text field keeps most of the width. */}
      <Typography.Paragraph
        className="font-semibold"
        numberOfLines={1}
        style={[typeScale.preview, { color, maxWidth: TARGET_NAME_WIDTH }]}
      >
        {agent.name}
      </Typography.Paragraph>
    </Pressable>
  );
}

/** Glass where the system has it; a solid capsule elsewhere, and with Reduce Transparency on. */
function GlassCapsule({
  liquidGlass,
  fallbackBackground,
  width,
  animateGlass = false,
  children,
}: PropsWithChildren<{
  liquidGlass: boolean;
  fallbackBackground: unknown;
  width?: number;
  /** The glass comes in with the native glass animation, for a capsule that mounts on screen. */
  animateGlass?: boolean;
}>) {
  return (
    <GlassView
      glassEffectStyle={
        animateGlass
          ? { style: liquidGlass ? "regular" : "none", animate: true, animationDuration: 0.22 }
          : liquidGlass
            ? "regular"
            : "none"
      }
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
function HomeSearchIdle({ onLeave, canUseTasks }: { onLeave: () => void; canUseTasks: boolean }) {
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
      ...(hasServer && canUseTasks
        ? [
            {
              id: "tasks",
              label: t("mobile.app.route.tasks"),
              icon: SquareCheck,
              href: { pathname: "/server-tasks", params: { serverId } } as const,
            },
          ]
        : []),
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
    [t, hasServer, hasHiddenChats, serverId, canUseTasks],
  );
  const openChat = (agent: MobileAgent) => {
    onLeave();
    if (!gate?.openFromHome(agent.id)) router.push({ pathname: "/chat/[agentId]", params: { agentId: agent.id } });
  };
  return (
    <View className="pb-2">
      {canUseTasks ? <SearchTasks onLeave={onLeave} /> : null}
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
      {canUseTasks ? <SearchHint text={t("mobile.search.task.atHint")} /> : null}
    </View>
  );
}

/** The most ideas that the task editor shows. */
const IDEA_LIMIT = 4;
/** Marks the place of the agent name in a translated line, so the name can have its own weight. */
const NAME_MARK = "\u2063";

/**
 * The page above the field while it holds a task: no cards. Who gets the task, one line on what a
 * task is with a way to message the agent instead, earlier tasks to run again, and the agent's open
 * tasks. A tap on an idea fills the field.
 */
function TaskEditorPage({ agent, search }: { agent: MobileAgent; search: HomeSearch }) {
  const { t } = useText();
  const gate = useContext(ChatNavigationGateContext);
  const muted = String(useThemeColor("muted"));
  const color = getBloubAvatarColor(agent.avatarSeed, agent.avatarHue);
  const { tasks } = useServerTasks(agent.serverId, { agentId: agent.id });
  const sorted = [...tasks].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const ideas = [...new Set(sorted.filter((task) => !isAgentTaskOpen(task)).map((task) => task.title.trim()))]
    .filter(Boolean)
    .slice(0, IDEA_LIMIT);
  const open = sorted.filter((task) => task.state === "running" || taskNeedsYou(task));
  const [before = "", after = ""] = t("mobile.search.task.newFor", { name: NAME_MARK }).split(NAME_MARK);
  const message = () => {
    search.leave();
    if (!gate?.openFromHome(agent.id)) router.push({ pathname: "/chat/[agentId]", params: { agentId: agent.id } });
  };
  return (
    // The spacing of the prototype: 4 pt above the page, 8 pt beside the avatar, 10 pt above the line.
    <View className="pb-2">
      <View className="gap-2.5 px-5 pt-1">
        <View className="flex-row items-center gap-2">
          <BloubAvatar
            agentId={agent.id}
            serverId={agent.serverId}
            hue={agent.avatarHue}
            seed={agent.avatarSeed}
            size={40}
            animateIdle={false}
          />
          <Typography.Paragraph
            accessibilityRole="header"
            className="min-w-0 flex-1 font-semibold"
            numberOfLines={2}
            style={typeScale.taskHeading}
          >
            {before}
            <Typography.Paragraph className="font-bold" style={typeScale.taskHeading}>
              {agent.name}
            </Typography.Paragraph>
            {after}
          </Typography.Paragraph>
        </View>
        <View className="flex-row items-start gap-2">
          <View className="pt-0.5">
            <SquareCheck color={muted} size={16} strokeWidth={1.8} />
          </View>
          <Typography.Paragraph className="min-w-0 flex-1 text-muted" style={typeScale.caption}>
            {t("mobile.search.task.how", { name: agent.name })}{" "}
            <Typography.Paragraph
              accessibilityRole="link"
              className="font-medium"
              style={[typeScale.caption, { color }]}
              onPress={message}
            >
              {t("mobile.search.task.message", { name: agent.name })}
            </Typography.Paragraph>
          </Typography.Paragraph>
        </View>
      </View>
      {ideas.length > 0 ? (
        <View className="pt-1.5">
          <SearchCaption label={t("mobile.search.task.ideas")} />
          {ideas.map((idea) => (
            <Pressable
              key={idea}
              accessibilityRole="button"
              accessibilityHint={t("mobile.search.task.ideaHint")}
              className="flex-row items-center gap-3 px-5 py-[9px]"
              style={({ pressed }) => ({ opacity: pressed ? 0.58 : 1 })}
              onPress={() => search.fillTask(idea)}
            >
              <ListRestart color={muted} size={18} strokeWidth={1.8} />
              <Typography.Paragraph className="min-w-0 flex-1" numberOfLines={1} style={typeScale.body}>
                {idea}
              </Typography.Paragraph>
              <Typography.Paragraph className="text-muted" style={typeScale.small}>
                {t("mobile.search.task.again")}
              </Typography.Paragraph>
            </Pressable>
          ))}
        </View>
      ) : null}
      {open.length > 0 ? (
        <View className="pt-1.5">
          <SearchCaption label={t("mobile.search.task.openWith", { name: agent.name })} />
          {open.map((task) => (
            <TaskListRow
              key={task.id}
              task={task}
              tintAgent={agent}
              onPress={() => {
                search.leave();
                router.push({
                  pathname: "/task/[taskId]",
                  params: { serverId: agent.serverId, agentId: agent.id, taskId: task.id },
                });
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** The most tasks that a search section shows. */
const SEARCH_TASK_LIMIT = 5;

/**
 * Tasks in the search: with a query, the tasks whose title has it; without one, the tasks that
 * need the person. Nothing when no task fits.
 */
function SearchTasks({ query, onLeave }: { query?: string; onLeave: () => void }) {
  const { t } = useText();
  const serverId = useMobileWorkspaceSelector((current) => current.activeServer.id);
  const { agents, tasks } = useServerTasks(serverId);
  const needle = query?.toLocaleLowerCase();
  const shown = tasks
    .filter((task) =>
      needle ? task.title.toLocaleLowerCase().includes(needle) : isAgentTaskOpen(task) && taskNeedsYou(task),
    )
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, SEARCH_TASK_LIMIT);
  if (shown.length === 0) return null;
  return (
    <View>
      <SearchCaption label={t(needle ? "mobile.app.route.tasks" : "mobile.server.tasks.section.needsYou")} />
      {shown.map((task) => (
        <TaskListRow
          key={task.id}
          task={task}
          agent={agents.find((agent) => agent.id === task.agentId)}
          dimmed={!isAgentTaskOpen(task)}
          onPress={() => {
            onLeave();
            router.push({
              pathname: "/task/[taskId]",
              params: { serverId, agentId: task.agentId, taskId: task.id },
            });
          }}
        />
      ))}
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
