import type { MenuComponentRef } from "@expo/ui/community/menu";
import { markdownPreviewText } from "@openbot/contracts/markdown-preview-text";
import MaskedView from "@react-native-masked-view/masked-view";
import { BlurView } from "expo-blur";
import { Link } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { type PropsWithChildren, useEffect, useId, useMemo, useRef } from "react";
import { Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, {
  Easing,
  interpolate,
  ReduceMotion,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useAgentChatPreview } from "@/features/agents/components/agent-chat-preview";
import { AgentAndroidMenu, useAgentContextMenu } from "@/features/agents/components/agent-context-menu";
import { AgentPinAvatar } from "@/features/agents/components/agent-pin-avatar";
import { AgentPinSwipeRow } from "@/features/agents/components/agent-pin-swipe-row";
import { useAgentPinTransition } from "@/features/agents/components/agent-pin-transition";
import { AGENT_WAIT_STATE, AgentWaitBadge, AgentWaitChip } from "@/features/agents/components/agent-wait-badge";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { ChatLinkPressable } from "@/features/agents/components/chat-link-pressable";
import { ChatZoomSource } from "@/features/agents/components/chat-zoom-source";
import { useAgentWaitReason } from "@/features/workspace/components/use-agent-activity";
import { useAgentUnread } from "@/features/workspace/components/use-live-workspace";
import { type MobileAgent, useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { canToggleAgentPin } from "@/features/workspace/model/agent-pins";
import { useText } from "@/shared/lib/text";

const AnimatedRect = Animated.createAnimatedComponent(Rect);
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

function AgentRowTextReveal({ active, children }: PropsWithChildren<{ active: boolean }>) {
  const gradientId = `agent-row-reveal-${useId().replaceAll(":", "")}`;
  const width = useSharedValue(0);
  const progress = useSharedValue(active ? 0 : 1);

  useEffect(() => {
    progress.set(
      active ? withDelay(45, withTiming(1, { duration: 220, easing: EASE_OUT, reduceMotion: ReduceMotion.System })) : 1,
    );
  }, [active, progress]);

  const contentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 0.35, 1], [0, 0.78, 1]),
  }));
  const blurStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 0.35, 0.8, 1], [0.72, 0.58, 0.1, 0]),
  }));
  const maskProps = useAnimatedProps(() => ({ width: width.get() * progress.get() }));

  if (!active) return children;

  return (
    <Animated.View
      className="min-w-0 flex-1"
      onLayout={(event) => width.set(event.nativeEvent.layout.width)}
      style={contentStyle}
    >
      <MaskedView
        style={{ width: "100%" }}
        maskElement={
          <Svg height="100%" width="100%">
            <Defs>
              <LinearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
                <Stop offset="0" stopColor="#000" stopOpacity="1" />
                <Stop offset="0.82" stopColor="#000" stopOpacity="1" />
                <Stop offset="1" stopColor="#000" stopOpacity="0" />
              </LinearGradient>
            </Defs>
            <AnimatedRect animatedProps={maskProps} fill={`url(#${gradientId})`} height="100%" x="0" y="0" />
          </Svg>
        }
      >
        {children}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, blurStyle]}>
          <BlurView intensity={16} style={StyleSheet.absoluteFill} tint="systemUltraThinMaterial" />
        </Animated.View>
      </MaskedView>
    </Animated.View>
  );
}

interface AgentListRowProps {
  agent: MobileAgent;
  leftInset?: number;
  rightInset?: number;
}

export function AgentListRow({ agent, leftInset = 20, rightInset = 20 }: AgentListRowProps) {
  const { t } = useText();
  const [background] = useThemeColor(["background"]);
  const { width: windowWidth } = useWindowDimensions();
  const { pinnedAgentIds } = useMobileWorkspace();
  const { toggleAgentPinAnimated, transition } = useAgentPinTransition();
  const editMenu = useRef<MenuComponentRef>(null);
  const agentContextMenu = useAgentContextMenu(agent);
  const agentChatPreview = useAgentChatPreview(agent);
  const previewLine = useMemo(() => markdownPreviewText(agent.preview), [agent.preview]);
  const isUnread = useAgentUnread(agent.id);
  const waitReason = useAgentWaitReason(agent.id);
  const isUnpinTarget = transition?.chatId === agent.id && transition.target === "row";
  const bloub = (
    <BloubAvatar
      agentId={agent.id}
      serverId={agent.serverId}
      hue={agent.avatarHue}
      seed={agent.avatarSeed}
      size={54}
      animateIdle={false}
    />
  );
  const waitBadge = waitReason ? <AgentWaitBadge reason={waitReason} /> : null;
  const avatar = (
    <ChatZoomSource>
      <AgentPinAvatar agentId={agent.id} location="row" size={54}>
        {bloub}
        {waitBadge}
      </AgentPinAvatar>
    </ChatZoomSource>
  );
  const openLabel = agent.title.trim()
    ? t("mobile.agent.list.openWithTitle", { name: agent.name, title: agent.title.trim() })
    : t("mobile.agent.list.open", { name: agent.name });

  const row = (
    <ChatLinkPressable
      chatId={agent.id}
      accessibilityLabel={
        waitReason
          ? t("mobile.agent.list.withState", { label: openLabel, state: t(AGENT_WAIT_STATE[waitReason]) })
          : openLabel
      }
      accessibilityRole="button"
      accessibilityActions={[{ name: "pin", label: t("mobile.agent.pin.pinNamed", { name: agent.name }) }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "pin") toggleAgentPinAnimated(agent.id);
      }}
      className="w-full"
      onPressIn={agentChatPreview.onPressIn}
      onLongPress={Platform.OS === "android" ? () => editMenu.current?.show() : undefined}
    >
      {({ pressed }) => (
        <View
          className="min-h-20 w-full flex-row items-center gap-3 py-1"
          style={{
            backgroundColor: background,
            opacity: pressed ? 0.58 : 1,
            paddingLeft: leftInset,
            paddingRight: rightInset,
          }}
        >
          {avatar}
          <AgentRowTextReveal active={isUnpinTarget}>
            <View className="min-w-0 flex-1 gap-1">
              <View className="gap-0">
                <View className="flex-row items-center gap-2">
                  {isUnread ? <View className="size-2 rounded-full bg-accent" /> : null}
                  <Typography.Paragraph className="min-w-0 flex-1" weight="semibold" numberOfLines={2}>
                    {agent.name}
                  </Typography.Paragraph>
                  {waitReason ? (
                    <AgentWaitChip reason={waitReason} />
                  ) : (
                    <Typography.Paragraph type="body-xs" className="text-muted">
                      {agent.updatedLabel}
                    </Typography.Paragraph>
                  )}
                </View>
                {agent.title.trim() ? (
                  <Typography.Paragraph type="body-xs" className="-mt-1.5 text-muted" numberOfLines={2}>
                    {agent.title.trim()}
                  </Typography.Paragraph>
                ) : null}
              </View>
              <Typography.Paragraph type="body-xs" className="text-text-secondary -mt-1" numberOfLines={1}>
                {previewLine}
              </Typography.Paragraph>
            </View>
          </AgentRowTextReveal>
          {agentChatPreview.measurer}
        </View>
      )}
    </ChatLinkPressable>
  );
  const href = { pathname: "/chat/[agentId]" as const, params: { agentId: agent.id } };
  const agentLink = (
    <Link href={href} asChild>
      <Link.Trigger>{row}</Link.Trigger>
      {agentChatPreview.preview}
      {agentContextMenu}
    </Link>
  );

  return (
    <AgentPinSwipeRow
      agentName={agent.name}
      pinBlocked={!canToggleAgentPin(pinnedAgentIds, agent.id)}
      onPin={(withHaptic) => toggleAgentPinAnimated(agent.id, { haptic: withHaptic })}
    >
      {Platform.OS === "android" ? (
        // The menu measures its child without a width limit; the home list row fills the window.
        <AgentAndroidMenu agent={agent} menuRef={editMenu} style={{ width: "100%" }}>
          <View style={{ width: windowWidth }}>{agentLink}</View>
        </AgentAndroidMenu>
      ) : (
        agentLink
      )}
    </AgentPinSwipeRow>
  );
}
