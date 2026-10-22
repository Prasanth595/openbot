import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useOpenAgentTasks } from "@/features/chat/components/chat-task-rows";
import { SettingsRow } from "@/features/settings/components/settings-content";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/** Opens the agent's task filter in the existing native Tasks tab. */
export function AgentTasksRow({ agent }: { agent: MobileAgent }) {
  const { t, format } = useText();
  const supported = useMobileWorkspaceSelector((current) => current.canUseTasks(agent.serverId));
  const open = useOpenAgentTasks(agent.serverId, agent.id);
  if (!supported) return null;
  return (
    <SettingsRow
      supportingText={open.length > 0 ? format.number(open.length) : undefined}
      onPress={() => {
        void haptics.impact("soft");
        router.dismissTo({ pathname: "/server-tasks", params: { serverId: agent.serverId, agentId: agent.id } });
      }}
    >
      <Typography.Paragraph>{t("mobile.app.route.tasks")}</Typography.Paragraph>
    </SettingsRow>
  );
}
