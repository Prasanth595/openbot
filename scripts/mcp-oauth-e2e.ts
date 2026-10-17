// Runs the silent MCP OAuth paths end to end on the real `McpOAuth`: the real SDK exchange, the real
// `secureOAuthFetch` and the real logger, against a local OAuth server on the loopback address. The
// storage is a map that decodes each record as the store on disk does. No account or key is used.
// `bun scripts/mcp-oauth-e2e.ts`. Writes .openbot-build/mcp-oauth-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { McpOAuth, type McpOAuthRecord, mcpOAuthRecordSchema } from "../src/backend/mcp-oauth-provider";

const OUT = resolve(import.meta.dirname, "../.openbot-build/mcp-oauth-e2e");
const REDIRECT_URL = "http://127.0.0.1:28417/mcp-auth";
const DEADLINE_MS = 10_000;

type TokenMode = "rotate" | "invalid_grant" | "invalid_client" | "drop";

interface Hit {
  method: string;
  path: string;
  body: Record<string, string>;
}

/** The authorization server and the MCP resource's metadata. Each case sets how `/token` answers. */
async function startAuthorizationServer() {
  const hits: Hit[] = [];
  const waiters: Array<{ done: () => boolean; resolve: () => void }> = [];
  let tokenMode: TokenMode = "rotate";
  let revokeStatus = 200;
  // Runs when a refresh reaches `/token`, before the answer: a case puts a sign-in in that wait.
  let beforeToken: () => void = () => undefined;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", base);
    const body = Object.fromEntries(new URLSearchParams(await readBody(request)));
    hits.push({ method: request.method ?? "GET", path: url.pathname, body });
    for (const waiter of waiters.splice(0))
      if (waiter.done()) waiter.resolve();
      else waiters.push(waiter);
    answer(url.pathname, request, response);
  });
  function answer(path: string, request: IncomingMessage, response: ServerResponse) {
    if (path === "/.well-known/oauth-authorization-server")
      return json(response, 200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        revocation_endpoint: `${base}/revoke`,
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["client_secret_post"],
      });
    if (path === "/.well-known/oauth-protected-resource/mcp")
      return json(response, 200, { resource: `${base}/mcp`, authorization_servers: [base] });
    if (path === "/register") return json(response, 201, { client_id: "registered", redirect_uris: [REDIRECT_URL] });
    if (path === "/revoke") return json(response, revokeStatus, {});
    if (path === "/token" && request.method === "POST") {
      beforeToken();
      if (tokenMode === "drop") return request.socket.destroy();
      if (tokenMode === "invalid_grant") return json(response, 400, { error: "invalid_grant" });
      if (tokenMode === "invalid_client") return json(response, 401, { error: "invalid_client" });
      return json(response, 200, {
        access_token: "access-rotated",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "refresh-rotated",
      });
    }
    json(response, 404, {});
  }
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  return {
    base,
    hits,
    setTokenMode: (mode: TokenMode) => {
      tokenMode = mode;
    },
    setRevokeStatus: (status: number) => {
      revokeStatus = status;
    },
    setBeforeToken: (run: () => void) => {
      beforeToken = run;
    },
    reset: () => {
      hits.splice(0);
      beforeToken = () => undefined;
    },
    /** Resolves when the hits satisfy `done`, and fails at the deadline. */
    waitFor: (done: () => boolean) =>
      new Promise<void>((resolveWait, reject) => {
        if (done()) return resolveWait();
        const timer = setTimeout(() => reject(new Error("The authorization server was not reached.")), DEADLINE_MS);
        waiters.push({
          done,
          resolve: () => {
            clearTimeout(timer);
            resolveWait();
          },
        });
      }),
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((done) => {
    let text = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      text += chunk;
    });
    request.on("end", () => done(text));
  });
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

/** A store that decodes what it is given, as the JSON store does, so unknown fields are dropped. */
function memoryStorage() {
  const records = new Map<string, McpOAuthRecord>();
  return {
    records,
    storage: {
      read: (resource: string) => records.get(resource) ?? null,
      write: (resource: string, record: McpOAuthRecord) =>
        Effect.sync(() => {
          records.set(resource, mcpOAuthRecordSchema.parse(record));
        }),
      clear: (resource: string) =>
        Effect.sync(() => {
          records.delete(resource);
        }),
    },
  };
}

/** A signed-in record whose access token is past its lifetime, so the next read refreshes it. */
function expiredRecord(base: string): McpOAuthRecord {
  return mcpOAuthRecordSchema.parse({
    client: {
      client_id: "client-on-file",
      client_secret: "client-secret-on-file",
      redirect_uris: [REDIRECT_URL],
      issuer: base,
    },
    tokens: {
      access_token: "access-on-file",
      token_type: "Bearer",
      expires_in: 60,
      refresh_token: "refresh-on-file",
      issuer: base,
    },
    obtainedAt: Date.now() - 10 * 60_000,
    discovery: {
      authorizationServerUrl: base,
      resourceMetadataUrl: `${base}/.well-known/oauth-protected-resource/mcp`,
    },
  });
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const auth = await startAuthorizationServer();
  const mcpUrl = `${auth.base}/mcp`;
  const logLines: string[] = [];
  let onLog: () => void = () => undefined;
  /** Resolves when `count` revocation warnings are in the log, and fails at the deadline. */
  const warnings = () => logLines.filter((line) => line.includes("An MCP token was not revoked."));
  const waitForWarnings = (count: number) =>
    new Promise<void>((done, reject) => {
      const timer = setTimeout(() => reject(new Error("The revocation failure was not logged.")), DEADLINE_MS);
      onLog = () => {
        if (warnings().length < count) return;
        clearTimeout(timer);
        done();
      };
      onLog();
    });

  /** One `McpOAuth` per case with a fresh store holding `record`. */
  async function withOAuth<T>(
    record: McpOAuthRecord,
    run: (oauth: McpOAuth, records: Map<string, McpOAuthRecord>) => Promise<T>,
  ) {
    const { records, storage } = memoryStorage();
    records.set(mcpUrl, record);
    const oauth = new McpOAuth({
      storage,
      openExternal: async () => {
        throw new Error("A silent path opened the browser.");
      },
      redirectUrl: REDIRECT_URL,
      logger: createOpenBotLogger("mcp-oauth", (line) => {
        logLines.push(line);
        onLog();
      }),
    });
    auth.reset();
    try {
      return await run(oauth, records);
    } finally {
      await runCauseEffect(oauth.close());
    }
  }
  const registrations = () => auth.hits.filter((hit) => hit.path === "/register").length;

  // A refresh the server accepts stores the rotated token set and hands on the new access token.
  auth.setTokenMode("rotate");
  const refreshed = await withOAuth(expiredRecord(auth.base), async (oauth, records) => {
    const token = await runCauseEffect(oauth.accessToken(mcpUrl));
    const stored = records.get(mcpUrl);
    assert.equal(token, "access-rotated");
    assert.equal(stored?.tokens?.refresh_token, "refresh-rotated");
    assert.equal(oauth.needsSignIn(mcpUrl), false);
    assert.equal(registrations(), 0);
    return { token: "access-rotated", needsSignIn: false, registrations: 0 };
  });

  // `invalid_grant`: the grant ended. No token is handed on, the client stays, the row asks again.
  auth.setTokenMode("invalid_grant");
  const invalidGrant = await withOAuth(expiredRecord(auth.base), async (oauth, records) => {
    const token = await runCauseEffect(oauth.accessToken(mcpUrl));
    const stored = records.get(mcpUrl);
    assert.equal(token, null);
    assert.equal(stored?.tokens, undefined);
    assert.equal(stored?.client?.client_id, "client-on-file");
    assert.equal(stored?.discovery?.authorizationServerUrl, auth.base);
    assert.equal(typeof stored?.lostAt, "number");
    assert.equal(oauth.signedIn(mcpUrl), false);
    assert.equal(oauth.needsSignIn(mcpUrl), true);
    assert.equal(registrations(), 0);
    return { token, clientKept: true, discoveryKept: true, needsSignIn: true, registrations: 0 };
  });

  // A sign-in that ends while a refresh waits stores a new grant. The refusal of the old grant
  // that follows does not delete it.
  auth.setTokenMode("invalid_grant");
  const signInDuringRefresh = await withOAuth(expiredRecord(auth.base), async (oauth, records) => {
    const fresh = expiredRecord(auth.base);
    auth.setBeforeToken(() =>
      records.set(mcpUrl, {
        ...fresh,
        tokens: {
          access_token: "access-new",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "refresh-new",
          issuer: auth.base,
        },
        obtainedAt: Date.now(),
      }),
    );
    await runCauseEffect(oauth.accessToken(mcpUrl));
    const stored = records.get(mcpUrl);
    assert.ok(auth.hits.some((hit) => hit.path === "/token"));
    assert.equal(stored?.tokens?.refresh_token, "refresh-new");
    assert.equal(stored?.lostAt, undefined);
    assert.equal(oauth.needsSignIn(mcpUrl), false);
    return { newGrantKept: true, needsSignIn: false };
  });

  // `invalid_client`: the registration goes too, and nothing registers a new one in the background.
  auth.setTokenMode("invalid_client");
  const invalidClient = await withOAuth(expiredRecord(auth.base), async (oauth, records) => {
    const token = await runCauseEffect(oauth.accessToken(mcpUrl));
    const stored = records.get(mcpUrl);
    assert.equal(token, null);
    assert.equal(stored?.tokens, undefined);
    assert.equal(stored?.client, undefined);
    assert.equal(stored?.discovery?.authorizationServerUrl, auth.base);
    assert.equal(oauth.needsSignIn(mcpUrl), true);
    assert.equal(registrations(), 0);
    return { token, clientDropped: true, needsSignIn: true, registrations: 0 };
  });

  // A dropped connection says nothing about the grant: everything stays and the stored token answers.
  auth.setTokenMode("drop");
  const networkError = await withOAuth(expiredRecord(auth.base), async (oauth, records) => {
    const token = await runCauseEffect(oauth.accessToken(mcpUrl));
    const stored = records.get(mcpUrl);
    assert.equal(token, "access-on-file");
    assert.equal(stored?.tokens?.refresh_token, "refresh-on-file");
    assert.equal(stored?.client?.client_id, "client-on-file");
    assert.equal(stored?.lostAt, undefined);
    assert.equal(oauth.needsSignIn(mcpUrl), false);
    assert.ok(auth.hits.some((hit) => hit.path === "/token"));
    return { token: "access-on-file", tokensKept: true, needsSignIn: false };
  });

  // Sign-out deletes the tokens first, then revokes the refresh token and the access token.
  auth.setRevokeStatus(200);
  const signOut = await withOAuth(expiredRecord(auth.base), async (oauth, records) => {
    await runCauseEffect(oauth.signOut(mcpUrl));
    assert.equal(records.has(mcpUrl), false);
    const revoked = () => auth.hits.filter((hit) => hit.path === "/revoke");
    await auth.waitFor(() => revoked().length === 2);
    const [first, second] = revoked();
    assert.deepEqual(first?.body, {
      token: "refresh-on-file",
      token_type_hint: "refresh_token",
      client_id: "client-on-file",
      client_secret: "client-secret-on-file",
    });
    assert.equal(second?.body.token, "access-on-file");
    assert.equal(second?.body.token_type_hint, "access_token");
    assert.equal(oauth.needsSignIn(mcpUrl), false);
    return { cleared: true, revoked: revoked().map((hit) => hit.body.token_type_hint) };
  });

  // A revocation the server refuses is logged by status only: no token reaches the log.
  auth.setRevokeStatus(503);
  logLines.splice(0);
  const revokeRefused = await withOAuth(expiredRecord(auth.base), async (oauth) => {
    await runCauseEffect(oauth.forget(mcpUrl));
    // The scope close in `withOAuth` would interrupt a revocation that has not logged yet.
    await waitForWarnings(2);
    for (const line of logLines)
      for (const secret of ["refresh-on-file", "access-on-file", "client-secret-on-file"])
        assert.ok(!line.includes(secret), "A revocation log line quoted a credential.");
    assert.ok(warnings().every((line) => line.includes("http 503")));
    return { warnings: warnings().length, status: "http 503", credentialsInLog: false };
  });

  await auth.close();
  const cases = { refreshed, invalidGrant, signInDuringRefresh, invalidClient, networkError, signOut, revokeRefused };
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ ok: true, cases }, null, 2)}\n`);
  process.stdout.write(`mcp-oauth-e2e: ${Object.keys(cases).length} cases passed\n`);
}

await main();
