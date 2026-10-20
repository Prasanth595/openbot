import { GlassView } from "expo-glass-effect";
import { type Href, router } from "expo-router";
import { HeaderHeightContext } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import type { LucideIcon } from "lucide-react-native";
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
import { MobileSearchResults, SearchCaption } from "@/features/search/components/mobile-search-results";
import { setHomeSearchOpener } from "@/features/search/model/home-search-request";
import { useAppDrawer } from "@/features/servers/components/app-drawer-shell";
import { type MobileAgent, useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { useText } from "@/shared/lib/text";
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

export interface HomeSearch {
  open: boolean;
  /** True while the results show or leave. */
  mounted: boolean;
  query: string;
  setQuery: (query: string) => void;
  openSearch: () => void;
  closeSearch: () => void;
  /** Closes the search for a result that opens another screen. */
  leave: () => void;
  input: RefObject<TextInput | null>;
  progress: SharedValue<number>;
}

/** The state of the search field at the bottom of home and of the results it opens over the list. */
export function useHomeSearch(): HomeSearch {
  const { setOpeningBlocked } = useAppDrawer();
  const input = useRef<TextInput>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const progress = useSharedValue(0);

  const openSearch = useCallback(() => {
    setOpen(true);
    setMounted(true);
    // The results take the screen, so a swipe right must not open the drawer under them.
    setOpeningBlocked(true);
    progress.set(withTiming(1, OPEN));
  }, [progress, setOpeningBlocked]);
  const closeSearch = useCallback(() => {
    input.current?.blur();
    Keyboard.dismiss();
    setOpen(false);
    setQuery("");
    setOpeningBlocked(false);
    progress.set(
      withTiming(0, CLOSE, (finished) => {
        if (finished) scheduleOnRN(setMounted, false);
      }),
    );
  }, [progress, setOpeningBlocked]);

  useEffect(() => () => setOpeningBlocked(false), [setOpeningBlocked]);
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

  return { open, mounted, query, setQuery, openSearch, closeSearch, leave: closeSearch, input, progress };
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
      style={style}
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
        <MobileSearchResults
          query={search.query}
          active={search.open}
          idle={<HomeSearchIdle onLeave={search.leave} />}
          onLeave={search.leave}
        />
      </KeyboardAwareScrollView>
    </Animated.View>
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

  return (
    <Animated.View
      className="absolute right-4 left-4 flex-row items-center gap-2"
      pointerEvents="box-none"
      style={[{ bottom: bottomGap }, barStyle]}
    >
      {search.open ? (
        <Animated.View
          entering={reduced ? undefined : closeButtonEnter}
          exiting={reduced ? undefined : closeButtonExit}
        >
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
            <Search color={String(muted)} size={18} strokeWidth={2} />
            <TextInput
              ref={search.input}
              accessibilityLabel={t("common.search")}
              autoCapitalize="none"
              autoCorrect={false}
              className="h-10 min-w-0 flex-1 font-sans text-foreground"
              placeholder={t("common.search")}
              placeholderTextColor={muted}
              returnKeyType="search"
              selectionColor={foreground}
              style={{ fontSize: 16, lineHeight: 20, paddingBottom: 0, paddingTop: 0, textAlignVertical: "center" }}
              value={search.query}
              onChangeText={search.setQuery}
              onFocus={() => {
                if (!search.open) search.openSearch();
              }}
            />
            {search.query ? (
              <Animated.View
                entering={reduced ? undefined : closeButtonEnter}
                exiting={reduced ? undefined : closeButtonExit}
              >
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
          </Pressable>
        </GlassCapsule>
      </Animated.View>
    </Animated.View>
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
function HomeSearchIdle({ onLeave }: { onLeave: () => void }) {
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
          <Typography.Paragraph weight="medium" style={typeScale.preview}>
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
