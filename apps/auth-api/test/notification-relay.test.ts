import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";
import { describe, expect, it, vi } from "vitest";
import { runApiEffect } from "../src/server/effect-runtime";
import { ApnsRelaySender, readNotificationRelayPush } from "../src/server/live-activity-relay";
import { RemoteControlPlane } from "../src/server/remote-control-plane";
import { sqliteD1 } from "./sqlite-d1";

const token = "ab".repeat(32);
const body = {
  machineToken: "machine",
  token,
  environment: "production",
  sessionId: "phone-session",
  sealed: "c2VhbGVk",
  sound: "openbot",
  timestamp: 1_790_000_000,
};

describe("notification relay", () => {
  // A host gives sealed bytes only. If it could add text, a host credential could show a phone anything.
  it("sends the sealed notification with the app name as its only text", async () => {
    const { privateKey } = await generateKeyPair("ES256", { extractable: true });
    const fetch = vi.fn(async (_input: string, _init: RequestInit) => new Response(null, { status: 200 }));
    const apns = new ApnsRelaySender(
      {
        privateKey: await exportPKCS8(privateKey),
        keyId: "KEY1234567",
        teamId: "ZTRDTUL87R",
        topic: "run.openbot.mobile",
      },
      fetch,
    );
    const push = readNotificationRelayPush({ ...body, alert: { title: "Pay now" }, body: "Pay now", title: "Bank" });
    if (!push) throw new Error("The notification was not read.");

    expect(await runApiEffect(apns.sendNotification(push))).toBe("sent");
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`https://api.push.apple.com/3/device/${token}`);
    expect(init?.headers).toMatchObject({
      "apns-push-type": "alert",
      "apns-topic": "run.openbot.mobile",
      "apns-priority": "10",
      "apns-expiration": String(body.timestamp + 24 * 60 * 60),
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      aps: { alert: { title: "OpenBot" }, "mutable-content": 1, sound: "openbot-task.wav" },
      sealed: body.sealed,
    });
  });

  it("refuses a token, sealed value or sound that could leave the device path or the payload", () => {
    expect(readNotificationRelayPush(body)).not.toBeNull();
    expect(readNotificationRelayPush({ ...body, token: "../../3/device/ab" })).toBeNull();
    expect(readNotificationRelayPush({ ...body, sealed: '","aps":{"alert":"x"}' })).toBeNull();
    expect(readNotificationRelayPush({ ...body, sealed: "a".repeat(4_000) })).toBeNull();
    expect(readNotificationRelayPush({ ...body, sound: "../alarm.caf" })).toBeNull();
    expect(readNotificationRelayPush({ ...body, sessionId: "" })).toBeNull();
  });

  // The host does not learn that the account service ended a session, so the relay is the gate.
  it("sends only for an open session of an active member on this host", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys = ON");
      const migrations = new URL("../migrations/", import.meta.url);
      for (const name of readdirSync(migrations)
        .filter((name) => name.endsWith(".sql"))
        .sort()) {
        database.exec(readFileSync(new URL(name, migrations), "utf8"));
      }
      database.exec(`
        INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES ('member', 'email:member@example.com', 'member@example.com', 1, 1);
        INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES ('owner', 'email:owner@example.com', 'owner@example.com', 1, 1);
        INSERT INTO remote_hosts(host_id, owner_user_id, name, auth_epoch, created_at, updated_at) VALUES ('host-a', 'owner', 'Desktop A', 1, 1, 1);
        INSERT INTO remote_hosts(host_id, owner_user_id, name, auth_epoch, created_at, updated_at) VALUES ('host-b', 'owner', 'Desktop B', 1, 1, 1);
        INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at) VALUES ('member-a', 'host-a', 'member', 'member', 'active', 1, 1);
        INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at) VALUES ('auth-1', 'member', 'phone-auth', 5000, 1, 1);
        INSERT INTO remote_sessions(session_id, host_id, user_id, membership_id, started_at, expires_at, auth_session_hash)
          VALUES ('phone-session', 'host-a', 'member', 'member-a', 1, 8640000000000000, 'phone-auth');
      `);
      const pair = await generateKeyPair("ES256", { extractable: true });
      const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "test-key", use: "sig", alg: "ES256" };
      const controlPlane = new RemoteControlPlane(
        {
          DB: sqliteD1(database),
          REMOTE_TICKET_PRIVATE_JWK: JSON.stringify({
            ...(await exportJWK(pair.privateKey)),
            kid: "test-key",
            alg: "ES256",
          }),
          REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({ keys: [publicJwk] }),
          REMOTE_TICKET_KEY_ID: "test-key",
        },
        { now: () => 1_000 },
      );
      const open = (hostId: string, sessionId = "phone-session") =>
        runApiEffect(controlPlane.sessionOpen(hostId, sessionId));

      expect(await open("host-a")).toBe(true);
      expect(await open("host-b")).toBe(false);
      expect(await open("host-a", "other-session")).toBe(false);

      database.exec("UPDATE auth_sessions SET revoked_at = 900");
      expect(await open("host-a")).toBe(false);
      database.exec("UPDATE auth_sessions SET revoked_at = NULL");
      database.exec("UPDATE remote_memberships SET status = 'revoked'");
      expect(await open("host-a")).toBe(false);
      database.exec("UPDATE remote_memberships SET status = 'active'");
      database.exec("UPDATE remote_sessions SET ended_at = 900");
      expect(await open("host-a")).toBe(false);
    } finally {
      database.close();
    }
  });
});
