import { sourceText } from "@openbot/i18n/source";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type OpenVoiceStreamSocket,
  ScribeRealtimeSession,
  scribeRealtimeUrl,
  type VoiceStreamSocketEvents,
} from "./voice-cloud-stream";

/** A server message as ElevenLabs sends it. */
interface ScribeMessage {
  message_type: string;
  text?: string;
  error?: string;
}

const API_KEY = "sk_0123456789abcdef0123456789abcdef";

function fakeSocket() {
  const sent: string[] = [];
  const opened: { url: string; apiKey: string }[] = [];
  let events: VoiceStreamSocketEvents | undefined;
  const open: OpenVoiceStreamSocket = (url, apiKey, nextEvents) => {
    opened.push({ url, apiKey });
    events = nextEvents;
    return { send: (text) => sent.push(text), close: () => {} };
  };
  const receive = (message: ScribeMessage) => events?.onMessage(JSON.stringify(message));
  return { open, sent, opened, receive, events: () => events };
}

function session(socket: ReturnType<typeof fakeSocket>, onText: (text: string) => void = () => {}) {
  return new ScribeRealtimeSession({ url: scribeRealtimeUrl("pl"), apiKey: API_KEY, open: socket.open, onText });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ScribeRealtimeSession", () => {
  it("gives the key to the socket header only, never to the URL or a message", async () => {
    const socket = fakeSocket();
    const stream = session(socket);
    socket.receive({ message_type: "session_started" });
    await stream.ready;
    stream.append(new Uint8Array([1, 0, 2, 0]));
    const finished = stream.finish();
    socket.receive({ message_type: "committed_transcript", text: "cześć" });

    await expect(finished).resolves.toBe("cześć");
    expect(socket.opened).toEqual([{ url: expect.not.stringContaining(API_KEY), apiKey: API_KEY }]);
    expect(socket.opened[0]?.url).toContain("language_code=pl");
    for (const message of socket.sent) expect(message).not.toContain(API_KEY);
  });

  it("reports a refused key with OpenBot's text, not the provider's", async () => {
    const socket = fakeSocket();
    const stream = session(socket);
    socket.events()?.onRejected(401);
    await expect(stream.ready).rejects.toThrow(sourceText("error.voice.cloud.keyRejected"));

    const quota = fakeSocket();
    const quotaStream = session(quota);
    quota.receive({ message_type: "session_started" });
    await quotaStream.ready;
    quota.receive({ message_type: "quota_exceeded", error: `Key ${API_KEY} has no credits` });
    expect(() => quotaStream.append(new Uint8Array(2))).toThrow(sourceText("error.voice.cloud.quotaExceeded"));
  });

  it("keeps the last words when ElevenLabs does not commit them after Stop", async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const stream = session(socket);
    socket.receive({ message_type: "session_started" });
    await stream.ready;
    socket.receive({ message_type: "committed_transcript", text: "Pierwsze zdanie." });
    socket.receive({ message_type: "partial_transcript", text: "drugie" });
    const finished = stream.finish();
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(finished).resolves.toBe("Pierwsze zdanie. drugie");
  });
});
