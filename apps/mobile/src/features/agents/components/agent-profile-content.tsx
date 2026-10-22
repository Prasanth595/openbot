import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { ListGroup, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import FileText from "lucide-react-native/icons/file-text";
import Pencil from "lucide-react-native/icons/pencil";
import { Children, type PropsWithChildren, type ReactNode, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { InstructionsLimit } from "@/features/agents/components/instructions-limit";
import { TeamAgentAvatar } from "@/features/agents/components/team-agent-avatar";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

export function AgentProfileHero({ agent, onAppearance }: { agent: MobileAgent; onAppearance: () => void }) {
  const { t } = useText();
  const ink = useThemeColor("background");
  return (
    <View className="flex-row items-center" style={{ gap: 18 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("mobile.agent.edit.appearance")}
        onPress={onAppearance}
        style={({ pressed }) => ({ width: 96, height: 92, opacity: pressed ? 0.6 : 1 })}
      >
        <TeamAgentAvatar agent={agent} size={84} />
        <View
          className="absolute items-center justify-center rounded-full border-team-canvas bg-foreground"
          style={styles.avatarEdit}
        >
          <Pencil size={17} color={ink} />
        </View>
      </Pressable>
      <View className="min-w-0 flex-1 gap-1">
        <Typography.Heading weight="medium" style={styles.name}>
          {agent.name}
        </Typography.Heading>
        {agent.title ? (
          <Typography.Paragraph className="text-muted" style={styles.body}>
            {agent.title}
          </Typography.Paragraph>
        ) : null}
      </View>
    </View>
  );
}

export function AgentProfileFields({
  name,
  title,
  description,
  disabled,
  onChange,
}: {
  name: string;
  title: string;
  description: string;
  disabled: boolean;
  onChange: (value: { name?: string; title?: string; description?: string }) => void;
}) {
  const { t } = useText();
  const color = useThemeColor("muted");
  const [editingInstructions, setEditingInstructions] = useState(false);
  return (
    <>
      <View className="overflow-hidden border border-grouped-border bg-team-surface" style={styles.group}>
        <View style={styles.field}>
          <Typography.Paragraph className="text-muted" style={styles.fieldLabel}>
            {t("mobile.agent.form.name")}
          </Typography.Paragraph>
          <SheetFormField
            label={t("mobile.agent.form.name")}
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
            {t("mobile.agent.edit.title")}
          </Typography.Paragraph>
          <SheetFormField
            label={t("mobile.agent.edit.title")}
            hideLabel
            appearance="embedded"
            placeholder={t("mobile.agent.edit.titlePlaceholder")}
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
            {t("mobile.agent.edit.instructions")}
          </Typography.Paragraph>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("mobile.agent.edit.instructions")}
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
              label={t("mobile.agent.edit.instructions")}
              hideLabel
              appearance="embedded"
              placeholder={t("mobile.agent.edit.instructionsPlaceholder")}
              multiline
              autoFocus
              value={description}
              editable={!disabled}
              onChangeText={(value) => onChange({ description: value })}
            />
          ) : (
            <Typography.Paragraph selectable className="text-text-secondary" style={styles.instructions}>
              {description || t("mobile.agent.edit.instructionsPlaceholder")}
            </Typography.Paragraph>
          )}
          <InstructionsLimit text={description} />
        </View>
      </View>
    </>
  );
}

export function AgentProfileSection({
  title,
  footer,
  children,
}: PropsWithChildren<{ title?: string; footer?: ReactNode }>) {
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

export function AgentProfileRow({
  children,
  supportingText,
  leading,
  onPress,
  disabled = false,
}: PropsWithChildren<{ supportingText?: string; leading?: ReactNode; onPress: () => void; disabled?: boolean }>) {
  const color = useThemeColor("muted");
  return (
    <ListGroup.Item
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        void haptics.impact("soft");
        onPress();
      }}
      className="flex-row items-center gap-3 px-4"
      style={({ pressed }) => ({ minHeight: 52, paddingVertical: 12, opacity: disabled ? 0.45 : pressed ? 0.6 : 1 })}
    >
      {leading}
      <View className="min-w-0 flex-1">{children}</View>
      {supportingText ? (
        <Typography.Paragraph className="shrink text-muted" style={styles.body}>
          {supportingText}
        </Typography.Paragraph>
      ) : null}
      <ChevronRight size={18} color={color} />
    </ListGroup.Item>
  );
}

const styles = StyleSheet.create({
  name: { fontFamily: "Inter", fontSize: 48, lineHeight: 52, fontWeight: "500", letterSpacing: -2.4 },
  body: { fontFamily: "Inter", fontSize: 15, lineHeight: 20 },
  avatarEdit: { width: 44, height: 44, borderWidth: 3, left: 52, top: 48 },
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
