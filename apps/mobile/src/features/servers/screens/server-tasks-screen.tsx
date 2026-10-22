import type { AgentTask } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { TASKS_CLOSED_SHOWN, type TasksSectionId, taskSections } from "@openbot/team-client/agent-tasks";
import { router, useLocalSearchParams } from "expo-router";
import { Button, Typography } from "heroui-native";
import Inbox from "lucide-react-native/icons/inbox";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useCSSVariable } from "uniwind";
import { TaskListRow } from "@/features/servers/components/task-list-row";
import { WorkScreen } from "@/features/servers/components/work-screen";
import { WorkTaskComposer } from "@/features/servers/components/work-task-composer";
import { useServerTasks } from "@/features/servers/model/use-server-tasks";
import { useWorkTabServer } from "@/features/servers/model/use-work-tab-server";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

const SECTION_TITLE = {
  needsYou: "mobile.server.tasks.section.needsYou",
  working: "mobile.server.tasks.section.working",
  waiting: "mobile.server.tasks.section.waiting",
  closed: "mobile.server.tasks.section.closed",
} as const satisfies Record<TasksSectionId, MobileTextKey>;

/**
 * The tasks of all agents of a server, or of one agent with `agentId`, by what they need: needs you,
 * working, waiting, then the newest closed tasks. The inline composer starts a task with the selected agent.
 */
export function ServerTasksScreen() {
  const { t, format } = useText();
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const { agentId } = useLocalSearchParams<{ agentId?: string }>();
  const serverId = useWorkTabServer();
  const { servers, agents: workspaceAgents } = useMobileWorkspace();
  const scopedAgentId = workspaceAgents.some((item) => item.id === agentId && item.serverId === serverId)
    ? agentId
    : undefined;
  const server = servers.find((item) => item.id === serverId);
  const { agents, tasks: serverTasks, online, supported, ready, retry } = useServerTasks(serverId);
  const tasks = scopedAgentId ? serverTasks.filter((task) => task.agentId === scopedAgentId) : serverTasks;
  const [showAllClosed, setShowAllClosed] = useState(false);
  const agent = scopedAgentId ? agents.find((item) => item.id === scopedAgentId) : undefined;
  const agentOf = (id: string) => agents.find((item) => item.id === id);
  const title = agent ? t("mobile.server.tasks.agentTitle", { name: agent.name }) : t("mobile.app.route.tasks");
  const canStart = Boolean(server) && online && supported && agents.length > 0;

  const open = (task: AgentTask) =>
    router.push({ pathname: "/task/[taskId]", params: { serverId, agentId: task.agentId, taskId: task.id } });

  const note = !server
    ? t("mobile.server.unavailable")
    : !supported
      ? t(online ? "mobile.server.tasks.unsupported" : "mobile.server.tasks.offline")
      : agents.length === 0
        ? t("mobile.server.tasks.noAgents")
        : !online && tasks.length === 0
          ? t("mobile.server.tasks.offline")
          : !ready && tasks.length === 0
            ? t("mobile.server.tasks.loading")
            : null;
  const sections = note ? [] : taskSections(tasks, showAllClosed).filter((section) => section.tasks.length > 0);

  return (
    <WorkScreen title={title}>
      {scopedAgentId ? (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          onPress={() => router.setParams({ agentId: undefined })}
        >
          <Button.Label>{t("mobile.server.tasks.allAgents")}</Button.Label>
        </Button>
      ) : null}
      <WorkTaskComposer serverId={serverId} agents={agents} initialAgentId={scopedAgentId} disabled={!canStart} />
      {note ? <EmptyNote text={note} /> : null}
      {retry ? (
        <Pressable accessibilityRole="button" className="px-5 py-2" onPress={retry}>
          <Typography.Paragraph className="text-muted" style={typeScale.preview}>
            {t("mobile.server.tasks.loadFailed")}{" "}
            <Typography.Paragraph className="font-medium text-accent-text" style={typeScale.preview}>
              {t("common.retry")}
            </Typography.Paragraph>
          </Typography.Paragraph>
        </Pressable>
      ) : null}
      {!note && !retry && sections.every((section) => section.id === "closed") ? (
        <View className="items-center gap-1.5 rounded-grouped border border-grouped-border px-4 py-6">
          <Inbox size={22} color={muted} />
          <Typography.Paragraph className="text-muted" weight="semibold" style={typeScale.workTitle}>
            {t("mobile.server.tasks.noOpen")}
          </Typography.Paragraph>
          <Typography.Paragraph
            align="center"
            className="text-muted"
            style={{ fontFamily: "Inter", fontSize: 13, lineHeight: 18 }}
          >
            {t("mobile.server.tasks.openHint")}
          </Typography.Paragraph>
        </View>
      ) : null}
      {sections.map((section) => (
        <View key={section.id} className="gap-2">
          <View className="flex-row flex-wrap items-center gap-1.5 px-1">
            <Typography.Paragraph
              accessibilityRole="header"
              className="font-medium text-muted"
              style={typeScale.teamMeta}
            >
              {t(SECTION_TITLE[section.id]).toUpperCase()}
            </Typography.Paragraph>
            <Typography.Paragraph className="text-muted opacity-60" style={typeScale.teamMeta}>
              {"· "}
              {format.number(section.count)}
            </Typography.Paragraph>
          </View>
          {section.tasks.map((task) => (
            <TaskListRow
              key={task.id}
              task={task}
              variant="card"
              agent={agent ? undefined : agentOf(task.agentId)}
              dimmed={section.id === "closed"}
              onPress={() => open(task)}
            />
          ))}
          {section.id === "closed" && !showAllClosed && section.count > TASKS_CLOSED_SHOWN ? (
            <Pressable
              accessibilityRole="button"
              className="self-start px-5 py-2"
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              onPress={() => {
                void haptics.selection();
                setShowAllClosed(true);
              }}
            >
              <Typography.Paragraph className="font-medium text-accent-text" style={typeScale.preview}>
                {t("mobile.server.tasks.showAll", { count: section.count })}
              </Typography.Paragraph>
            </Pressable>
          ) : null}
        </View>
      ))}
    </WorkScreen>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <Typography.Paragraph className="text-muted" style={typeScale.preview}>
      {text}
    </Typography.Paragraph>
  );
}
