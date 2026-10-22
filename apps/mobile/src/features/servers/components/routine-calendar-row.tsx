import { ListGroup, Typography } from "heroui-native";
import CircleCheck from "lucide-react-native/icons/circle-check";
import CircleDot from "lucide-react-native/icons/circle-dot";
import CirclePause from "lucide-react-native/icons/circle-pause";
import CircleX from "lucide-react-native/icons/circle-x";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import { TeamAgentAvatar } from "@/features/agents/components/team-agent-avatar";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

export type CalendarStatus = "active" | "paused" | "failed" | "completed" | "cancelled";

export function RoutineCalendarRow({
  title,
  subtitle,
  status,
  agents,
  onPress,
}: {
  title: string;
  subtitle: string;
  status: CalendarStatus;
  agents: readonly MobileAgent[];
  onPress: () => void;
}) {
  const { format } = useText();
  const shown = agents.slice(0, 3);
  const hidden = agents.length - shown.length;
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const accent = String(useCSSVariable("--openbot-accent-text"));
  const success = String(useCSSVariable("--openbot-success-text"));
  const danger = String(useCSSVariable("--openbot-danger-text"));
  const Icon =
    status === "paused"
      ? CirclePause
      : status === "failed" || status === "cancelled"
        ? CircleX
        : status === "completed"
          ? CircleCheck
          : CircleDot;
  const color =
    status === "paused" || status === "cancelled"
      ? muted
      : status === "failed"
        ? danger
        : status === "completed"
          ? success
          : accent;
  return (
    <ListGroup.Item
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}${agents.length ? `. ${format.list(agents.map((agent) => agent.name))}` : ""}`}
      className="flex-row items-center gap-3 border border-grouped-border bg-grouped"
      style={({ pressed }) => ({
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderRadius: 14,
        opacity: pressed ? 0.6 : 1,
      })}
      onPress={() => {
        void haptics.impact("soft");
        onPress();
      }}
    >
      <Icon size={18} color={color} strokeWidth={1.8} />
      <View className="min-w-0 flex-1" style={{ gap: 3 }}>
        <Typography.Paragraph
          numberOfLines={2}
          weight="medium"
          style={{ fontFamily: "Inter", fontSize: 15, lineHeight: 19 }}
        >
          {title}
        </Typography.Paragraph>
        <Typography.Paragraph
          className="text-grouped-secondary"
          style={{ fontFamily: "Inter", fontSize: 13, lineHeight: 18 }}
        >
          {subtitle}
        </Typography.Paragraph>
      </View>
      {shown.length ? (
        <View
          className="flex-row items-center"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {shown.map((agent, index) => (
            <View key={agent.id} style={{ marginLeft: index === 0 ? 0 : -9 }}>
              <TeamAgentAvatar agent={agent} size={28} />
            </View>
          ))}
          {hidden ? (
            <Typography type="body-xs" className="ml-1 text-grouped-secondary">
              +{format.number(hidden)}
            </Typography>
          ) : null}
        </View>
      ) : null}
    </ListGroup.Item>
  );
}
