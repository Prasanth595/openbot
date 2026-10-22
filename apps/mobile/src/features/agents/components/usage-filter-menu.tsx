import { Typography } from "heroui-native";
import ChevronsUpDown from "lucide-react-native/icons/chevrons-up-down";
import { View } from "react-native";
import { useCSSVariable, useUniwind } from "uniwind";
import { type MenuAction, MenuView } from "@/shared/components/menu-view";
import { haptics } from "@/shared/lib/haptics";

/** Native menu actions with the compact filter surface used by the usage report. */
export function UsageFilterMenu<T extends string>({
  options,
  value,
  label,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  label: string;
  onChange: (value: T) => void;
}) {
  const { theme } = useUniwind();
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const selected = options.find((option) => option.value === value);
  return (
    <MenuView
      colorScheme={theme === "dark" ? "dark" : "light"}
      actions={options.map(
        (option): MenuAction => ({
          id: option.value,
          title: option.label,
          state: option.value === value ? "on" : "off",
        }),
      )}
      onPressAction={({ nativeEvent }) => {
        const option = options.find((item) => item.value === nativeEvent.event);
        if (option) {
          void haptics.selection();
          onChange(option.value);
        }
      }}
    >
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? value}`}
        className="min-h-11 flex-row items-center gap-1.5 rounded-full border border-grouped-border bg-grouped pr-2.5 pl-3.5"
        style={{ maxWidth: 200 }}
      >
        <Typography.Paragraph
          numberOfLines={1}
          weight="medium"
          style={{ fontFamily: "Inter", fontSize: 14, lineHeight: 20, flexShrink: 1 }}
        >
          {selected?.label ?? value}
        </Typography.Paragraph>
        <ChevronsUpDown size={14} color={muted} />
      </View>
    </MenuView>
  );
}
