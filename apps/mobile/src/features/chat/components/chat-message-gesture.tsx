import { useThemeColor } from "heroui-native/hooks";
import Reply from "lucide-react-native/icons/reply";
import { type PropsWithChildren, useMemo, useRef } from "react";
import { type AccessibilityActionInfo, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { CHAT_BACK_EDGE_WIDTH } from "@/features/chat/model/chat-layout";
import { type MenuAction, MenuView } from "@/shared/components/menu-view";
import { haptics } from "@/shared/lib/haptics";

/** Swipe replies. Touch and hold opens the same menu for every completed message. */
export function ChatMessageGesture({
  children,
  selecting,
  onReply,
  menuActions,
  onAction,
  accessibilityLabel,
  accessibilityActions,
  align,
  maxWidth,
}: PropsWithChildren<{
  selecting: boolean;
  onReply?: () => void;
  menuActions: MenuAction[];
  onAction: (name: string) => void;
  accessibilityLabel: string;
  accessibilityActions: AccessibilityActionInfo[];
  align: "start" | "end";
  /** The native menu measures its own content without the list's percentage width constraints. */
  maxWidth: number;
}>) {
  const muted = useThemeColor("muted");
  const { left } = useSafeAreaInsets();
  const offset = useSharedValue(0);
  const bubbleStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.get() }] }));
  const iconStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, offset.get() / 64) }));
  const handlers = useRef({ onReply });
  handlers.current = { onReply };
  const canReply = Boolean(onReply) && !selecting;
  // Build the gestures once per row. A streaming reply re-renders its row for each chunk, and a new
  // gesture would reconfigure the native handler each time.
  const gesture = useMemo(() => {
    const reply = () => {
      void haptics.impact();
      handlers.current.onReply?.();
    };
    const swipe = Gesture.Pan()
      .enabled(canReply)
      .onTouchesDown((event, manager) => {
        const touch = event.allTouches[0];
        if (!touch || touch.absoluteX <= left + CHAT_BACK_EDGE_WIDTH) manager.fail();
      })
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
    return swipe;
  }, [canReply, left, offset]);

  const bubble = <Animated.View style={[{ maxWidth }, bubbleStyle]}>{children}</Animated.View>;

  return (
    <View className={align === "end" ? "max-w-full self-end" : "max-w-[88%] self-start"}>
      <Animated.View pointerEvents="none" className="absolute bottom-0 left-0 top-0 justify-center" style={iconStyle}>
        <Reply color={muted} size={22} />
      </Animated.View>
      {/* A separate target keeps links and attachments focusable in the content beside it. */}
      {accessibilityActions.length ? (
        <View
          accessible
          accessibilityLabel={accessibilityLabel}
          accessibilityActions={accessibilityActions}
          onAccessibilityAction={({ nativeEvent }) => onAction(nativeEvent.actionName)}
          pointerEvents="none"
          style={{ position: "absolute", inset: 0 }}
        />
      ) : null}
      <GestureDetector gesture={gesture}>
        <MenuView
          shouldOpenOnLongPress
          actions={selecting ? [] : menuActions}
          onPressAction={({ nativeEvent }) => onAction(nativeEvent.event)}
        >
          {bubble}
        </MenuView>
      </GestureDetector>
    </View>
  );
}
