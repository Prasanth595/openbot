import { describe, expect, it, vi } from "vitest";
import type { ChatAttachment } from "../components/use-chat-attachments";
import {
  decodePersistedOutbox,
  OUTBOX_RETRY_WINDOW_MS,
  type OutboxMessage,
  type OutboxTarget,
  type PersistedOutbox,
} from "./outbox";
import { type OutboxDeliverer, type OutboxStorage, OutboxStore } from "./outbox-store";

const AGENT: OutboxTarget = { kind: "agent", serverId: "server", agentId: "agent" };
const ONLINE: ReadonlySet<string> = new Set(["server"]);
const OFFLINE: ReadonlySet<string> = new Set();
const PHOTO: ChatAttachment = {
  id: "mobile-draft-attachment-1",
  name: "photo.png",
  mimeType: "image/png",
  size: 3,
  base64: "AAAA",
};

/** The phone's documents: survives a new store, as a restart does. `saved` is the file's JSON. */
function phone(saved: unknown = null) {
  const files = new Map<string, string>();
  const kept: unknown[] = [];
  const state: { saved: unknown; written: PersistedOutbox | null; readFails: boolean; saves: number } = {
    saved,
    written: null,
    readFails: false,
    saves: 0,
  };
  const storage: OutboxStorage = {
    load: async () => {
      if (state.readFails) throw new Error("read failed");
      return state.saved === null ? null : decodePersistedOutbox(state.saved);
    },
    save: async (outbox: PersistedOutbox) => {
      state.saves += 1;
      state.written = structuredClone(outbox);
      state.saved = state.written;
    },
    keepUnreadable: async () => {
      kept.push(state.saved);
    },
    writeFiles: async (id, items) =>
      items.map((file, index) => {
        files.set(`${id}/${index}`, file.base64);
        return { id: file.id, name: file.name, mimeType: file.mimeType, size: file.size, fileName: `${index}.png` };
      }),
    readFile: async (id, file) => files.get(`${id}/${file.fileName.split(".")[0]}`) ?? "",
    fileUri: (id, file) => `file:///outbox/${id}/${file.fileName}`,
    removeFiles: async (id) => {
      for (const key of files.keys()) if (key.startsWith(`${id}/`)) files.delete(key);
    },
  };
  const savedMessages = () => state.written?.messages ?? [];
  return { storage, state, kept, files, savedMessages };
}

/** A host that stores a repeat of a `clientMessageId` once, as message-client-id-v1 does. */
function host(options: { repeatSafe?: boolean } = {}) {
  const stored: { text: string; files: string[] }[] = [];
  const receipts = new Map<string, string>();
  const calls: string[] = [];
  let next: ((message: OutboxMessage) => Promise<void> | void) | null = null;
  let loseReply = false;
  const deliver: OutboxDeliverer = async (message, delivery) => {
    calls.push(message.clientMessageId);
    const step = next;
    next = null;
    await delivery.beforeStore(options.repeatSafe ?? true);
    await step?.(message);
    const known = receipts.get(message.clientMessageId);
    if (known && (options.repeatSafe ?? true)) return { messageId: known };
    stored.push({ text: message.text, files: delivery.files.map((file) => file.base64) });
    const messageId = `host-${stored.length}`;
    receipts.set(message.clientMessageId, messageId);
    if (loseReply) {
      loseReply = false;
      // The app stops after the host stored the message and before its receipt arrived.
      await new Promise<void>(() => {});
    }
    return { messageId };
  };
  return {
    deliver,
    stored,
    calls,
    /** Runs `step` inside the next delivery, after the host could have stored the message. */
    during: (step: (message: OutboxMessage) => Promise<void> | void) => {
      next = step;
    },
    loseNextReply: () => {
      loseReply = true;
    },
  };
}

function createStore(storage: OutboxStorage | null, deliver: OutboxDeliverer, now = () => Date.now()) {
  let sequence = 0;
  return new OutboxStore({
    storage,
    deliver,
    describeError: (error) => (error instanceof Error ? error.message : "failed"),
    now,
    randomId: () => `client-${++sequence}`,
  });
}

const states = (store: OutboxStore) => store.snapshot().messages.map((message) => [message.text, message.state]);

describe("outbox", () => {
  it("keeps a message while offline and sends it once the server is online", async () => {
    const device = phone();
    const server = host();
    const store = createStore(device.storage, server.deliver);
    await store.load();
    store.setOnline(OFFLINE);
    store.add(AGENT, { text: "hello", replyToMessageId: null, files: [] });
    await vi.waitFor(() => expect(device.savedMessages()).toHaveLength(1));
    expect(server.calls).toEqual([]);

    store.setOnline(ONLINE);
    await vi.waitFor(() => expect(states(store)).toEqual([["hello", "sent"]]));
    expect(server.stored).toEqual([{ text: "hello", files: [] }]);
  });

  it("sends the messages of one chat one at a time, in order", async () => {
    const server = host();
    const store = createStore(null, server.deliver);
    await store.load();
    let release = () => {};
    server.during(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    store.setOnline(ONLINE);
    store.add(AGENT, { text: "first", replyToMessageId: null, files: [] });
    store.add(AGENT, { text: "second", replyToMessageId: null, files: [] });
    await vi.waitFor(() => expect(server.calls).toEqual(["client-1"]));
    expect(states(store)).toEqual([
      ["first", "sending"],
      ["second", "waiting"],
    ]);

    release();
    await vi.waitFor(() => expect(server.stored.map((message) => message.text)).toEqual(["first", "second"]));
  });

  it("sends the waiting messages and their files after a restart", async () => {
    const device = phone();
    const offline = createStore(device.storage, host().deliver);
    await offline.load();
    offline.add(AGENT, { text: "with photo", replyToMessageId: "reply", files: [PHOTO] });
    await vi.waitFor(() => expect(device.savedMessages()[0]?.files[0]?.fileName).toBe("0.png"));

    const server = host();
    const restarted = createStore(device.storage, server.deliver);
    await restarted.load();
    expect(states(restarted)).toEqual([["with photo", "waiting"]]);
    restarted.setOnline(ONLINE);
    await vi.waitFor(() => expect(server.stored).toEqual([{ text: "with photo", files: ["AAAA"] }]));
  });

  it("repeats a send that a restart interrupted with the same id, so the host stores it once", async () => {
    const device = phone();
    const server = host();
    const first = createStore(device.storage, server.deliver);
    await first.load();
    server.loseNextReply();
    first.setOnline(ONLINE);
    first.add(AGENT, { text: "once", replyToMessageId: null, files: [] });
    await vi.waitFor(() => expect(server.stored).toHaveLength(1));
    expect(device.savedMessages()[0]?.firstAttemptAt).not.toBeNull();

    const restarted = createStore(device.storage, server.deliver);
    await restarted.load();
    restarted.setOnline(ONLINE);
    await vi.waitFor(() => expect(states(restarted)).toEqual([["once", "sent"]]));
    expect(server.calls).toEqual(["client-1", "client-1"]);
    expect(server.stored).toHaveLength(1);
  });

  it("does not repeat a send that a host without repeat safety may have stored", async () => {
    const device = phone();
    const server = host({ repeatSafe: false });
    const first = createStore(device.storage, server.deliver);
    await first.load();
    server.during(() => new Promise<void>(() => {}));
    first.setOnline(ONLINE);
    first.add(AGENT, { text: "unsure", replyToMessageId: null, files: [] });
    await vi.waitFor(() => expect(device.savedMessages()[0]?.firstAttemptAt).not.toBeNull());

    const deliver = vi.fn<OutboxDeliverer>();
    const restarted = createStore(device.storage, deliver);
    await restarted.load();
    restarted.setOnline(ONLINE);
    expect(states(restarted)).toEqual([["unsure", "failed"]]);
    expect(restarted.snapshot().messages[0]?.repeatSafe).toBe(false);
    restarted.retry("client-1");
    // Retry starts nothing: a start would have made the message sending at once.
    expect(states(restarted)).toEqual([["unsure", "failed"]]);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("waits for the connection after it drops during a send, and sends with the same id", async () => {
    const server = host();
    const store = createStore(null, server.deliver);
    await store.load();
    store.setOnline(ONLINE);
    server.during(() => {
      store.setOnline(OFFLINE);
      throw new Error("disconnected");
    });
    store.add(AGENT, { text: "flaky", replyToMessageId: null, files: [] });
    await vi.waitFor(() => expect(states(store)).toEqual([["flaky", "waiting"]]));

    store.setOnline(ONLINE);
    await vi.waitFor(() => expect(states(store)).toEqual([["flaky", "sent"]]));
    expect(server.calls).toEqual(["client-1", "client-1"]);
    expect(server.stored).toHaveLength(1);
  });

  it("keeps a rejected message for Retry and holds the messages behind it", async () => {
    const server = host();
    const store = createStore(null, server.deliver);
    await store.load();
    store.setOnline(ONLINE);
    server.during(() => {
      throw new Error("The host refused the message.");
    });
    store.add(AGENT, { text: "rejected", replyToMessageId: null, files: [] });
    store.add(AGENT, { text: "behind", replyToMessageId: null, files: [] });
    await vi.waitFor(() =>
      expect(states(store)).toEqual([
        ["rejected", "failed"],
        ["behind", "waiting"],
      ]),
    );
    expect(store.snapshot().messages[0]?.error).toBe("The host refused the message.");

    store.retry("client-1");
    await vi.waitFor(() => expect(server.stored.map((message) => message.text)).toEqual(["rejected", "behind"]));
  });

  it("gives an edited message back with its files, and removes a cancelled one with its files", async () => {
    const device = phone();
    const store = createStore(device.storage, host().deliver);
    await store.load();
    store.add(AGENT, { text: "edit me", replyToMessageId: "reply", files: [PHOTO] });
    store.add(AGENT, { text: "cancel me", replyToMessageId: null, files: [PHOTO] });
    await vi.waitFor(() => expect(device.files.size).toBe(2));

    const draft = await store.edit("client-1");
    expect(draft).toMatchObject({
      text: "edit me",
      replyToMessageId: "reply",
      files: [{ name: "photo.png", base64: "AAAA" }],
    });
    await store.cancel("client-2");
    expect(store.snapshot().messages).toEqual([]);
    await vi.waitFor(() => expect(device.savedMessages()).toEqual([]));
    expect(device.files.size).toBe(0);
  });

  it("does not replace the saved outbox with a message added before the load", async () => {
    const device = phone();
    const earlier = createStore(device.storage, host().deliver);
    await earlier.load();
    earlier.add(AGENT, { text: "older", replyToMessageId: null, files: [] });
    await vi.waitFor(() => expect(device.savedMessages()).toHaveLength(1));

    const restarted = createStore(device.storage, host().deliver);
    restarted.add(AGENT, { text: "newer", replyToMessageId: null, files: [] });
    expect(device.savedMessages().map((message) => message.text)).toEqual(["older"]);
    await restarted.load();
    await vi.waitFor(() => expect(device.savedMessages().map((message) => message.text)).toEqual(["older", "newer"]));
  });

  it("keeps a copy of an outbox it cannot read, and never writes over one it could not load", async () => {
    const unreadable = phone({ version: 1, messages: [{ text: "from a newer version" }] });
    const store = createStore(unreadable.storage, host().deliver);
    await store.load();
    expect(unreadable.kept).toEqual([{ version: 1, messages: [{ text: "from a newer version" }] }]);

    const failing = phone({ version: 1, messages: [] });
    failing.state.readFails = true;
    const blocked = createStore(failing.storage, host().deliver);
    await blocked.load();
    blocked.add(AGENT, { text: "kept in memory", replyToMessageId: null, files: [] });
    expect(blocked.snapshot().storageFailed).toBe(true);
    expect(failing.state.saves).toBe(0);
  });

  it("does not repeat a message after the host may have forgotten its id", async () => {
    let now = Date.parse("2026-10-12T08:00:00.000Z");
    const device = phone();
    const server = host();
    const first = createStore(device.storage, server.deliver, () => now);
    await first.load();
    server.during(() => new Promise<void>(() => {}));
    first.setOnline(ONLINE);
    first.add(AGENT, { text: "late", replyToMessageId: null, files: [] });
    await vi.waitFor(() => expect(device.savedMessages()[0]?.firstAttemptAt).not.toBeNull());

    now += OUTBOX_RETRY_WINDOW_MS + 1;
    const deliver = vi.fn<OutboxDeliverer>();
    const restarted = createStore(device.storage, deliver, () => now);
    await restarted.load();
    restarted.setOnline(ONLINE);
    expect(states(restarted)).toEqual([["late", "failed"]]);
    expect(deliver).not.toHaveBeenCalled();
  });
});
