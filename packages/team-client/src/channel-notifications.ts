import type { ChannelSummary, ClientAgentSummary, ServerNotificationLevel } from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import { type AgentNotificationChannel, plainPreview } from "./agent-notifications";

export interface ChannelNotificationContent {
  title: string;
  body: string;
  channelId: string;
  agentId: string;
}

export interface ChannelNotificationOptions {
  agents: readonly ClientAgentSummary[];
  translate: AppTranslate;
  level: ServerNotificationLevel;
  /** Hides the secrets in the preview. Null when the user keeps the agent's words out of notifications. */
  redact: ((text: string) => string) | null;
}

/**
 * The agent replies that a new channel list shows, one for each channel. A reply is news when an
 * agent wrote the newest message, it stopped streaming since the previous list, and the reader has
 * not read it. The level and the agent's own switch apply as for an agent chat reply
 * (`notificationForAgentEvent`): a reply notifies only at "all".
 *
 * The first list of a server is only the baseline: `previous` null gives no notification. A host
 * without channel-attention-v1 sends no author or status, so its replies never notify.
 */
export function channelReplyNotifications(
  previous: readonly ChannelSummary[] | null,
  next: readonly ChannelSummary[],
  options: ChannelNotificationOptions,
): ChannelNotificationContent[] {
  if (previous === null || options.level !== "all") return [];
  const before = new Map(previous.map((channel) => [channel.id, channel.lastMessage] as const));
  return next.flatMap((channel) => {
    const last = channel.lastMessage;
    if (channel.archived || channel.unreadCount === 0) return [];
    if (last?.author?.kind !== "agent") return [];
    if (last.status !== "completed" && last.status !== "failed") return [];
    const earlier = before.get(channel.id);
    // The same message, already finished in the list before: it was news then, not now.
    if (
      earlier?.author?.id === last.author.id &&
      earlier.at === last.at &&
      (earlier.status === "completed" || earlier.status === "failed")
    )
      return [];
    const agentId = last.author.id;
    const agent = options.agents.find((candidate) => candidate.id === agentId);
    if (!agent?.notifications) return [];
    const body =
      last.status === "failed"
        ? options.translate("notification.failed")
        : (options.redact && plainPreview(options.redact(last.text))) ||
          options.translate("notification.channelMessage");
    const title = options.translate("notification.channelTitle", { agent: agent.name, channel: channel.name });
    return [{ title, body, channelId: channel.id, agentId }];
  });
}

/** The channel that owns `threadId` in a channel list, from the threads of channel-attention-v1. */
export function channelForThread(
  channels: readonly ChannelSummary[],
  threadId: string | null,
): AgentNotificationChannel | null {
  if (threadId === null) return null;
  const channel = channels.find((candidate) => candidate.threads?.some((thread) => thread.threadId === threadId));
  return channel ? { id: channel.id, name: channel.name } : null;
}
