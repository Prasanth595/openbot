import type { AgentContextCategoryUsage, ReadContextCategoriesInput } from "@openbot/contracts/ipc";
import type { AgentStore } from "../agent-store";
import type { ConversationRuntime } from "./conversation-runtime";
import type { ProviderRuntime } from "./provider-runtime";

export interface ContextCategoriesOptions {
  store: AgentStore;
  conversation: ConversationRuntime;
  providers: Pick<ProviderRuntime, "peekClientForAgent">;
}

/** Reads the cached estimate of one exact live provider session. It starts no session and sends no request. */
export class ContextCategories {
  readonly #options: ContextCategoriesOptions;

  constructor(options: ContextCategoriesOptions) {
    this.#options = options;
  }

  read(input: ReadContextCategoriesInput): AgentContextCategoryUsage | null {
    const { store, conversation, providers } = this.#options;
    const agent = store.list().find((candidate) => candidate.id === input.agentId);
    if (agent?.provider !== "claude" || agent.threadId !== input.threadId) return null;
    const session = store.database.activeProviderSession(input.threadId, agent.provider);
    const client = providers.peekClientForAgent(agent);
    if (
      !session ||
      conversation.agentForThread(session.externalSessionId) !== agent.id ||
      conversation.publicThreadId(agent.id, session.externalSessionId) !== input.threadId ||
      !client ||
      !client.running ||
      client.provider !== "claude" ||
      conversation.loadedClientFor(session.externalSessionId) !== client
    )
      return null;
    const usage = client.readContextCategories?.(session.externalSessionId);
    if (!usage) return null;
    // The pure adapter can be replaced in a host. Recheck its exact owner before returning any value.
    const currentAgent = store.list().find((candidate) => candidate.id === agent.id);
    const currentSession = store.database.activeProviderSession(input.threadId, "claude");
    if (
      currentAgent?.provider !== "claude" ||
      currentAgent.threadId !== input.threadId ||
      !currentSession ||
      currentSession.id !== session.id ||
      currentSession.externalSessionId !== session.externalSessionId ||
      !client.running ||
      providers.peekClientForAgent(currentAgent) !== client ||
      conversation.agentForThread(session.externalSessionId) !== agent.id ||
      conversation.loadedClientFor(session.externalSessionId) !== client ||
      conversation.publicThreadId(agent.id, session.externalSessionId) !== input.threadId
    )
      return null;
    return { agentId: input.agentId, threadId: input.threadId, ...usage };
  }
}
