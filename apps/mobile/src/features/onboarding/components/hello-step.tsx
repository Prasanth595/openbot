import { useIsFocused } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { CalendarCheck, Code, type LucideIcon, PenLine, Search } from "lucide-react-native";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FloatingBot, type SceneBot } from "@/features/agents/components/empty-agents-scene";
import {
  EASE_OUT_CSS,
  type OnboardingMotion,
  popEntering,
  STAGGER_MS,
} from "@/features/onboarding/components/onboarding-motion";
import { useText } from "@/shared/lib/text";

// A group of characters fills the top of the welcome, the biggest one in the middle, the others
// close round it at different sizes, as in a group photo. The positions are shares of the group
// area, so the group keeps its shape on any phone. The first one is the only one that animates its
// face; the others hold it and float.
const CROWD: readonly SceneBot[] = [
  { seed: "onboarding:hello:main", hue: 245, mood: "responded", size: 124, x: "50%", y: "54%", floatMs: 3200 },
  { seed: "onboarding:hello:left", hue: 30, mood: "idle", size: 78, x: "21%", y: "62%", floatMs: 2800 },
  { seed: "onboarding:hello:right", hue: 185, mood: "waiting", size: 86, x: "80%", y: "60%", floatMs: 3600 },
  { seed: "onboarding:hello:top-left", hue: 320, mood: "asleep", size: 60, x: "28%", y: "27%", floatMs: 3400 },
  { seed: "onboarding:hello:top-right", hue: 150, mood: "responded", size: 64, x: "72%", y: "25%", floatMs: 3000 },
  { seed: "onboarding:hello:top", hue: 280, mood: "waiting", size: 40, x: "50%", y: "12%", floatMs: 2600 },
  { seed: "onboarding:hello:far-left", hue: 55, mood: "idle", size: 42, x: "8%", y: "38%", floatMs: 3300 },
  { seed: "onboarding:hello:far-right", hue: 0, mood: "asleep", size: 44, x: "92%", y: "36%", floatMs: 2900 },
  { seed: "onboarding:hello:bottom-left", hue: 215, mood: "idle", size: 50, x: "33%", y: "88%", floatMs: 3100 },
  { seed: "onboarding:hello:bottom-right", hue: 100, mood: "responded", size: 46, x: "67%", y: "89%", floatMs: 3500 },
];

// The kinds of work agents do float between them as small badges.
const BADGES: readonly { id: string; icon: LucideIcon; x: `${number}%`; y: `${number}%`; floatMs: number }[] = [
  { id: "code", icon: Code, x: "12%", y: "13%", floatMs: 3000 },
  { id: "write", icon: PenLine, x: "88%", y: "11%", floatMs: 3400 },
  { id: "plan", icon: CalendarCheck, x: "10%", y: "84%", floatMs: 2800 },
  { id: "search", icon: Search, x: "90%", y: "82%", floatMs: 3200 },
];
const BADGE_SIZE = 40;
const BADGE_POP = {
  from: { opacity: 0, transform: [{ translateY: 10 }, { scale: 0.9 }] },
  to: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] },
};
const BADGE_FADE = { from: { opacity: 0 }, to: { opacity: 1 } };
const BADGE_FLOAT = { from: { transform: [{ translateY: 0 }] }, to: { transform: [{ translateY: -5 }] } };
// The badges arrive after the characters.
const BADGE_DELAY_MS = 420;
// The group takes the top three fifths; the text is centred in the rest, above the main action.
const CROWD_SHARE = 3;
const TEXT_SHARE = 2;

/** The share of the group area, from "17%" to 0.17. */
function share(value: `${number}%`): number {
  return Number.parseFloat(value) / 100;
}

/**
 * A layer that holds one member of the group. When the user goes on, it flies off the screen away
 * from the middle of the group, tilts and fades.
 */
function Departure({
  x,
  y,
  index,
  reach,
  leaving,
  children,
}: {
  x: `${number}%`;
  y: `${number}%`;
  index: number;
  reach: number;
  leaving: boolean;
  children: ReactNode;
}) {
  const dx = share(x) - 0.5;
  const dy = share(y) - 0.5;
  const length = Math.hypot(dx, dy) || 1;
  return (
    <Animated.View
      pointerEvents="none"
      className="absolute inset-0"
      style={{
        opacity: leaving ? 0 : 1,
        transform: [
          { translateX: leaving ? (dx / length) * reach : 0 },
          { translateY: leaving ? (dy / length) * reach : 0 },
          { rotate: leaving ? `${dx < 0 ? -18 : 18}deg` : "0deg" },
        ],
        transitionProperty: ["opacity", "transform"],
        transitionDuration: 300,
        transitionDelay: leaving ? index * 18 : 0,
        transitionTimingFunction: EASE_OUT_CSS,
      }}
    >
      {children}
    </Animated.View>
  );
}

function Badge({
  badge,
  index,
  motion,
  focused,
}: {
  badge: (typeof BADGES)[number];
  index: number;
  motion: OnboardingMotion;
  focused: boolean;
}) {
  const muted = String(useThemeColor("muted"));
  const Icon = badge.icon;
  // The whole badge pops in and floats; the icon stays in its centre.
  return (
    <Animated.View
      className="absolute"
      style={{
        left: badge.x,
        top: badge.y,
        marginLeft: -BADGE_SIZE / 2,
        marginTop: -BADGE_SIZE / 2,
        animationName: motion === "full" ? BADGE_POP : BADGE_FADE,
        animationDuration: motion === "none" ? 0 : 300,
        animationDelay: BADGE_DELAY_MS + index * 60,
        animationFillMode: "backwards",
        animationTimingFunction: EASE_OUT_CSS,
      }}
    >
      <Animated.View
        className="items-center justify-center rounded-full bg-grouped"
        style={[
          { width: BADGE_SIZE, height: BADGE_SIZE },
          motion === "full"
            ? {
                animationName: BADGE_FLOAT,
                animationDuration: badge.floatMs,
                animationDelay: BADGE_DELAY_MS + 300,
                animationDirection: "alternate",
                animationIterationCount: "infinite",
                animationPlayState: focused ? "running" : "paused",
              }
            : null,
        ]}
      >
        <Icon size={18} color={muted} strokeWidth={1.9} />
      </Animated.View>
    </Animated.View>
  );
}

/**
 * The welcome: a group of agents and what they do. When the user goes on, the group flies off the
 * screen, each member away from the middle, and the text fades.
 */
export function HelloStep({ motion, leaving }: { motion: OnboardingMotion; leaving: boolean }) {
  const { t } = useText();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const [area, setArea] = useState({ width: 0, height: 0 });
  const reach = Math.max(area.width, area.height) * 0.9;
  const fade = {
    opacity: leaving ? 0 : 1,
    transitionProperty: "opacity" as const,
    transitionDuration: 200,
    transitionTimingFunction: EASE_OUT_CSS,
  };
  return (
    <View className="flex-1" style={{ paddingTop: insets.top + 8 }}>
      <View
        style={{ flex: CROWD_SHARE }}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        onLayout={({ nativeEvent: { layout } }) => setArea({ width: layout.width, height: layout.height })}
      >
        {CROWD.map((bot, index) => (
          <Departure key={bot.seed} x={bot.x} y={bot.y} index={index} reach={reach} leaving={leaving}>
            <FloatingBot bot={bot} index={index} reducedMotion={motion !== "full"} focused={focused} />
          </Departure>
        ))}
        {BADGES.map((badge, index) => (
          <Departure
            key={badge.id}
            x={badge.x}
            y={badge.y}
            index={CROWD.length + index}
            reach={reach}
            leaving={leaving}
          >
            <Badge badge={badge} index={index} motion={motion} focused={focused} />
          </Departure>
        ))}
      </View>
      {/* The text sits in the middle of the space between the group and the main action. */}
      <Animated.View className="items-center justify-center px-8" style={[{ flex: TEXT_SHARE }, fade]}>
        <Animated.View entering={popEntering(motion, STAGGER_MS * 4)} className="items-center gap-3">
          <Typography.Heading type="h2" align="center" accessibilityRole="header" className="tracking-openbot-tight">
            {t("mobile.onboarding.hello.title")}
          </Typography.Heading>
          <Typography.Paragraph align="center" color="muted">
            {t("mobile.onboarding.hello.body")}
          </Typography.Paragraph>
        </Animated.View>
      </Animated.View>
    </View>
  );
}
