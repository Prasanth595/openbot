import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";
/** Local-only IPC. The joined-host surface does not use or advertise this port. */
export function agentConversationsPort(): OpenBotDesktopApi["agentConversations"] {
  return window.openbot.agentConversations;
}
