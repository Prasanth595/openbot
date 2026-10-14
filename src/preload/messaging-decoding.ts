// What main answers for the Slack workspaces, Discord servers and Telegram chats of this computer.
// These guard the renderer.

import {
  type AddMessagingOrchestratorResult,
  isAddMessagingOrchestratorResult,
  isMessagingOverview,
  isSlackAccessOverview,
  isTelegramOverview,
  type MessagingOverview,
  type SlackAccessOverview,
  type TelegramOverview,
} from "@openbot/contracts/ipc";

/** The orchestrator that main created, and the sidebar section it went to. */
export function decodeAddOrchestratorReply(value: unknown): AddMessagingOrchestratorResult {
  if (!isAddMessagingOrchestratorResult(value)) throw new Error("Invalid messaging orchestrator response.");
  return value;
}

export function decodeMessagingOverviewReply(value: unknown): MessagingOverview {
  if (!isMessagingOverview(value)) throw new Error("Invalid messaging overview response.");
  return value;
}

export function decodeSlackAccessOverviewReply(value: unknown): SlackAccessOverview {
  if (!isSlackAccessOverview(value)) throw new Error("Invalid Slack access response.");
  return {
    connections: value.connections.map(({ workspaceId, grantedScopes, verifiedAt, current }) => ({
      workspaceId,
      grantedScopes,
      verifiedAt,
      current,
    })),
  };
}

export function decodeTelegramOverviewReply(value: unknown): TelegramOverview {
  if (!isTelegramOverview(value)) throw new Error("Invalid Telegram overview response.");
  return value;
}
