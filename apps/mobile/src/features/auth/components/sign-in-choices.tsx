import { Button, Spinner } from "heroui-native";
import type { Ref } from "react";
import { View } from "react-native";
import Animated, { cubicBezier, FadeIn, FadeOut } from "react-native-reanimated";

import { SIGN_IN_CONTROL_HEIGHT, useSignInColors } from "@/features/auth/components/sign-in-colors";
import { SIGN_IN_TEXT_EASE } from "@/features/auth/components/sign-in-motion";
import { haptics } from "@/shared/lib/haptics";

// The iOS sheet curve: the move starts at once and settles without overshoot.
const MOVE_EASING = cubicBezier(0.32, 0.72, 0, 1);
const MOVE_MS = 300;
// A label change is a quiet fade with no movement: the button itself already moves. The old label
// fades out, and the new one fades in as the old one is nearly gone, so two labels never show at
// full strength together.
const LABEL_OUT = FadeOut.duration(120).easing(SIGN_IN_TEXT_EASE);
const LABEL_IN = FadeIn.duration(180).delay(100).easing(SIGN_IN_TEXT_EASE);
/**
 * One of the two sign-in buttons. Both stay on the screen in every step and keep their color: the
 * lavender button is the main action, the gray one the other choice. A step change moves them down
 * or up one slot, and their labels fade to the new ones. The buttons never mount or unmount.
 */
export function SignInChoiceButton({
  ref,
  top,
  brand,
  label,
  labelKey = label,
  onPress,
  busy = false,
  waiting = false,
  hidden = false,
  reduced,
}: {
  /** The frame that the QR scanner grows from. */
  ref?: Ref<View>;
  /** The slot, as the distance from the top of the controls. */
  top: number;
  /** Lavender, or the gray surface. It does not change. */
  brand: boolean;
  label: string;
  /** The label fades to the new one when this changes. A countdown keeps one key. */
  labelKey?: string;
  onPress: () => void;
  /** Shows a spinner and ignores presses. */
  busy?: boolean;
  /** Ignores presses and dims the label, such as during a countdown. */
  waiting?: boolean;
  /** The scanner sheet covers this button and draws its own copy. */
  hidden?: boolean;
  reduced: boolean;
}) {
  const colors = useSignInColors();
  const textColor = brand ? colors.onBrand : colors.text;
  return (
    <Animated.View
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        transform: [{ translateY: top }],
        transitionProperty: "transform",
        transitionDuration: reduced ? 0 : MOVE_MS,
        transitionTimingFunction: MOVE_EASING,
      }}
    >
      <View
        ref={ref}
        collapsable={false}
        className="overflow-hidden"
        style={{ height: SIGN_IN_CONTROL_HEIGHT, opacity: hidden ? 0 : 1 }}
      >
        {/* The same size, fill and label as `ScanQrButton`: the QR scanner opens from this button
            and draws that copy in its place, so any difference shows as a jump. The fill is on the
            button, so the press feedback shrinks fill and label together, as in the copy. */}
        <Button
          size="lg"
          variant="ghost"
          feedbackVariant="scale"
          className="w-full"
          accessibilityLabel={label}
          accessibilityState={{ disabled: waiting, busy }}
          style={{
            height: SIGN_IN_CONTROL_HEIGHT,
            borderRadius: colors.radius,
            backgroundColor: brand ? colors.brand : colors.surface,
          }}
          onPress={() => {
            if (busy || waiting) return;
            void haptics.impact("light");
            onPress();
          }}
        >
          <Animated.View
            key={labelKey}
            entering={reduced ? undefined : LABEL_IN}
            exiting={reduced ? undefined : LABEL_OUT}
            className="flex-row items-center gap-2"
          >
            {busy ? <Spinner size="sm" color={textColor} /> : null}
            <Button.Label className="font-sans font-semibold" style={{ color: textColor, opacity: waiting ? 0.5 : 1 }}>
              {label}
            </Button.Label>
          </Animated.View>
        </Button>
      </View>
    </Animated.View>
  );
}
