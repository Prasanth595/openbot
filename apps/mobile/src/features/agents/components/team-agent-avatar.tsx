import { BloubAvatar, BloubAvatarPreview } from "@/features/agents/components/bloub-avatar";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";

export function TeamAgentAvatar({
  agent,
  size = 44,
  showActivity = true,
}: {
  agent: Pick<MobileAgent, "id" | "serverId" | "avatarSeed" | "avatarHue">;
  size?: number;
  showActivity?: boolean;
}) {
  const Avatar = showActivity ? BloubAvatar : BloubAvatarPreview;
  return (
    <Avatar
      agentId={agent.id}
      serverId={agent.serverId}
      seed={agent.avatarSeed}
      hue={agent.avatarHue}
      size={size}
      animateIdle={false}
      rings={showActivity}
    />
  );
}
