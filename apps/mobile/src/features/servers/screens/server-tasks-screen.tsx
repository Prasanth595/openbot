import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentTask, AgentTasksSnapshot } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import {
  plainTaskTitle,
  TASKS_CLOSED_SHOWN,
  type TasksSectionId,
  taskSections,
} from "@openbot/team-client/agent-tasks";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { Button, Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import ChevronsDownUp from "lucide-react-native/icons/chevrons-down-up";
import ChevronsUpDown from "lucide-react-native/icons/chevrons-up-down";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { AgentTaskMark } from "@/features/servers/components/agent-task-mark";
import { agentTaskStatus } from "@/features/servers/model/agent-task-text";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";

/** As on desktop: how long a start waits before it reaches the agent. Undo cancels it in this time. */
const UNDO_MS = 6_000;
const AVATAR_SIZE = 26;

const SECTION_TITLE = {
  needsYou: "mobile.server.tasks.section.needsYou",
  working: "mobile.server.tasks.section.working",
  waiting: "mobile.server.tasks.section.waiting",
  closed: "mobile.server.tasks.section.closed",
} as const satisfies Record<TasksSectionId, MobileTextKey>;

/** A start that waits for its Undo time. Its task shows in the list as waiting. */
interface PendingStart {
  task: AgentTask;
  text: string;
  clientMessageId: string;
  timer: ReturnType<typeof setTimeout>;
}

/** The task of the last start, in the row under the composer. */
interface Took {
  taskId: string;
  /** True while the start waits: Undo cancels it. */
  pending: boolean;
}

/**
 * The tasks of all agents of a server, as on desktop: a composer that starts a task for the chosen
 * agent, then the tasks by what they need. A start waits a few seconds for Undo; opening it or
 * leaving the screen starts it at once.
 */
export function ServerTasksScreen() {
  const { t } = useText();
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const accent = String(useCSSVariable("--openbot-accent"));
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const { servers, agents, activeServer, hiddenAgents, canUseTasks, loadAgentTasks, startAgentTask } =
    useMobileWorkspace();
  const server = servers.find((item) => item.id === serverId);
  const online = server?.state === "online";
  const supported = canUseTasks(serverId);
  // The host answers 404 for the tasks of an agent that it hides from this member.
  const hiddenIds = serverId === activeServer.id ? new Set(hiddenAgents.map((agent) => agent.id)) : null;
  const serverAgents = agents.filter((agent) => agent.serverId === serverId && !hiddenIds?.has(agent.id));
  const agentOf = (id: string) => serverAgents.find((agent) => agent.id === id);

  const lists = useQueries({
    queries: serverAgents.map((agent) => ({
      queryKey: queryKeys.agentTasks(queryScope, serverId, agent.id),
      enabled: online && supported,
      retry: false,
      queryFn: () => loadAgentTasks(agent.id, serverId),
    })),
  });
  const ready = lists.every((list) => list.data !== undefined || list.isError);
  const failed = lists.filter((list) => list.isError);

  const [draft, setDraft] = useState("");
  const [chosenAgentId, setChosenAgentId] = useState("");
  const agentId = agentOf(chosenAgentId) ? chosenAgentId : (serverAgents[0]?.id ?? "");
  const [pending, setPending] = useState<AgentTask | null>(null);
  const [took, setTook] = useState<Took | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [showAllClosed, setShowAllClosed] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const AgentsToggle = agentsOpen ? ChevronsDownUp : ChevronsUpDown;
  const pendingStart = useRef<PendingStart | null>(null);
  const mounted = useRef(true);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const tasks = [
    ...(pending ? [pending] : []),
    ...lists.flatMap((list) => list.data?.tasks ?? []).filter((task) => agentOf(task.agentId)),
  ];
  const taskOf = (taskId: string) => tasks.find((task) => task.id === taskId);

  /**
   * Starts the waiting task now. The list shows the real task when the host returns it; a failure
   * puts the text back in an empty composer.
   */
  const commit = useCallback(async (): Promise<AgentTask | null> => {
    const start = pendingStart.current;
    if (!start) return null;
    pendingStart.current = null;
    clearTimeout(start.timer);
    try {
      const task = await startAgentTask(
        { agentId: start.task.agentId, text: start.text, clientMessageId: start.clientMessageId },
        serverId,
      );
      // The task shows before its list event arrives.
      queryClient.setQueryData<AgentTasksSnapshot>(
        queryKeys.agentTasks(queryScope, serverId, task.agentId),
        (stored) =>
          stored && !stored.tasks.some((entry) => entry.id === task.id)
            ? { ...stored, tasks: [task, ...stored.tasks] }
            : stored,
      );
      if (mounted.current) {
        setPending((current) => (current?.id === start.task.id ? null : current));
        setTook((current) => (current?.taskId === start.task.id ? { taskId: task.id, pending: false } : current));
      }
      return task;
    } catch (error) {
      void haptics.notification("error");
      const text = currentText();
      const message = text.errorMessage(error, text.t("mobile.server.tasks.error.start"));
      if (!mounted.current) {
        showFailureAlert(error, "team", text.t("mobile.server.tasks.error.start"), message);
        return null;
      }
      setPending((current) => (current?.id === start.task.id ? null : current));
      setTook((current) => (current?.taskId === start.task.id ? null : current));
      if (!draftRef.current.trim()) {
        setDraft(start.text);
        setChosenAgentId(start.task.agentId);
      }
      setStartError(message);
      return null;
    }
  }, [startAgentTask, serverId, queryClient, queryScope]);

  const commitRef = useRef(commit);
  commitRef.current = commit;
  // Leaving the screen starts a waiting task at once.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void commitRef.current();
    };
  }, []);

  function start() {
    const title = plainTaskTitle(draft);
    if (!title || !agentId) return;
    void commit();
    void haptics.notification("success");
    const clientMessageId = Crypto.randomUUID();
    const now = new Date().toISOString();
    const task: AgentTask = {
      id: `pending:${clientMessageId}`,
      agentId,
      threadId: "",
      origin: "user",
      title: title.slice(0, INPUT_LIMITS.agentTaskTitle),
      state: "queued",
      outcome: null,
      hold: null,
      activeTurnId: null,
      progress: null,
      error: null,
      queuedMessages: [],
      createdAt: now,
      updatedAt: now,
      closedAt: null,
    };
    pendingStart.current = { task, text: draft, clientMessageId, timer: setTimeout(() => void commit(), UNDO_MS) };
    setPending(task);
    setTook({ taskId: task.id, pending: true });
    setDraft("");
    setStartError(null);
  }

  /** Takes the waiting start back: its text and agent return to the composer. */
  function undo() {
    const start = pendingStart.current;
    if (!start) return;
    pendingStart.current = null;
    clearTimeout(start.timer);
    void haptics.selection();
    setPending(null);
    setTook(null);
    setDraft(start.text);
    setChosenAgentId(start.task.agentId);
  }

  /** A waiting task opens as soon as it starts. */
  async function open(task: AgentTask) {
    const opened = task.id === pendingStart.current?.task.id ? await commit() : task;
    if (!opened || opened.id.startsWith("pending:")) return;
    router.push({
      pathname: "/task/[taskId]",
      params: { serverId, agentId: opened.agentId, taskId: opened.id },
    });
  }

  if (!server)
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.server.unavailable")}</SettingsNote>
      </SettingsContent>
    );
  if (!online && !supported)
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.server.tasks.offline")}</SettingsNote>
      </SettingsContent>
    );
  if (!supported)
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.server.tasks.unsupported")}</SettingsNote>
      </SettingsContent>
    );
  if (serverAgents.length === 0)
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.server.tasks.noAgents")}</SettingsNote>
      </SettingsContent>
    );

  const chosen = agentOf(agentId);
  const tookTask = took ? taskOf(took.taskId) : undefined;
  const tookAgent = tookTask ? agentOf(tookTask.agentId) : undefined;
  const sections = taskSections(tasks, showAllClosed).filter((section) => section.tasks.length > 0);

  return (
    <SettingsContent>
      <SheetSaveAction
        dirty={plainTaskTitle(draft) !== ""}
        canSave={online && Boolean(agentId)}
        pending={false}
        label={t("mobile.server.tasks.start")}
        onSave={start}
      />
      <View className="gap-2">
        <SheetFormField
          label={t("mobile.server.tasks.ask")}
          hideLabel
          appearance="soft"
          multiline
          maxLength={INPUT_LIMITS.messageText}
          placeholder={t("mobile.server.tasks.ask")}
          value={draft}
          onChangeText={(value) => {
            setDraft(value);
            if (startError) setStartError(null);
          }}
        />
        {/* As the routine trigger picker: a press shows the agents below the row, and the chosen one has a check. */}
        <SettingsSection title={t("mobile.server.tasks.chooseAgent")}>
          <SettingsRow
            accessibilityLabel={t("mobile.server.tasks.agentLabel", { name: chosen?.name ?? "" })}
            expanded={agentsOpen}
            leading={chosen ? <TaskAgentAvatar agent={chosen} serverId={serverId} /> : undefined}
            trailing={<AgentsToggle size={18} color={muted} strokeWidth={1.5} />}
            onPress={() => setAgentsOpen((open) => !open)}
          >
            <Typography.Paragraph numberOfLines={1}>{chosen?.name ?? ""}</Typography.Paragraph>
          </SettingsRow>
          {agentsOpen
            ? serverAgents.map((agent) => (
                <SettingsRow
                  key={agent.id}
                  checked={agent.id === agentId}
                  disclosure={false}
                  leading={<TaskAgentAvatar agent={agent} serverId={serverId} />}
                  trailing={agent.id === agentId ? <Check size={18} color={accent} strokeWidth={2} /> : null}
                  onPress={() => {
                    setAgentsOpen(false);
                    if (agent.id === agentId) return;
                    void haptics.selection();
                    setChosenAgentId(agent.id);
                  }}
                >
                  <Typography.Paragraph numberOfLines={1}>{agent.name}</Typography.Paragraph>
                </SettingsRow>
              ))
            : null}
        </SettingsSection>
        {startError ? (
          <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="px-4 text-danger-text">
            {startError}
          </Typography.Paragraph>
        ) : null}
      </View>

      {took && tookTask ? (
        <SettingsSection footer={took.pending ? t("mobile.server.tasks.undoHint") : undefined}>
          <SettingsRow
            leading={tookAgent ? <TaskAgentAvatar agent={tookAgent} serverId={serverId} /> : undefined}
            disclosure={!took.pending}
            trailing={
              took.pending ? (
                <Button variant="ghost" size="sm" onPress={undo}>
                  <Button.Label>{t("mobile.server.tasks.undo")}</Button.Label>
                </Button>
              ) : undefined
            }
            onPress={() => void open(tookTask)}
          >
            <Typography.Paragraph numberOfLines={2}>
              {t("mobile.server.tasks.took", {
                name: tookAgent?.name ?? tookTask.agentId,
                title: tookTask.title,
              })}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}

      {failed.length > 0 ? (
        <SettingsSection footer={t("mobile.server.tasks.loadFailed")}>
          <SettingsRow
            disclosure={false}
            onPress={() => {
              for (const list of failed) void list.refetch();
            }}
          >
            <Typography.Paragraph>{t("common.retry")}</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}

      {!online && tasks.length === 0 ? (
        <SettingsNote>{t("mobile.server.tasks.offline")}</SettingsNote>
      ) : !ready && tasks.length === 0 ? (
        <SettingsNote>{t("mobile.server.tasks.loading")}</SettingsNote>
      ) : sections.length === 0 && failed.length === 0 ? (
        <SettingsNote>{t("mobile.server.tasks.empty")}</SettingsNote>
      ) : (
        sections.map((section) => (
          <SettingsSection key={section.id} title={t(SECTION_TITLE[section.id])}>
            {section.tasks.map((task) => {
              const agent = agentOf(task.agentId);
              return (
                <SettingsRow
                  key={task.id}
                  leading={<AgentTaskMark task={task} />}
                  trailing={agent ? <TaskAgentAvatar agent={agent} serverId={serverId} /> : undefined}
                  supportingText={t("mobile.server.tasks.rowMeta", {
                    agent: agent?.name ?? task.agentId,
                    status: agentTaskStatus(task, t),
                  })}
                  onPress={() => void open(task)}
                >
                  <Typography.Paragraph
                    numberOfLines={2}
                    className={section.id === "closed" ? "text-grouped-secondary" : undefined}
                  >
                    {task.title}
                  </Typography.Paragraph>
                </SettingsRow>
              );
            })}
            {section.id === "closed" && !showAllClosed && section.count > TASKS_CLOSED_SHOWN ? (
              <SettingsRow disclosure={false} onPress={() => setShowAllClosed(true)}>
                <Typography.Paragraph className="text-accent-text">
                  {t("mobile.server.tasks.showAll", { count: section.count })}
                </Typography.Paragraph>
              </SettingsRow>
            ) : null}
          </SettingsSection>
        ))
      )}
    </SettingsContent>
  );
}

/** The agent of a task, as the routine calendar shows it. */
function TaskAgentAvatar({ agent, serverId }: { agent: MobileAgent; serverId: string }) {
  return (
    <View className="flex-row items-center" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <BloubAvatar
        agentId={agent.id}
        serverId={serverId}
        hue={agent.avatarHue}
        seed={agent.avatarSeed}
        size={AVATAR_SIZE}
        animateIdle={false}
      />
    </View>
  );
}
