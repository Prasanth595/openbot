import type { AgentTask } from "@openbot/contracts/ipc";
import { taskTone } from "@openbot/team-client/agent-tasks";
import { Typography } from "heroui-native";
import CircleCheck from "lucide-react-native/icons/circle-check";
import { Pressable, View } from "react-native";
import { useCSSVariable } from "uniwind";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { AgentTaskMark } from "@/features/servers/components/agent-task-mark";
import { agentTaskStatus } from "@/features/servers/model/agent-task-text";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { formatUpdatedAt } from "@/shared/lib/format-updated-at";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

const AVATAR_SIZE = 36;
/** Marks the place of the status in the translated line, so the status can have its own color. */
const STATUS_MARK = "⁣";

/**
 * One task as the Tasks screen and the search show it: the agent, the title, and a line with the
 * agent, the state in its color and the time. Without `agent`, the screen of one agent, the row
 * leaves out the avatar and the name. A task that needs the person shows its state in bold, green
 * for an answer and red for a failure or a stop, with a dot in the same color.
 */
export function TaskListRow({
  task,
  agent,
  dimmed = false,
  variant = "plain",
  onPress,
}: {
  task: AgentTask;
  agent?: MobileAgent;
  /** A closed task. */
  dimmed?: boolean;
  variant?: "plain" | "card";
  onPress: () => void;
}) {
  const { t, format } = useText();
  const status = agentTaskStatus(task, t);
  const when = formatUpdatedAt(task.closedAt ?? task.updatedAt, format);
  const line = agent
    ? t("mobile.server.tasks.rowMetaTime", { agent: agent.name, status: STATUS_MARK, when })
    : t("mobile.server.tasks.rowMetaTimeOnly", { status: STATUS_MARK, when });
  const [before = "", after = ""] = line.split(STATUS_MARK);
  const tone = taskTone(task);
  const [success, danger, accent] = useCSSVariable([
    "--openbot-success-text",
    "--openbot-danger-text",
    "--openbot-accent-text",
  ]);
  // `taskTone` says "attention" for an answer and "danger" for a failure or a stop.
  const mark = tone === "attention" ? String(success) : tone === "danger" ? String(danger) : null;
  const cardColor = task.state === "running" ? accent : task.outcome === "completed" ? success : mark;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("mobile.chat.tasks.open", { title: task.title, status })}
      className={
        variant === "card"
          ? "flex-row items-center gap-3 rounded-grouped border border-grouped-border bg-grouped p-3.5"
          : "flex-row items-center gap-3 px-5 py-2.5"
      }
      style={({ pressed }) => ({ opacity: pressed ? 0.58 : 1 })}
      onPress={() => {
        void haptics.selection();
        onPress();
      }}
    >
      {variant === "card" ? (
        task.outcome === "completed" && task.state !== "running" && task.state !== "queued" ? (
          <CircleCheck size={20} color={String(success)} />
        ) : (
          <View className="w-5 items-center">
            <AgentTaskMark task={task} />
          </View>
        )
      ) : agent ? (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <BloubAvatar
            agentId={agent.id}
            serverId={agent.serverId}
            hue={agent.avatarHue}
            seed={agent.avatarSeed}
            size={AVATAR_SIZE}
            animateIdle={false}
          />
        </View>
      ) : null}
      <View className={variant === "card" ? "min-w-0 flex-1 gap-1" : "min-w-0 flex-1 gap-0.5"}>
        <Typography.Paragraph
          className={dimmed ? (variant === "card" ? "text-text-secondary" : "font-medium text-muted") : "font-medium"}
          numberOfLines={variant === "card" ? 2 : 1}
          style={variant === "card" ? typeScale.workTitle : typeScale.body}
        >
          {task.title}
        </Typography.Paragraph>
        {variant === "card" ? (
          <Typography.Paragraph
            className="text-muted uppercase"
            style={[typeScale.workStatus, typeof cardColor === "string" ? { color: cardColor } : undefined]}
          >
            {status}
          </Typography.Paragraph>
        ) : (
          <Typography.Paragraph className="text-muted" numberOfLines={1} style={typeScale.caption}>
            {before}
            <Typography.Paragraph
              className={mark ? "font-semibold" : "text-muted"}
              style={[typeScale.caption, mark ? { color: mark } : null]}
            >
              {status}
            </Typography.Paragraph>
            {/* As the design: the time after the state has the color of the state too. */}
            {mark ? (
              <Typography.Paragraph style={[typeScale.caption, { color: mark }]}>{after}</Typography.Paragraph>
            ) : (
              after
            )}
          </Typography.Paragraph>
        )}
      </View>
      {variant === "card" ? (
        agent ? (
          <BloubAvatar
            agentId={agent.id}
            serverId={agent.serverId}
            seed={agent.avatarSeed}
            hue={agent.avatarHue}
            size={28}
            animateIdle={false}
          />
        ) : null
      ) : mark ? (
        // A task that needs the person: a dot in the color of its state.
        <View
          className="size-4 items-center justify-center"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <View className="size-2 rounded-full" style={{ backgroundColor: mark }} />
        </View>
      ) : (
        <AgentTaskMark task={task} />
      )}
    </Pressable>
  );
}
