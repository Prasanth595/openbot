import type { ConversationMessageSender, QueuedMessageReceipt, QueueSnapshot } from "@openbot/contracts/ipc";
import type {
  AgentConversationActionInput,
  AgentConversationEvent,
  AgentConversationListInput,
  CreateAgentConversationInput,
  ReadAgentConversationInput,
  SearchAgentConversationInput,
  SendAgentConversationInput,
  UpdateAgentConversationInput,
} from "@openbot/contracts/ipc-agent-conversations";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema } from "effect";
import type { AttentionRegistry } from "../agent/attention-registry";
import type { ConversationRuntime } from "../agent/conversation-runtime";
import type { MailboxSync } from "../agent/mailbox-sync";
import type { QueueControls } from "../agent/queue-controls";
import type { AgentStore } from "../agent-store";
import { ConversationReadStore } from "../conversation-read-store";
import { causeHelpers } from "../effect-boundary";
import type { MailboxStore } from "../mailbox-store";

interface AgentConversationsOptions {
  store: AgentStore;
  mailbox: MailboxStore;
  conversation: ConversationRuntime;
  mailboxSync: MailboxSync;
  queue: QueueControls;
  attention: AttentionRegistry;
  emit(event: AgentConversationEvent): void;
  send(
    input: SendAgentConversationInput,
    sender?: ConversationMessageSender,
  ): Effect.Effect<QueuedMessageReceipt, { readonly cause: unknown }>;
  stop(agentId: string, turnId: string, threadId: string): Effect.Effect<void, { readonly cause: unknown }>;
}

/** Owns the local user-conversation domain. The main chat and serial admission keep their old identity. */
export class AgentConversations {
  readonly #options: AgentConversationsOptions;
  readonly #reads: ConversationReadStore;
  constructor(options: AgentConversationsOptions) {
    this.#options = options;
    this.#reads = new ConversationReadStore(options.store.database);
  }

  readonly list = Effect.fn("AgentConversations.list")(function* (
    this: AgentConversations,
    input: AgentConversationListInput,
  ) {
    yield* this.#options.store.existing(input.agentId).pipe(toConversationFailed);
    const mainThreadId = yield* this.#options.store.ensureThreadId(input.agentId).pipe(toConversationFailed);
    return yield* conversationStep(() => {
      const page = this.#options.store.database.userConversations.list(
        input.agentId,
        mainThreadId,
        input.query,
        input.cursor,
        input.archived,
      );
      return {
        ...page,
        conversations: page.conversations.map((summary) => ({
          ...summary,
          activeTurnId: this.#options.store.database.readActiveTurnId(input.agentId, summary.threadId),
          queuedCount: this.#options.mailbox
            .listQueue(input.agentId, summary.main ? undefined : summary.threadId)
            .deliveries.filter((delivery) => delivery.status === "queued").length,
          requiresInput: this.#options.attention.hasAttentionForThread(input.agentId, summary.threadId),
        })),
      };
    });
  }).bind(this);

  readonly create = Effect.fn("AgentConversations.create")(function* (
    this: AgentConversations,
    input: CreateAgentConversationInput,
  ) {
    yield* this.#options.store.existing(input.agentId).pipe(toConversationFailed);
    return yield* conversationStep(() => {
      const threadId = this.#options.store.database.userConversations.create(input.agentId, input.label);
      this.#options.conversation.registerUserThread(input.agentId, threadId);
      this.#options.emit({ type: "list-changed", agentId: input.agentId });
      return { agentId: input.agentId, threadId };
    });
  }).bind(this);

  readonly update = Effect.fn("AgentConversations.update")(function* (
    this: AgentConversations,
    input: UpdateAgentConversationInput,
  ) {
    yield* this.#options.store.existing(input.agentId).pipe(toConversationFailed);
    yield* conversationStep(() => {
      if (
        "archived" in input &&
        input.archived &&
        this.#options.attention.hasAttentionForThread(input.agentId, input.threadId)
      )
        throw new Error(sourceText("error.agent.conversationBusy"));
      this.#options.store.database.userConversations.update(input.agentId, input.threadId, input);
      this.#options.emit({ type: "list-changed", agentId: input.agentId });
    });
  }).bind(this);

  #summary(agentId: string, threadId: string) {
    const summary = this.#options.store.database.userConversations.summary(agentId, threadId);
    return {
      ...summary,
      queuedCount: this.#options.mailbox
        .listQueue(agentId, summary.main ? undefined : threadId)
        .deliveries.filter((row) => row.status === "queued").length,
      requiresInput: this.#options.attention.hasAttentionForThread(agentId, threadId),
    };
  }

  readonly read = Effect.fn("AgentConversations.read")(function* (
    this: AgentConversations,
    input: ReadAgentConversationInput,
    memberId: string,
  ) {
    yield* this.#options.store.existing(input.agentId).pipe(toConversationFailed);
    return yield* conversationStep(() => {
      this.#options.store.database.userConversations.requireTarget(input.agentId, input.threadId, true);
      const snapshot = this.#options.conversation.ensureSnapshot(input.agentId, input.threadId);
      this.#options.mailboxSync.syncMailboxMessages(snapshot);
      this.#options.conversation.emitConversation(snapshot);
      const page = this.#options.store.database.readConversationPage(
        input.agentId,
        input.threadId,
        input.anchor ?? { type: "latest" },
        input.limit ?? 50,
      );
      return {
        summary: this.#summary(input.agentId, input.threadId),
        page: { ...page, readState: this.#reads.readStateForThread(memberId, input.threadId) },
        queue: this.queueSnapshot(input),
        attention: this.#options.attention.eventsForThread(input.agentId, input.threadId),
      };
    });
  }).bind(this);

  queue(input: ReadAgentConversationInput) {
    return { agentId: input.agentId, threadId: input.threadId, snapshot: this.queueSnapshot(input) };
  }

  queueSnapshot(input: ReadAgentConversationInput): QueueSnapshot {
    this.#options.store.database.userConversations.requireTarget(input.agentId, input.threadId, true);
    const all = this.#options.mailboxSync.queueSnapshot(input.agentId);
    const selected = this.#options.mailbox.listQueue(
      input.agentId,
      this.#options.store.database.userConversations.isUserThread(input.threadId) ? input.threadId : undefined,
    );
    return {
      ...selected,
      deliveries: selected.deliveries.filter(
        (row) => row.status === "queued" || row.status === "starting" || row.status === "running",
      ),
      ...(all.hold ? { hold: all.hold } : {}),
    };
  }

  search(input: SearchAgentConversationInput) {
    this.#options.store.database.userConversations.requireTarget(input.agentId, input.threadId, true);
    return this.#options.store.database.searchConversationMessages(
      input.query,
      input.agentId,
      input.cursor,
      input.limit,
      input.threadId,
    );
  }

  readonly send = Effect.fn("AgentConversations.send")(function* (
    this: AgentConversations,
    input: SendAgentConversationInput,
    sender?: ConversationMessageSender,
  ) {
    yield* conversationStep(() =>
      this.#options.store.database.userConversations.requireTarget(input.agentId, input.threadId),
    );
    return yield* this.#options.send(input, sender).pipe(toConversationFailed);
  }).bind(this);

  readonly action = Effect.fn("AgentConversations.action")(function* (
    this: AgentConversations,
    input: AgentConversationActionInput,
    memberId: string,
    sender?: ConversationMessageSender,
  ) {
    yield* conversationStep(() =>
      this.#options.store.database.userConversations.requireTarget(
        input.agentId,
        input.threadId,
        input.action === "mark-read",
      ),
    );
    const scope = this.#options.store.database.userConversations.isUserThread(input.threadId)
      ? input.threadId
      : undefined;
    if (input.action === "stop") {
      yield* conversationStep(() => {
        const snapshot = this.#options.conversation.ensureSnapshot(input.agentId, input.threadId);
        if (snapshot.activeTurnId !== input.turnId) throw new Error(sourceText("error.agent.conversationTurnChanged"));
      });
      yield* this.#options.stop(input.agentId, input.turnId, input.threadId).pipe(toConversationFailed);
    } else if (input.action === "cancel")
      yield* this.#options.queue.cancel(input.agentId, input.deliveryId, scope).pipe(toConversationFailed);
    else if (input.action === "steer")
      yield* this.#options.queue
        .steer({ agentId: input.agentId, deliveryId: input.deliveryId, expectedTurnId: input.expectedTurnId }, scope)
        .pipe(toConversationFailed);
    else if (input.action === "reorder")
      yield* this.#options.queue
        .reorder({ agentId: input.agentId, deliveryIds: input.deliveryIds }, scope)
        .pipe(toConversationFailed);
    else if (input.action === "edit")
      yield* this.#options.queue.edit(input.agentId, input.edit, sender, scope).pipe(toConversationFailed);
    else if (input.action === "reaction") {
      const snapshot = this.#options.conversation.ensureSnapshot(input.agentId, input.threadId);
      const [message] = this.#options.store.database.readConversationMessages(input.agentId, input.threadId, [
        input.messageId,
      ]);
      if (!message)
        return yield* new AgentConversationFailed({ cause: new Error(sourceText("error.agent.messageUnavailable")) });
      if (!snapshot.messages.some((row) => row.id === message.id)) snapshot.messages.push(message);
      yield* this.#options.mailbox
        .setReaction(input.agentId, input.messageId, { kind: "user" }, input.emoji)
        .pipe(toConversationFailed);
      this.#options.mailboxSync.syncMailboxMessages(snapshot);
      this.#options.conversation.emitConversation(snapshot);
    } else if (input.action === "mark-read")
      yield* conversationStep(() => {
        this.#reads.markReadForThread(memberId, input.threadId, input.throughMessageId);
      });
    else {
      yield* conversationStep(() =>
        this.#options.attention.requireInputThread(
          input.agentId,
          input.threadId,
          input.turnId,
          input.action === "secret" ? "takeover" : input.action,
          input.requestId,
        ),
      );
      if (input.action === "prompt") yield* this.#options.attention.respondToPrompt(input).pipe(toConversationFailed);
      else if (input.action === "approval")
        yield* this.#options.attention.respondToApproval(input).pipe(toConversationFailed);
      else if (input.action === "secret")
        yield* this.#options.attention.respondToBrowserSecret(input).pipe(toConversationFailed);
      else yield* this.#options.attention.respondToBrowserTakeover(input).pipe(toConversationFailed);
    }
  }).bind(this);
}

export class AgentConversationFailed extends Schema.TaggedError<AgentConversationFailed>()("AgentConversationFailed", {
  cause: Schema.Defect(),
}) {}
const { sync: conversationStep, rewrap: toConversationFailed } = causeHelpers(AgentConversationFailed);
