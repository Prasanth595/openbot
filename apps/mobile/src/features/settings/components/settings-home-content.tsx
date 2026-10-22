import { ListGroup, Typography } from "heroui-native";
import type { LucideIcon } from "lucide-react-native";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import type { ReactNode } from "react";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

export function SettingsHomeSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <Typography.Paragraph
        className="text-grouped-secondary"
        style={[typeScale.teamMeta, { textTransform: "uppercase" }]}
      >
        {title}
      </Typography.Paragraph>
      {children}
    </View>
  );
}

export function SettingsHomeRow({
  title,
  subtitle,
  icon: Icon,
  onPress,
}: {
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  onPress: () => void;
}) {
  const color = String(useCSSVariable("--openbot-text-secondary"));
  const dim = String(useCSSVariable("--openbot-text-dim"));
  return (
    <ListGroup.Item
      accessibilityRole="button"
      className="flex-row items-center border border-grouped-border bg-grouped"
      style={({ pressed }) => ({
        minHeight: subtitle ? 64 : 60,
        borderRadius: 14,
        gap: 14,
        paddingHorizontal: 16,
        paddingVertical: 10,
        opacity: pressed ? 0.6 : 1,
      })}
      onPress={() => {
        void haptics.impact("soft");
        onPress();
      }}
    >
      <Icon size={20} color={color} />
      <View className="min-w-0 flex-1" style={{ gap: 2 }}>
        <Typography.Paragraph weight="medium" style={{ fontFamily: "Inter", fontSize: 16, lineHeight: 21 }}>
          {title}
        </Typography.Paragraph>
        {subtitle ? (
          <Typography.Paragraph
            className="text-grouped-secondary"
            style={{ fontFamily: "Inter", fontSize: 13, lineHeight: 17 }}
          >
            {subtitle}
          </Typography.Paragraph>
        ) : null}
      </View>
      <ChevronRight size={18} color={dim} />
    </ListGroup.Item>
  );
}

export function SettingsHomeTile({
  title,
  index,
  icon: Icon,
  onPress,
}: {
  title: string;
  index: number;
  icon: LucideIcon;
  onPress: () => void;
}) {
  const { format } = useText();
  const color = String(useCSSVariable("--openbot-text-primary"));
  return (
    <ListGroup.Item
      accessibilityRole="button"
      accessibilityLabel={title}
      className="min-w-0 flex-1 justify-between border border-grouped-border bg-grouped"
      style={({ pressed }) => ({
        minHeight: 84,
        flexDirection: "column",
        alignItems: "stretch",
        borderRadius: 14,
        padding: 14,
        gap: 12,
        opacity: pressed ? 0.6 : 1,
      })}
      onPress={() => {
        void haptics.impact("soft");
        onPress();
      }}
    >
      <View className="flex-row items-center justify-between">
        <Icon size={20} color={color} />
        <Typography.Paragraph className="text-text-dim" style={typeScale.teamMeta}>
          {format.number(index, { minimumIntegerDigits: 2 })}
        </Typography.Paragraph>
      </View>
      <Typography.Paragraph weight="medium" style={{ fontFamily: "Inter", fontSize: 16, lineHeight: 21 }}>
        {title}
      </Typography.Paragraph>
    </ListGroup.Item>
  );
}
