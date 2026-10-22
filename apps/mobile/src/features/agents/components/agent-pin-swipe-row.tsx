import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Mail from "lucide-react-native/icons/mail";
import MailOpen from "lucide-react-native/icons/mail-open";
import Pin from "lucide-react-native/icons/pin";
import PinOff from "lucide-react-native/icons/pin-off";
import type { PropsWithChildren } from "react";
import { Pressable, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, { type SharedValue, useAnimatedStyle } from "react-native-reanimated";
import { useAppDrawer } from "@/features/servers/components/app-drawer-shell";
import { useText } from "@/shared/lib/text";

import { PIN_REVEAL_DISTANCE, useAgentPinSwipe } from "./use-agent-pin-swipe";

function RowActions({
  agentName,
  pinned = false,
  pinBlocked,
  unread,
  readMode,
  readDisabled,
  revealed,
  translation,
  onPress,
  onRead,
}: {
  agentName: string;
  pinned?: boolean;
  pinBlocked: boolean;
  unread: boolean;
  readMode: "toggle" | "read";
  readDisabled: boolean;
  revealed: boolean;
  translation: SharedValue<number>;
  onPress: () => void;
  onRead: () => void;
}) {
  const [accent, accentForeground, control, foreground] = useThemeColor([
    "accent",
    "accent-foreground",
    "default",
    "default-foreground",
  ]);
  const { t } = useText();
  const marksRead = readMode === "read" || unread;
  const ReadIcon = marksRead ? MailOpen : Mail;
  const readLabel = t(marksRead ? "mobile.agent.menu.markRead" : "mobile.agent.menu.markUnread");
  const actionStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: Math.min(0, (translation.get() + PIN_REVEAL_DISTANCE) / 2) }],
  }));

  return (
    <Animated.View
      className="flex-row items-stretch gap-1 py-1 pr-2"
      style={[{ width: PIN_REVEAL_DISTANCE }, actionStyle]}
      accessibilityElementsHidden={!revealed}
      importantForAccessibility={revealed ? "auto" : "no-hide-descendants"}
    >
      <Pressable
        accessibilityLabel={readLabel}
        accessibilityRole="button"
        accessibilityState={{ disabled: readDisabled }}
        disabled={readDisabled}
        className="min-w-0 flex-1 items-center justify-center gap-1 rounded-xl px-1"
        onPress={onRead}
        style={({ pressed }) => ({ backgroundColor: accent, opacity: readDisabled ? 0.45 : pressed ? 0.72 : 1 })}
      >
        <ReadIcon color={String(accentForeground)} size={22} strokeWidth={1.8} />
        <Typography.Paragraph type="body-xs" align="center" weight="semibold" style={{ color: accentForeground }}>
          {readLabel}
        </Typography.Paragraph>
      </Pressable>
      <Pressable
        accessibilityLabel={t(pinned ? "mobile.agent.pin.unpinNamed" : "mobile.agent.pin.pinNamed", {
          name: agentName,
        })}
        accessibilityRole="button"
        accessibilityState={{ disabled: pinBlocked }}
        accessibilityHint={pinBlocked ? t("mobile.agent.pin.limitReached") : undefined}
        disabled={pinBlocked}
        className="min-w-0 flex-1 items-center justify-center gap-1 rounded-xl px-1"
        onPress={onPress}
        style={({ pressed }) => ({ backgroundColor: control, opacity: pinBlocked ? 0.45 : pressed ? 0.72 : 1 })}
      >
        {pinned ? (
          <PinOff color={String(foreground)} size={22} strokeWidth={1.8} />
        ) : (
          <Pin color={String(foreground)} fill={String(foreground)} size={22} strokeWidth={1.8} />
        )}
        <Typography.Paragraph type="body-xs" weight="semibold" style={{ color: foreground }}>
          {t(pinned ? "mobile.agent.pin.unpin" : "mobile.agent.pin.pin")}
        </Typography.Paragraph>
      </Pressable>
    </Animated.View>
  );
}

export function AgentPinSwipeRow({
  agentName,
  pinned = false,
  pinBlocked,
  unread,
  readMode = "toggle",
  readDisabled = false,
  onPin,
  onRead,
  children,
}: PropsWithChildren<{
  agentName: string;
  pinned?: boolean;
  pinBlocked: boolean;
  unread: boolean;
  /** Channels support read receipts, but have no released unread command. */
  readMode?: "toggle" | "read";
  readDisabled?: boolean;
  onPin: (withHaptic: boolean) => void;
  onRead: () => void;
}>) {
  const [background] = useThemeColor(["background"]);
  const { openingGesture } = useAppDrawer();
  const swipe = useAgentPinSwipe(openingGesture, onPin, pinBlocked);
  const { t } = useText();

  return (
    <GestureDetector gesture={swipe.gesture}>
      <ReanimatedSwipeable
        ref={swipe.swipeable}
        enabled={!swipe.pinPending}
        containerStyle={{ backgroundColor: background, overflow: "hidden" }}
        childrenContainerStyle={{ backgroundColor: background }}
        friction={1}
        overshootRight
        overshootFriction={1}
        rightThreshold={PIN_REVEAL_DISTANCE / 2}
        enableTrackpadTwoFingerGesture
        simultaneousWithExternalGesture={swipe.gesture}
        requireExternalGestureToFail={openingGesture}
        onSwipeableWillOpen={swipe.onWillOpen}
        onSwipeableWillClose={swipe.onWillClose}
        onSwipeableClose={swipe.onClose}
        renderRightActions={(_progress, translation) => (
          <RowActions
            revealed={swipe.revealed}
            agentName={agentName}
            pinned={pinned}
            pinBlocked={pinBlocked}
            unread={unread}
            readMode={readMode}
            readDisabled={readDisabled}
            translation={translation}
            onPress={() => swipe.pin()}
            onRead={() => {
              swipe.close();
              onRead();
            }}
          />
        )}
      >
        <View
          pointerEvents={swipe.revealed ? "none" : "auto"}
          accessibilityElementsHidden={swipe.revealed}
          importantForAccessibility={swipe.revealed ? "no-hide-descendants" : "auto"}
        >
          {children}
        </View>
        {swipe.revealed ? (
          <Pressable
            className="absolute inset-0"
            accessibilityRole="button"
            accessibilityLabel={t("mobile.agent.pin.closeAction", { name: agentName })}
            onPress={swipe.close}
          />
        ) : null}
      </ReanimatedSwipeable>
    </GestureDetector>
  );
}
