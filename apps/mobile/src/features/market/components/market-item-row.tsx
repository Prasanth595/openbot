import { Image } from "expo-image";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import type { LucideIcon } from "lucide-react-native";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import { typeScale } from "@/shared/lib/type-scale";

export function MarketItemRow({
  name,
  description,
  meta,
  avatar,
  iconUrl,
  icon: Icon,
  action,
  actionIcon: ActionIcon,
  disabled,
  onPress,
}: {
  name: string;
  description: string;
  meta: string;
  avatar?: ReactNode;
  iconUrl?: string | null;
  icon: LucideIcon;
  action: string;
  actionIcon: LucideIcon;
  disabled?: boolean;
  onPress: () => void;
}) {
  const [failedIcon, setFailedIcon] = useState<string | null>(null);
  const [foreground, accentForeground] = useThemeColor(["foreground", "accent-foreground"]);
  return (
    <View className="flex-row items-start gap-3.5 border-t border-grouped-border py-3.5">
      <View className="min-w-0 flex-1 flex-row items-start gap-3.5">
        <View className="size-11 shrink-0 items-center justify-center">
          {avatar ??
            (iconUrl && failedIcon !== iconUrl ? (
              <Image
                source={{ uri: iconUrl }}
                contentFit="contain"
                style={{ width: 40, height: 40, borderRadius: 12 }}
                onError={() => setFailedIcon(iconUrl)}
              />
            ) : (
              <View className="size-11 items-center justify-center rounded-xl bg-accent">
                <Icon size={20} color={String(accentForeground)} />
              </View>
            ))}
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <Typography.Paragraph style={typeScale.teamName}>{name}</Typography.Paragraph>
          <Typography.Paragraph numberOfLines={2} className="text-muted" style={typeScale.marketDescription}>
            {description}
          </Typography.Paragraph>
          <Typography.Paragraph numberOfLines={2} className="text-muted uppercase" style={typeScale.marketMeta}>
            {meta}
          </Typography.Paragraph>
        </View>
      </View>
      <Button
        variant="secondary"
        size="sm"
        isDisabled={disabled}
        accessibilityLabel={`${action} ${name}`}
        onPress={onPress}
        className="h-auto min-h-11 shrink-0 self-start rounded-full border border-border px-3.5 py-2.5"
      >
        <ActionIcon size={15} color={String(foreground)} />
        <Button.Label className="text-foreground" style={typeScale.marketLabel}>
          {action}
        </Button.Label>
      </Button>
    </View>
  );
}
