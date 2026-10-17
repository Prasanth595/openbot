import type { BrowserTab } from "@openbot/contracts/ipc";
import { BrowserDock, type BrowserIslandContent } from "@openbot/ui/features/browser/BrowserDock";
import { browserActionLabel } from "@openbot/ui/features/browser/browser-action-labels";
import { useText } from "@openbot/ui/text";
import { createMemo, createSignal, Show, untrack } from "solid-js";
import { deviceSendShortcut } from "../../send-shortcut-preference";
import { conversationRuntime } from "./conversation-runtime";
import { useConversationViewScope } from "./conversation-scope";

/**
 * The dock over the page of `tab`: the island, the queue and the composer of the agent that owns the tab.
 * It uses the draft, the queue and the turn of the conversation, so a message typed here is the same message
 * as in the chat.
 */
export function BrowserDockAdapter(adapterProps: { tab: BrowserTab | undefined }) {
  const {
    props,
    currentDraft,
    updateCurrentDraft,
    submitComposer,
    composerFocusRequest,
    installedSkills,
    mcpServers,
    presentedQueueDeliveries,
    editingDeliveryId,
    editQueuedMessage,
    cancelQueuedMessageEdit,
    reorderPresentedQueue,
    browserControlForTab,
    respondToBrowserTakeover,
    openExternalMessageUrl,
    setActiveRightPanel,
  } = useConversationViewScope();
  const { t } = useText();
  const owner = createMemo(() => {
    const ownerId = adapterProps.tab?.ownerAgentId;
    return (ownerId ? props.agents.find((agent) => agent.id === ownerId) : undefined) ?? props.agent;
  });
  /** The conversation shows a different agent: its turn and queue are not the tab's. */
  const foreign = () => Boolean(owner() && props.agent && owner()?.id !== props.agent.id);
  const control = () => (adapterProps.tab ? browserControlForTab(adapterProps.tab) : undefined);
  const working = () => Boolean(props.activeTurnId) || control()?.phase === "acting";
  const [handoffPending, setHandoffPending] = createSignal(false);
  const [dismissedReplies, setDismissedReplies] = createSignal<ReadonlySet<string>>(new Set());
  /** Only an answer that arrives while the page is open shows on it. */
  const openedAfter = untrack(() => props.messages.at(-1)?.id);

  const takeover = () => {
    const request = props.browserTakeover;
    return request && request.tabId === adapterProps.tab?.id ? request : undefined;
  };
  /** One open question with no choices is answered from the field. Others need the chat. */
  const question = () => {
    const prompt = props.prompt;
    if (!prompt || prompt.agentId !== owner()?.id || prompt.questions.length === 0) return undefined;
    const [first] = prompt.questions;
    const fromField = prompt.questions.length === 1 && first && first.options === null && !first.isSecret;
    return { prompt, first: fromField ? first : undefined };
  };
  const reply = createMemo(() => {
    const messages = props.messages;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message || message.id === openedAfter) return undefined;
      if (message.author !== "agent") return undefined;
      if (message.streaming || message.itemType === "commentary") continue;
      if ((message.kind ?? "text") !== "text" || !message.body.trim()) continue;
      return dismissedReplies().has(message.id) ? undefined : message;
    }
    return undefined;
  });

  const island = createMemo((): BrowserIslandContent | null => {
    const request = takeover();
    if (request?.secret) return { kind: "secret", request };
    if (request) return { kind: "activity", control: "request" };
    const asked = question();
    if (asked) {
      const id = `prompt:${asked.prompt.requestId}`;
      const body = asked.prompt.questions.map((entry) => entry.question).join("\n\n");
      return dismissedReplies().has(id)
        ? null
        : { kind: "reply", id, body, question: true, answerInChat: asked.first === undefined };
    }
    const session = control();
    if (session?.phase === "acting") {
      return { kind: "activity", control: "agent", label: t(browserActionLabel(session)) };
    }
    if (working()) {
      return { kind: "activity", control: "agent", label: props.activityDetail || t("chat.activity.workingOnIt") };
    }
    const answer = reply();
    return answer ? { kind: "reply", id: answer.id, body: answer.body } : null;
  });

  async function handoff() {
    if (!takeover() || handoffPending()) return;
    setHandoffPending(true);
    try {
      await respondToBrowserTakeover("complete");
    } finally {
      setHandoffPending(false);
    }
  }

  function send(text: string) {
    const asked = question();
    if (asked?.first && !editingDeliveryId()) {
      const answer = text.trim();
      if (!answer) return;
      void props.onAnswerPrompt({ [asked.first.id]: [answer] }).then((answered) => {
        if (answered) updateCurrentDraft({ text: "" });
      });
      return;
    }
    void submitComposer();
  }

  return (
    <Show when={owner()}>
      {(agent) => (
        <BrowserDock
          agent={agent()}
          agents={props.agents}
          skills={installedSkills()}
          mcpServers={mcpServers()}
          value={currentDraft().text}
          focusRequest={composerFocusRequest()}
          sendShortcut={deviceSendShortcut(props.platform)}
          working={working()}
          deliveries={foreign() ? [] : presentedQueueDeliveries()}
          hold={props.queue?.hold?.agentId === agent().id ? null : props.queue?.hold}
          editingDeliveryId={editingDeliveryId()}
          canSteer={Boolean(props.activeTurnId)}
          island={island()}
          handoffPending={handoffPending()}
          onValueChange={(text) => updateCurrentDraft({ text })}
          onSend={send}
          onStop={props.onStop}
          onSteer={props.onSteerQueuedMessage}
          onRunAsTask={props.tasks?.onRunQueuedMessage}
          onCancel={props.onCancelQueuedMessage}
          onEdit={(delivery) => void editQueuedMessage(delivery)}
          onCancelEdit={() => void cancelQueuedMessageEdit()}
          onReorder={reorderPresentedQueue}
          onHandoff={takeover() ? () => void handoff() : undefined}
          onRespondSecret={(input) => conversationRuntime(props).agent.respondToBrowserSecret(input)}
          onDismissReply={(id) => setDismissedReplies((ids) => new Set(ids).add(id))}
          onOpenChat={() => setActiveRightPanel("browser")}
          onOpenAgent={foreign() ? () => props.onSelectAgent(agent().id) : undefined}
          onSelectAgent={props.onSelectAgent}
          onOpenLink={(url) => void openExternalMessageUrl(url)}
        />
      )}
    </Show>
  );
}
