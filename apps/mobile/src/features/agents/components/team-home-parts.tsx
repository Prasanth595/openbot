import { markdownPreviewText } from "@openbot/contracts/markdown-preview-text";
import { cleanAgentMessageText } from "@openbot/team-client/agent-message-text";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ArrowRight from "lucide-react-native/icons/arrow-right";
import CalendarClock from "lucide-react-native/icons/calendar-clock";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import Ellipsis from "lucide-react-native/icons/ellipsis";
import Layers from "lucide-react-native/icons/layers";
import ListChecks from "lucide-react-native/icons/list-checks";
import Search from "lucide-react-native/icons/search";
import Settings2 from "lucide-react-native/icons/settings-2";
import Store from "lucide-react-native/icons/store";
import UsersRound from "lucide-react-native/icons/users-round";
import { type ReactNode, useId } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import { useCSSVariable } from "uniwind";
import { TeamOrb } from "@/features/agents/components/team-orb";

export { TeamOrb } from "@/features/agents/components/team-orb";

import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

export type TeamDestination = "team" | "tasks" | "routines" | "market" | "settings";

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
      <Typography.Heading weight="medium" style={typeScale.teamDisplay}>
        {t("mobile.agent.team.title")}
      </Typography.Heading>
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
  options,
}: {
  name: string;
  onWorkspace: () => void;
  onSearch: () => void;
  options: ReactNode;
}) {
  const { t } = useText();
  const insets = useSafeAreaInsets();
  const [foreground, muted] = useThemeColor(["foreground", "muted"]);
  const glass = String(useCSSVariable("--openbot-bg-chrome-glass"));
  const edge = String(useCSSVariable("--openbot-border-chrome-glass"));
  const ink = String(useCSSVariable("--openbot-text-on-light"));
  return (
    <View className="bg-team-canvas" style={{ paddingTop: insets.top }}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("mobile.agent.home.serverTitle", { name })}
          onPress={onWorkspace}
          style={({ pressed }) => [
            styles.workspace,
            { backgroundColor: glass, borderColor: edge, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <View className="bg-feature" style={styles.workspaceIcon}>
            <Layers size={16} color={ink} />
          </View>
          <Typography.Paragraph numberOfLines={1} style={[typeScale.teamMeta, { flexShrink: 1 }]}>
            {name.toUpperCase()}
          </Typography.Paragraph>
          <ChevronDown size={16} color={String(muted)} />
        </Pressable>
        <View style={styles.actions}>
          <Button
            isIconOnly
            variant="secondary"
            accessibilityLabel={t("mobile.search.placeholder")}
            onPress={onSearch}
            style={[styles.iconButton, { backgroundColor: glass, borderColor: edge }]}
          >
            <Search size={20} color={String(foreground)} />
          </Button>
          <View style={[styles.iconButton, { backgroundColor: glass, borderColor: edge }]}>{options}</View>
        </View>
      </View>
    </View>
  );
}

export function TeamMoreIcon() {
  const color = String(useThemeColor("foreground"));
  return <Ellipsis size={20} color={color} />;
}

export function TeamTabs({
  onSelect,
  disabled = false,
  activeTab = "team",
}: {
  onSelect: (tab: TeamDestination) => void;
  disabled?: boolean;
  activeTab?: TeamDestination;
}) {
  const { t } = useText();
  const insets = useSafeAreaInsets();
  const muted = useThemeColor("muted");
  const glass = String(useCSSVariable("--openbot-bg-chrome-glass"));
  const edge = String(useCSSVariable("--openbot-border-chrome-glass"));
  const selected = String(useCSSVariable("--openbot-action"));
  const selectedInk = String(useCSSVariable("--openbot-action-foreground"));
  const canvas = String(useCSSVariable("--openbot-bg-canvas"));
  const id = useId();
  const tabs = [
    { id: "team", key: "mobile.agent.team.tabTeam", Icon: UsersRound },
    { id: "tasks", key: "mobile.agent.team.tabTasks", Icon: ListChecks },
    { id: "routines", key: "mobile.agent.team.tabRoutines", Icon: CalendarClock },
    { id: "market", key: "mobile.agent.team.tabMarket", Icon: Store },
    { id: "settings", key: "mobile.agent.team.tabSettings", Icon: Settings2 },
  ] as const;
  return (
    <View pointerEvents="box-none" style={[styles.tabWrap, { paddingBottom: Math.max(30, insets.bottom - 4) }]}>
      <Svg pointerEvents="none" width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={canvas} stopOpacity={0} />
            <Stop offset="0.5" stopColor={canvas} stopOpacity={0.95} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
      <View accessibilityRole="tablist" style={[styles.tabBar, { backgroundColor: glass, borderColor: edge }]}>
        {tabs.map(({ id: destination, key, Icon }) => (
          <Pressable
            key={destination}
            accessibilityRole="tab"
            accessibilityState={{
              selected: destination === activeTab,
              disabled: disabled && destination !== "settings",
            }}
            disabled={disabled && destination !== "settings"}
            onPress={() => onSelect(destination)}
            style={({ pressed }) => [
              styles.tab,
              { backgroundColor: destination === activeTab ? selected : "transparent", opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Icon size={20} color={destination === activeTab ? selectedInk : String(muted)} />
            <Typography.Paragraph
              numberOfLines={1}
              style={[styles.tabLabel, { color: destination === activeTab ? selectedInk : String(muted) }]}
            >
              {t(key)}
            </Typography.Paragraph>
          </Pressable>
        ))}
      </View>
    </View>
  );
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
  openChat: { borderRadius: 999, height: 44, minHeight: 44, paddingHorizontal: 18, gap: 8 },
  openChatLabel: { fontFamily: "Inter", fontSize: 15, fontWeight: "600", color: "white" },
  header: {
    height: 52,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  workspace: {
    flexShrink: 1,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    height: 44,
    paddingLeft: 6,
    paddingRight: 14,
    borderRadius: 999,
    borderWidth: 1,
  },
  workspaceIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  actions: { flexDirection: "row", gap: 8 },
  iconButton: {
    width: 44,
    height: 44,
    minWidth: 44,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  tabWrap: { position: "absolute", bottom: 0, left: 0, right: 0, paddingTop: 26, paddingHorizontal: 20 },
  tabBar: { minHeight: 64, flexDirection: "row", padding: 6, gap: 4, borderRadius: 999, borderWidth: 1 },
  tab: {
    flex: 1,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    gap: 3,
    paddingVertical: 4,
  },
  tabLabel: { fontFamily: "Inter", fontSize: 11, lineHeight: 14, fontWeight: "600" },
});
