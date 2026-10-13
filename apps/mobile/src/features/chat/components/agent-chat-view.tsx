import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { useAgentActivity } from "@/features/workspace/components/use-agent-activity";
import { useApprovalRequests } from "@/features/workspace/components/use-live-workspace";
import { type MobileAgent, useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { openTurnActivity } from "@/features/workspace/model/agent-activity";
import { chatRowIndex, latestReadableMessage, projectChatMessages, withFailureReasons } from "../model/chat-messages";
import { ChatView } from "./chat-view";
import { useChatQueue } from "./use-chat-queue";
import { useQuestionPrompt } from "./use-question-prompt";

/** `focusMessageId` opens the chat at a message from search instead of at the latest message. */
export function MobileChatView({ agent, focusMessageId }: { agent: MobileAgent; focusMessageId?: string }) {
  const {
    agents,
    conversationStore,
    servers,
    loadConversation,
    loadConversationAround,
    loadLatestMessages,
    loadOlderMessages,
    interruptTurn,
    markAgentRead,
    respondToPrompt,
  } = useMobileWorkspace();
  const subscribe = useCallback(
    (notify: () => void) => conversationStore.subscribe(agent.id, notify),
    [agent.id, conversationStore],
  );
  const snapshot = useCallback(() => conversationStore.get(agent.id), [agent.id, conversationStore]);
  const stopTurn = useCallback(
    (turnId: string) => interruptTurn(agent.id, turnId, agent.serverId),
    [agent.id, agent.serverId, interruptTurn],
  );
  const conversation = useSyncExternalStore(subscribe, snapshot);
  const serverAgents = useMemo(
    () => agents.filter((item) => item.serverId === agent.serverId),
    [agents, agent.serverId],
  );
  const mentionAgents = useMemo(() => serverAgents.filter((item) => item.id !== agent.id), [serverAgents, agent.id]);
  const memberId = servers.find((item) => item.id === agent.serverId)?.membershipId ?? null;
  const accountUserId = useMobileSession().session?.user.id ?? null;
  const projected = useMemo(
    () => projectChatMessages(conversation?.messages ?? [], memberId, accountUserId),
    [conversation?.messages, memberId, accountUserId],
  );
  const references = useMemo(
    () => projectChatMessages(Object.values(conversation?.references ?? {}), memberId, accountUserId),
    [conversation?.references, memberId, accountUserId],
  );
  const activity = openTurnActivity(useAgentActivity(agent.id), conversation);
  const serverApprovals = useApprovalRequests(agent.serverId);
  const threadId = conversation?.threadId ?? null;
  // As on the desktop, only this chat's thread.
  const approvals = useMemo(
    () =>
      serverApprovals.filter(
        (approval) => approval.agentId === agent.id && (threadId === null || approval.threadId === threadId),
      ),
    [serverApprovals, agent.id, threadId],
  );
  const online = servers.find((item) => item.id === agent.serverId)?.state === "online";
  const queue = useChatQueue(
    agent.id,
    agent.serverId,
    online,
    conversation?.activeTurnId ?? null,
    conversation?.messages,
  );
  const messages = useMemo(() => withFailureReasons(projected, queue.deliveries), [projected, queue.deliveries]);
  const [historyLoadFailed, setHistoryLoadFailed] = useState(false);
  // The message from search, until the chat shows it. `loaded` is set when its page is in the store.
  const [focus, setFocus] = useState(focusMessageId ? { messageId: focusMessageId, loaded: false } : null);
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const clearFocus = useCallback(() => setFocus(null), []);
  const request = useRef(0);
  const fetchHistory = useCallback(() => {
    if (!online) return;
    const id = ++request.current;
    setHistoryLoadFailed(false);
    const messageId = focusRef.current?.loaded === false ? focusRef.current.messageId : null;
    const load = async () => {
      if (messageId && !conversationStore.get(agent.id)?.messages.some((message) => message.id === messageId)) {
        if (!(await loadConversationAround(agent.id, messageId, agent.serverId))) {
          // The host no longer has the message. The chat opens at the latest message.
          if (request.current === id) setFocus(null);
          await loadLatestMessages(agent.id, agent.serverId);
          return;
        }
      }
      // The list can show the message, and clear the focus, before the request ends.
      if (messageId && request.current === id)
        setFocus((current) => (current?.messageId === messageId ? { messageId, loaded: true } : current));
      // A latest page that meets the window around the message joins the two.
      await loadConversation(agent.id, agent.serverId);
    };
    void load().catch(() => {
      if (request.current !== id) return;
      setHistoryLoadFailed(true);
      // Show what the phone has rather than wait for a message that did not load.
      setFocus(null);
    });
  }, [
    agent.id,
    agent.serverId,
    online,
    conversationStore,
    loadConversation,
    loadConversationAround,
    loadLatestMessages,
  ]);
  useEffect(() => {
    fetchHistory();
    return () => {
      request.current += 1;
    };
  }, [fetchHistory]);
  const detached = conversation?.detached ?? false;
  // A message in the store that the chat shows no row for, such as a thinking step.
  const focusRowMissing = focus?.loaded === true && chatRowIndex(messages, focus.messageId) < 0;
  useEffect(() => {
    if (!focusRowMissing) return;
    setFocus(null);
    if (detached) void loadLatestMessages(agent.id, agent.serverId).catch(() => undefined);
  }, [focusRowMissing, detached, agent.id, agent.serverId, loadLatestMessages]);
  const showLatestMessages = useCallback(
    () => loadLatestMessages(agent.id, agent.serverId),
    [agent.id, agent.serverId, loadLatestMessages],
  );
  const latest = latestReadableMessage(conversation?.messages ?? []);
  const latestId = latest?.id;
  const markRead = useCallback(() => {
    if (latestId) markAgentRead(agent.id, latestId, agent.serverId);
  }, [agent.id, agent.serverId, latestId, markAgentRead]);
  const activePrompt = messages.findLast(
    (message) =>
      message.kind === "question" &&
      !message.prompt.resolution &&
      Boolean(conversation?.activeTurnId) &&
      message.turnId === conversation?.activeTurnId,
  );
  const questionForm = useQuestionPrompt(
    agent.id,
    activePrompt?.kind === "question" ? activePrompt : undefined,
    online,
    respondToPrompt,
  );
  return (
    <ChatView
      target={{ ...agent, kind: "agent" }}
      queue={queue}
      agents={serverAgents}
      mentionAgents={mentionAgents}
      projectedMessages={messages}
      referenceMessages={references}
      ready={Boolean(conversation)}
      historyLoadFailed={historyLoadFailed}
      // The phone keeps a message while the server is offline and sends it when it is back.
      canSend
      activity={activity}
      activeTurnId={conversation?.activeTurnId ?? null}
      stopTurn={stopTurn}
      questionForm={questionForm}
      approvals={approvals}
      readBoundary={latest ? `${latest.id}:${latest.status}` : null}
      markRead={markRead}
      fetchHistory={fetchHistory}
      hasOlder={conversation?.pageInfo.hasOlder ?? false}
      olderLoading={conversation?.olderLoading ?? false}
      olderError={conversation?.olderError ?? false}
      loadOlder={() => {
        void loadOlderMessages(agent.id, agent.serverId);
      }}
      focusMessageId={focus?.messageId ?? null}
      // Offline, the chat shows what the phone has and moves to the message when its page loads.
      holdOpening={focus !== null && online}
      onFocusPlaced={clearFocus}
      detached={detached}
      showLatestMessages={showLatestMessages}
    />
  );
}
