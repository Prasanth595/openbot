import { ListGroup, Typography } from "heroui-native";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import { Children, type PropsWithChildren, type ReactNode } from "react";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { haptics } from "@/shared/lib/haptics";
import { typeScale } from "@/shared/lib/type-scale";

/** Full-screen server settings keep native navigation and the concept's content gutters. */
export function ServerSettingsContent({ children }: PropsWithChildren) {
  return (
    <SheetScrollView
      className="bg-team-canvas"
      contentContainerClassName="gap-5 px-5 pb-safe-offset-10 pt-2"
      scrollEdgeEffect={false}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </SheetScrollView>
  );
}

export function ServerSettingsSection({
  title,
  footer,
  children,
}: PropsWithChildren<{ title?: string; footer?: ReactNode }>) {
  return (
    <View style={{ gap: 10 }}>
      {title ? (
        <Typography.Paragraph className="px-1 text-muted" style={typeScale.teamMeta}>
          {title}
        </Typography.Paragraph>
      ) : null}
      <ListGroup
        variant="secondary"
        className="overflow-hidden border border-grouped-border bg-grouped p-0 shadow-none"
        style={{ borderRadius: 14 }}
      >
        {Children.map(Children.toArray(children), (child, index) => (
          <View>
            {index > 0 ? <View className="h-px bg-grouped-border" /> : null}
            {child}
          </View>
        ))}
      </ListGroup>
      {footer ? (
        <Typography.Paragraph className="px-1 text-muted" style={{ ...typeScale.caption, fontFamily: "Inter" }}>
          {footer}
        </Typography.Paragraph>
      ) : null}
    </View>
  );
}

export function ServerSettingsRow({
  label,
  icon,
  value,
  disabled = false,
  onPress,
}: {
  label: string;
  icon?: ReactNode;
  value?: ReactNode;
  disabled?: boolean;
  onPress: () => void;
}) {
  const muted = String(useCSSVariable("--openbot-text-dim"));
  return (
    <ListGroup.Item
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        void haptics.impact("soft");
        onPress();
      }}
      className="min-h-13 flex-row items-center gap-3 py-1 pr-1 pl-4"
      style={({ pressed }) => ({ opacity: disabled ? 0.45 : pressed ? 0.6 : 1 })}
    >
      {icon}
      <Typography.Paragraph
        className="min-w-0 flex-1"
        style={{ ...typeScale.rowTitle, fontFamily: "Inter", fontWeight: "500" }}
      >
        {label}
      </Typography.Paragraph>
      {value}
      <View className="min-h-11 w-10 items-center justify-center">
        <ChevronRight size={18} color={muted} strokeWidth={1.5} />
      </View>
    </ListGroup.Item>
  );
}

export function ServerSettingLabel({ children }: PropsWithChildren) {
  return (
    <Typography.Paragraph style={{ ...typeScale.rowTitle, fontFamily: "Inter", fontWeight: "500" }}>
      {children}
    </Typography.Paragraph>
  );
}

export function ServerSettingDescription({ children }: PropsWithChildren) {
  return (
    <Typography.Paragraph className="text-muted" style={{ ...typeScale.caption, fontFamily: "Inter" }}>
      {children}
    </Typography.Paragraph>
  );
}
