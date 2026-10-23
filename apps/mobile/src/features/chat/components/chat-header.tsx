import { Link, router, Stack } from "expo-router";
import { HeaderBackContext } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ArrowLeft from "lucide-react-native/icons/arrow-left";
import Info from "lucide-react-native/icons/info";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import { type ReactNode, useContext, useMemo } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCSSVariable } from "uniwind";
import { SatelliteMotionContext } from "@/features/agents/components/agent-activity-satellites";
import { AgentPinAvatar } from "@/features/agents/components/agent-pin-avatar";
import { TeamAgentAvatar } from "@/features/agents/components/team-agent-avatar";
import { TeamOrb } from "@/features/agents/components/team-home-parts";
import { useAgentModelLabel } from "@/features/agents/components/use-agent-model-label";
import { ChannelAvatar } from "@/features/channels/components/channel-avatar";
import { CHAT_BACK_EDGE_WIDTH } from "@/features/chat/model/chat-layout";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { showsOnline } from "@/features/workspace/model/server-status";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import type { ChatTarget } from "../model/chat-target";

interface ChatHeaderProps {
  target: ChatTarget;
  onBack: () => void;
  needsAction?: boolean;
  /** Voice mode owns the screen while it is open. */
  accessibilityHidden?: boolean;
  title?: string;
  kicker?: string;
  /** Native toolbar items, such as the actions of a task. */
  trailing?: ReactNode;
}

/** The identity is also used inside the development motion preview. */
export function ChatHeaderTitle({
  target,
  title,
  kicker,
  maxWidth,
}: Pick<ChatHeaderProps, "target" | "title" | "kicker"> & { maxWidth?: number }) {
  const agent = useMobileWorkspaceSelector((current) =>
    target.kind === "agent"
      ? current.agents.find((candidate) => candidate.id === target.id && candidate.serverId === target.serverId)
      : undefined,
  );
  const disconnected = useMobileWorkspaceSelector(
    (current) => !current.servers.some((server) => server.id === target.serverId && showsOnline(server)),
  );
  const members = useMemo(
    () => new Map(target.kind === "channel" ? target.members.map((member) => [member.id, member]) : []),
    [target],
  );
  const modelLabel = useAgentModelLabel(agent);
  const meta = [agent?.title, modelLabel].filter(Boolean).join(" · ");
  return (
    <View style={{ maxWidth, minWidth: 0, flexShrink: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Link.AppleZoomTarget>
        {target.kind === "channel" ? (
          <View collapsable={false}>
            <ChannelAvatar
              channel={{ members: target.members.map((member) => ({ agentId: member.id })) }}
              agents={members}
              size={32}
              disconnected={disconnected}
            />
          </View>
        ) : (
          <AgentPinAvatar agentId={target.id} location="chat" size={32}>
            {agent ? (
              <TeamAgentAvatar agent={agent} size={32} />
            ) : (
              <TeamOrb hue={target.avatarHue} seed={target.avatarSeed} size={32} />
            )}
          </AgentPinAvatar>
        )}
      </Link.AppleZoomTarget>
      <View style={{ minWidth: 0, flexShrink: 1 }}>
        <Typography.Heading numberOfLines={1} weight="medium" style={{ fontSize: 17, lineHeight: 22 }}>
          {title ?? target.name}
        </Typography.Heading>
        {kicker || meta ? (
          <Typography.Paragraph className="text-muted" numberOfLines={1} style={{ fontSize: 11, lineHeight: 14 }}>
            {kicker ?? meta}
          </Typography.Paragraph>
        ) : null}
      </View>
    </View>
  );
}

export function ChatHeader({
  target,
  onBack,
  needsAction = false,
  accessibilityHidden = false,
  title,
  kicker,
  trailing,
}: ChatHeaderProps) {
  const { t } = useText();
  const foreground = useThemeColor("foreground");
  const canvas = String(useCSSVariable("--openbot-bg-canvas"));
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // A custom native title is measured independently of the toolbar. Reserve the larger side on
  // both sides of the centered title: Back, and Info plus the optional task or channel action.
  const sideWidth = 64 + (trailing || (target.kind === "channel" && needsAction) ? 48 : 0);
  const titleWidth = Math.max(0, width - insets.left - insets.right - sideWidth * 2 - 16);
  // Native header content renders outside the screen subtree. Keep the conversation's shared clock.
  const satelliteMotion = useContext(SatelliteMotionContext);
  const canGoBack = useContext(HeaderBackContext) !== undefined;
  const infoLabel = t("mobile.chat.header.info", { name: target.name });
  const openInfo = () => {
    if (target.kind === "channel")
      router.push({
        pathname: "/channel-info/[channelId]",
        params: { channelId: target.id, serverId: target.serverId },
      });
    else router.push({ pathname: "/agent-info/[agentId]", params: { agentId: target.id, serverId: target.serverId } });
  };
  const openActions = () =>
    router.push({
      pathname: "/channel-actions/[channelId]",
      params: { channelId: target.id, serverId: target.serverId },
    });
  if (accessibilityHidden) return <Stack.Screen options={{ headerShown: false }} />;
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          // The keyboard-aware list owns its insets and anchors. A solid native bar keeps its
          // scrolled content outside the title and status area without a second inset owner.
          headerTransparent: false,
          headerStyle: { backgroundColor: canvas },
          headerBlurEffect: "none",
          headerLeft: undefined,
          headerBackVisible: canGoBack,
          headerBackButtonDisplayMode: "minimal",
          // iOS 26 uses its native content-pop recognizer. Limit it to the edge so message
          // swipes inside the transcript can still reply.
          fullScreenGestureEnabled: true,
          gestureResponseDistance: { end: insets.left + CHAT_BACK_EDGE_WIDTH },
          scrollEdgeEffects: { top: "hidden" },
        }}
      />
      <Stack.Title asChild>
        <SatelliteMotionContext value={satelliteMotion}>
          <ChatHeaderTitle target={target} title={title} kicker={kicker} maxWidth={titleWidth} />
        </SatelliteMotionContext>
      </Stack.Title>
      {/* A direct link can have no prior route. Its explicit exit uses the caller's connected-screen fallback. */}
      {canGoBack ? null : (
        <Stack.Toolbar placement="left">
          {isAndroid ? (
            <Stack.Toolbar.View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("common.back")}
                onPress={onBack}
                className="min-h-12 min-w-12 items-center justify-center"
              >
                <ArrowLeft size={22} color={foreground} />
              </Pressable>
            </Stack.Toolbar.View>
          ) : (
            <Stack.Toolbar.Button icon="chevron.left" accessibilityLabel={t("common.back")} onPress={onBack}>
              {t("common.back")}
            </Stack.Toolbar.Button>
          )}
        </Stack.Toolbar>
      )}
      <Stack.Toolbar placement="right">
        {/* Android toolbar icons require bitmap sources. The native toolbar hosts the existing Lucide icon. */}
        {isAndroid ? (
          <Stack.Toolbar.View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={infoLabel}
              onPress={openInfo}
              className="min-h-12 min-w-12 items-center justify-center"
            >
              <Info size={22} color={foreground} />
            </Pressable>
          </Stack.Toolbar.View>
        ) : (
          <Stack.Toolbar.Button icon="info.circle" accessibilityLabel={infoLabel} onPress={openInfo} />
        )}
        {trailing}
        {trailing === undefined && target.kind === "channel" && needsAction ? (
          isAndroid ? (
            <Stack.Toolbar.View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("mobile.chat.header.actionsNeeded")}
                onPress={openActions}
                className="min-h-12 min-w-12 items-center justify-center"
              >
                <TriangleAlert size={22} color={foreground} />
              </Pressable>
            </Stack.Toolbar.View>
          ) : (
            <Stack.Toolbar.Button
              icon="exclamationmark.triangle"
              accessibilityLabel={t("mobile.chat.header.actionsNeeded")}
              onPress={openActions}
            />
          )
        ) : null}
      </Stack.Toolbar>
    </>
  );
}
