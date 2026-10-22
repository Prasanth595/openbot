import { router } from "expo-router";
import { Button, Typography } from "heroui-native";
import ArrowLeftRight from "lucide-react-native/icons/arrow-left-right";
import Brain from "lucide-react-native/icons/brain";
import ChevronsUpDown from "lucide-react-native/icons/chevrons-up-down";
import Gauge from "lucide-react-native/icons/gauge";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Defs, Path, Pattern, Rect } from "react-native-svg";
import { useCSSVariable } from "uniwind";
import { EFFORT_LABELS } from "@/features/agents/components/agent-runtime-fields";
import { useAgentModelLabel } from "@/features/agents/components/use-agent-model-label";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

export function AgentBrainCard({ agent }: { agent: MobileAgent; available: boolean }) {
  const { t } = useText();
  const ink = String(useCSSVariable("--openbot-text-on-light"));
  const onInk = String(useCSSVariable("--openbot-text-on-accent"));
  const model = useAgentModelLabel(agent);
  const open = () => {
    void haptics.impact("soft");
    router.push({ pathname: "/agent-info/[agentId]/runtime", params: { agentId: agent.id, serverId: agent.serverId } });
  };
  return (
    <View className="overflow-hidden bg-brain-feature" style={{ padding: 20, gap: 14, borderRadius: 24 }}>
      <Svg pointerEvents="none" width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <Pattern id="brainGrid" width={24} height={24} patternUnits="userSpaceOnUse">
            <Path d="M 24 0 L 0 0 0 24" fill="none" stroke={ink} strokeOpacity={0.07} />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#brainGrid)" />
      </Svg>
      <View className="flex-row items-center justify-between">
        <View className="overflow-hidden rounded-full px-2 py-1">
          <View
            pointerEvents="none"
            className="absolute inset-0 rounded-full"
            style={{ backgroundColor: ink, opacity: 0.08, borderWidth: 1, borderColor: ink }}
          />
          <Typography.Paragraph
            style={{
              fontFamily: "Inter",
              fontSize: 10,
              fontWeight: "600",
              letterSpacing: 0.6,
              textTransform: "uppercase",
              color: ink,
            }}
          >
            {t("mobile.agent.groups.brain")}
          </Typography.Paragraph>
        </View>
        <Brain size={20} color={ink} />
      </View>
      <View className="flex-row items-end gap-3">
        <View className="min-w-0 flex-1 gap-1">
          <Typography.Paragraph
            className="text-on-feature-muted"
            style={{ fontFamily: "Inter", fontSize: 14, fontWeight: "500" }}
          >
            {t("mobile.agent.runtime.model")}
          </Typography.Paragraph>
          <Typography.Heading
            numberOfLines={2}
            style={{
              fontFamily: "Inter",
              fontSize: 26,
              lineHeight: 30,
              fontWeight: "600",
              letterSpacing: -0.5,
              color: ink,
            }}
          >
            {model ?? t("mobile.agent.runtime.unavailable")}
          </Typography.Heading>
        </View>
        <Button
          variant="primary"
          className="h-11 flex-row gap-2 rounded-full px-4.5"
          style={{ backgroundColor: ink }}
          onPress={open}
        >
          <Button.Label style={{ fontFamily: "Inter", fontSize: 15, fontWeight: "600", color: onInk }}>
            {t("mobile.agent.runtime.change")}
          </Button.Label>
          <ArrowLeftRight size={16} color={onInk} />
        </Button>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("mobile.agent.runtime.reasoning")}
        onPress={open}
        style={({ pressed }) => ({
          minHeight: 44,
          paddingTop: 4,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <View
          pointerEvents="none"
          className="absolute top-0 right-0 left-0"
          style={{ height: StyleSheet.hairlineWidth, backgroundColor: ink, opacity: 0.14 }}
        />
        <Gauge size={16} color={ink} />
        <Typography.Paragraph style={{ fontFamily: "Inter", fontSize: 15, fontWeight: "600", color: ink }}>
          {t("mobile.agent.runtime.reasoning")}
        </Typography.Paragraph>
        <View className="flex-1" />
        <Typography.Paragraph style={{ fontFamily: "Inter", fontSize: 15, fontWeight: "500", color: ink }}>
          {agent.reasoningEffort ? t(EFFORT_LABELS[agent.reasoningEffort]) : t("mobile.agent.runtime.unavailable")}
        </Typography.Paragraph>
        <ChevronsUpDown size={16} color={ink} />
      </Pressable>
    </View>
  );
}
