import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { ListGroup, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import FileText from "lucide-react-native/icons/file-text";
import Pencil from "lucide-react-native/icons/pencil";
import { Children, type PropsWithChildren, type ReactNode, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { haptics } from "@/shared/lib/haptics";

export function ProfileIdentity({ name, title, avatar }: { name: string; title: string; avatar: ReactNode }) {
  return (
    <View className="flex-row items-center" style={{ gap: 18 }}>
      {avatar}
      <View className="min-w-0 flex-1 gap-1">
        <Typography.Heading weight="medium" style={styles.name}>
          {name}
        </Typography.Heading>
        {title ? (
          <Typography.Paragraph className="text-muted" style={styles.body}>
            {title}
          </Typography.Paragraph>
        ) : null}
      </View>
    </View>
  );
}

export function ProfileFields({
  name,
  title,
  instructions,
  disabled,
  onChange,
  labels,
  instructionsMaxLength,
  instructionsFooter,
}: {
  name: string;
  title: string;
  instructions: string;
  disabled: boolean;
  labels: {
    name: string;
    title: string;
    titlePlaceholder: string;
    instructions: string;
    instructionsPlaceholder: string;
  };
  instructionsMaxLength?: number;
  instructionsFooter?: ReactNode;
  onChange: (value: { name?: string; title?: string; instructions?: string }) => void;
}) {
  const color = useThemeColor("muted");
  const [editingInstructions, setEditingInstructions] = useState(false);
  return (
    <>
      <View className="overflow-hidden border border-grouped-border bg-team-surface" style={styles.group}>
        <View style={styles.field}>
          <Typography.Paragraph className="text-muted" style={styles.fieldLabel}>
            {labels.name}
          </Typography.Paragraph>
          <SheetFormField
            label={labels.name}
            hideLabel
            appearance="embedded"
            autoCapitalize="words"
            maxLength={INPUT_LIMITS.agentName}
            value={name}
            editable={!disabled}
            onChangeText={(value) => onChange({ name: value })}
          />
        </View>
        <View className="h-px bg-grouped-border" />
        <View style={styles.field}>
          <Typography.Paragraph className="text-muted" style={styles.fieldLabel}>
            {labels.title}
          </Typography.Paragraph>
          <SheetFormField
            label={labels.title}
            hideLabel
            appearance="embedded"
            placeholder={labels.titlePlaceholder}
            maxLength={INPUT_LIMITS.agentTitle}
            value={title}
            editable={!disabled}
            onChangeText={(value) => onChange({ title: value })}
          />
        </View>
      </View>
      <View className="overflow-hidden border border-grouped-border bg-team-surface" style={styles.group}>
        <View className="flex-row items-center gap-2 border-b border-grouped-border pl-4" style={{ minHeight: 44 }}>
          <FileText size={15} color={color} />
          <Typography.Paragraph className="min-w-0 flex-1 text-muted" style={styles.fieldLabel}>
            {labels.instructions}
          </Typography.Paragraph>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={labels.instructions}
            accessibilityState={{ expanded: editingInstructions, disabled }}
            disabled={disabled}
            onPress={() => {
              void haptics.impact("soft");
              setEditingInstructions(true);
            }}
            style={({ pressed }) => ({
              minWidth: 44,
              minHeight: 44,
              alignItems: "center",
              justifyContent: "center",
              opacity: disabled ? 0.45 : pressed ? 0.6 : 1,
            })}
          >
            <Pencil size={16} color={color} />
          </Pressable>
        </View>
        <View className="p-4">
          {editingInstructions ? (
            <SheetFormField
              label={labels.instructions}
              hideLabel
              appearance="embedded"
              placeholder={labels.instructionsPlaceholder}
              multiline
              maxLength={instructionsMaxLength}
              autoFocus
              value={instructions}
              editable={!disabled}
              onChangeText={(value) => onChange({ instructions: value })}
            />
          ) : (
            <Typography.Paragraph selectable className="text-text-secondary" style={styles.instructions}>
              {instructions || labels.instructionsPlaceholder}
            </Typography.Paragraph>
          )}
          {instructionsFooter}
        </View>
      </View>
    </>
  );
}

export function ProfileSection({ title, footer, children }: PropsWithChildren<{ title?: string; footer?: ReactNode }>) {
  return (
    <View style={{ gap: 10 }}>
      {title ? (
        <Typography.Paragraph className="px-1 text-muted" style={styles.sectionLabel}>
          {title}
        </Typography.Paragraph>
      ) : null}
      <ListGroup
        variant="secondary"
        className="overflow-hidden border border-grouped-border bg-team-surface p-0 shadow-none"
        style={styles.group}
      >
        {Children.map(Children.toArray(children), (child, index) => (
          <View>
            {index > 0 ? <View className="h-px bg-grouped-border" /> : null}
            {child}
          </View>
        ))}
      </ListGroup>
      {footer ? (
        <Typography.Paragraph className="px-1 text-muted" type="body-xs">
          {footer}
        </Typography.Paragraph>
      ) : null}
    </View>
  );
}

export function ProfileRow({
  children,
  supportingText,
  leading,
  trailing,
  disclosure = true,
  checked,
  onPress,
  disabled = false,
}: PropsWithChildren<{
  supportingText?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  disclosure?: boolean;
  checked?: boolean;
  onPress?: () => void;
  disabled?: boolean;
}>) {
  const color = useThemeColor("muted");
  const content = (
    <>
      {leading}
      <View className="min-w-0 flex-1">{children}</View>
      {supportingText ? (
        <Typography.Paragraph className="shrink text-muted" style={styles.body}>
          {supportingText}
        </Typography.Paragraph>
      ) : null}
      {trailing ?? (onPress && disclosure ? <ChevronRight size={18} color={color} /> : null)}
    </>
  );
  return onPress ? (
    <ListGroup.Item
      accessibilityRole={checked === undefined ? "button" : "radio"}
      accessibilityState={{ disabled, checked }}
      disabled={disabled}
      onPress={() => {
        void haptics.impact("soft");
        onPress();
      }}
      className="flex-row items-center gap-3 px-4"
      style={({ pressed }) => ({ minHeight: 52, paddingVertical: 12, opacity: disabled ? 0.45 : pressed ? 0.6 : 1 })}
    >
      {content}
    </ListGroup.Item>
  ) : (
    <View className="min-h-13 flex-row items-center gap-3 px-4 py-3">{content}</View>
  );
}

const styles = StyleSheet.create({
  name: { fontFamily: "Inter", fontSize: 48, lineHeight: 52, fontWeight: "500", letterSpacing: -2.4 },
  body: { fontFamily: "Inter", fontSize: 15, lineHeight: 20 },
  group: { borderRadius: 14 },
  field: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, gap: 6 },
  fieldLabel: {
    fontFamily: "Inter",
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "600",
    letterSpacing: 0.66,
    textTransform: "uppercase",
  },
  sectionLabel: {
    fontFamily: "Inter",
    fontSize: 12,
    lineHeight: 15,
    fontWeight: "600",
    letterSpacing: 0.72,
    textTransform: "uppercase",
  },
  instructions: { fontFamily: "Inter", fontSize: 15, lineHeight: 23.25 },
});
