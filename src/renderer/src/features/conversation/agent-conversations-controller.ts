import type {
  AgentEvent,
  ConversationMessage,
  ConversationPage,
  ConversationPageAnchor,
  OpenBotDesktopApi,
  QueueSnapshot,
} from "@openbot/contracts/ipc";
import type {
  AgentConversationActionInput,
  AgentConversationList,
  AgentConversationSummary,
  AgentConversationTarget,
} from "@openbot/contracts/ipc-agent-conversations";
import { currentText } from "@openbot/ui/text";
import { createMemo, createStore, onSettled, untrack } from "solid-js";
import { toAgentMessage, toAgentMessages } from "../../app-message-projection";
import { mergeConversationPage, windowedSnapshotMessages } from "./conversation-merge";
import type { ConversationTarget, SendMessageResult } from "./conversation-types";

interface SubjectView {
  agentId: string;
  messages: ConversationMessage[];
  page: ConversationPage | null;
  queue: QueueSnapshot | undefined;
  attention: AgentEvent[];
  activeTurnId: string | null;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  olderLoading: boolean;
  olderError: string | null;
  mode: "latest" | "around";
  detail: string | undefined;
  revision: number;
}
interface SubjectList extends AgentConversationList {
  loading: boolean;
  error: string | null;
}
interface ControllerState {
  lists: Record<string, SubjectList>;
  views: Record<string, SubjectView>;
  selections: Record<string, string>;
  summaries: Record<string, AgentConversationSummary>;
  mainThreads: Record<string, string>;
  dialog: { open: boolean; query: string; archived: boolean; pending: boolean; error: string | null };
}
/** Captures every destination before an async action. Each subject owns its page, input and error state. */
export function createAgentConversationsController(
  api: OpenBotDesktopApi["agentConversations"],
  agentId: () => string | null,
) {
  const [state, setState] = createStore<ControllerState>({
    lists: {},
    views: {},
    selections: {},
    summaries: {},
    mainThreads: {},
    dialog: { open: false, query: "", archived: false, pending: false, error: null },
  });
  const pageRequests = new Map<string, number>();
  const listRequests = new Map<string, number>();
  const eventVersions = new Map<string, { queue: number; input: number; turn: number }>();
  const metadataVersions = new Map<string, number>();
  let retainedAgents: Set<string> | null = null;
  let live = true;
  const selected = createMemo(() => {
    const id = agentId();
    return id
      ? (state.selections[id] ?? state.lists[id]?.conversations.find((row) => row.main)?.threadId ?? null)
      : null;
  });
  const currentSummary = createMemo(() => {
    const id = agentId();
    const threadId = selected();
    return id && threadId ? state.summaries[threadId] : undefined;
  });
  const target = (): AgentConversationTarget | null => {
    const id = agentId();
    const threadId = selected();
    return id && threadId ? { agentId: id, threadId } : null;
  };
  const addedTarget = (): AgentConversationTarget | null => {
    const scope = target();
    return scope && state.mainThreads[scope.agentId] && scope.threadId !== state.mainThreads[scope.agentId]
      ? scope
      : null;
  };
  const view = createMemo(() => {
    const threadId = selected();
    return threadId ? state.views[threadId] : undefined;
  });
  const messages = createMemo(() => toAgentMessages(view()?.messages ?? [], agentId() ?? undefined));
  const references = createMemo(() =>
    Object.fromEntries(
      Object.entries(view()?.page?.references ?? {}).map(([id, message]) => [
        id,
        toAgentMessage(message, agentId() ?? undefined),
      ]),
    ),
  );
  const prompt = createMemo(() =>
    view()?.attention.find((event): event is Extract<AgentEvent, { type: "prompt" }> => event.type === "prompt"),
  );
  const approval = createMemo(
    () =>
      view()?.attention.find((event): event is Extract<AgentEvent, { type: "approval" }> => event.type === "approval")
        ?.approval,
  );
  const takeover = createMemo(
    () =>
      view()?.attention.find(
        (event): event is Extract<AgentEvent, { type: "browser-takeover-requested" }> =>
          event.type === "browser-takeover-requested",
      )?.request,
  );

  function updateView(scope: AgentConversationTarget, update: (value: SubjectView) => void): void {
    if (!live) return;
    setState((draft) => {
      draft.views[scope.threadId] ??= {
        agentId: scope.agentId,
        messages: [],
        page: null,
        queue: undefined,
        attention: [],
        activeTurnId: null,
        loading: false,
        loaded: false,
        error: null,
        olderLoading: false,
        olderError: null,
        mode: "latest",
        detail: undefined,
        revision: 0,
      };
      const current = draft.views[scope.threadId];
      if (!current || current.agentId !== scope.agentId) throw new Error("Conversation state owner mismatch.");
      update(current);
    });
  }
  async function list(id: string, more = false, filter?: { query: string; archived: boolean }): Promise<void> {
    if (retainedAgents && !retainedAgents.has(id)) return;
    const request = (listRequests.get(id) ?? 0) + 1;
    listRequests.set(id, request);
    // A command captures its filters and cursor once; these reads do not subscribe its caller.
    const { query, archived, cursor } = untrack(() => ({
      query: filter?.query ?? state.dialog.query,
      archived: filter?.archived ?? state.dialog.archived,
      cursor: more ? (state.lists[id]?.cursor ?? undefined) : undefined,
    }));
    setState((draft) => {
      draft.lists[id] ??= { conversations: [], cursor: null, loading: false, error: null };
      draft.lists[id].loading = true;
      draft.lists[id].error = null;
    });
    try {
      const page = await api.list({ agentId: id, query, archived, ...(cursor ? { cursor } : {}) });
      if (!live || listRequests.get(id) !== request) return;
      setState((draft) => {
        const current = draft.lists[id];
        if (!current) return;
        const rows = more ? [...current.conversations, ...page.conversations] : page.conversations;
        current.conversations = [...new Map(rows.map((row) => [row.threadId, row])).values()];
        for (const summary of page.conversations) {
          draft.summaries[summary.threadId] = summary;
          if (summary.main) draft.mainThreads[id] = summary.threadId;
        }
        current.cursor = page.cursor;
        current.loading = false;
        draft.selections[id] ??=
          page.conversations.find((row) => row.main)?.threadId ?? page.conversations[0]?.threadId ?? "";
      });
    } catch (error) {
      if (!live || listRequests.get(id) !== request) return;
      setState((draft) => {
        const current = draft.lists[id];
        if (current) {
          current.loading = false;
          current.error = currentText().errorMessage(error, currentText().t("conversation.conversations.loadFailed"));
        }
      });
    }
  }
  async function load(
    scope: AgentConversationTarget,
    anchor: ConversationPageAnchor = { type: "latest" },
    mode: "replace" | "older" = "replace",
  ): Promise<void> {
    if (retainedAgents && !retainedAgents.has(scope.agentId)) return;
    const request = (pageRequests.get(scope.threadId) ?? 0) + 1;
    pageRequests.set(scope.threadId, request);
    const eventVersion = { ...(eventVersions.get(scope.threadId) ?? { queue: 0, input: 0, turn: 0 }) };
    const metadataVersion = metadataVersions.get(scope.agentId) ?? 0;
    updateView(scope, (current) => {
      if (mode === "older") {
        current.olderLoading = true;
        current.olderError = null;
      } else {
        current.loading = true;
        current.error = null;
      }
    });
    try {
      const reply = await api.read({ ...scope, anchor, limit: 50 });
      if (!live || pageRequests.get(scope.threadId) !== request) return;
      if (reply.page.agentId !== scope.agentId || reply.page.threadId !== scope.threadId)
        throw new Error("Conversation page owner mismatch.");
      const latestEvents = eventVersions.get(scope.threadId) ?? { queue: 0, input: 0, turn: 0 };
      const receivedQueue = latestEvents.queue !== eventVersion.queue;
      const receivedInput = latestEvents.input !== eventVersion.input;
      const receivedTurn = latestEvents.turn !== eventVersion.turn;
      if ((metadataVersions.get(scope.agentId) ?? 0) === metadataVersion)
        setState((draft) => {
          const previous = draft.summaries[scope.threadId];
          draft.summaries[scope.threadId] = {
            ...reply.summary,
            ...(receivedTurn && previous ? { activeTurnId: previous.activeTurnId } : {}),
            ...(receivedQueue && previous ? { queuedCount: previous.queuedCount } : {}),
            ...(receivedInput && previous ? { requiresInput: previous.requiresInput } : {}),
          };
        });
      updateView(scope, (current) => {
        if (!receivedQueue) current.queue = reply.queue;
        if (!receivedInput) current.attention = reply.attention;
        if (current.revision > reply.page.revision) {
          const known = new Set(current.messages.map((message) => message.id));
          current.messages = [...reply.page.messages.filter((message) => !known.has(message.id)), ...current.messages];
          current.loading = false;
          current.olderLoading = false;
          current.loaded = true;
          if (!current.page)
            current.page = { ...reply.page, revision: current.revision, activeTurnId: current.activeTurnId };
          else if (mode === "older") current.page.pageInfo = reply.page.pageInfo;
          return;
        }
        current.messages = mergeConversationPage(
          current.messages,
          reply.page.messages,
          mode === "older" ? "older" : "replace",
        );
        current.revision = reply.page.revision;
        current.page = reply.page;
        if (!receivedTurn) current.activeTurnId = reply.page.activeTurnId;
        else current.page.activeTurnId = current.activeTurnId;
        current.loading = false;
        current.olderLoading = false;
        current.loaded = true;
        current.mode = anchor.type === "around" ? "around" : "latest";
      });
    } catch (error) {
      if (!live || pageRequests.get(scope.threadId) !== request) return;
      updateView(scope, (current) => {
        current.loading = false;
        current.olderLoading = false;
        const message = currentText().errorMessage(error, currentText().t("conversation.conversations.loadFailed"));
        if (mode === "older") current.olderError = message;
        else current.error = message;
      });
    }
  }
  function receive(event: import("@openbot/contracts/ipc-agent-conversations").AgentConversationEvent): void {
    if (retainedAgents && !retainedAgents.has(event.agentId)) return;
    if (event.type === "list-changed") {
      metadataVersions.set(event.agentId, (metadataVersions.get(event.agentId) ?? 0) + 1);
      void list(event.agentId);
      const selectedTarget = addedTarget();
      if (selectedTarget?.agentId === event.agentId) void load(selectedTarget);
      return;
    }
    const scope = { agentId: event.agentId, threadId: event.threadId };
    const versions = eventVersions.get(scope.threadId) ?? { queue: 0, input: 0, turn: 0 };
    if (event.event.type === "queue-changed") versions.queue += 1;
    if (
      event.event.type === "prompt" ||
      event.event.type === "approval" ||
      event.event.type === "browser-takeover-requested" ||
      event.event.type === "agent-input-resolved" ||
      event.event.type === "browser-takeover-resolved"
    )
      versions.input += 1;
    if (event.event.type === "turn-started" || event.event.type === "turn-completed") versions.turn += 1;
    eventVersions.set(scope.threadId, versions);
    updateView(scope, (current) => {
      const incoming = event.event;
      if (incoming.type === "conversation") {
        if (current.revision > incoming.snapshot.revision) return;
        current.revision = incoming.snapshot.revision;
        const messages = windowedSnapshotMessages(current.messages, incoming.snapshot.messages, {
          hasOlder: current.page?.pageInfo.hasOlder ?? false,
          mode: current.mode,
        });
        current.messages = mergeConversationPage(
          current.messages,
          messages,
          current.page?.pageInfo.hasOlder ? "latest" : "replace",
        );
        current.activeTurnId = incoming.snapshot.activeTurnId;
        if (current.page) current.page.revision = incoming.snapshot.revision;
      } else if (incoming.type === "conversation-delta") {
        if (current.revision >= incoming.revision) return;
        current.revision = incoming.revision;
        const message = current.messages.find((row) => row.id === incoming.messageId);
        if (message) message.text += incoming.delta;
        else
          current.messages.push({
            id: incoming.messageId,
            author: "assistant",
            source: "assistant",
            text: incoming.delta,
            status: "streaming",
            turnId: incoming.turnId,
            createdAt: incoming.createdAt,
          });
        if (current.page) current.page.revision = incoming.revision;
      } else if (incoming.type === "queue-changed") current.queue = incoming.snapshot;
      else if (incoming.type === "turn-started") current.activeTurnId = incoming.turnId;
      else if (incoming.type === "turn-completed") {
        if (current.activeTurnId === incoming.turnId) current.activeTurnId = null;
        current.detail = undefined;
      } else if (incoming.type === "turn-progress") current.detail = incoming.detail;
      else if (
        incoming.type === "prompt" ||
        incoming.type === "approval" ||
        incoming.type === "browser-takeover-requested"
      ) {
        current.attention = current.attention.filter((row) => row.type !== incoming.type);
        current.attention.push(incoming);
      } else if (incoming.type === "agent-input-resolved")
        current.attention = current.attention.filter((row) =>
          row.type === "prompt"
            ? row.requestId !== incoming.requestId
            : row.type === "approval"
              ? row.approval.requestId !== incoming.requestId
              : true,
        );
      else if (incoming.type === "browser-takeover-resolved")
        current.attention = current.attention.filter(
          (row) => row.type !== "browser-takeover-requested" || row.request.requestId !== incoming.requestId,
        );
      else if (incoming.type === "error") current.error = incoming.message;
    });
    if (
      event.event.type === "turn-started" ||
      event.event.type === "turn-completed" ||
      event.event.type === "prompt" ||
      event.event.type === "agent-input-resolved" ||
      event.event.type === "queue-changed"
    )
      void list(event.agentId);
  }
  onSettled(() => {
    const stop = api.onChanged(receive);
    return () => {
      live = false;
      stop();
    };
  });

  async function run(input: AgentConversationActionInput): Promise<void> {
    try {
      await api.action(input);
    } catch (error) {
      updateView(input, (current) => {
        current.error = currentText().errorMessage(error, currentText().t("conversation.conversations.actionFailed"));
      });
      throw error;
    }
  }
  function select(scope: AgentConversationTarget): void {
    setState((draft) => {
      draft.selections[scope.agentId] = scope.threadId;
      draft.dialog.open = false;
    });
    void load(scope);
  }
  async function mutate(work: () => Promise<void>): Promise<void> {
    setState((draft) => {
      draft.dialog.pending = true;
      draft.dialog.error = null;
    });
    try {
      await work();
    } catch (error) {
      setState((draft) => {
        draft.dialog.error = currentText().errorMessage(
          error,
          currentText().t("conversation.conversations.actionFailed"),
        );
      });
      throw error;
    } finally {
      setState((draft) => {
        draft.dialog.pending = false;
      });
    }
  }
  async function send(
    body: string,
    attachmentDraftIds: string[],
    replyToMessageId: string | null,
    captured: ConversationTarget,
    clientMessageId?: string,
  ): Promise<SendMessageResult> {
    if (!captured.threadId) throw new Error("A local subject send requires its captured destination.");
    const scope = { agentId: captured.agentId, threadId: captured.threadId };
    try {
      const receipt = await api.send({
        ...scope,
        text: body,
        attachmentDraftIds,
        replyToMessageId,
        ...(clientMessageId ? { clientMessageId } : {}),
      });
      const delivery = receipt.deliveries.find((row) => row.recipientAgentId === scope.agentId);
      if (!delivery) throw new Error("Conversation delivery receipt is missing.");
      void load(scope);
      return { messageId: delivery.id };
    } catch (error) {
      return { error: currentText().errorMessage(error, currentText().t("conversation.conversations.actionFailed")) };
    }
  }
  function reconcileAgents(ids: readonly string[]): void {
    const retained = new Set(ids);
    retainedAgents = retained;
    setState((draft) => {
      for (const id of Object.keys(draft.lists))
        if (!retained.has(id)) {
          delete draft.lists[id];
          delete draft.selections[id];
          delete draft.mainThreads[id];
          listRequests.delete(id);
          metadataVersions.delete(id);
        }
      for (const [threadId, summary] of Object.entries(draft.summaries))
        if (!retained.has(summary.agentId)) {
          delete draft.summaries[threadId];
          pageRequests.delete(threadId);
          eventVersions.delete(threadId);
        }
      for (const [threadId, view] of Object.entries(draft.views))
        if (!retained.has(view.agentId)) {
          delete draft.views[threadId];
          pageRequests.delete(threadId);
          eventVersions.delete(threadId);
        }
    });
  }
  return {
    reconcileAgents,
    state,
    selected,
    target,
    addedTarget,
    currentSummary,
    view,
    messages,
    references,
    prompt,
    approval,
    takeover,
    list,
    load,
    receive,
    run,
    send,
    clearError: (scope: AgentConversationTarget) =>
      updateView(scope, (current) => {
        current.error = null;
      }),
    select,
    setDialog: (open: boolean) =>
      setState((draft) => {
        draft.dialog.open = open;
      }),
    setQuery: (query: string) => {
      setState((draft) => {
        draft.dialog.query = query;
      });
      const id = agentId();
      if (id) void list(id, false, { query, archived: state.dialog.archived });
    },
    setArchived: (archived: boolean) => {
      setState((draft) => {
        draft.dialog.archived = archived;
      });
      const id = agentId();
      if (id) void list(id, false, { query: state.dialog.query, archived });
    },
    create: (id: string, label: string) =>
      mutate(async () => {
        const scope = await api.create({ agentId: id, label });
        await list(id);
        select(scope);
      }),
    rename: (scope: AgentConversationTarget, label: string) =>
      mutate(async () => {
        await api.update({ ...scope, label });
        await list(scope.agentId);
      }),
    archive: (scope: AgentConversationTarget, archived: boolean) =>
      mutate(async () => {
        await api.update({ ...scope, archived });
        await load(scope);
        await list(scope.agentId);
      }),
    loadMore: () => {
      const id = agentId();
      return id ? list(id, true) : Promise.resolve();
    },
    loadOlder: (scope: AgentConversationTarget) => {
      const cursor = untrack(() => {
        const current = state.views[scope.threadId];
        return current?.agentId === scope.agentId ? current.page?.pageInfo.olderCursor : undefined;
      });
      return cursor ? load(scope, { type: "before", cursor }, "older") : Promise.resolve();
    },
    search: async (scope: AgentConversationTarget, query: string) => {
      const page = await api.search({ ...scope, query, limit: 100 });
      return { messageIds: page.results.map((row) => row.message.id), total: page.total };
    },
  };
}
