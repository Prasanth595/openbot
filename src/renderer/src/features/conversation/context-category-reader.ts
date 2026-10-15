import type { AgentContextCategoryUsage, ReadContextCategoriesInput } from "@openbot/contracts/ipc";

export interface ContextCategoryTarget extends ReadContextCategoriesInput {
  serverId: string;
  model?: string;
}

/** Owns current-read generations. A host, agent or public-thread change cannot retain an older reply. */
export class ContextCategoryReader {
  readonly #read: (input: ReadContextCategoriesInput, serverId: string) => Promise<AgentContextCategoryUsage | null>;
  readonly #changed: (usage: AgentContextCategoryUsage | null, target: ContextCategoryTarget | null) => void;
  #target: ContextCategoryTarget | null = null;
  #generation = 0;
  #pending = false;
  #work: Promise<void> | null = null;

  constructor(
    read: (input: ReadContextCategoriesInput, serverId: string) => Promise<AgentContextCategoryUsage | null>,
    changed: (usage: AgentContextCategoryUsage | null, target: ContextCategoryTarget | null) => void,
  ) {
    this.#read = read;
    this.#changed = changed;
  }

  select(target: ContextCategoryTarget | null): void {
    const previous = this.#target;
    const same =
      previous &&
      target &&
      previous.agentId === target.agentId &&
      previous.threadId === target.threadId &&
      previous.serverId === target.serverId &&
      previous.model === target.model;
    this.#target = target;
    this.#generation += 1;
    if (!same) this.#changed(null, target);
    if (target) void this.refresh();
    else this.#pending = false;
  }

  refresh(): Promise<void> {
    if (!this.#target) return Promise.resolve();
    this.#generation += 1;
    this.#pending = true;
    if (this.#work) return this.#work;
    // The microtask coalesces one synchronous invalidation burst and sets ownership before the read.
    const pending = Promise.resolve().then(() => this.#readPending());
    const work = pending.finally(() => {
      if (this.#work !== work) return;
      this.#work = null;
      if (this.#pending && this.#target) void this.refresh();
    });
    this.#work = work;
    return work;
  }

  async #readPending(): Promise<void> {
    while (this.#pending && this.#target) {
      this.#pending = false;
      const target = this.#target;
      const generation = this.#generation;
      try {
        const value = await this.#read({ agentId: target.agentId, threadId: target.threadId }, target.serverId);
        if (generation !== this.#generation || this.#target !== target) continue;
        this.#changed(
          value && value.agentId === target.agentId && value.threadId === target.threadId ? value : null,
          target,
        );
      } catch {
        if (generation === this.#generation && this.#target === target) this.#changed(null, target);
      }
    }
  }

  dispose(): void {
    this.#target = null;
    this.#generation += 1;
    this.#pending = false;
    this.#changed(null, null);
  }
}
