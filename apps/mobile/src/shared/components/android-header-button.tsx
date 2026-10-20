import { router, Stack } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import type { LucideIcon } from "lucide-react-native";
import ArrowLeft from "lucide-react-native/icons/arrow-left";
import { useLayoutEffect, useMemo, useRef } from "react";
import { Pressable } from "react-native";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

/**
 * A header button for Android. `Stack.Toolbar.Button` on Android shows only an image icon, so a
 * button with an SF Symbol or a text label does not appear. iOS keeps `Stack.Toolbar`. A button
 * with `text` shows that text instead of an icon.
 *
 * The header options change only when the button looks different. New options make the navigator
 * set them again and Android rebuild the toolbar, which a form did on every key press before.
 */
export function AndroidHeaderButton({
  placement,
  icon: Icon,
  text,
  accessibilityLabel,
  hidden = false,
  disabled = false,
  onPress,
}: {
  placement: "left" | "right";
  accessibilityLabel: string;
  hidden?: boolean;
  disabled?: boolean;
  onPress: () => void;
} & ({ icon: LucideIcon; text?: undefined } | { icon?: undefined; text: string })) {
  const foreground = String(useThemeColor("foreground"));
  const press = useRef(onPress);
  useLayoutEffect(() => {
    press.current = onPress;
  });
  const options = useMemo(() => {
    const button = hidden
      ? undefined
      : () => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            accessibilityState={{ disabled }}
            disabled={disabled}
            hitSlop={4}
            className={`${text ? "h-11 px-3" : "size-11"} items-center justify-center rounded-full`}
            style={({ pressed }) => ({ opacity: disabled ? 0.4 : pressed ? 0.6 : 1 })}
            onPress={() => press.current()}
          >
            {Icon ? (
              <Icon color={foreground} size={22} strokeWidth={1.9} />
            ) : (
              <Typography.Paragraph weight="semibold" style={{ color: foreground }}>
                {text}
              </Typography.Paragraph>
            )}
          </Pressable>
        );
    return placement === "left" ? { headerLeft: button } : { headerRight: button };
  }, [Icon, accessibilityLabel, disabled, foreground, hidden, placement, text]);
  return <Stack.Screen options={options} />;
}

/**
 * The back button of a full screen on Android, drawn as the home header buttons are. iOS keeps the
 * native Liquid Glass back button of the stack.
 */
export function AndroidBackButton() {
  const { t } = useText();
  if (!isAndroid) return null;
  return (
    <AndroidHeaderButton
      placement="left"
      icon={ArrowLeft}
      accessibilityLabel={t("common.back")}
      onPress={() => {
        void haptics.impact("soft");
        router.back();
      }}
    />
  );
}
