import { agentProviderName } from "@openbot/contracts/agent-providers";
import type { AgentEvent, AgentSummary, ServerNotificationLevel } from "@openbot/contracts/ipc";
import { markdownPreviewText } from "@openbot/contracts/markdown-preview-text";
import type { AppFormat, AppTranslate } from "@openbot/i18n";
import { cleanAgentMessageText } from "./agent-message-text";

export interface AgentNotificationContent {
  title: string;
  body: string;
  agentId: string;
  threadId: string | null;
}

/**
 * The one notice for a provider plan limit, at every level but "nothing". It is about the account,
 * so the switch of the agent whose turn found the limit does not silence it.
 */
export function notificationForUsageLimit(
  event: Extract<AgentEvent, { type: "usage-limit-reached" }>,
  agents: AgentSummary[],
  translate: AppTranslate,
  format: AppFormat,
  level: ServerNotificationLevel,
): AgentNotificationContent | null {
  if (level === "nothing") return null;
  const count = event.agentCount;
  // A weekly window can reset days later, so a reset that is not today names its day.
  const resetDate = event.resetsAt === null ? null : new Date(event.resetsAt * 1_000);
  const reset =
    resetDate === null
      ? null
      : format.date(resetDate, {
          ...(resetDate.toDateString() === new Date().toDateString() ? {} : { weekday: "short" }),
          hour: "numeric",
          minute: "2-digit",
        });
  return {
    title: translate("notification.usageLimit.title", { provider: agentProviderName(event.provider) }),
    body: reset
      ? translate("notification.usageLimit.bodyResets", { count, reset })
      : translate("notification.usageLimit.body", { count }),
    agentId: event.agentId,
    threadId: agents.find((agent) => agent.id === event.agentId)?.threadId ?? null,
  };
}

/**
 * The words of the agent that a notification may show. Without it, a notification shows only a
 * fixed text, so a shared screen or the Lock Screen shows no part of a conversation.
 */
export interface AgentNotificationPreview {
  /** The answer of the finished turn, as the agent wrote it, or null when the caller has none. */
  reply: string | null;
  /**
   * Hides the secrets in the text, because the Lock Screen can show it. The caller supplies it:
   * this package runs in a browser and in React Native, without the log redaction.
   */
  redact: (text: string) => string;
}

/** About three lines of a macOS notification. The system cuts a longer body itself. */
const PREVIEW_LIMIT = 200;
/** The start of a reply that the preview reads, so that a long reply is not parsed in full. */
const REPLY_READ_LIMIT = 2_000;

/**
 * What a server's agent event says to the user, or null when the server level or the agent's own
 * switch keeps it quiet. "needs-me" keeps only the events that wait for the user.
 */
export function notificationForAgentEvent(
  event: AgentEvent,
  agents: AgentSummary[],
  translate: AppTranslate,
  level: ServerNotificationLevel,
  preview: AgentNotificationPreview | null = null,
): AgentNotificationContent | null {
  if (level === "nothing") return null;
  const subject = notificationSubject(event, level, translate, preview);
  if (!subject) return null;
  const agent = agents.find((candidate) => candidate.id === subject.agentId);
  if (!agent?.notifications) return null;
  return { title: agent.name, ...subject };
}

function notificationSubject(
  event: AgentEvent,
  level: ServerNotificationLevel,
  translate: AppTranslate,
  preview: AgentNotificationPreview | null,
): Omit<AgentNotificationContent, "title"> | null {
  if (event.type === "prompt") {
    const question = preview && event.questions[0]?.question;
    const body = (question && plainPreview(preview.redact(question))) || translate("notification.needsInput");
    return { body, agentId: event.agentId, threadId: event.threadId };
  }
  if (event.type === "approval") {
    const { agentId, threadId, kind, command, reason } = event.approval;
    // A command keeps its characters; a reason is Markdown, as a reply is.
    const action = !preview
      ? null
      : kind === "command" && command
        ? previewText(preview.redact(command))
        : reason && plainPreview(preview.redact(reason));
    const body = action
      ? translate("notification.needsApprovalFor", { action })
      : translate("notification.needsApproval");
    return { body, agentId, threadId };
  }
  // A quiet routine run posted nothing, so there is nothing to look at.
  if (event.type !== "turn-completed" || level !== "all" || event.quiet) return null;
  const { agentId, threadId } = event;
  if (event.status === "completed") {
    // Redact before the cut and the Markdown change the shape of a secret.
    const reply = preview?.reply && plainPreview(preview.redact(preview.reply).slice(0, REPLY_READ_LIMIT));
    return { body: reply || translate("notification.finished"), agentId, threadId };
  }
  // An interrupted turn is one the user stopped, so it is not news.
  if (event.status === "failed") return { body: translate("notification.failed"), agentId, threadId };
  return null;
}

/** Agent Markdown as plain text, cut to the preview length. */
function plainPreview(text: string): string | null {
  return previewText(markdownPreviewText(cleanAgentMessageText(text)));
}

/** The text as one line, cut to the preview length, or null when nothing is left. */
function previewText(text: string): string | null {
  const characters = Array.from(text.replace(/\s+/gu, " ").trim());
  if (characters.length === 0) return null;
  if (characters.length <= PREVIEW_LIMIT) return characters.join("");
  return `${characters
    .slice(0, PREVIEW_LIMIT - 1)
    .join("")
    .trimEnd()}…`;
}
