import type {
  BrowserDockAction,
  BrowserDockAgent,
  BrowserDockMcpServer,
  BrowserDockPresentation,
  BrowserDockSkill,
  BrowserTab,
} from "@openbot/contracts/ipc";
import { BROWSER_USER_CONTROL_CAPABILITY } from "@openbot/contracts/team-protocol/browser-user-control-v1";
import type { ComposerAgent, ComposerMcpServer, ComposerSkill } from "@openbot/ui/data";
import { BrowserDock, type BrowserIslandContent } from "@openbot/ui/features/browser/BrowserDock";
import { browserActionLabel } from "@openbot/ui/features/browser/browser-action-labels";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, onSettled, Show, snapshot, untrack } from "solid-js";
import { deviceSendShortcut } from "../../send-shortcut-preference";
import { serverSupportsCapability } from "../servers/server-capabilities";
import { conversationPort } from "./conversation-port";
import { conversationRuntime } from "./conversation-runtime";
import { useConversationViewScope } from "./conversation-scope";

/**
 * The dock over the page of `tab`: the island, the queue and the composer of the agent that owns the tab.
 * It uses the draft, the queue and the turn of the conversation, so a message typed here is the same message
 * as in the chat.
 *
 * With `overlay`, the page is a native view above this window, so the dock here is under it. The adapter
 * then publishes the dock to the overlay view above the page and does the actions that it sends back.
 * This dock shows again when main hides the overlay.
 */
export function BrowserDockAdapter(adapterProps: { tab: BrowserTab | undefined; overlay: boolean }) {
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
    takeBrowserControl,
    releaseBrowserControl,
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
    if (adapterProps.tab?.userControl) return { kind: "activity", control: "user" };
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

  /** The user takes the page from the agent, or gives it back. A request of the agent ends when the user is done. */
  const handoffAction = (): (() => Promise<void>) | undefined => {
    const tab = adapterProps.tab;
    const content = island();
    if (!tab || content?.kind !== "activity") return undefined;
    if (content.control === "request") return async () => void (await respondToBrowserTakeover("complete"));
    if (content.control === "user") return () => releaseBrowserControl(tab.id);
    if (foreign() || !serverSupportsCapability(props.server, BROWSER_USER_CONTROL_CAPABILITY)) return undefined;
    return () => takeBrowserControl(tab.id);
  };

  const deliveries = () => (foreign() ? [] : presentedQueueDeliveries());
  const hold = () => {
    const current = props.queue?.hold;
    return current && current.agentId !== owner()?.id ? current : null;
  };
  const dismissReply = (id: string) => setDismissedReplies((ids) => new Set(ids).add(id));
  const openAgent = () => {
    const agent = owner();
    return foreign() && agent ? () => props.onSelectAgent(agent.id) : undefined;
  };

  async function handoff(action: () => Promise<void>) {
    if (handoffPending()) return;
    setHandoffPending(true);
    try {
      await action();
    } finally {
      setHandoffPending(false);
    }
  }

  const onHandoff = createMemo(() => {
    const action = handoffAction();
    return action ? () => void handoff(action) : undefined;
  });

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

  /** The overlay's field: a revision changes only for a draft that did not come from the overlay. */
  let overlayText: string | undefined;
  let draftText = untrack(() => currentDraft().text);
  let draftRevision = 0;
  const presentation = createMemo((): BrowserDockPresentation | null => {
    const agent = owner();
    if (!adapterProps.overlay || !adapterProps.tab || !agent) return null;
    const text = currentDraft().text;
    if (text !== draftText) {
      draftText = text;
      if (text !== overlayText) draftRevision += 1;
      overlayText = undefined;
    }
    // The stores hold proxies, which IPC cannot copy.
    return snapshot({
      agent: dockAgent(agent),
      agents: props.agents.map(dockAgent),
      skills: installedSkills().map(dockSkill),
      mcpServers: mcpServers().map(dockMcpServer),
      draft: { text, revision: draftRevision },
      focusRequest: composerFocusRequest(),
      sendShortcut: deviceSendShortcut(props.platform),
      working: working(),
      deliveries: deliveries(),
      hold: hold(),
      editingDeliveryId: editingDeliveryId() ?? null,
      canSteer: Boolean(props.activeTurnId),
      canRunAsTask: Boolean(props.tasks?.onRunQueuedMessage),
      island: island(),
      handoffPending: handoffPending(),
      canHandoff: Boolean(onHandoff()),
      openAgent: Boolean(openAgent()),
      canOpenChat: true,
    });
  });
  /** Main shows the overlay above the page. */
  const [overlayShown, setOverlayShown] = createSignal(false);

  // A failed publish keeps the overlay as it was; main hides it when the page goes.
  const publish = (value: BrowserDockPresentation | null) =>
    void conversationPort()
      .browserDock.publishPresentation(value)
      .catch(() => undefined);
  createEffect(presentation, publish);

  function act(action: BrowserDockAction) {
    switch (action.type) {
      case "value-change":
        overlayText = action.text;
        updateCurrentDraft({ text: action.text });
        return;
      case "send":
        send(action.text);
        return;
      case "stop":
        props.onStop();
        return;
      case "steer":
        props.onSteerQueuedMessage(action.deliveryId);
        return;
      case "run-as-task":
        props.tasks?.onRunQueuedMessage(action.deliveryId);
        return;
      case "cancel":
        props.onCancelQueuedMessage(action.deliveryId);
        return;
      case "edit": {
        const delivery = deliveries().find((entry) => entry.id === action.deliveryId);
        if (delivery) void editQueuedMessage(delivery);
        return;
      }
      case "cancel-edit":
        void cancelQueuedMessageEdit();
        return;
      case "reorder":
        reorderPresentedQueue(action.deliveryIds);
        return;
      case "handoff":
        onHandoff()?.();
        return;
      case "dismiss-reply":
        dismissReply(action.id);
        return;
      case "open-chat":
        setActiveRightPanel("browser");
        return;
      case "open-agent":
        openAgent()?.();
        return;
      case "select-agent":
        props.onSelectAgent(action.agentId);
        return;
      case "open-link":
        void openExternalMessageUrl(action.url);
        return;
    }
  }

  onSettled(() => {
    const stopAction = conversationPort().browserDock.onAction(act);
    const stopShown = conversationPort().browserDock.onShown(setOverlayShown);
    return () => {
      stopAction();
      stopShown();
      publish(null);
    };
  });

  return (
    <Show when={!overlayShown() && owner()}>
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
          deliveries={deliveries()}
          hold={hold()}
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
          onHandoff={onHandoff()}
          onRespondSecret={(input) => conversationRuntime(props).agent.respondToBrowserSecret(input)}
          onDismissReply={dismissReply}
          onOpenChat={() => setActiveRightPanel("browser")}
          onOpenAgent={openAgent()}
          onSelectAgent={props.onSelectAgent}
          onOpenLink={(url) => void openExternalMessageUrl(url)}
        />
      )}
    </Show>
  );
}

function dockAgent(agent: ComposerAgent): BrowserDockAgent {
  return {
    id: agent.id,
    name: agent.name,
    title: agent.title,
    description: agent.description,
    avatarSeed: agent.avatarSeed,
    avatarHue: agent.avatarHue,
    avatarUrl: agent.avatarUrl,
  };
}

function dockSkill(skill: ComposerSkill): BrowserDockSkill {
  return {
    skillId: skill.skillId,
    slug: skill.slug,
    name: skill.name,
    state: skill.state,
    ...(skill.enabled === undefined ? {} : { enabled: skill.enabled }),
    ...(skill.origin === undefined ? {} : { origin: skill.origin }),
    ...(skill.description === undefined ? {} : { description: skill.description }),
  };
}

/** Never the environment or the headers: they can hold secrets. */
function dockMcpServer(server: ComposerMcpServer): BrowserDockMcpServer {
  return {
    id: server.id,
    name: server.name,
    enabled: server.enabled,
    transport: server.transport,
    command: server.command,
    args: [...server.args],
    url: server.url,
  };
}
