import { Link, router } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import Info from "lucide-react-native/icons/info";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import { type ReactNode, useId, useMemo } from "react";
import { View, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useCSSVariable } from "uniwind";
import { AgentPinAvatar } from "@/features/agents/components/agent-pin-avatar";
import { TeamAgentAvatar } from "@/features/agents/components/team-agent-avatar";
import { TeamOrb } from "@/features/agents/components/team-home-parts";
import { useAgentModelLabel } from "@/features/agents/components/use-agent-model-label";
import { ChannelAvatar } from "@/features/channels/components/channel-avatar";
import { ChatGlassIconButton } from "@/features/chat/components/chat-glass-icon-button";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { showsOnline } from "@/features/workspace/model/server-status";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import type { ChatTarget } from "../model/chat-target";

interface ChatHeaderProps {
  target: ChatTarget;
  fallbackBackground: ViewStyle["backgroundColor"];
  foreground: ViewStyle["backgroundColor"];
  liquidGlassAvailable: boolean;
  topInset: number;
  onBack: () => void;
  /** A channel task needs the user. */
  needsAction?: boolean;
  /** Something covers the header, such as the voice mode, so screen readers skip it. */
  accessibilityHidden?: boolean;
  /** Shown next to the avatar in place of the agent's name, such as a task title. */
  title?: string;
  /** Shown before the title with a dot between them, such as "Task". */
  kicker?: string;
  /** Additional controls, such as the actions of a task. */
  trailing?: ReactNode;
}

export function ChatHeader({
  target,
  fallbackBackground,
  foreground,
  liquidGlassAvailable,
  topInset,
  onBack,
  needsAction = false,
  accessibilityHidden = false,
  title,
  kicker,
  trailing,
}: ChatHeaderProps) {
  const { t } = useText();
  const agent = useMobileWorkspaceSelector((current) =>
    target.kind === "agent"
      ? current.agents.find((candidate) => candidate.id === target.id && candidate.serverId === target.serverId)
      : undefined,
  );
  const warning = useThemeColor("warning");
  const disconnected = useMobileWorkspaceSelector(
    (current) => !current.servers.some((server) => server.id === target.serverId && showsOnline(server)),
  );
  const members = useMemo(
    () => new Map(target.kind === "channel" ? target.members.map((member) => [member.id, member]) : []),
    [target],
  );
  const iconColor = String(foreground);
  const fadeId = useId();
  const canvas = String(useCSSVariable("--openbot-bg-canvas"));
  const glass = String(useCSSVariable("--openbot-bg-chrome-glass"));
  const edge = String(useCSSVariable("--openbot-border-chrome-glass"));
  const border = String(useCSSVariable("--openbot-border-grouped"));
  const modelLabel = useAgentModelLabel(agent);
  const meta = [agent?.title, modelLabel].filter(Boolean).join(" · ").toUpperCase();
  const openInfo = () => {
    void haptics.impact("soft");
    if (target.kind === "channel")
      router.push({
        pathname: "/channel-info/[channelId]",
        params: { channelId: target.id, serverId: target.serverId },
      });
    else router.push({ pathname: "/agent-info/[agentId]", params: { agentId: target.id, serverId: target.serverId } });
  };
  const buttonStyle = {
    width: 44,
    height: 44,
    minWidth: 44,
    borderRadius: 999,
    backgroundColor: glass,
    borderColor: edge,
    borderWidth: 1,
  };
  return (
    <>
      <View
        className="absolute inset-x-0 z-20"
        accessibilityElementsHidden={accessibilityHidden}
        importantForAccessibility={accessibilityHidden ? "no-hide-descendants" : "auto"}
        style={{ top: 0, paddingTop: topInset, backgroundColor: canvas }}
      >
        <View
          style={{
            height: 60,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingHorizontal: 16,
            borderBottomWidth: 1,
            borderBottomColor: border,
          }}
        >
          <Button
            isIconOnly
            variant="secondary"
            accessibilityLabel={t("common.back")}
            onPress={() => {
              void haptics.impact("soft");
              onBack();
            }}
            style={buttonStyle}
          >
            <ChevronLeft size={22} color={iconColor} />
          </Button>
          <View style={{ flex: 1, minWidth: 0, height: 52, flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Link.AppleZoomTarget>
              {target.kind === "channel" ? (
                <View collapsable={false}>
                  <ChannelAvatar
                    channel={{ members: target.members.map((member) => ({ agentId: member.id })) }}
                    agents={members}
                    size={36}
                    disconnected={disconnected}
                  />
                </View>
              ) : (
                <AgentPinAvatar agentId={target.id} location="chat" size={36}>
                  {agent ? (
                    <TeamAgentAvatar agent={agent} size={36} />
                  ) : (
                    <TeamOrb hue={target.avatarHue} seed={target.avatarSeed} size={36} />
                  )}
                </AgentPinAvatar>
              )}
            </Link.AppleZoomTarget>
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
              <Typography.Heading
                numberOfLines={1}
                weight="medium"
                style={{ fontFamily: "Inter", fontSize: 24, lineHeight: 24, letterSpacing: -1.2 }}
              >
                {title ?? target.name}
              </Typography.Heading>
              {kicker || meta ? (
                <Typography.Paragraph
                  className="text-muted"
                  numberOfLines={1}
                  style={{ fontFamily: "Inter", fontSize: 10, lineHeight: 13, fontWeight: "600", letterSpacing: 0.6 }}
                >
                  {kicker ?? meta}
                </Typography.Paragraph>
              ) : null}
            </View>
          </View>
          <Button
            isIconOnly
            variant="secondary"
            accessibilityLabel={t("mobile.chat.header.info", { name: target.name })}
            onPress={openInfo}
            style={buttonStyle}
          >
            <Info size={20} color={iconColor} />
          </Button>
          {trailing !== undefined ? (
            trailing
          ) : target.kind === "channel" && needsAction ? (
            <ChatGlassIconButton
              accessibilityLabel={t("mobile.chat.header.actionsNeeded")}
              fallbackBackground={fallbackBackground}
              liquidGlassAvailable={liquidGlassAvailable}
              onPress={() => {
                void haptics.impact("soft");
                router.push({
                  pathname: "/channel-actions/[channelId]",
                  params: { channelId: target.id, serverId: target.serverId },
                });
              }}
            >
              <TriangleAlert color={String(warning)} size={24} strokeWidth={2.5} />
            </ChatGlassIconButton>
          ) : null}
        </View>
      </View>
      <Svg
        pointerEvents="none"
        width="100%"
        height={72}
        style={{ position: "absolute", top: topInset + 60, left: 0, right: 0, zIndex: 19 }}
      >
        <Defs>
          <LinearGradient id={fadeId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={canvas} />
            <Stop offset="1" stopColor={canvas} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${fadeId})`} />
      </Svg>
    </>
  );
}
