import type { createWorkspacePreferences, RemoteWorkspacePreferences } from "@openbot/team-client";

const MAX_PINNED_AGENTS = 16;

/** Protect only the lead agent; the shared limit includes agent and channel pins. */
export function canToggleAgentPin(
  pinned: readonly string[],
  chatId: string,
  leadAgentId: string | null = null,
): boolean {
  return chatId !== leadAgentId && (pinned.includes(chatId) || pinned.length < MAX_PINNED_AGENTS);
}

/**
 * Keep a visible lead pinned without restoring an agent the user hid. A mandatory lead may exceed
 * the soft limit when all 16 saved pins are channels. Keep those pins; block further manual pins.
 */
export function withLeadAgentPin(
  current: RemoteWorkspacePreferences,
  agents: readonly { id: string }[],
  hostHidden: readonly string[] = [],
): RemoteWorkspacePreferences {
  const hidden = new Set([...current.hidden, ...hostHidden]);
  const available = new Set(agents.filter((agent) => !hidden.has(agent.id)).map((agent) => agent.id));
  const pinned = current.pinned.filter((id) => available.has(id));
  if (pinned.length === 0) {
    const first = agents.find((agent) => available.has(agent.id));
    if (first) pinned.push(first.id);
  }
  return pinned.length === current.pinned.length && pinned.every((id, index) => id === current.pinned[index])
    ? current
    : { ...current, pinned };
}

/** Call only with a complete server list, never a filtered or loading list. */
export function reconcileAgentPins(
  store: ReturnType<typeof createWorkspacePreferences>,
  serverId: string,
  agents: readonly { id: string }[],
  hostHidden: readonly string[] = [],
) {
  const current = store.read(serverId);
  const next = withLeadAgentPin(current, agents, hostHidden);
  if (next !== current) store.write(serverId, next);
  return next;
}

export function reconcileChannelPins(
  store: ReturnType<typeof createWorkspacePreferences>,
  serverId: string,
  channels: readonly { id: string }[],
) {
  const current = store.read(serverId);
  const available = new Set(channels.map((channel) => channel.id));
  const pinnedChannels = (current.pinnedChannels ?? []).filter((id) => available.has(id));
  if (pinnedChannels.length === (current.pinnedChannels?.length ?? 0)) return current;
  const next = { ...current, pinnedChannels };
  store.write(serverId, next);
  return next;
}

export function setChannelHidden(
  current: RemoteWorkspacePreferences,
  channelId: string,
  hidden: boolean,
): RemoteWorkspacePreferences {
  return {
    ...current,
    hiddenChannels: hidden
      ? [...new Set([...(current.hiddenChannels ?? []), channelId])]
      : (current.hiddenChannels ?? []).filter((id) => id !== channelId),
    ...(hidden ? { pinnedChannels: (current.pinnedChannels ?? []).filter((id) => id !== channelId) } : {}),
  };
}
