import type { AgentEvent, ConversationMessage, ConversationPage } from "@openbot/contracts/ipc";

import { replaceEqualDeep } from "@tanstack/react-query";

type Delta = Extract<AgentEvent, { type: "conversation-delta" }>;
export interface MobileConversation extends ConversationPage {
  olderLoading: boolean;
  olderError: boolean;
  /** The window was loaded around a searched message and does not reach the latest message. */
  detached: boolean;
}
const CACHE_LIMIT = 5;
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_BYTES = 10 * 1024 * 1024;

type CachedPage = { page: ConversationPage; usedAt: number; bytes: number };

function conversationKey(agentId: string, serverId: string, accountScope: string) {
  return JSON.stringify([serverId, agentId, accountScope]);
}

type ReadPage = (cursor?: string) => Promise<ConversationPage>;

/** In-memory chat windows. Only subscribers to a changed agent are notified. */
export class MobileConversationStore {
  #entries = new Map<string, MobileConversation>();
  #listeners = new Map<string, Set<() => void>>();
  #indices = new Map<string, Map<string, number>>();
  #revisions = new Map<string, number>();
  #deltas = new Map<string, Delta[]>();
  #cancelFrame: (() => void) | null = null;
  #olderLoads = new Map<string, symbol>();
  #loads = new Map<string, { promise: Promise<ConversationPage>; dirty: boolean; attach: boolean }>();

  #latest = new Map<string, CachedPage>();
  #expiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private schedule: (flush: () => void) => () => void,
    private now: () => number = Date.now,
    private accountScope = "",
  ) {}

  get(agentId: string, serverId: string) {
    this.#evict();
    return this.#entries.get(conversationKey(agentId, serverId, this.accountScope));
  }

  isObserved(agentId: string, serverId: string) {
    return this.#isObserved(conversationKey(agentId, serverId, this.accountScope));
  }

  remove(agentId: string, serverId: string) {
    this.#remove(conversationKey(agentId, serverId, this.accountScope));
  }

  removeServer(serverId: string) {
    for (const key of new Set([...this.#entries.keys(), ...this.#loads.keys()])) {
      if (JSON.parse(key)[0] === serverId) this.#remove(key);
    }
    this.#evict();
  }

  #remember(key: string, page: ConversationPage) {
    // Retain the complete response. Its cursors and references must describe these exact messages.
    if (page.messages.length > 50) return;
    const previous = this.#latest.get(key);
    const shared = replaceEqualDeep(previous?.page, page);
    this.#latest.set(key, {
      page: shared,
      usedAt: this.#isObserved(key) ? this.now() : (previous?.usedAt ?? this.now()),
      bytes: new TextEncoder().encode(JSON.stringify(shared)).length,
    });
  }

  #restore(key: string) {
    const cached = this.#latest.get(key);
    if (!cached) {
      this.#remove(key);
      return;
    }
    cached.usedAt = this.now();
    this.#publish(key, { ...cached.page, olderLoading: false, olderError: false, detached: false });
    this.#evict();
  }

  #evict() {
    if (this.#expiryTimer) clearTimeout(this.#expiryTimer);
    this.#expiryTimer = null;
    const inactive = [...this.#latest].filter(([key]) => !this.#isObserved(key));
    inactive.sort((a, b) => a[1].usedAt - b[1].usedAt);
    let bytes = inactive.reduce((total, [, cached]) => total + cached.bytes, 0);
    let count = inactive.length;
    for (const [key, cached] of inactive) {
      if (this.now() - cached.usedAt < CACHE_TTL_MS && count <= CACHE_LIMIT && bytes <= CACHE_BYTES) continue;
      bytes -= cached.bytes;
      count--;
      this.#remove(key);
    }
    const next = [...this.#latest].filter(([key]) => !this.#isObserved(key));
    if (next.length) {
      const expires = Math.min(...next.map(([, cached]) => cached.usedAt + CACHE_TTL_MS));
      this.#expiryTimer = setTimeout(() => this.#evict(), Math.max(1, expires - this.now()));
    }
  }

  #get(agentId: string) {
    return this.#entries.get(agentId);
  }

  #isObserved(agentId: string) {
    return Boolean(this.#listeners.get(agentId)?.size);
  }

  subscribe(id: string, serverId: string, listener: () => void) {
    const agentId = conversationKey(id, serverId, this.accountScope);
    this.#evict();
    const cached = this.#latest.get(agentId);
    if (cached) cached.usedAt = this.now();
    let listeners = this.#listeners.get(agentId);
    if (!listeners) {
      listeners = new Set();
      this.#listeners.set(agentId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) {
        this.#listeners.delete(agentId);
        // Drop expanded and search windows, then restore the exact latest response.
        this.#restore(agentId);
      }
    };
  }

  #remove(agentId: string) {
    this.#latest.delete(agentId);
    this.#entries.delete(agentId);
    this.#indices.delete(agentId);
    this.#revisions.delete(agentId);
    this.#deltas.delete(agentId);
    this.#loads.delete(agentId);
    this.#olderLoads.delete(agentId);
    for (const listener of this.#listeners.get(agentId) ?? []) listener();
  }

  cancelRequests() {
    this.#loads.clear();
    this.#olderLoads.clear();
    for (const [id, entry] of this.#entries) {
      if (entry.olderLoading) this.#publish(id, { ...entry, olderLoading: false }, false);
    }
  }

  dispose() {
    this.#cancelFrame?.();
    this.#cancelFrame = null;
    this.#deltas.clear();
    this.cancelRequests();
    if (this.#expiryTimer) clearTimeout(this.#expiryTimer);
    this.#expiryTimer = null;
    this.#entries.clear();
    this.#indices.clear();
    this.#revisions.clear();
    this.#latest.clear();
    this.#listeners.clear();
  }

  #publish(agentId: string, entry: MobileConversation, reindex = true) {
    if (!this.#isObserved(agentId) && entry.messages.length > 50) {
      this.#remove(agentId);
      return;
    }
    const current = this.#get(agentId);
    if (entry === current) return;
    this.#entries.set(agentId, entry);
    this.#revisions.set(agentId, Math.max(this.#revisions.get(agentId) ?? 0, entry.revision));
    if (reindex) this.#indices.set(agentId, new Map(entry.messages.map((message, index) => [message.id, index])));
    for (const listener of this.#listeners.get(agentId) ?? []) listener();
  }

  /** `attach` lets a latest page replace a window around a searched message. */
  applyPage(page: ConversationPage, serverId: string, cursor?: string, attach = false) {
    this.#applyPage(page, conversationKey(page.agentId, serverId, this.accountScope), cursor, attach);
    this.#evict();
  }

  #applyPage(page: ConversationPage, key: string, cursor?: string, attach = false) {
    this.flush();
    const current = this.#get(key);
    if (cursor && (!current || current.threadId !== page.threadId || current.pageInfo.olderCursor !== cursor)) return;
    if (!cursor && page.revision < (this.#revisions.get(key) ?? 0)) return;
    if (!cursor) {
      this.#remember(key, page);
      if (!this.#isObserved(key)) {
        this.#publish(
          key,
          replaceEqualDeep(current, { ...page, olderLoading: false, olderError: false, detached: false }),
        );
        return;
      }
    }
    const sameThread = current?.threadId === page.threadId;
    const indices = sameThread ? this.#indices.get(key) : undefined;
    const overlap = page.messages.find((message) => indices?.has(message.id));
    // A window around a searched message stays until a latest page meets it or the reader asks for the latest messages.
    if (!cursor && current?.detached && !overlap && !attach) return;
    // A disconnected latest page must not leave an invisible gap in the history.
    const retain = Boolean(sameThread && (cursor || overlap));
    const oldMessages = retain && current ? current.messages : [];
    const oldById = new Map(oldMessages.map((message) => [message.id, message]));
    const fetched = page.messages.map((message) => {
      const old = oldById.get(message.id);
      if (!old) return message;
      if (cursor) return old;
      return replaceEqualDeep(old, message);
    });
    const fetchedById = new Map(fetched.map((message) => [message.id, message]));
    const fetchedIds = new Set(fetchedById.keys());
    const first = overlap ? (indices?.get(overlap.id) ?? 0) : 0;
    let messages: ConversationMessage[];
    if (cursor)
      messages = [
        ...fetched.filter((message) => !oldById.has(message.id)),
        ...oldMessages.map((message) =>
          fetchedIds.has(message.id) ? (fetchedById.get(message.id) ?? message) : message,
        ),
      ];
    else {
      messages = [...oldMessages.slice(0, first).filter((message) => !fetchedIds.has(message.id)), ...fetched];
    }
    const next = replaceEqualDeep(current, {
      ...page,
      ...(cursor && current ? { revision: current.revision, activeTurnId: current.activeTurnId } : {}),
      messages,
      references: { ...(retain ? current?.references : {}), ...page.references },
      pageInfo: !cursor && retain && current && first > 0 ? current.pageInfo : page.pageInfo,
      olderLoading: current?.olderLoading ?? false,
      olderError: false,
      detached: cursor ? (current?.detached ?? false) : false,
    });
    this.#publish(key, next);
  }

  /**
   * Shows a page around a searched message. A page that meets the loaded window adds its older
   * messages to it. Another page replaces the window until the latest messages load again.
   */
  applyAround(page: ConversationPage, serverId: string) {
    const key = conversationKey(page.agentId, serverId, this.accountScope);
    // A reader who left the chat does not need it, and the next one opens at the latest message.
    if (!this.#isObserved(key)) return;
    this.flush();
    const current = this.#get(key);
    const indices =
      current && !current.detached && current.threadId === page.threadId ? this.#indices.get(key) : undefined;
    const overlap = indices ? page.messages.findIndex((message) => indices.has(message.id)) : -1;
    if (current && overlap >= 0) {
      // The window already starts at the page or before it.
      if (overlap === 0) return;
      this.#publish(key, {
        ...current,
        messages: [...page.messages.slice(0, overlap), ...current.messages],
        references: { ...current.references, ...page.references },
        pageInfo: page.pageInfo,
        olderError: false,
      });
      return;
    }
    this.#publish(key, { ...page, olderLoading: false, olderError: false, detached: true });
  }

  loadLatest(
    serverId: string,
    agentId: string,
    read: ReadPage,
    isCurrent: () => boolean,
    refresh = false,
    attach = false,
  ): Promise<ConversationPage> {
    const key = conversationKey(agentId, serverId, this.accountScope);
    this.#evict();
    const pending = this.#loads.get(key);
    if (pending) {
      if (refresh) pending.dirty = true;
      if (attach) pending.attach = true;
      return pending.promise;
    }
    const load: { promise: Promise<ConversationPage>; dirty: boolean; attach: boolean } = {
      dirty: false,
      attach,
      promise: Promise.resolve()
        .then(async () => {
          let page: ConversationPage;
          do {
            load.dirty = false;
            page = await read();
            if (page.agentId !== agentId) throw new Error("The server returned a page for another conversation.");
            if (!isCurrent() || this.#loads.get(key) !== load) return page;
            this.applyPage(page, serverId, undefined, load.attach);
          } while (load.dirty);
          return page;
        })
        .finally(() => {
          if (this.#loads.get(key) === load) this.#loads.delete(key);
        }),
    };
    this.#loads.set(key, load);
    return load.promise;
  }

  async loadOlder(serverId: string, id: string, read: ReadPage, isCurrent: () => boolean) {
    const agentId = conversationKey(id, serverId, this.accountScope);
    const current = this.#get(agentId);
    const cursor = current?.pageInfo.olderCursor;
    if (!current || current.olderLoading || !current.pageInfo.hasOlder || !cursor) return;
    const token = Symbol();
    this.#olderLoads.set(agentId, token);
    const valid = () => isCurrent() && this.#olderLoads.get(agentId) === token;
    this.#publish(agentId, { ...current, olderLoading: true, olderError: false }, false);
    try {
      const page = await read(cursor);
      if (page.agentId !== id) throw new Error("The server returned a page for another conversation.");
      if (valid()) this.applyPage(page, serverId, cursor);
    } catch {
      const latest = this.#get(agentId);
      if (valid() && latest?.pageInfo.olderCursor === cursor)
        this.#publish(agentId, { ...latest, olderError: true }, false);
    } finally {
      const latest = this.#get(agentId);
      if (this.#olderLoads.get(agentId) === token) {
        this.#olderLoads.delete(agentId);
        if (latest) this.#publish(agentId, { ...latest, olderLoading: false }, false);
      }
    }
  }

  enqueue(delta: Delta, serverId: string) {
    const key = conversationKey(delta.agentId, serverId, this.accountScope);
    if (!this.#get(key)) return;
    const pending = this.#deltas.get(key) ?? [];
    pending.push(delta);
    this.#deltas.set(key, pending);
    this.#cancelFrame ??= this.schedule(() => this.flush());
  }

  flush() {
    this.#cancelFrame?.();
    this.#cancelFrame = null;
    const pending = this.#deltas;
    this.#deltas = new Map();
    for (const [agentId, deltas] of pending) {
      const current = this.#get(agentId);
      const indices = this.#indices.get(agentId);
      if (!current || !indices) continue;
      let revision = Math.max(current.revision, this.#revisions.get(agentId) ?? 0);
      let threadId = current.threadId;
      let activeTurnId = current.activeTurnId;
      const updates = new Map<string, { event: Delta; parts: string[] }>();
      for (const event of deltas) {
        if (event.revision <= revision || (threadId !== null && event.threadId !== threadId)) continue;
        threadId = event.threadId;
        const update = updates.get(event.messageId);
        if (update) update.parts.push(event.delta);
        else updates.set(event.messageId, { event, parts: [event.delta] });
        revision = event.revision;
        activeTurnId = event.turnId;
      }
      if (!updates.size) continue;
      // Deltas have no page cursor. Keep the complete cached page until the host sends another.
      this.#revisions.set(agentId, Math.max(this.#revisions.get(agentId) ?? 0, revision));
      if (!this.#isObserved(agentId)) continue;
      const messages = [...current.messages];
      let added = false;
      for (const [messageId, { event, parts }] of updates) {
        const text = parts.join("");
        const index = indices.get(messageId);
        if (index === undefined) {
          // A window around a searched message does not reach the newest messages.
          if (current.detached) continue;
          added = true;
          messages.push({
            id: messageId,
            turnId: event.turnId,
            author: "assistant",
            source: "assistant",
            text,
            createdAt: event.createdAt,
            status: "streaming",
          });
        } else {
          const message = messages[index];
          if (!message) throw new Error("The streamed message is missing.");
          messages[index] = { ...message, text: message.text + text, status: "streaming" };
        }
      }
      if (added) {
        this.#publish(agentId, { ...current, messages, revision, activeTurnId, threadId });
      } else {
        this.#publish(agentId, { ...current, messages, revision, activeTurnId, threadId }, false);
      }
    }
  }
}
