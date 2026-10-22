import { useThemeColor } from "heroui-native/hooks";
import Reply from "lucide-react-native/icons/reply";
import { type PropsWithChildren, useMemo, useRef } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { haptics } from "@/shared/lib/haptics";

/**
 * A swipe to the right replies. A touch and hold copies earlier replies in a burst, or selects
 * text in other replies. A screen reader keeps the full action row for each message.
 */
export function ChatMessageGesture({
  children,
  selecting,
  onReply,
  onSelectText,
  onCopy,
}: PropsWithChildren<{
  /** The text is selected in the bubble: the handles get the touches, not the swipe. */
  selecting: boolean;
  onReply?: () => void;
  onSelectText?: () => void;
  onCopy?: () => void;
}>) {
  const muted = useThemeColor("muted");
  const offset = useSharedValue(0);
  const bubbleStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.get() }] }));
  const iconStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, offset.get() / 64) }));
  const handlers = useRef({ onReply, onSelectText, onCopy });
  handlers.current = { onReply, onSelectText, onCopy };
  const canReply = Boolean(onReply) && !selecting;
  const canHold = Boolean(onCopy || onSelectText) && !selecting;
  // Build the gestures once per row. A streaming reply re-renders its row for each chunk, and a new
  // gesture would reconfigure the native handler each time.
  const gesture = useMemo(() => {
    const reply = () => {
      void haptics.impact();
      handlers.current.onReply?.();
    };
    const holdMessage = () => {
      if (handlers.current.onCopy) handlers.current.onCopy();
      else {
        void haptics.impact();
        handlers.current.onSelectText?.();
      }
    };
    const swipe = Gesture.Pan()
      .enabled(canReply)
      .activeOffsetX(16)
      .failOffsetX(-8)
      .failOffsetY([-12, 12])
      .onUpdate((event) => {
        offset.set(Math.max(0, Math.min(event.translationX, 64) + Math.max(0, event.translationX - 64) * 0.15));
      })
      .onEnd((event) => {
        if (event.translationX >= 64 || (event.translationX >= 24 && event.velocityX >= 650)) scheduleOnRN(reply);
      })
      .onFinalize(() => {
        offset.set(withSpring(0, { duration: 400, dampingRatio: 1, reduceMotion: ReduceMotion.System }));
      });
    const hold = Gesture.LongPress()
      .enabled(canHold)
      .onStart(() => scheduleOnRN(holdMessage));
    return Gesture.Race(swipe, hold);
  }, [canReply, canHold, offset]);

  return (
    <View className="max-w-[88%] self-start">
      <Animated.View pointerEvents="none" className="absolute bottom-0 left-0 top-0 justify-center" style={iconStyle}>
        <Reply color={muted} size={22} />
      </Animated.View>
      <GestureDetector gesture={gesture}>
        <Animated.View style={bubbleStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}
