import { markdownPreviewText } from "@openbot/contracts/markdown-preview-text";
import { cleanAgentMessageText } from "@openbot/team-client/agent-message-text";
import { Stack } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ArrowRight from "lucide-react-native/icons/arrow-right";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import Ellipsis from "lucide-react-native/icons/ellipsis";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useCSSVariable } from "uniwind";

import { TeamOrb } from "@/features/agents/components/team-orb";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

export { TeamOrb };

export function TeamSectionHeading({
  name,
  count,
  hasLead,
  collapsed,
  onToggle,
  menu,
}: {
  name: string;
  count: number;
  hasLead: boolean;
  collapsed: boolean;
  onToggle: () => void;
  menu: ReactNode;
}) {
  const { t, format } = useText();
  const color = String(useThemeColor("muted"));
  const countText = format.number(count, { minimumIntegerDigits: 2 });
  return (
    <View style={{ minHeight: 48, flexDirection: "row", alignItems: "center" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(collapsed ? "mobile.agent.section.expand" : "mobile.agent.section.collapse", { name })}
        accessibilityState={{ expanded: !collapsed }}
        onPress={onToggle}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          minHeight: 44,
          gap: 10,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Typography.Heading weight="medium" numberOfLines={1} style={[typeScale.teamSection, { flexShrink: 1 }]}>
          {name}
        </Typography.Heading>
        <Typography.Paragraph className="text-muted" style={typeScale.teamMeta}>
          {hasLead ? t("mobile.agent.team.sectionCount", { count: countText }) : countText}
        </Typography.Paragraph>
        <View style={{ flex: 1 }} />
        <View style={{ width: 40, alignItems: "center", transform: [{ rotate: collapsed ? "0deg" : "180deg" }] }}>
          <ChevronDown size={18} color={color} />
        </View>
      </Pressable>
      {menu}
    </View>
  );
}

export function TeamAgentSummary({
  agent,
  unread,
  state,
}: {
  agent: MobileAgent;
  unread?: boolean;
  state?: ReactNode;
}) {
  return (
    <View className="min-w-0 flex-1" style={{ gap: 4 }}>
      <View className="flex-row items-center gap-2">
        {unread ? <View className="size-2 rounded-full bg-accent" /> : null}
        <Typography.Paragraph className="min-w-0 flex-1" numberOfLines={1} style={typeScale.teamName}>
          {agent.name}
        </Typography.Paragraph>
        {state ?? (
          <Typography.Paragraph className="text-muted" style={typeScale.teamMeta}>
            {agent.updatedLabel}
          </Typography.Paragraph>
        )}
      </View>
      <Typography.Paragraph className="text-muted" numberOfLines={1} style={typeScale.teamPreview}>
        {markdownPreviewText(cleanAgentMessageText(agent.preview))}
      </Typography.Paragraph>
    </View>
  );
}

export function TeamTitle({ agents, groups }: { agents: number; groups: number }) {
  const { t } = useText();
  return (
    <View style={styles.title}>
      <Typography.Paragraph className="text-muted" style={typeScale.teamMeta}>
        {t("mobile.agent.team.agents", { count: agents })}
        {" · "}
        {t("mobile.agent.team.groups", { count: groups })}
      </Typography.Paragraph>
    </View>
  );
}

export function TeamLeadCard({
  agent,
  total,
  avatar,
  onOpen,
}: {
  agent: MobileAgent;
  total: number;
  avatar?: ReactNode;
  onOpen: () => void;
}) {
  const { t, format } = useText();
  const ink = String(useCSSVariable("--openbot-text-on-light"));
  return (
    <View className="bg-feature" style={styles.lead}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Svg width="100%" height="100%">
          <Path
            d={Array.from({ length: 30 }, (_, index) => `M${(index + 1) * 24} 0V720 M0 ${(index + 1) * 24}H720`).join(
              " ",
            )}
            stroke={ink}
            strokeOpacity={0.07}
            strokeWidth={1}
          />
        </Svg>
      </View>
      <View style={styles.between}>
        <View style={[styles.tag, { borderColor: `${ink}24`, backgroundColor: `${ink}14` }]}>
          <Typography.Paragraph style={[typeScale.teamMeta, styles.tagText, { color: ink }]}>
            {t("mobile.agent.team.lead")}
          </Typography.Paragraph>
        </View>
        <Typography.Paragraph style={[typeScale.teamMeta, { color: ink, opacity: 0.52 }]}>
          {format.number(1, { minimumIntegerDigits: 2 })}
          {" / "}
          {format.number(total, { minimumIntegerDigits: 2 })}
        </Typography.Paragraph>
      </View>
      <View style={styles.identity}>
        {avatar ?? <TeamOrb seed={agent.avatarSeed} hue={agent.avatarHue} size={60} />}
        <View className="min-w-0 flex-1" style={{ gap: 2 }}>
          <Typography.Heading
            weight="medium"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.65}
            style={[typeScale.teamLead, { color: ink }]}
          >
            {agent.name}
          </Typography.Heading>
          {agent.title ? (
            <Typography.Paragraph numberOfLines={1} style={[styles.role, { color: ink, opacity: 0.52 }]}>
              {agent.title}
            </Typography.Paragraph>
          ) : null}
        </View>
      </View>
      <Typography.Paragraph numberOfLines={2} style={[styles.leadPreview, { color: ink }]}>
        {markdownPreviewText(cleanAgentMessageText(agent.preview))}
      </Typography.Paragraph>
      <View style={styles.between}>
        <Typography.Paragraph style={[typeScale.teamMeta, { color: ink, opacity: 0.52 }]}>
          {agent.updatedLabel}
        </Typography.Paragraph>
        <Button variant="primary" onPress={onOpen} style={[styles.openChat, { backgroundColor: ink }]}>
          <Button.Label style={styles.openChatLabel}>{t("mobile.agent.team.openChat")}</Button.Label>
          <ArrowRight size={16} color="white" />
        </Button>
      </View>
    </View>
  );
}

export function TeamHeader({
  name,
  onWorkspace,
  onSearch,
  planLimits,
  connectionStatus,
  options,
}: {
  name: string;
  onWorkspace: () => void;
  onSearch?: () => void;
  planLimits?: ReactElement | null;
  connectionStatus?: ReactElement | null;
  options: ReactNode;
}) {
  const { t } = useText();
  return (
    <>
      <Stack.Title large={false}>{t("mobile.agent.team.title")}</Stack.Title>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button
          icon={isAndroid ? undefined : "square.stack.3d.up.fill"}
          accessibilityLabel={t("mobile.agent.home.serverTitle", { name })}
          onPress={onWorkspace}
        >
          {name}
        </Stack.Toolbar.Button>
        {connectionStatus ? <Stack.Toolbar.View hidesSharedBackground>{connectionStatus}</Stack.Toolbar.View> : null}
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        {planLimits ? <Stack.Toolbar.View hidesSharedBackground>{planLimits}</Stack.Toolbar.View> : null}
        <Stack.Toolbar.Button
          hidden={!onSearch}
          icon={isAndroid ? undefined : "magnifyingglass"}
          accessibilityLabel={t("mobile.search.placeholder")}
          onPress={onSearch}
        >
          {t("common.search")}
        </Stack.Toolbar.Button>
        {options}
      </Stack.Toolbar>
    </>
  );
}

export function TeamMoreIcon() {
  const color = String(useThemeColor("foreground"));
  return <Ellipsis size={20} color={color} />;
}

const styles = StyleSheet.create({
  title: { gap: 8, paddingTop: 12, paddingBottom: 20, paddingHorizontal: 20 },
  lead: { marginHorizontal: 20, padding: 20, borderRadius: 24, gap: 16, overflow: "hidden", marginBottom: 20 },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  tag: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  tagText: { fontSize: 10, lineHeight: 12, letterSpacing: 0.6 },
  identity: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 60 },
  role: { fontFamily: "Inter", fontSize: 14, lineHeight: 17, fontWeight: "500" },
  leadPreview: { fontFamily: "Inter", fontSize: 15, lineHeight: 21.75, minHeight: 43.5 },
  openChat: { borderRadius: 999, minHeight: 44, paddingHorizontal: 18, gap: 8 },
  openChatLabel: { fontFamily: "Inter", fontSize: 15, fontWeight: "600", color: "white" },
});
