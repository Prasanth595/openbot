import { agentSatellitePhase, type SatellitePhase } from "@/features/agents/model/satellite-motion";
import type { MobileAgentActivity } from "@/features/workspace/model/agent-activity";
import type { ChatMessage } from "./chat-messages";
import { isStreamingReply } from "./reply-reveal";

export interface ChatActivityPresentation {
  active: boolean;
  /** The reply replaces the placeholder; the header can still show an active turn. */
  showRow: boolean;
  phase: SatellitePhase;
  activity: MobileAgentActivity | undefined;
  /** A terminal event wins over an older active-turn read or streamed message. */
  finishedTurnId: string | null;
}

/** One activity decision for the header, activity row and scroll reserve. */
export function presentChatActivity({
  activity,
  completion,
  activeTurnId,
  messages,
  sending,
  awaitingTurn,
}: {
  activity?: MobileAgentActivity;
  completion?: MobileAgentActivity;
  activeTurnId: string | null;
  messages: readonly ChatMessage[];
  sending: boolean;
  awaitingTurn: boolean;
}): ChatActivityPresentation {
  const finished =
    completion?.phase === "finished" ? completion : activity?.phase === "finished" ? activity : undefined;
  const finishedTurnId = finished?.turnId ?? null;
  const live = activity && (!finished || activity.turnId !== finishedTurnId) ? activity : undefined;
  const runningTurn = activeTurnId !== null && activeTurnId !== finishedTurnId;
  const currentTurnId = live?.turnId ?? (runningTurn ? activeTurnId : null);
  const latestReply = messages.findLast(
    (message) =>
      message.kind === "message" &&
      message.author === "agent" &&
      (!message.speaker || message.speaker.kind === "agent") &&
      (!activity?.agentId || !message.speaker || message.speaker.id === activity.agentId),
  );
  const streaming =
    latestReply?.kind === "message" &&
    isStreamingReply(latestReply) &&
    (!finished || latestReply.turnId !== finishedTurnId) &&
    currentTurnId !== null &&
    latestReply.turnId === currentTurnId;
  const active = Boolean(live || runningTurn || streaming || sending || awaitingTurn);
  const replyVisible =
    currentTurnId !== null &&
    latestReply?.kind === "message" &&
    latestReply.turnId === currentTurnId &&
    latestReply.body.trim().length > 0;
  const showRow = active && (!replyVisible || live?.phase === "waiting" || live?.phase === "tool");
  const belongsToChat =
    finished &&
    (activeTurnId === finished.turnId ||
      activity?.turnId === finished.turnId ||
      messages.some((message) => "turnId" in message && message.turnId === finished.turnId));
  const phase =
    live?.phase === "waiting"
      ? "idle"
      : live?.phase === "tool"
        ? "tool"
        : live?.phase === "responding" || streaming
          ? "generating"
          : active
            ? "thinking"
            : agentSatellitePhase(belongsToChat ? finished : undefined);
  return { active, showRow, phase, activity: live, finishedTurnId };
}
