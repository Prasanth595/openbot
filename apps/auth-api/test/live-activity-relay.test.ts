import { exportPKCS8, generateKeyPair } from "jose";
import { describe, expect, it, vi } from "vitest";
import { runApiEffect } from "../src/server/effect-runtime";
import { ApnsRelaySender, readLiveActivityRelayPush } from "../src/server/live-activity-relay";

const token = "ab".repeat(32);
const body = {
  machineToken: "machine",
  token,
  environment: "production",
  event: "update",
  sealed: "c2VhbGVk",
  timestamp: 1_790_000_000,
  staleAt: 1_790_000_900,
  priority: 10,
};

async function sender(respond: () => Response) {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  const fetch = vi.fn(async (_input: string, _init: RequestInit) => respond());
  const apns = new ApnsRelaySender(
    {
      privateKey: await exportPKCS8(privateKey),
      keyId: "KEY1234567",
      teamId: "ZTRDTUL87R",
      topic: "run.openbot.mobile",
    },
    fetch,
  );
  return { apns, fetch };
}

describe("Live Activity relay", () => {
  it("sends the sealed props as a Live Activity update with no text of its own", async () => {
    const { apns, fetch } = await sender(() => new Response(null, { status: 200 }));
    // A host from before alerts sends no `alert`.
    const push = readLiveActivityRelayPush(body);
    if (!push) throw new Error("The update was not read.");

    expect(await runApiEffect(apns.send(push))).toBe("sent");
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`https://api.push.apple.com/3/device/${token}`);
    expect(init?.headers).toMatchObject({
      "apns-push-type": "liveactivity",
      "apns-topic": "run.openbot.mobile.push-type.liveactivity",
      "apns-priority": "10",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      aps: {
        timestamp: body.timestamp,
        event: "update",
        "content-state": { name: "AgentActivity", props: JSON.stringify({ sealed: body.sealed }) },
        "stale-date": body.staleAt,
      },
    });
  });

  it("alerts with the app name and the chosen sound only, never with text of the host", async () => {
    const { apns, fetch } = await sender(() => new Response(null, { status: 200 }));
    expect(readLiveActivityRelayPush({ ...body, alert: { title: "Pay now" } })).toBeNull();
    expect(readLiveActivityRelayPush({ ...body, alert: { sound: "chime.aiff" } })).toBeNull();
    const push = readLiveActivityRelayPush({ ...body, alert: { sound: "bubble", title: "Pay now" } });
    if (!push) throw new Error("The update was not read.");

    expect(await runApiEffect(apns.send(push))).toBe("sent");
    const [, init] = fetch.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body)).aps.alert).toEqual({
      title: "OpenBot",
      body: "OpenBot",
      sound: "openbot-bubble.wav",
    });
  });

  it("refuses a token or sealed value that could leave the device path or the payload", () => {
    expect(readLiveActivityRelayPush({ ...body, token: "../../3/device/ab" })).toBeNull();
    expect(readLiveActivityRelayPush({ ...body, sealed: '","alert":"x' })).toBeNull();
    expect(readLiveActivityRelayPush({ ...body, sealed: "a".repeat(4_000) })).toBeNull();
    expect(readLiveActivityRelayPush({ ...body, event: "start" })).toBeNull();
    expect(readLiveActivityRelayPush({ ...body, event: "end", sealed: null, staleAt: null })).not.toBeNull();
  });

  it("tells the host when Apple no longer knows the token, so it stops sending", async () => {
    const push = readLiveActivityRelayPush({ ...body, environment: "development" });
    if (!push) throw new Error("The update was not read.");

    const gone = await sender(() => new Response(null, { status: 410 }));
    expect(await runApiEffect(gone.apns.send(push))).toBe("gone");
    expect(gone.fetch.mock.calls[0]?.[0]).toContain("api.sandbox.push.apple.com");
    const refused = await sender(() => Response.json({ reason: "BadDeviceToken" }, { status: 400 }));
    expect(await runApiEffect(refused.apns.send(push))).toBe("gone");
    const busy = await sender(() => new Response(null, { status: 503 }));
    expect(await runApiEffect(busy.apns.send(push))).toBe("unavailable");
  });
});
