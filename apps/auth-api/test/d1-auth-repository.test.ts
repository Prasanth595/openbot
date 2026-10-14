import { describe, expect, it } from "vitest";
import { AuthService } from "../src/server/auth-service";
import { sha256 } from "../src/server/crypto";
import { D1AuthRepository } from "../src/server/d1-auth-repository";
import { runApiEffect } from "../src/server/effect-runtime";
import { migratedDatabase, sqliteD1 } from "./sqlite-d1";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

interface TestMobileSessionUserRow {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  last_used_at: number;
}

interface PreparedCall {
  query: string;
  values: unknown[];
}

describe("D1 auth sessions", () => {
  it("includes verified sent challenges in resend cooldown checks", async () => {
    const calls: PreparedCall[] = [];
    const repository = new D1AuthRepository(emailChallengeDatabase(calls));

    await expect(runApiEffect(repository.latestEmailChallengeAt("person@example.com"))).resolves.toBe(1_000);

    expect(calls[0]?.query).toContain("delivery_state IN ('pending', 'sent')");
    expect(calls[0]?.query).not.toContain("consumed_at IS NULL");
    expect(calls[0]?.values).toEqual(["person@example.com"]);
  });

  it("excludes registered mobile sessions from desktop authentication", async () => {
    const calls: PreparedCall[] = [];
    const repository = new D1AuthRepository(desktopAuthenticationDatabase(calls));

    await expect(runApiEffect(repository.authenticateDesktopSession("desktop-token", 1_000))).resolves.toMatchObject({
      id: "user-1",
    });

    expect(calls[0]?.query).toContain("NOT EXISTS");
    expect(calls[0]?.query).toContain("mobile_auth_sessions.session_id = auth_sessions.id");
    expect(calls[0]?.values).toEqual([expect.any(String), 1_000]);
  });

  it("revokes only a session registered as mobile", async () => {
    const calls: PreparedCall[] = [];
    const repository = new D1AuthRepository(mobileRevocationDatabase(calls));

    await expect(runApiEffect(repository.revokeMobileSession("mobile-token", 2_000))).resolves.toBe(true);

    expect(calls[0]?.query).toContain("id IN (SELECT session_id FROM mobile_auth_sessions)");
    expect(calls[0]?.values).toEqual([2_000, expect.any(String)]);
  });

  it.each([
    [
      "generic",
      (repository: D1AuthRepository, now: number) => runApiEffect(repository.authenticate("session-token", now)),
    ],
    [
      "desktop",
      (repository: D1AuthRepository, now: number) =>
        runApiEffect(repository.authenticateDesktopSession("desktop-token", now)),
    ],
    [
      "mobile",
      (repository: D1AuthRepository, now: number) =>
        runApiEffect(repository.authenticateMobileSession("mobile-token", now)),
    ],
  ])("updates %s session activity only after the coarse activity window", async (_kind, authenticate) => {
    const updates: unknown[][] = [];
    const connectedAt = 1_000;
    const repository = new D1AuthRepository(activityDatabase(connectedAt, updates));

    await expect(authenticate(repository, connectedAt + FIFTEEN_MINUTES_MS - 1)).resolves.toMatchObject({
      id: "user-1",
    });
    expect(updates).toEqual([]);

    const now = connectedAt + FIFTEEN_MINUTES_MS;
    await expect(authenticate(repository, now)).resolves.toMatchObject({ id: "user-1" });
    expect(updates).toEqual([[now, expect.any(String), connectedAt]]);
  });

  it("atomically replaces outstanding mobile authentication tickets", async () => {
    const batches: PreparedCall[][] = [];
    const repository = new D1AuthRepository(ticketDatabase(batches));

    await runApiEffect(
      repository.replaceMobileAuthTicket({
        ticketHash: "new-ticket-hash",
        userId: "user-1",
        serverId: "00000000-0000-4000-8000-000000000001",
        createdAt: 1_000,
        expiresAt: 121_000,
      }),
    );

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
    expect(batches[0]?.[0]?.query).toContain("UPDATE team_auth_tickets SET consumed_at");
    expect(batches[0]?.[0]?.values).toEqual([1_000, "user-1", "00000000-0000-4000-8000-000000000001"]);
    expect(batches[0]?.[1]?.query).toContain("INSERT INTO team_auth_tickets");
    expect(batches[0]?.[1]?.values).toEqual([
      "new-ticket-hash",
      "user-1",
      "00000000-0000-4000-8000-000000000001",
      1_000,
      121_000,
      null,
      null,
    ]);
  });
});

describe("email sign-in on a phone", () => {
  it("makes a mobile session that cannot act as a desktop and replaces the device's earlier session", async () => {
    const database = migratedDatabase();
    try {
      let now = 1_000;
      const service = new AuthService({
        repository: new D1AuthRepository(sqliteD1(database)),
        delivery: null,
        exposeDevelopmentCode: true,
        now: () => now,
      });
      const device = { id: crypto.randomUUID(), name: "Phone", platform: "ios" as const };
      const signIn = async () => {
        const challenge = await runApiEffect(service.startEmailSignIn("person@example.com", "203.0.113.4"));
        now += 61_000;
        return runApiEffect(
          service.verifyMobileEmailCode({
            challengeId: challenge.challengeId,
            code: challenge.developmentCode ?? "",
            sourceIp: "203.0.113.5",
            device,
          }),
        );
      };

      const first = await signIn();
      expect(first).toEqual({
        sessionToken: expect.any(String),
        user: expect.objectContaining({ id: expect.any(String) }),
      });
      await expect(runApiEffect(service.authenticateMobileSession(first.sessionToken))).resolves.toMatchObject({
        email: "person@example.com",
      });
      await expect(runApiEffect(service.authenticateDesktopSession(first.sessionToken))).resolves.toBeNull();
      await expect(
        runApiEffect(service.issueMobileAuthTicket(first.sessionToken, "203.0.113.4")),
      ).rejects.toMatchObject({ status: 401, code: "unauthorized" });

      const second = await signIn();
      await expect(runApiEffect(service.authenticateMobileSession(first.sessionToken))).resolves.toBeNull();
      await expect(runApiEffect(service.authenticateMobileSession(second.sessionToken))).resolves.toMatchObject({
        id: first.user.id,
      });
    } finally {
      database.close();
    }
  });
});

describe("persistent Mobile Connect links", () => {
  it("signs in many phones until the link is replaced, revoked, or its desktop session or host key changes", async () => {
    const database = migratedDatabase();
    try {
      const desktopToken = "desktop-token";
      database.exec(`
        INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES
          ('owner', 'email:owner@example.com', 'owner@example.com', 1, 1),
          ('other', 'email:other@example.com', 'other@example.com', 1, 1);
        INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at)
          VALUES ('desktop', 'owner', '${await runApiEffect(sha256(desktopToken))}', 8640000000000000, 1, 1);
        INSERT INTO remote_hosts(host_id, owner_user_id, name, device_public_key, auth_epoch, created_at, updated_at) VALUES
          ('host-a', 'owner', 'Desktop A', 'key-a', 1, 1, 1),
          ('host-b', 'other', 'Desktop B', 'key-b', 1, 1, 1);
      `);
      const host = { hostId: "host-a", fingerprint: await runApiEffect(sha256("key-a")) };
      let now = 1_000;
      const service = new AuthService({
        repository: new D1AuthRepository(sqliteD1(database)),
        delivery: null,
        now: () => now,
      });
      const createLink = () => runApiEffect(service.createMobileConnectLink(desktopToken, "203.0.113.4", host));
      const redeem = (code: string) =>
        runApiEffect(
          service.redeemMobileAuthTicket(
            code,
            { id: crypto.randomUUID(), name: "Phone", platform: "ios" },
            "203.0.113.5",
          ),
        );

      const first = await createLink();
      expect(first).toEqual({ link: expect.stringMatching(/^[A-Za-z0-9_-]{32,128}$/), createdAt: 1_000 });
      now = 2_000;
      const phoneA = await redeem(first.link);
      const phoneB = await redeem(first.link);
      expect(phoneA).toMatchObject({ user: { id: "owner" }, host });
      expect(phoneB?.sessionToken).not.toBe(phoneA?.sessionToken);
      await expect(runApiEffect(service.authenticateMobileSession(phoneB?.sessionToken ?? ""))).resolves.toMatchObject({
        id: "owner",
      });
      expect(database.prepare("SELECT use_count, last_used_at FROM mobile_connect_links").get()).toEqual({
        use_count: 2,
        last_used_at: 2_000,
      });
      expect(JSON.stringify(database.prepare("SELECT * FROM mobile_connect_links").all())).not.toContain(first.link);

      const second = await createLink();
      await expect(redeem(first.link)).resolves.toBeNull();
      await expect(redeem(second.link)).resolves.toMatchObject({ host });

      const codePhone = await redeem(
        (await runApiEffect(service.issueMobileAuthTicket(desktopToken, "203.0.113.4", host))).ticket,
      );
      expect(
        (await runApiEffect(service.listMobileAuthDevices(desktopToken))).map((device) => device.via).sort(),
      ).toEqual(["code", "link", "link", "link"]);

      // A replaced link's row can go with the desktop session that made it. Its phones still go at revoke.
      database.exec("DELETE FROM mobile_connect_links WHERE revoked_at IS NOT NULL");
      await runApiEffect(service.revokeMobileConnectLink(desktopToken, "host-a"));
      await runApiEffect(service.revokeMobileConnectLink(desktopToken, "host-a"));
      await expect(redeem(second.link)).resolves.toBeNull();
      // Revoking signs out every phone that a link of this host signed in, also the replaced link's.
      await expect(runApiEffect(service.authenticateMobileSession(phoneA?.sessionToken ?? ""))).resolves.toBeNull();
      await expect(
        runApiEffect(service.authenticateMobileSession(codePhone?.sessionToken ?? "")),
      ).resolves.toMatchObject({ id: "owner" });
      expect(await runApiEffect(service.listMobileAuthDevices(desktopToken))).toEqual([
        expect.objectContaining({ via: "code" }),
      ]);
      await expect(runApiEffect(service.revokeMobileConnectLink(desktopToken, "host/a"))).rejects.toMatchObject({
        status: 400,
        code: "invalid_mobile_host",
      });

      const third = await createLink();
      database.exec("UPDATE remote_hosts SET device_public_key = 'substituted-key' WHERE host_id = 'host-a'");
      await expect(redeem(third.link)).resolves.toBeNull();
      database.exec("UPDATE remote_hosts SET device_public_key = 'key-a' WHERE host_id = 'host-a'");

      await expect(
        runApiEffect(
          service.createMobileConnectLink(desktopToken, "203.0.113.4", {
            hostId: "host-b",
            fingerprint: await runApiEffect(sha256("key-b")),
          }),
        ),
      ).rejects.toMatchObject({ status: 409, code: "mobile_host_mismatch" });

      const ticket = await runApiEffect(service.issueMobileAuthTicket(desktopToken, "203.0.113.4", host));
      await expect(redeem(ticket.ticket)).resolves.toMatchObject({ user: { id: "owner" }, host });
      await expect(redeem(ticket.ticket)).resolves.toBeNull();
      const cancelled = await runApiEffect(service.issueMobileAuthTicket(desktopToken, "203.0.113.4", host));
      // A cancel on another desktop of the account does not spend this desktop's code.
      await runApiEffect(service.cancelMobileAuthTickets(desktopToken, "host-c"));
      expect(
        database.prepare("SELECT COUNT(*) AS live FROM team_auth_tickets WHERE consumed_at IS NULL").get(),
      ).toEqual({
        live: 1,
      });
      await runApiEffect(service.cancelMobileAuthTickets(desktopToken, "host-a"));
      await expect(redeem(cancelled.ticket)).resolves.toBeNull();

      const fourth = await createLink();
      await runApiEffect(service.logout(desktopToken));
      await expect(redeem(fourth.link)).resolves.toBeNull();
    } finally {
      database.close();
    }
  });
});

function emailChallengeDatabase(calls: PreparedCall[]): D1Database {
  return {
    prepare(query) {
      const call: PreparedCall = { query, values: [] };
      calls.push(call);
      return statement({ first: { created_at: 1_000 }, onBind: (values) => (call.values = values) });
    },
    batch() {
      throw new Error("Unexpected batch call.");
    },
    exec() {
      throw new Error("Unexpected exec call.");
    },
    withSession() {
      throw new Error("Unexpected withSession call.");
    },
    dump() {
      throw new Error("Unexpected dump call.");
    },
  };
}

function ticketDatabase(batches: PreparedCall[][]): D1Database {
  const pending: PreparedCall[] = [];
  return {
    prepare(query) {
      const call: PreparedCall = { query, values: [] };
      pending.push(call);
      return statement({ onBind: (values) => (call.values = values) });
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      batches.push(pending.splice(0));
      return statements.map(() => d1Result<T>());
    },
    exec() {
      throw new Error("Unexpected exec call.");
    },
    withSession() {
      throw new Error("Unexpected withSession call.");
    },
    dump() {
      throw new Error("Unexpected dump call.");
    },
  };
}

function activityDatabase(lastUsedAt: number, updates: unknown[][]): D1Database {
  return {
    prepare(query) {
      if (query.includes("SELECT users.id")) {
        return statement({
          first: {
            id: "user-1",
            email: "person@example.com",
            name: null,
            avatar_url: null,
            last_used_at: lastUsedAt,
          },
        });
      }
      if (query.startsWith("UPDATE auth_sessions SET last_used_at")) {
        return statement({ onRun: (values) => updates.push(values) });
      }
      throw new Error(`Unexpected query: ${query}`);
    },
    batch() {
      throw new Error("Unexpected batch call.");
    },
    exec() {
      throw new Error("Unexpected exec call.");
    },
    withSession() {
      throw new Error("Unexpected withSession call.");
    },
    dump() {
      throw new Error("Unexpected dump call.");
    },
  };
}

function desktopAuthenticationDatabase(calls: PreparedCall[]): D1Database {
  return singleStatementDatabase(calls, {
    id: "user-1",
    email: "person@example.com",
    name: null,
    avatar_url: null,
    last_used_at: 1_000,
  });
}

function mobileRevocationDatabase(calls: PreparedCall[]): D1Database {
  return singleStatementDatabase(calls, { id: "mobile-session" });
}

function singleStatementDatabase(calls: PreparedCall[], first?: unknown): D1Database {
  return {
    prepare(query) {
      const call: PreparedCall = { query, values: [] };
      calls.push(call);
      return statement({ first, onBind: (values) => (call.values = values) });
    },
    batch() {
      throw new Error("Unexpected batch call.");
    },
    exec() {
      throw new Error("Unexpected exec call.");
    },
    withSession() {
      throw new Error("Unexpected withSession call.");
    },
    dump() {
      throw new Error("Unexpected dump call.");
    },
  };
}

function statement(options: {
  first?: unknown;
  onBind?: (values: unknown[]) => void;
  onRun?: (values: unknown[]) => void;
}): D1PreparedStatement {
  let values: unknown[] = [];
  const prepared: D1PreparedStatement = {
    bind(...nextValues) {
      values = nextValues;
      options.onBind?.(values);
      return prepared;
    },
    async first<T = TestMobileSessionUserRow>(): Promise<T | null> {
      // biome-ignore lint/nursery/noUnsafeTypeAssertion: This test adapter owns the concrete row behind D1's generic return type.
      return options.first ? (options.first as T) : null;
    },
    async run<T = TestMobileSessionUserRow>(): Promise<D1Result<T>> {
      options.onRun?.(values);
      return d1Result<T>();
    },
    async all<T = TestMobileSessionUserRow>(): Promise<D1Result<T>> {
      return d1Result<T>();
    },
    async raw(): Promise<never> {
      throw new Error("Unexpected raw call.");
    },
  };
  return prepared;
}

function d1Result<T>(): D1Result<T> {
  return {
    success: true,
    results: [],
    meta: {
      duration: 0,
      size_after: 0,
      rows_read: 0,
      rows_written: 0,
      last_row_id: 0,
      changed_db: false,
      changes: 1,
    },
  };
}
