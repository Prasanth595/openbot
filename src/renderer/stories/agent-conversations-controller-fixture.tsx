import {
  type ConversationSearchPage,
  isAgentStatus,
  isAgentSummary,
  type OpenBotDesktopApi,
  type QueuedMessageReceipt,
  type VoiceTranscriptionResult,
} from "@openbot/contracts/ipc";
import type {
  AgentConversationActionInput,
  AgentConversationList,
  AgentConversationListInput,
  AgentConversationQueue,
  AgentConversationRead,
  AgentConversationTarget,
  CreateAgentConversationInput,
  ReadAgentConversationInput,
  SearchAgentConversationInput,
  SendAgentConversationInput,
  UpdateAgentConversationInput,
} from "@openbot/contracts/ipc-agent-conversations";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Button } from "@openbot/ui";
import { createEffect, createMemo, createStore, flush, onSettled, Show, untrack } from "solid-js";
import {
  decodeLocalAgentConversationEvent,
  decodeLocalAgentConversationList,
  decodeLocalAgentConversationQueue,
  decodeLocalAgentConversationRead,
  decodeLocalAgentConversationTarget,
} from "../../preload/agent-conversation-decoding";
import { decodeConversationSearchPageFromMain, decodeReceipt } from "../../preload/conversation-decoding";
import { toAgentProfile } from "../src/app-message-projection";
import { createAgentConversationsController } from "../src/features/conversation/agent-conversations-controller";
import { createConversationController } from "../src/features/conversation/conversation-controller";
import { ConversationControllerProvider } from "../src/features/conversation/conversation-controller-context";
import { composerDraftKey } from "../src/features/conversation/conversation-keys";
import type { ConversationRuntime } from "../src/features/conversation/conversation-runtime";
import { createConversationViewScope } from "../src/features/conversation/conversation-scope";
import type { ConversationProps, ConversationTarget } from "../src/features/conversation/conversation-types";
import { createVoiceStore } from "../src/features/conversation/stores/voice-store";
import { CONVERSATION_STORY_ARGS, StoryAppProviders } from "./conversation-story-support";
import { createMockOpenBot } from "./mock-openbot";

function transcribed(value: unknown): VoiceTranscriptionResult {
  if (!isDynamicRecord(value) || !isString(value.text)) throw new Error("Invalid synthetic voice transport.");
  return { text: value.text };
}
interface FixtureAcknowledgement {
  acknowledged: true;
}
function acknowledged(value: unknown): FixtureAcknowledgement {
  if (!isDynamicRecord(value) || value.acknowledged !== true) throw new Error("Invalid fixture acknowledgement.");
  return { acknowledged: true };
}
interface FixtureBootstrap {
  agent: import("@openbot/contracts/ipc").AgentSummary;
  status: import("@openbot/contracts/ipc").AgentStatus;
  main: AgentConversationTarget;
  a: AgentConversationTarget;
  b: AgentConversationTarget;
}
function bootstrap(value: unknown): FixtureBootstrap {
  if (!isDynamicRecord(value) || !isAgentSummary(value.agent) || !isAgentStatus(value.status))
    throw new Error("Invalid controller bootstrap.");
  const agent = value.agent;
  const status = value.status;
  const main = decodeLocalAgentConversationTarget(value.main);
  const a = decodeLocalAgentConversationTarget(value.a);
  const b = decodeLocalAgentConversationTarget(value.b);
  if (
    [main, a, b].some((target) => target.agentId !== agent.id) ||
    main.threadId !== agent.threadId ||
    new Set([main.threadId, a.threadId, b.threadId]).size !== 3
  )
    throw new Error("Fixture bootstrap conversation owner mismatch.");
  return { agent, status, main, a, b };
}
interface FixtureRequestInputs {
  list: AgentConversationListInput;
  create: CreateAgentConversationInput;
  update: UpdateAgentConversationInput;
  read: ReadAgentConversationInput;
  queue: ReadAgentConversationInput;
  search: SearchAgentConversationInput;
  send: SendAgentConversationInput;
  action: AgentConversationActionInput;
  bootstrap: null;
  "barrier-arm": {
    method: "send" | "read" | "action" | "voice";
    threadId: string;
    failReply?: boolean;
    editAction?: "save";
  };
  "barrier-wait": null;
  "barrier-release": null;
  "event-ack": { id: string };
  "event-flush": null;
  "ask-a": null;
  voice: { threadId: string };
}
interface FixtureRequestReplies {
  list: AgentConversationList;
  create: AgentConversationTarget;
  update: FixtureAcknowledgement;
  read: AgentConversationRead;
  queue: AgentConversationQueue;
  search: ConversationSearchPage;
  send: QueuedMessageReceipt;
  action: FixtureAcknowledgement;
  bootstrap: FixtureBootstrap;
  "barrier-arm": FixtureAcknowledgement;
  "barrier-wait": FixtureAcknowledgement;
  "barrier-release": FixtureAcknowledgement;
  "event-ack": FixtureAcknowledgement;
  "event-flush": FixtureAcknowledgement;
  "ask-a": FixtureAcknowledgement;
  voice: VoiceTranscriptionResult;
}
type FixtureDecoder<Method extends keyof FixtureRequestInputs> = (value: unknown) => FixtureRequestReplies[Method];
type FixtureRequest = <Method extends keyof FixtureRequestInputs>(
  method: Method,
  input: FixtureRequestInputs[Method],
  decode: FixtureDecoder<Method>,
) => Promise<FixtureRequestReplies[Method]>;

/** The runner owns this loopback bridge and synthetic profile. No fixture message reaches a model. */
export function AgentConversationsControllerFixture() {
  const params = new URLSearchParams(window.location.search);
  const origin = params.get("fixtureOrigin");
  const nonce = params.get("fixtureNonce");
  if (!origin || !nonce) return <p>This controller fixture needs the conversation E2E runner.</p>;
  const fixtureNonce = nonce;
  const url = new URL(origin);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/")
    throw new Error("The conversation fixture requires its owned loopback bridge.");
  const mock = createMockOpenBot();
  const previous = window.openbot;
  window.openbot = mock.api;
  onSettled(() => () => {
    mock.dispose();
    window.openbot = previous;
  });
  async function request<Method extends keyof FixtureRequestInputs>(
    method: Method,
    input: FixtureRequestInputs[Method],
    decode: FixtureDecoder<Method>,
  ): Promise<FixtureRequestReplies[Method]> {
    const response = await fetch(`${url.origin}/fixture/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Fixture-Nonce": fixtureNonce },
      body: JSON.stringify(input),
    });
    const value = await response.json();
    if (!response.ok)
      throw new Error(
        isDynamicRecord(value) && isString(value.error) ? value.error : "The fixture service request was refused.",
      );
    return decode(value);
  }
  const api: OpenBotDesktopApi["agentConversations"] = {
    list: (input) => request("list", input, decodeLocalAgentConversationList),
    create: (input) => request("create", input, decodeLocalAgentConversationTarget),
    update: async (input) => {
      await request("update", input, acknowledged);
    },
    read: (input) => request("read", input, decodeLocalAgentConversationRead),
    queue: (input) => request("queue", input, decodeLocalAgentConversationQueue),
    search: (input) => request("search", input, decodeConversationSearchPageFromMain),
    send: (input) => request("send", input, decodeReceipt),
    action: async (input) => {
      await request("action", input, acknowledged);
    },
    onChanged: (listener) => {
      const stream = new EventSource(`${url.origin}/fixture/events?nonce=${encodeURIComponent(fixtureNonce)}`);
      stream.onmessage = (message) => listener(decodeLocalAgentConversationEvent(JSON.parse(message.data)));
      stream.addEventListener("fixture-barrier", (message) => {
        if (!(message instanceof MessageEvent) || typeof message.data !== "string")
          throw new Error("Invalid fixture event barrier.");
        const value = JSON.parse(message.data);
        if (isDynamicRecord(value) && isString(value.id)) {
          flush();
          void request("event-ack", { id: value.id }, acknowledged);
        }
      });
      return () => stream.close();
    },
  };
  mock.api.agentConversations = api;
  const [loaded, setLoaded] = createStore<{ data: FixtureBootstrap | null; error: string | null }>({
    data: null,
    error: null,
  });
  onSettled(() => {
    let live = true;
    void request("bootstrap", null, bootstrap)
      .then((data) => {
        if (!live) return;
        setLoaded((state) => {
          state.data = data;
        });
      })
      .catch(() =>
        setLoaded((state) => {
          state.error = "The controller fixture could not load its service.";
        }),
      );
    return () => {
      live = false;
    };
  });
  return (
    <Show
      when={loaded.data}
      fallback={<output aria-label="Conversation controller receipt">{loaded.error ?? "loading"}</output>}
    >
      {(data) => (
        <StoryAppProviders>
          <ControllerRoot api={api} request={request} data={data()} mock={mock.api} fixtureNonce={fixtureNonce} />
        </StoryAppProviders>
      )}
    </Show>
  );
}

interface RootProps {
  api: OpenBotDesktopApi["agentConversations"];
  request: FixtureRequest;
  data: FixtureBootstrap;
  mock: OpenBotDesktopApi;
  fixtureNonce: string;
}
interface FixtureControllerState {
  operation: string;
  receipt: string;
  error: string | null;
  pending: boolean;
}
function ControllerRoot(props: RootProps) {
  const subjects = createAgentConversationsController(
    untrack(() => props.api),
    () => props.data.agent.id,
  );
  const stable = createConversationController({ onTypingChange: () => {} }, false);
  const profile = createMemo(() => toAgentProfile(props.data.agent));
  const selectedScope = () => subjects.target() ?? props.data.main;
  function runtime(captured: ConversationTarget): ConversationRuntime {
    const threadId = captured.threadId ?? props.data.main.threadId;
    const subject = { agentId: captured.agentId, threadId };
    const api = props.api;
    const mock = props.mock;
    return {
      ...mock,
      agent: {
        ...mock.agent,
        editQueuedMessage: async (input) => {
          await api.action({ ...subject, action: "edit", edit: input });
          return (await api.queue(subject)).snapshot;
        },
        setMessageReaction: async (input) => {
          await api.action({ ...subject, action: "reaction", messageId: input.messageId, emoji: input.emoji });
          return undefined;
        },
      },
    };
  }
  const viewProps = createMemo<ConversationProps>(() => {
    const selected = selectedScope();
    const target = { agentId: selected.agentId, threadId: selected.threadId };
    const view = subjects.view();
    const activeTurnId = view?.activeTurnId;
    const prompt = subjects.prompt();
    const promptHandle = prompt ? { turnId: prompt.turnId, requestId: prompt.requestId } : null;
    const throughMessageId = view?.messages.at(-1)?.id ?? null;
    return {
      ...CONVERSATION_STORY_ARGS,
      agent: profile(),
      agents: [profile()],
      agentStatus: props.data.status,
      messages: subjects.messages(),
      messageReferences: subjects.references(),
      conversationThreadId: subjects.selected() ?? undefined,
      conversationArchived:
        subjects.currentSummary()?.archivedAt !== null && subjects.currentSummary()?.archivedAt !== undefined,
      activeTurnId: subjects.view()?.activeTurnId,
      loaded: subjects.view()?.loaded ?? false,
      queue: subjects.view()?.queue,
      prompt: subjects.prompt(),
      approval: subjects.approval(),
      browserTakeover: subjects.takeover(),
      unreadCount: subjects.view()?.page?.readState?.unreadCount ?? 0,
      firstUnreadMessageId: subjects.view()?.page?.readState?.firstUnreadMessageId ?? null,
      hasOlder: subjects.view()?.page?.pageInfo.hasOlder,
      runtimeForTarget: runtime,
      runtime: runtime({ ...target, serverId: "local" }),
      server: CONVERSATION_STORY_ARGS.server,
      browserEnabled: false,
      remoteDesktopSessionActive: false,
      remoteDesktopVisible: false,
      onSendMessage: (body, drafts, replyId, captured, clientId) =>
        subjects.send(body, drafts, replyId, captured ?? { ...target, serverId: "local" }, clientId),
      onMarkRead: async () => {
        await subjects.run({ ...target, action: "mark-read", throughMessageId });
      },
      onLoadOlder: () => {
        void subjects.loadOlder(target);
      },
      onLoadLatest: () => subjects.load(target),
      onSearchMessages: (query) => subjects.search(target, query),
      onOpenSearchMessage: (messageId) => subjects.load(target, { type: "around", messageId }),
      onStop: async () => {
        if (activeTurnId) await subjects.run({ ...target, action: "stop", turnId: activeTurnId });
      },
      onAnswerPrompt: async (answers) => {
        if (!promptHandle) return false;
        await subjects.run({
          ...target,
          action: "prompt",
          turnId: promptHandle.turnId,
          requestId: promptHandle.requestId,
          answers,
        });
        return true;
      },
      onCancelQueuedMessage: async (deliveryId) => {
        await subjects.run({ ...target, action: "cancel", deliveryId });
      },
      onReorderQueue: (deliveryIds) => {
        void subjects.run({ ...target, action: "reorder", deliveryIds });
      },
    };
  });
  createEffect(
    () => ({
      agentId: props.data.agent.id,
      main: { agentId: props.data.main.agentId, threadId: props.data.main.threadId },
    }),
    ({ agentId, main }) => {
      void subjects.list(agentId).then(() => subjects.load(main));
    },
  );
  return (
    <ConversationControllerProvider controller={stable}>
      <ScopeCommands {...props} {...viewProps()} subjects={subjects} stable={stable} />
    </ConversationControllerProvider>
  );
}

function ScopeCommands(
  props: RootProps &
    ConversationProps & {
      subjects: ReturnType<typeof createAgentConversationsController>;
      stable: ReturnType<typeof createConversationController>;
    },
) {
  const chat = createConversationViewScope(props);
  let scrollElement: HTMLDivElement | undefined;
  untrack(() => {
    props.mock.voice.transcribe = async () => {
      return props.request("voice", { threadId: props.data.a.threadId }, transcribed);
    };
  });
  const voice = createVoiceStore({
    props,
    resources: untrack(() => props.stable.resources),
    voicePhase: () => props.stable.voicePhase(),
    setVoicePhase: (phase) => props.stable.setVoicePhase(phase),
    setVoiceModelProgress: (progress) => props.stable.setVoiceModelProgress(progress),
    voiceElapsedSeconds: () => props.stable.voiceElapsedSeconds(),
    setVoiceElapsedSeconds: (seconds) => props.stable.setVoiceElapsedSeconds(seconds),
    setVoiceLiveTranscript: (transcript) => props.stable.setVoiceLiveTranscript(transcript),
    setVoiceLevels: (levels) => props.stable.setVoiceLevels(levels),
    drafts: () => props.stable.drafts(),
    setDrafts: (update) => props.stable.setDrafts(update),
    setConversationErrors: (update) => props.stable.setConversationErrors(update),
    setComposerError: chat.setComposerError,
    setComposerFocusRequest: (update) => props.stable.setComposerFocusRequest(update),
    clearConversationError: chat.clearChatErrors,
    setConversationError: (target, message) =>
      props.stable.setConversationErrors((errors) => ({ ...errors, [composerDraftKey(target)]: message })),
    viewIsMounted: () => true,
    hooks: {
      submit: async () => {
        throw new Error("This synthetic dictation restores a draft only.");
      },
      saveEdit: async () => {
        throw new Error("This synthetic dictation does not save an edit.");
      },
      restoreTranscript: () => {
        throw new Error("This synthetic dictation has no submitted request.");
      },
    },
  });
  const [state, setState] = createStore<FixtureControllerState>({
    operation: "ready",
    receipt: "",
    error: null,
    pending: false,
  });
  const select = (destination: AgentConversationTarget) => {
    props.stable.setAgentConversationSelection({ ...destination, serverId: "local" });
    props.subjects.select(destination);
    flush();
  };
  const local = (destination: AgentConversationTarget): ConversationTarget => ({ ...destination, serverId: "local" });
  const draftText = (destination: AgentConversationTarget) =>
    props.stable.drafts()[composerDraftKey(local(destination))]?.text ?? "";
  const waitHeld = async () => {
    await props.request("barrier-wait", null, acknowledged);
  };
  const release = async () => {
    await props.request("barrier-release", null, acknowledged);
  };
  async function run(operation: string): Promise<void> {
    if (state.pending) return;
    setState((current) => {
      current.pending = true;
      current.operation = operation;
      current.receipt = "";
      current.error = null;
    });
    try {
      await props.subjects.list(props.data.agent.id);
      if (operation === "draft") {
        select(props.data.a);
        await props.subjects.load(props.data.a);
        chat.updateCurrentDraft({
          text: "Synthetic A draft",
          replyToMessageId: props.subjects.view()?.messages.find((row) => row.author === "assistant")?.id ?? null,
        });
        flush();
        const replyA = chat.currentDraft().replyToMessageId;
        select(props.data.b);
        await props.subjects.load(props.data.b);
        chat.updateCurrentDraft({ text: "Synthetic B draft" });
        flush();
        props.stable.setDrafts((drafts) => drafts);
        select(props.data.a);
        flush();
        setState((current) => {
          current.receipt = JSON.stringify({
            a: draftText(props.data.a),
            b: draftText(props.data.b),
            replyA,
            currentReply: chat.currentDraft().replyToMessageId,
            target: chat.currentChatConversationKey(),
          });
        });
      } else if (operation === "send") {
        select(props.data.a);
        await props.subjects.load(props.data.a);
        chat.updateCurrentDraft({
          text: "subject-controller-send-a [fixture:complete:controller-send-a]",
          replyToMessageId: null,
        });
        flush();
        await props.request(
          "barrier-arm",
          { method: "send", threadId: props.data.a.threadId, failReply: true },
          acknowledged,
        );
        chat.submitComposer();
        await waitHeld();
        select(props.data.b);
        chat.updateCurrentDraft({ text: "Synthetic B during A send" });
        flush();
        await release();
        setState((current) => {
          current.receipt = JSON.stringify({
            captured: props.data.a.threadId,
            selected: props.subjects.selected(),
            bDraft: draftText(props.data.b),
          });
        });
      } else if (operation === "retry") {
        select(props.data.a);
        flush();
        const failed = props.stable.pendingSends.list(local(props.data.a)).find((row) => row.state === "failed");
        if (!failed) throw new Error("The accepted send with a lost reply did not remain retryable.");
        chat.retryPendingSend(failed.clientMessageId);
        setState((current) => {
          current.receipt = JSON.stringify({
            clientMessageId: failed.clientMessageId,
            threadId: props.data.a.threadId,
          });
        });
      } else if (operation === "page") {
        await props.request("barrier-arm", { method: "read", threadId: props.data.a.threadId }, acknowledged);
        select(props.data.a);
        await waitHeld();
        select(props.data.b);
        await props.subjects.load(props.data.b);
        await release();
        setState((current) => {
          current.receipt = JSON.stringify({
            selected: props.subjects.selected(),
            aPageThread: props.subjects.state.views[props.data.a.threadId]?.page?.threadId,
            bPageThread: props.subjects.state.views[props.data.b.threadId]?.page?.threadId,
          });
        });
      } else if (operation === "older") {
        select(props.data.a);
        await props.subjects.load(props.data.a);
        const before = props.subjects.state.views[props.data.a.threadId]?.messages.length ?? 0;
        await props.subjects.loadOlder(props.data.a);
        const after = props.subjects.state.views[props.data.a.threadId]?.messages.length ?? 0;
        const found = await props.subjects.search(props.data.a, "subject-controller-history-a");
        select(props.data.b);
        await props.subjects.load(props.data.b);
        setState((current) => {
          current.receipt = JSON.stringify({
            before,
            after,
            matchingIds: found.messageIds,
            selected: props.subjects.selected(),
          });
        });
      } else if (operation === "stale-attention") {
        await props.request("barrier-arm", { method: "read", threadId: props.data.a.threadId }, acknowledged);
        select(props.data.a);
        await waitHeld();
        await props.request("ask-a", null, acknowledged);
        await props.request("event-flush", null, acknowledged);
        select(props.data.b);
        await release();
        setState((current) => {
          current.receipt = JSON.stringify({
            selected: props.subjects.selected(),
            aAttention: props.subjects.state.views[props.data.a.threadId]?.attention.map((item) => item.type),
          });
        });
      } else if (operation === "edit") {
        select(props.data.b);
        await props.subjects.load(props.data.b);
        const queued = props.subjects.view()?.queue?.deliveries.find((row) => row.status === "queued");
        if (!queued) throw new Error("The real B queue fixture is missing.");
        await props.request("barrier-arm", { method: "action", threadId: props.data.b.threadId }, acknowledged);
        const editing = chat.editQueuedMessage(queued);
        await waitHeld();
        select(props.data.a);
        chat.updateCurrentDraft({ text: "Synthetic A during B edit" });
        flush();
        const focusBefore = props.stable.composerFocusRequest();
        const actionsBefore = chat.showComposerActions();
        await release();
        await editing;
        flush();
        setState((current) => {
          current.receipt = JSON.stringify({
            editingThreadId: props.stable.editingThreadId(),
            selected: props.subjects.selected(),
            aDraft: draftText(props.data.a),
            bDraft: draftText(props.data.b),
            focusBefore,
            focusAfter: props.stable.composerFocusRequest(),
            actionsBefore,
            actionsAfter: chat.showComposerActions(),
          });
        });
      } else if (operation === "cancel-edit") {
        select(props.data.b);
        flush();
        await chat.cancelQueuedMessageEdit();
        setState((current) => {
          current.receipt = JSON.stringify({
            editingThreadId: props.stable.editingThreadId(),
            aDraft: draftText(props.data.a),
            bDraft: draftText(props.data.b),
          });
        });
      } else if (operation === "save-edit") {
        select(props.data.b);
        await props.subjects.load(props.data.b);
        const queued = props.subjects.view()?.queue?.deliveries.find((row) => row.status === "queued");
        if (!queued) throw new Error("The real B queue for Save is missing.");
        await chat.editQueuedMessage(queued);
        chat.updateCurrentDraft({ text: "subject-controller-saved-b [fixture:complete:controller-saved-b]" });
        flush();
        await props.request(
          "barrier-arm",
          { method: "action", threadId: props.data.b.threadId, editAction: "save" },
          acknowledged,
        );
        chat.submitComposer();
        await waitHeld();
        select(props.data.a);
        chat.updateCurrentDraft({ text: "Synthetic A during B save" });
        flush();
        await release();
        setState((current) => {
          current.receipt = JSON.stringify({
            savedThreadId: props.data.b.threadId,
            selected: props.subjects.selected(),
            aDraft: draftText(props.data.a),
          });
        });
      } else if (operation === "read") {
        select(props.data.a);
        await props.subjects.load(props.data.a);
        const mark = props.onMarkRead;
        await props.request("barrier-arm", { method: "action", threadId: props.data.a.threadId }, acknowledged);
        const pending = mark();
        await waitHeld();
        select(props.data.b);
        await release();
        await pending;
        setState((current) => {
          current.receipt = JSON.stringify({
            markedThreadId: props.data.a.threadId,
            selected: props.subjects.selected(),
          });
        });
      } else if (operation === "voice") {
        select(props.data.a);
        flush();
        chat.updateCurrentDraft({ text: "Synthetic A voice prefix" });
        const captured = local(props.data.a);
        props.stable.resources.voiceAgentId = captured.agentId;
        props.stable.resources.voiceServerId = captured.serverId;
        props.stable.resources.voiceThreadId = captured.threadId;
        props.stable.resources.voiceSubmitRequest = undefined;
        // This is the captured microphone transport: a valid short silent WAV on an owned profile.
        const audio = new ArrayBuffer(1644);
        const header = new DataView(audio);
        const bytes = new Uint8Array(audio);
        for (const [at, text] of [
          [0, "RIFF"],
          [8, "WAVE"],
          [12, "fmt "],
          [36, "data"],
        ] as const)
          bytes.set(new TextEncoder().encode(text), at);
        header.setUint32(4, 1636, true);
        header.setUint32(16, 16, true);
        header.setUint16(20, 1, true);
        header.setUint16(22, 1, true);
        header.setUint32(24, 16000, true);
        header.setUint32(28, 32000, true);
        header.setUint16(32, 2, true);
        header.setUint16(34, 16, true);
        header.setUint32(40, 1600, true);
        props.stable.resources.voiceChunks = [new Blob([audio], { type: "audio/wav" })];
        props.stable.setVoicePhase("transcribing");
        await props.request("barrier-arm", { method: "voice", threadId: props.data.a.threadId }, acknowledged);
        const finishing = voice.finishVoiceRecording("audio/wav");
        await waitHeld();
        select(props.data.b);
        await release();
        await finishing;
        flush();
        setState((current) => {
          current.receipt = JSON.stringify({
            voiceThreadId: captured.threadId,
            selected: props.subjects.selected(),
            aDraft: draftText(props.data.a),
            bDraft: draftText(props.data.b),
          });
        });
      } else if (operation === "stop") {
        select(props.data.a);
        await props.subjects.load(props.data.a);
        await props.request("barrier-arm", { method: "action", threadId: props.data.a.threadId }, acknowledged);
        props.onStop();
        await waitHeld();
        select(props.data.b);
        await release();
        setState((current) => {
          current.receipt = JSON.stringify({
            stoppedThreadId: props.data.a.threadId,
            selected: props.subjects.selected(),
          });
        });
      } else if (operation === "input") {
        select(props.data.a);
        await props.subjects.load(props.data.a);
        const prompt = props.subjects.prompt();
        if (!prompt) throw new Error("The real controller input fixture is missing.");
        const captured = {
          ...props.data.a,
          action: "prompt" as const,
          turnId: prompt.turnId,
          requestId: prompt.requestId,
          answers: { "fixture-choice": ["Keep"] },
        };
        select(props.data.b);
        await props.subjects.run(captured);
        setState((current) => {
          current.receipt = JSON.stringify({
            answeredThreadId: captured.threadId,
            turnId: captured.turnId,
            selected: props.subjects.selected(),
          });
        });
      } else if (operation === "scroll") {
        select(props.data.a);
        await props.subjects.load(props.data.a);
        flush();
        await new Promise<void>((done) => requestAnimationFrame(() => done()));
        if (!scrollElement) throw new Error("The real scroll fixture element is missing.");
        scrollElement.scrollTop = 120;
        chat.setStickToLatest(false);
        select(props.data.b);
        await props.subjects.load(props.data.b);
        flush();
        await new Promise<void>((done) => requestAnimationFrame(() => done()));
        chat.setStickToLatest(true);
        select(props.data.a);
        flush();
        const identity = (target: AgentConversationTarget) => `local:${target.agentId}:${target.threadId}`;
        setState((current) => {
          current.receipt = JSON.stringify({
            aScroll: props.stable.resources.conversationScrollStates.get(identity(props.data.a)),
            bScroll: props.stable.resources.conversationScrollStates.get(identity(props.data.b)),
            selected: props.subjects.selected(),
          });
        });
      }
    } catch (error) {
      setState((current) => {
        current.error = error instanceof Error ? error.message : "Controller fixture failed.";
      });
    } finally {
      setState((current) => {
        current.pending = false;
      });
    }
  }
  const receipt = createMemo(() =>
    JSON.stringify({
      fixtureNonce: props.fixtureNonce,
      agentId: props.data.agent.id,
      mainThreadId: props.data.main.threadId,
      aThreadId: props.data.a.threadId,
      bThreadId: props.data.b.threadId,
      operation: state.operation,
      pending: state.pending,
      error: state.error,
      result: state.receipt,
      pendingA: props.stable.pendingSends
        .list(local(props.data.a))
        .map((row) => ({ state: row.state, clientMessageId: row.clientMessageId, messageId: row.messageId })),
      voicePhase: props.stable.voicePhase(),
      aPageThread: props.subjects.state.views[props.data.a.threadId]?.page?.threadId,
      bPageThread: props.subjects.state.views[props.data.b.threadId]?.page?.threadId,
      aDraft: draftText(props.data.a),
      bDraft: draftText(props.data.b),
      aAttention: props.subjects.state.views[props.data.a.threadId]?.attention.map((item) => item.type),
      editingThreadId: props.stable.editingThreadId(),
    }),
  );
  return (
    <main class="foundation-story foundation-interaction-stage" ref={chat.setConversationPanelElement}>
      <Button onClick={() => void run("draft")}>Draft capture</Button>
      <Button onClick={() => void run("send")}>Send capture</Button>
      <Button onClick={() => void run("retry")}>Retry send</Button>
      <Button onClick={() => void run("page")}>Page capture</Button>
      <Button onClick={() => void run("older")}>Older page and search</Button>
      <Button onClick={() => void run("stale-attention")}>Stale attention capture</Button>
      <Button onClick={() => void run("edit")}>Queue edit capture</Button>
      <Button onClick={() => void run("cancel-edit")}>Cancel queue edit</Button>
      <Button onClick={() => void run("save-edit")}>Queue save capture</Button>
      <Button onClick={() => void run("read")}>Read capture</Button>
      <Button onClick={() => void run("voice")}>Voice capture</Button>
      <Button onClick={() => void run("stop")}>Stop capture</Button>
      <Button onClick={() => void run("input")}>Input capture</Button>
      <Button onClick={() => void run("scroll")}>Scroll capture</Button>
      <div
        class="chat-scroll"
        ref={(element) => {
          scrollElement = element;
          chat.setScrollElement(element);
        }}
      >
        <div ref={chat.setVirtualRootElement}>
          {props.subjects.messages().map((message) => (
            <p>{message.body}</p>
          ))}
        </div>
      </div>
      <output aria-label="Conversation controller receipt">{receipt()}</output>
    </main>
  );
}
