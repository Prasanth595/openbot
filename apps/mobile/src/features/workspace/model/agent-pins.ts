import type { createWorkspacePreferences, RemoteWorkspacePreferences } from "@openbot/team-client";

const MAX_PINNED_AGENTS = 16;

/** The shared limit includes agent and channel pins. */
export function canToggleAgentPin(pinned: readonly string[], chatId: string): boolean {
  return pinned.includes(chatId) || pinned.length < MAX_PINNED_AGENTS;
}

/** Remove deleted agents only. Hidden pins stay saved and return when the agent is shown again. */
export function withAvailableAgentPins(
  current: RemoteWorkspacePreferences,
  agents: readonly { id: string }[],
): RemoteWorkspacePreferences {
  const available = new Set(agents.map((agent) => agent.id));
  const pinned = current.pinned.filter((id) => available.has(id));
  return pinned.length === current.pinned.length ? current : { ...current, pinned };
}

/** Save a lead only when the server has none. This choice does not change its pins. */
export function withLeadAgent(current: RemoteWorkspacePreferences, agentId: string): RemoteWorkspacePreferences {
  if (current.leadAgentId != null) return current;
  return { ...current, leadAgentId: agentId };
}

/** Clear only the selected lead, so a stale menu cannot remove a later choice. */
export function withoutLeadAgent(current: RemoteWorkspacePreferences, agentId: string): RemoteWorkspacePreferences {
  return current.leadAgentId === agentId ? { ...current, leadAgentId: null } : current;
}

/** Call only with a complete server list, never a filtered or loading list. */
export function reconcileAgentPins(
  store: ReturnType<typeof createWorkspacePreferences>,
  serverId: string,
  agents: readonly { id: string }[],
) {
  const current = store.read(serverId);
  const availablePins = withAvailableAgentPins(current, agents);
  const next =
    current.leadAgentId && !agents.some((agent) => agent.id === current.leadAgentId)
      ? { ...availablePins, leadAgentId: null }
      : availablePins;
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
