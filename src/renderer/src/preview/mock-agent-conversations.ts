import type { AgentSummary, ConversationPage, OpenBotDesktopApi, QueueSnapshot } from "@openbot/contracts/ipc";
import type {
  AgentConversationEvent,
  AgentConversationSummary,
  AgentConversationTarget,
} from "@openbot/contracts/ipc-agent-conversations";
import { sourceText } from "@openbot/i18n/source";

interface PreviewSubject {
  summary: AgentConversationSummary;
  page: ConversationPage;
  queue: QueueSnapshot;
}
/** The preview's second implementation of the local subject bridge, with independent histories and labels. */
export function mockAgentConversations(
  agents: () => AgentSummary[],
  mainApi: () => OpenBotDesktopApi["agent"],
): { api: OpenBotDesktopApi["agentConversations"]; dispose(): void } {
  const subjects = new Map<string, PreviewSubject>();
  const mainLabels = new Map<string, string>();
  const receipts = new Map<string, Awaited<ReturnType<OpenBotDesktopApi["agentConversations"]["send"]>>>();
  const listeners = new Set<(event: AgentConversationEvent) => void>();
  const emit = (event: AgentConversationEvent) => {
    for (const listener of listeners) listener(structuredClone(event));
  };
  function main(id: string): AgentConversationSummary {
    const agent = agents().find((row) => row.id === id);
    if (!agent) throw new Error(sourceText("error.agent.conversationUnavailable"));
    return {
      agentId: id,
      threadId: agent.threadId ?? `preview-main-${id}`,
      label: mainLabels.get(id) ?? null,
      main: true,
      archivedAt: null,
      updatedAt: agent.updatedAt ?? "",
      activeTurnId: null,
      queuedCount: 0,
      requiresInput: false,
    };
  }
  function requireSubject(target: AgentConversationTarget): PreviewSubject {
    const subject = subjects.get(target.threadId);
    if (!subject || subject.summary.agentId !== target.agentId)
      throw new Error(sourceText("error.agent.conversationUnavailable"));
    return subject;
  }
  const api: OpenBotDesktopApi["agentConversations"] = {
    list: async (input) => {
      const primary = main(input.agentId);
      const rows = [...subjects.values()]
        .map((subject) => subject.summary)
        .filter(
          (row) =>
            row.agentId === input.agentId &&
            Boolean(row.archivedAt) === Boolean(input.archived) &&
            (!input.query || row.label?.toLocaleLowerCase().includes(input.query.toLocaleLowerCase())) &&
            (!input.cursor || row.threadId > input.cursor),
        )
        .sort((a, b) => a.threadId.localeCompare(b.threadId));
      const page = rows.slice(0, 50);
      return {
        conversations: structuredClone(input.archived || input.cursor ? page : [primary, ...page]),
        cursor: rows.length > 50 ? (page.at(-1)?.threadId ?? null) : null,
      };
    },
    create: async ({ agentId, label }) => {
      main(agentId);
      const threadId = `preview-conversation-${crypto.randomUUID()}`;
      const summary: AgentConversationSummary = {
        agentId,
        threadId,
        label,
        main: false,
        archivedAt: null,
        updatedAt: new Date().toISOString(),
        activeTurnId: null,
        queuedCount: 0,
        requiresInput: false,
      };
      subjects.set(threadId, {
        summary,
        page: {
          agentId,
          threadId,
          activeTurnId: null,
          revision: 0,
          messages: [],
          references: {},
          pageInfo: { hasOlder: false, olderCursor: null },
          readState: { unreadCount: 0, firstUnreadMessageId: null, throughMessageId: null },
        },
        queue: { agentId, deliveries: [] },
      });
      emit({ type: "list-changed", agentId });
      return { agentId, threadId };
    },
    update: async (input) => {
      const primary = main(input.agentId);
      if (input.threadId === primary.threadId) {
        if (!("label" in input)) throw new Error(sourceText("error.agent.mainConversationFixed"));
        mainLabels.set(input.agentId, input.label);
      } else {
        const subject = requireSubject(input);
        if ("label" in input) subject.summary.label = input.label;
        else {
          if (
            input.archived &&
            (subject.summary.activeTurnId || subject.summary.queuedCount || subject.summary.requiresInput)
          )
            throw new Error(sourceText("error.agent.conversationBusy"));
          subject.summary.archivedAt = input.archived ? new Date().toISOString() : null;
        }
      }
      emit({ type: "list-changed", agentId: input.agentId });
    },
    read: async (input) => {
      const primary = main(input.agentId);
      if (input.threadId === primary.threadId)
        return {
          summary: primary,
          page: await mainApi().readConversationPage(
            { agentId: input.agentId, anchor: input.anchor, limit: input.limit },
            "local",
          ),
          queue: await mainApi().listQueue(input.agentId, "local"),
          attention: [],
        };
      const subject = requireSubject(input);
      return {
        summary: structuredClone(subject.summary),
        page: structuredClone(subject.page),
        queue: structuredClone(subject.queue),
        attention: [],
      };
    },
    queue: async (input) => ({
      agentId: input.agentId,
      threadId: input.threadId,
      snapshot:
        input.threadId === main(input.agentId).threadId
          ? await mainApi().listQueue(input.agentId, "local")
          : structuredClone(requireSubject(input).queue),
    }),
    search: async (input) => {
      if (input.threadId === main(input.agentId).threadId) return mainApi().searchConversationMessages(input, "local");
      const subject = requireSubject(input);
      const results = subject.page.messages
        .filter((row) => row.text.toLocaleLowerCase().includes(input.query.toLocaleLowerCase()))
        .map((message) => ({ agentId: input.agentId, message: structuredClone(message) }));
      return { results, total: results.length, nextCursor: null };
    },
    send: async (input) => {
      const primary = main(input.agentId);
      if (input.threadId === primary.threadId) return mainApi().sendMessage(input, "local");
      const subject = requireSubject(input);
      if (subject.summary.archivedAt) throw new Error(sourceText("error.agent.conversationArchived"));
      const key = JSON.stringify([input.agentId, input.threadId, input.clientMessageId]);
      const previous = input.clientMessageId ? receipts.get(key) : undefined;
      if (previous) return structuredClone(previous);
      const messageId = crypto.randomUUID();
      const deliveryId = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      subject.page.messages.push({
        id: deliveryId,
        author: "user",
        source: "user",
        text: input.text,
        createdAt,
        status: "completed",
      });
      subject.page.revision += 1;
      const receipt = {
        messageId,
        deliveries: [{ id: deliveryId, recipientAgentId: input.agentId, status: "completed" as const, position: null }],
      };
      if (input.clientMessageId) receipts.set(key, receipt);
      emit({
        type: "conversation-event",
        agentId: input.agentId,
        threadId: input.threadId,
        event: { type: "conversation", snapshot: subject.page },
      });
      return structuredClone(receipt);
    },
    action: async (input) => {
      const subject = requireSubject(input);
      if (input.action === "mark-read") {
        if (subject.page.readState) subject.page.readState.throughMessageId = input.throughMessageId;
        return;
      }
      if (input.action === "reaction") {
        const message = subject.page.messages.find((row) => row.id === input.messageId);
        if (message) message.reaction = input.emoji;
        return;
      }
      if (input.action === "stop") {
        if (subject.page.activeTurnId !== input.turnId)
          throw new Error(sourceText("error.agent.conversationTurnChanged"));
        subject.page.activeTurnId = null;
        subject.summary.activeTurnId = null;
        return;
      }
      throw new Error(sourceText("error.agent.conversationDeliveryChanged"));
    },
    onChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    api,
    dispose: () => {
      listeners.clear();
      subjects.clear();
      receipts.clear();
    },
  };
}
