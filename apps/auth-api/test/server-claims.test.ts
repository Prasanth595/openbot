import { isDynamicRecord, isFunction, isString } from "@openbot/contracts/runtime-values";
import { describe, expect, it, vi } from "vitest";
import { AuthService } from "../src/server/auth-service";
import { D1AuthRepository } from "../src/server/d1-auth-repository";
import { runApiEffect } from "../src/server/effect-runtime";
import { migratedDatabase, sqliteD1 } from "./sqlite-d1";

// The route files read the Worker bindings from this module, and have no other seam.
const workerEnvironment = vi.hoisted((): { value: object } => ({ value: {} }));
vi.mock("cloudflare:workers", () => ({
  get env() {
    return workerEnvironment.value;
  },
  waitUntil: () => undefined,
}));

const ADMIN_TOKEN = "a".repeat(43);

// A claim signs a server in to the account of an email with no code, so only the operator can make
// one, and a server can spend it only once and before it expires.
describe("server claims", () => {
  it("makes a claim only with the operator token", async () => {
    const { database, create } = await setup();

    expect((await create("owner@example.com")).status).toBe(401);
    expect((await create("owner@example.com", "w".repeat(43))).status).toBe(401);
    const unset = await setup({ adminToken: undefined });
    expect((await unset.create("owner@example.com", ADMIN_TOKEN)).status).toBe(401);

    expect(database.prepare("SELECT COUNT(*) AS count FROM server_claims").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM users").get()).toEqual({ count: 0 });
  });

  it("signs a server in once for the user of the email", async () => {
    const { database, service, create, redeem } = await setup();

    const created = await create("Owner@Example.com", ADMIN_TOKEN);
    expect(created.status).toBe(200);
    const claim = await claimOf(created);
    // A second claim for the same email keeps the one user, and D1 keeps only the hashes.
    expect((await create("owner@example.com", ADMIN_TOKEN)).status).toBe(200);
    expect(database.prepare("SELECT email FROM users").all()).toEqual([{ email: "owner@example.com" }]);
    expect(database.prepare("SELECT COUNT(*) AS count FROM server_claims WHERE claim_hash = ?").get(claim)).toEqual({
      count: 0,
    });

    const redeemed = await redeem(claim);
    expect(redeemed.status).toBe(200);
    const session = await redeemed.json();
    expect(session).toMatchObject({ sessionToken: expect.any(String), user: { email: "owner@example.com" } });
    const sessionToken = isDynamicRecord(session) && isString(session.sessionToken) ? session.sessionToken : "";
    await expect(runApiEffect(service.authenticateDesktopSession(sessionToken))).resolves.toMatchObject({
      email: "owner@example.com",
    });

    const again = await redeem(claim);
    expect(again.status).toBe(401);
    await expect(again.json()).resolves.toMatchObject({ error: { code: "server_claim_invalid" } });
    expect(database.prepare("SELECT COUNT(*) AS count FROM auth_sessions").get()).toEqual({ count: 1 });
  });

  it("refuses an expired or unknown claim", async () => {
    const { database, create, redeem } = await setup();
    const claim = await claimOf(await create("owner@example.com", ADMIN_TOKEN));
    database.exec("UPDATE server_claims SET expires_at = 0");

    for (const value of [claim, "x".repeat(43), "short", 7]) {
      const response = await redeem(value);
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "server_claim_invalid" } });
    }
    expect(database.prepare("SELECT COUNT(*) AS count FROM auth_sessions").get()).toEqual({ count: 0 });
  });
});

async function setup(options: { adminToken?: string | undefined } = { adminToken: ADMIN_TOKEN }) {
  const database = migratedDatabase();
  const DB = sqliteD1(database);
  workerEnvironment.value = {
    DB,
    AUTH_EXPOSE_DEVELOPMENT_CODE: "true",
    SERVER_CLAIMS_ADMIN_TOKEN: options.adminToken,
    ...fakeWorkerResources(),
  };
  const { Route: CreateRoute } = await import("../src/routes/v2/admin/server-claims");
  const { Route: RedeemRoute } = await import("../src/routes/v2/server-claims/redeem");
  const post = (handlers: unknown, path: string, body: unknown, headers: Record<string, string> = {}) => {
    if (!hasPostHandler(handlers)) throw new Error("The route has no POST handler.");
    return handlers.POST({
      request: new Request(`https://openbot.run${path}`, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json", ...headers },
      }),
      params: {},
    });
  };
  return {
    database,
    service: new AuthService({ repository: new D1AuthRepository(DB), delivery: null }),
    create: (email: string, token?: string) =>
      post(
        CreateRoute.options.server?.handlers,
        "/v2/admin/server-claims",
        { email },
        token ? { Authorization: `Bearer ${token}` } : {},
      ),
    redeem: (claim: unknown) => post(RedeemRoute.options.server?.handlers, "/v2/server-claims/redeem", { claim }),
  };
}

async function claimOf(response: Response): Promise<string> {
  const body = await response.json();
  if (!isDynamicRecord(body) || !isString(body.claim)) throw new Error("The answer has no claim.");
  return body.claim;
}

function hasPostHandler(value: unknown): value is {
  POST: (context: { request: Request; params: Record<string, string> }) => Promise<Response>;
} {
  return isDynamicRecord(value) && isFunction(value.POST);
}

function fakeWorkerResources() {
  const bucket = { get: () => null, put: () => null, delete: () => null };
  const limiter = { limit: async () => ({ success: true }) };
  return {
    AVATARS: bucket,
    SKILLS: bucket,
    SITES: bucket,
    MARKETPLACE_INGRESS_RATE_LIMITER: limiter,
    MARKETPLACE_MUTATION_RATE_LIMITER: limiter,
    MARKETPLACE_UPLOAD_RATE_LIMITER: limiter,
    SITE_REPORT_RATE_LIMITER: limiter,
    GITHUB_TOKEN_RATE_LIMITER: limiter,
  };
}
