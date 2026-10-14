import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { useEffect, useState } from "react";
import { View } from "react-native";
import Animated, { LinearTransition, ReduceMotion } from "react-native-reanimated";

import {
  EASE_OUT_CSS,
  type OnboardingMotion,
  popEntering,
  swapEntering,
  swapExiting,
} from "@/features/onboarding/components/onboarding-motion";
import { SPLASH_EASE_OUT } from "@/shared/lib/splash-motion";

// The agent "types" for a moment before it speaks, as in a chat.
export const TYPING_MS = 700;
const DOT = {
  from: { opacity: 0.35, transform: [{ translateY: 0 }] },
  to: { opacity: 1, transform: [{ translateY: -3 }] },
};
const RESIZE = LinearTransition.duration(180).easing(SPLASH_EASE_OUT).reduceMotion(ReduceMotion.System);

function TypingDots() {
  const muted = String(useThemeColor("muted"));
  return (
    <View className="h-7 flex-row items-center gap-1.5 px-1">
      {[0, 1, 2].map((index) => (
        <Animated.View
          key={index}
          className="size-2 rounded-full"
          style={{
            backgroundColor: muted,
            animationName: DOT,
            animationDuration: 360,
            animationDelay: index * 120,
            animationDirection: "alternate",
            animationIterationCount: "infinite",
            animationTimingFunction: EASE_OUT_CSS,
          }}
        />
      ))}
    </View>
  );
}

/**
 * What the agent says. The bubble pops in, shows that the agent is typing, then its words. A text
 * that changes in place, such as a name being typed, grows the bubble instead of replacing it.
 */
export function SpeechBubble({
  text,
  textKey = text,
  motion,
  tail,
  delay = 0,
}: {
  text: string;
  /** The words fade to the new ones when this changes. Typing keeps one key. */
  textKey?: string;
  motion: OnboardingMotion;
  /** Where the bubble points: down to the agent below it, or up to the agent in the header. */
  tail: "bottom" | "top";
  delay?: number;
}) {
  const typing = motion === "full";
  const [spoken, setSpoken] = useState(!typing);
  useEffect(() => {
    if (spoken) return;
    const timer = setTimeout(() => setSpoken(true), delay + TYPING_MS);
    return () => clearTimeout(timer);
  }, [delay, spoken]);

  return (
    <Animated.View
      entering={popEntering(motion, delay)}
      layout={motion === "none" ? undefined : RESIZE}
      className={tail === "bottom" ? "items-center self-center" : "items-start self-start"}
    >
      {tail === "top" ? <Tail placement="top" /> : null}
      <View
        className="max-w-80 rounded-[22px] bg-grouped px-4 py-3"
        style={{ borderCurve: "continuous" }}
        accessibilityLiveRegion="polite"
      >
        {spoken ? (
          <Animated.View key={textKey} entering={swapEntering(motion)} exiting={swapExiting(motion)}>
            <Typography.Heading
              type="h4"
              accessibilityRole="header"
              align={tail === "bottom" ? "center" : "start"}
              className="tracking-openbot-tight"
            >
              {text}
            </Typography.Heading>
          </Animated.View>
        ) : (
          <TypingDots />
        )}
      </View>
      {tail === "bottom" ? <Tail placement="bottom" /> : null}
    </Animated.View>
  );
}

/** A small corner of the bubble that points at the agent. */
function Tail({ placement }: { placement: "top" | "bottom" }) {
  return (
    <View
      className="size-3.5 bg-grouped"
      style={{
        transform: [{ rotate: "45deg" }],
        marginTop: placement === "bottom" ? -8 : 0,
        marginBottom: placement === "top" ? -8 : 0,
        marginLeft: placement === "top" ? 20 : 0,
        borderRadius: 3,
      }}
    />
  );
}
