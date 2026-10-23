import { Link, router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useAgentChatPreview } from "@/features/agents/components/agent-chat-preview";
import { AgentAndroidMenu, AgentContextMenuLink } from "@/features/agents/components/agent-context-menu";
import { AgentPinAvatar } from "@/features/agents/components/agent-pin-avatar";
import { useAgentPinTransition } from "@/features/agents/components/agent-pin-transition";
import { AgentWaitBadge } from "@/features/agents/components/agent-wait-badge";
import { ChatLinkPressable } from "@/features/agents/components/chat-link-pressable";
import { ChatZoomSource } from "@/features/agents/components/chat-zoom-source";
import { TeamAgentAvatar } from "@/features/agents/components/team-agent-avatar";
import { TeamLeadCard } from "@/features/agents/components/team-home-parts";
import { useAgentWaitReason } from "@/features/workspace/components/use-agent-activity";
import {
  type MobileAgent,
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { canToggleAgentPin } from "@/features/workspace/model/agent-pins";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

export function TeamLeadAgent({ agent, total }: { agent: MobileAgent; total: number }) {
  const { t } = useText();
  const workspace = useMobileWorkspaceReader();
  const preview = useAgentChatPreview(agent);
  const { toggleAgentPinAnimated } = useAgentPinTransition();
  const canPin = useMobileWorkspaceSelector(({ pinnedAgentIds, pinnedChannelIds }) =>
    canToggleAgentPin([...pinnedAgentIds, ...pinnedChannelIds], agent.id),
  );
  const pinned = useMobileWorkspaceSelector((workspace) => workspace.pinnedAgentIds.includes(agent.id));
  const waitReason = useAgentWaitReason(agent.id);
  const [menuKey, setMenuKey] = useState(0);
  const content = (
    <ChatLinkPressable
      chatId={agent.id}
      serverId={agent.serverId}
      accessibilityRole="button"
      accessibilityLabel={t("mobile.agent.list.open", { name: agent.name })}
      accessibilityActions={[
        ...(canPin
          ? [
              {
                name: "pin",
                label: t(pinned ? "mobile.agent.pin.unpinNamed" : "mobile.agent.pin.pinNamed", { name: agent.name }),
              },
            ]
          : []),
        { name: "remove-lead", label: t("mobile.agent.menu.removeLead") },
      ]}
      onAccessibilityAction={({ nativeEvent }) => {
        if (nativeEvent.actionName === "pin") toggleAgentPinAnimated(agent.id);
        else if (nativeEvent.actionName === "remove-lead") {
          if (workspace().removeLeadAgent(agent.id) === "error") void haptics.notification("error");
          else void haptics.selection();
        }
      }}
      onPressIn={preview.onPressIn}
      onLongPress={isAndroid ? () => setMenuKey((key) => key + 1) : undefined}
    >
      <TeamLeadCard
        agent={agent}
        total={total}
        onOpen={() =>
          router.push({ pathname: "/chat/[agentId]", params: { agentId: agent.id, serverId: agent.serverId } })
        }
        avatar={
          <ChatZoomSource>
            <AgentPinAvatar agentId={agent.id} location={pinned ? "pinned" : "row"} size={60}>
              <TeamAgentAvatar agent={agent} size={60} />
              {waitReason ? <AgentWaitBadge reason={waitReason} /> : null}
            </AgentPinAvatar>
          </ChatZoomSource>
        }
      />
      {preview.measurer}
    </ChatLinkPressable>
  );
  return isAndroid ? (
    <View>
      <Link href={{ pathname: "/chat/[agentId]", params: { agentId: agent.id, serverId: agent.serverId } }} asChild>
        <Link.Trigger>{content}</Link.Trigger>
      </Link>
      {menuKey > 0 ? <AgentAndroidMenu key={menuKey} agent={agent} onClose={() => setMenuKey(0)} /> : null}
    </View>
  ) : (
    <AgentContextMenuLink agent={agent} preview={preview.preview}>
      {content}
    </AgentContextMenuLink>
  );
}
