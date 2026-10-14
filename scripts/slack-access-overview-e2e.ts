// Drives real Slack identification and MessagingService with synthetic loopback Slack responses.
// The Team route uses real request/response codecs and admin authorization. A synthetic transport
// replaces Signal. No app, account, agent workspace, operating system credential store or external API is used.
// bun scripts/slack-access-overview-e2e.ts
// Writes .openbot-build/slack-access-overview-e2e/report.json.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { decodeHostSlackAccessOverview, type TeamMemberSummary } from "@openbot/contracts/ipc";
import { CONNECTORS_CODECS, CONNECTORS_ROUTES } from "@openbot/contracts/team-protocol/connectors-v1";
import { teamCapabilitiesForProtocol } from "@openbot/contracts/team-protocol/current";
import { teamSideRouteCodec } from "@openbot/contracts/team-protocol/side-routes";
import { SLACK_ACCESS_CAPABILITY, SLACK_ACCESS_ROUTES } from "@openbot/contracts/team-protocol/slack-access-v1";
import { TEAM_CAPABILITIES_HEADER, TEAM_PROTOCOL_VERSION_HEADER } from "@openbot/contracts/team-protocol/v1";
import { redactText, registerSecretValue, teeLogLines } from "@openbot/logging";
import { slackAccessOverview } from "@openbot/team-client/team-admin-requests";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { type MessagingCredentials, MessagingService } from "../src/backend/messaging/messaging-service";
import { MessagingThreads } from "../src/backend/messaging/messaging-threads";
import { slackDriver } from "../src/backend/messaging/slack/slack-driver";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { HttpError } from "../src/main/team-api/http-error";
import { requestCapabilities, requestProtocol } from "../src/main/team-api/request-helpers";
import { routeSlackAccess } from "../src/main/team-api/route-slack-access";
import { decodeSlackAccessOverviewReply } from "../src/preload/messaging-decoding";

type FixtureSlackApiResponse =
  | { ok: true; team_id: string; user_id: string; bot_id: string; team: string }
  | { ok: false; error: "invalid_auth" }
  | { ok: true; bot: { app_id: string } }
  | { ok: true; channels: [] }
  | { ok: true; revoked: true };

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build/slack-access-overview-e2e");
const EXPECTED_CHECKS = 16;
const FIXTURE_WAIT_MS = 10_000;
const runNonce = randomUUID();
const SECRET = "xoxb-synthetic-local-only";
const INVALID_HEADER_SECRET = "xoxb-synthetic-header-value";
const SESSION_SECRET = "synthetic-scope-session-only";
const secrets = [SECRET, INVALID_HEADER_SECRET, SESSION_SECRET];
for (const value of secrets) registerSecretValue(value);
const checks: string[] = [];
const servers: Server[] = [];
const tasks = new Set<Promise<void>>();
const fixtureErrors: string[] = [];
const cleanupErrors: Array<{ resource: string; error: string }> = [];
const artifactErrors: string[] = [];
// This fixed inventory is the same in dirty development and clean CI checkouts.
// It includes feature consumers and the real services, codecs and schema used by this fixture.
const sourcePaths = [
  "bun.lock",
  "changelog.d/codex-slack-scope-visibility.md",
  "docs/architecture/team-api.md",
  "docs/messaging.md",
  "packages/contracts/package.json",
  "packages/contracts/src/ipc-endpoints.ts",
  "packages/contracts/src/ipc-slack-access.ts",
  "packages/contracts/src/ipc.ts",
  "packages/contracts/src/slack-app.ts",
  "packages/contracts/src/team-protocol/admin-wire.ts",
  "packages/contracts/src/team-protocol/connectors-v1.ts",
  "packages/contracts/src/team-protocol/current.ts",
  "packages/contracts/src/team-protocol/fixtures/slack-access-v1/client-request.json",
  "packages/contracts/src/team-protocol/fixtures/slack-access-v1/host-response.json",
  "packages/contracts/src/team-protocol/optional-routes.ts",
  "packages/contracts/src/team-protocol/side-routes.ts",
  "packages/contracts/src/team-protocol/slack-access-v1.ts",
  "packages/i18n/src/messages/de/connector.ts",
  "packages/i18n/src/messages/en/connector.ts",
  "packages/i18n/src/messages/es/connector.ts",
  "packages/i18n/src/messages/fr/connector.ts",
  "packages/i18n/src/messages/it/connector.ts",
  "packages/i18n/src/messages/ja/connector.ts",
  "packages/i18n/src/messages/pl/connector.ts",
  "packages/i18n/src/messages/pt/connector.ts",
  "packages/i18n/src/messages/ru/connector.ts",
  "packages/i18n/src/messages/tr/connector.ts",
  "packages/logging/src/index.ts",
  "packages/team-client/src/team-admin-requests.ts",
  "packages/team-client/src/team-api-requests.ts",
  "packages/ui/src/features/settings/SlackIntegrationPanel.tsx",
  "scripts/slack-access-overview-e2e.ts",
  "src/backend/agent-memory-selection.ts",
  "src/backend/agent-waits/agent-wait-schema.ts",
  "src/backend/channel-schema.ts",
  "src/backend/database/database-core.ts",
  "src/backend/database/provider-history-schema.ts",
  "src/backend/effect-boundary.ts",
  "src/backend/mailbox-store.ts",
  "src/backend/messaging/messaging-memory-store.ts",
  "src/backend/messaging/messaging-schema.ts",
  "src/backend/messaging/messaging-service.ts",
  "src/backend/messaging/messaging-store.ts",
  "src/backend/messaging/messaging-threads.ts",
  "src/backend/messaging/messaging-types.ts",
  "src/backend/messaging/slack/slack-driver.ts",
  "src/backend/messaging/slack/slack-events.ts",
  "src/backend/messaging/slack/slack-web-api.ts",
  "src/backend/mcp-schema.ts",
  "src/backend/openbot-database.ts",
  "src/backend/openbot-database-schema.ts",
  "src/backend/routine-flows/routine-flow-schema.ts",
  "src/backend/routine-results/routine-result-schema.ts",
  "src/main/ipc/messaging-handlers.ts",
  "src/main/team-api-server.ts",
  "src/main/team-api/dependencies.ts",
  "src/main/team-api/http-error.ts",
  "src/main/team-api/request-helpers.ts",
  "src/main/team-api/route-slack-access.ts",
  "src/preload/index.ts",
  "src/preload/messaging-decoding.ts",
  "src/renderer/src/features/connectors/host-messaging-port.ts",
  "src/renderer/src/features/connectors/messaging-connector.ts",
  "src/renderer/src/features/servers/server-capabilities.ts",
  "src/renderer/src/features/web-client/WebWorkspace.tsx",
  "src/renderer/src/features/web-client/web-messaging-connector.ts",
  "src/renderer/src/preview/mock-messaging.ts",
  "src/renderer/stories/SlackIntegrationPanel.stories.tsx",
];
const sourceManifest: Array<{ path: string; sha256: string }> = [];
let sourceDigest: string | null = null;
let sourceHead: string | null = null;
let nodeChildVersion: string | null = null;
let root = "";
let database: OpenBotDatabase | undefined;
let passed = false;
let failure: string | null = null;
let header: string | null = "chat:write,channels:manage";
let tokenValid = true;
let authCalls = 0;
const methods: string[] = [];
const credentials = new Map<string, Record<string, string>>();
const credentialPort: MessagingCredentials = {
  keys: () => [...credentials.keys()],
  status: (id) => (credentials.has(id) ? "saved" : "missing"),
  get: (id) => credentials.get(id) ?? null,
  set: (id, values) =>
    Effect.sync(() => {
      for (const value of Object.values(values)) {
        registerSecretValue(value);
        if (!secrets.includes(value)) secrets.push(value);
      }
      credentials.set(id, values);
    }),
  clear: (id) =>
    Effect.sync(() => {
      credentials.delete(id);
    }),
  retain: (ids) =>
    Effect.sync(() => {
      for (const id of credentials.keys()) if (!ids.has(id)) credentials.delete(id);
    }),
};
let service: MessagingService | undefined;
let stopLogTee: (() => void) | undefined;
let fixtureLog = "";

function containsSecret(value: string): boolean {
  return secrets.some((secret) =>
    [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)].some((form) => value.includes(form)),
  );
}

function redactedText(value: string): string {
  let result = redactText(value);
  for (const secret of secrets)
    for (const form of [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)])
      result = result.replaceAll(form, "[redacted]");
  if (root) result = result.replaceAll(root, "[fixture-root]");
  result = result.replaceAll(ROOT, "[worktree]");
  return result;
}

function safeText(value: string, limit = 8 * 1_024): string {
  const result = redactedText(value);
  return containsSecret(result) ? "The fixture redaction guard refused unsafe text." : result.slice(0, limit);
}

function failureText(error: unknown): string {
  return safeText(error instanceof Error ? error.message : "A fixture operation failed.");
}

async function waitWithin<A>(operation: Promise<A>, resource: string): Promise<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_done, fail) => {
        timer = setTimeout(
          () => fail(new Error(`${resource} did not finish within its fixture deadline.`)),
          FIXTURE_WAIT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function fixtureArtifactText(value: string): string {
  const encoded = redactedText(value);
  if (containsSecret(encoded)) throw new Error("The artifact redaction guard refused unsafe text.");
  if (new TextEncoder().encode(encoded).byteLength > 512 * 1_024)
    throw new Error("The fixture artifact exceeds its limit.");
  return encoded;
}

async function finalize(resource: string, operation: () => Promise<void>): Promise<void> {
  try {
    await waitWithin(Promise.resolve().then(operation), resource);
  } catch (error) {
    cleanupErrors.push({ resource, error: failureText(error) });
  }
}

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await waitWithin(
    new Promise<void>((done, fail) => {
      server.once("error", fail);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", fail);
        done();
      });
    }),
    "Fixture listener startup",
  );
  server.on("error", (error) => fixtureErrors.push(failureText(error)));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

try {
  sourceHead = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    timeout: 5_000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  nodeChildVersion = execFileSync("node", ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  for (const path of sourcePaths)
    sourceManifest.push({
      path,
      sha256: createHash("sha256")
        .update(await readFile(join(ROOT, path)))
        .digest("hex"),
    });
  sourceDigest = createHash("sha256").update(JSON.stringify(sourceManifest)).digest("hex");
  root = await mkdtemp(join(tmpdir(), "openbot-slack-access-e2e-"));
  stopLogTee = teeLogLines(["messaging", "messaging-status-posts", "openbot-database-schema"], (line) => {
    fixtureLog = `${fixtureLog}${safeText(line)}\n`.slice(-64 * 1_024);
  });
  database = new OpenBotDatabase(join(root, "state"));
  await runCauseEffect(database.initialize());
  const mailbox = new MailboxStore(join(root, "state"), join(root, "shared"), database);
  await runCauseEffect(mailbox.initialize());
  const threads = new MessagingThreads(database, mailbox, {
    schedule: () => {
      throw new Error("This fixture must not schedule work.");
    },
    queueChanged: () => undefined,
    busy: () => false,
    interrupt: () => Effect.void,
    forgetThread: () => Effect.void,
    // This metadata fixture registers no agents and cannot own an agent's main chat.
    ownChat: () => false,
  });
  const record = threads.store.ensureConnection("slack", "T_SCOPE_FIXTURE", "Scope fixture");
  await runCauseEffect(credentialPort.set(record.connectionId, { botToken: SECRET }));
  const slackOrigin = await listen(
    createServer((request, response) => {
      try {
        assert.equal(request.headers.authorization, `Bearer ${SECRET}`);
        const method = new URL(request.url ?? "/", "http://fixture.invalid").pathname.slice(5);
        methods.push(method);
        const reply = (value: FixtureSlackApiResponse) => {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify(value));
        };
        if (method === "auth.test") {
          authCalls += 1;
          // Method-accepted scopes are not evidence that this token has these grants.
          response.setHeader("x-accepted-oauth-scopes", "files:read");
          if (header !== null) response.setHeader("x-oauth-scopes", header);
          reply(
            tokenValid
              ? {
                  ok: true,
                  team_id: record.workspaceId,
                  user_id: "U_SCOPE_FIXTURE",
                  bot_id: "B_SCOPE_FIXTURE",
                  team: "Scope fixture",
                }
              : { ok: false, error: "invalid_auth" },
          );
        } else if (method === "bots.info") reply({ ok: true, bot: { app_id: "A_SCOPE_FIXTURE" } });
        else if (method === "conversations.list") reply({ ok: true, channels: [] });
        else if (method === "auth.revoke") reply({ ok: true, revoked: true });
        else {
          response.writeHead(400);
          response.end();
        }
      } catch (error) {
        fixtureErrors.push(failureText(error));
        if (!response.headersSent) response.writeHead(500);
        response.end();
      }
    }),
  );
  const driver = slackDriver({ origin: slackOrigin });
  service = new MessagingService({
    threads,
    credentials: credentialPort,
    agents: {
      listAgents: () => [],
      onEvent: () => () => undefined,
      respondToApproval: () => Effect.void,
      createAgentProfile: () => Effect.die(new Error("This fixture must not create an agent.")),
      createMemory: () => {
        throw new Error("This fixture must not create memory.");
      },
    },
    drivers: [
      {
        ...driver,
        createTransport: () => ({
          start: (sink) => sink.state("connected"),
          reconnect: () => undefined,
          stop: () => Effect.void,
        }),
      },
    ],
    downloadsRoot: join(root, "downloads"),
    slackOrigin,
  });
  await runCauseEffect(service.start());
  const connection = () => {
    assert.ok(service);
    const result = service.slackAccessOverview().connections[0];
    assert.ok(result);
    return result;
  };
  assert.equal(service.slackOverview().connections[0]?.state, "paused");
  assert.equal(connection().current, false);
  assert.equal(authCalls, 0);
  checks.push("A newly stored disabled workspace has no observation and makes no token check.");
  await runCauseEffect(service.setEnabled("slack", record.workspaceId, true));
  assert.deepEqual(connection().grantedScopes, ["chat:write", "channels:manage"]);
  assert.equal(connection().current, true);
  assert.ok(connection().verifiedAt);
  assert.equal(service.slackOverview().connections[0]?.missingScopes.includes("files:read"), true);
  assert.equal(connection().grantedScopes?.includes("files:read"), false);
  checks.push("Actual header grants include an unrequested permission and exclude requested permissions not granted.");

  const member: TeamMemberSummary = {
    id: "scope-admin",
    username: "scope",
    email: null,
    name: null,
    role: "admin",
    createdAt: new Date().toISOString(),
    disabled: false,
  };
  const target = service;
  const adminOrigin = await listen(
    createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://fixture.invalid");
      const codec = teamSideRouteCodec(url.pathname);
      const task: Promise<void> = routeSlackAccess(
        {
          request,
          response,
          method: request.method ?? "GET",
          url,
          protocol: requestProtocol(request),
          capabilities: requestCapabilities(request),
          member: { ...member, role: request.headers["x-fixture-role"] === "member" ? "member" : "admin" },
          token: SESSION_SECRET,
          sessionId: SESSION_SECRET,
          sessionExpiresAt: new Date().toISOString(),
          json: (status, value) => {
            response.writeHead(status, { "content-type": "application/json" });
            response.end(JSON.stringify(codec?.response(url.pathname, status, value) ?? value));
            return "handled";
          },
          empty: (status) => {
            response.writeHead(status);
            response.end();
            return "handled";
          },
        },
        target,
      )
        .then((outcome) => {
          if (outcome !== "handled") {
            response.writeHead(404);
            response.end();
          }
        })
        .catch((error) => {
          if (!(error instanceof HttpError)) fixtureErrors.push(failureText(error));
          if (response.headersSent) {
            response.destroy();
            return;
          }
          response.writeHead(error instanceof HttpError ? error.status : 500);
          response.end();
        })
        .finally(() => {
          tasks.delete(task);
        });
      tasks.add(task);
    }),
  );
  const adminCall = (role = "admin", capability = SLACK_ACCESS_CAPABILITY, body = "{}", method = "POST") =>
    fetch(`${adminOrigin}${SLACK_ACCESS_ROUTES.overview}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-fixture-role": role,
        [TEAM_PROTOCOL_VERSION_HEADER]: "7",
        [TEAM_CAPABILITIES_HEADER]: capability,
      },
      ...(method === "POST" ? { body } : {}),
      signal: AbortSignal.timeout(FIXTURE_WAIT_MS),
    });
  assert.equal((await adminCall("member")).status, 403);
  assert.equal((await adminCall("admin", "")).status, 400);
  assert.equal((await adminCall("admin", SLACK_ACCESS_CAPABILITY, "[]")).status, 400);
  assert.equal((await adminCall("admin", SLACK_ACCESS_CAPABILITY, "{}", "GET")).status, 404);
  const accepted = await adminCall();
  assert.equal(accepted.status, 200);
  const response = await accepted.json();
  assert.deepEqual(decodeSlackAccessOverviewReply(response), decodeHostSlackAccessOverview(response));
  assert.equal(containsSecret(JSON.stringify(response)), false);
  checks.push(
    "Real admin route accepts valid requests, denies members, and preserves wrong-method and capability behavior.",
  );

  let clientRequests = 0;
  const clientRequest: TeamApiRequest = async (method, path, decode, body) => {
    clientRequests += 1;
    const result = await fetch(`${adminOrigin}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        [TEAM_PROTOCOL_VERSION_HEADER]: "7",
        [TEAM_CAPABILITIES_HEADER]: SLACK_ACCESS_CAPABILITY,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FIXTURE_WAIT_MS),
    });
    if (!result.ok) throw new Error("The synthetic admin request failed.");
    return decode(await result.json());
  };
  assert.equal(await runCauseEffect(slackAccessOverview(clientRequest, false)), null);
  assert.equal(clientRequests, 0, "An old host must receive no scope request.");
  assert.deepEqual(await runCauseEffect(slackAccessOverview(clientRequest, true)), service.slackAccessOverview());
  assert.equal(clientRequests, 1);
  checks.push(
    "Shared Team client returns unsupported metadata without a request and reads negotiated metadata through the real route.",
  );

  // Slack documents these perspectives and unnamespaced names. This is a syntax round trip,
  // not a request for these scopes or a claim that all combinations can be authorized together.
  const legacyGrants = [
    "chat:write:user",
    "chat:write:bot",
    "chat:write:admin",
    "client",
    "admin",
    "read",
    "post",
    "tokens.basic",
  ];
  header = legacyGrants.join(",");
  await runCauseEffect(service.reconnect("slack", record.workspaceId, false));
  assert.deepEqual(connection().grantedScopes, legacyGrants);
  assert.equal(connection().current, true);
  assert.equal(service.slackOverview().connections[0]?.state, "connected");
  const legacyResponse = await adminCall();
  assert.equal(legacyResponse.status, 200);
  const legacyBody = await legacyResponse.json();
  assert.deepEqual(decodeSlackAccessOverviewReply(legacyBody).connections[0]?.grantedScopes, legacyGrants);
  assert.deepEqual(decodeHostSlackAccessOverview(legacyBody), service.slackAccessOverview());
  assert.deepEqual(await runCauseEffect(slackAccessOverview(clientRequest, true)), service.slackAccessOverview());
  checks.push(
    "Documented legacy perspectives and unnamespaced grants survive real Slack identification, Team wire and both IPC decoders.",
  );

  const codec = teamSideRouteCodec(SLACK_ACCESS_ROUTES.overview);
  assert.ok(codec);
  const valid = service.slackAccessOverview();
  assert.throws(() =>
    codec.response(SLACK_ACCESS_ROUTES.overview, 200, {
      connections: Array.from({ length: 33 }, () => valid.connections[0]),
    }),
  );
  assert.throws(() =>
    codec.response(SLACK_ACCESS_ROUTES.overview, 200, { connections: valid.connections, extra: "x".repeat(96 * 1024) }),
  );
  assert.throws(() => decodeSlackAccessOverviewReply({ connections: [{ ...connection(), grantedScopes: [SECRET] }] }));
  assert.throws(() => decodeHostSlackAccessOverview({ connections: [{ ...connection(), current: false }] }));
  for (const invalidScope of ["unknown", "chat:write:owner", "chat:write:user:admin", "chat:write:"]) {
    const invalid = { connections: [{ ...connection(), grantedScopes: [invalidScope] }] };
    assert.throws(() => codec.response(SLACK_ACCESS_ROUTES.overview, 200, invalid));
    assert.throws(() => decodeSlackAccessOverviewReply(invalid));
    assert.throws(() => decodeHostSlackAccessOverview(invalid));
  }
  assert.throws(() =>
    codec.response(SLACK_ACCESS_ROUTES.overview, 200, {
      connections: [{ ...connection(), grantedScopes: [`${"x".repeat(65)}:read`] }],
    }),
  );
  assert.throws(() =>
    codec.response(SLACK_ACCESS_ROUTES.overview, 200, {
      connections: [{ ...connection(), grantedScopes: Array.from({ length: 65 }, (_, index) => `scope${index}:read`) }],
    }),
  );
  checks.push(
    "Side codec and both IPC boundaries reject oversized lists, oversized responses, credential text and inconsistent observations.",
  );

  const oldCodec = CONNECTORS_CODECS.get(CONNECTORS_ROUTES.messagingOverview);
  assert.ok(oldCodec);
  const frozen = oldCodec.response(200, service.slackOverview());
  assert.equal(JSON.stringify(frozen).includes("grantedScopes"), false);
  assert.equal(JSON.stringify(frozen).includes("verifiedAt"), false);
  assert.equal(teamCapabilitiesForProtocol(6).includes(SLACK_ACCESS_CAPABILITY), false);
  assert.equal(teamCapabilitiesForProtocol(7).includes(SLACK_ACCESS_CAPABILITY), true);
  const fixtureRoot = resolve(import.meta.dirname, "../packages/contracts/src/team-protocol/fixtures/slack-access-v1");
  assert.deepEqual(
    codec.request(
      SLACK_ACCESS_ROUTES.overview,
      JSON.parse(await readFile(join(fixtureRoot, "client-request.json"), "utf8")),
    ),
    {},
  );
  const fixture = JSON.parse(await readFile(join(fixtureRoot, "host-response.json"), "utf8"));
  assert.deepEqual(codec.response(SLACK_ACCESS_ROUTES.overview, 200, fixture), fixture);
  checks.push(
    "Older clients keep the frozen connector response; protocol 6 omits the new capability and protocol 7 can negotiate it.",
  );

  const beforePause = authCalls;
  await runCauseEffect(service.setEnabled("slack", record.workspaceId, false));
  assert.deepEqual(connection(), {
    workspaceId: record.workspaceId,
    grantedScopes: null,
    verifiedAt: null,
    current: false,
  });
  assert.equal(authCalls, beforePause);
  header = "files:read";
  await runCauseEffect(service.setEnabled("slack", record.workspaceId, true));
  assert.deepEqual(connection().grantedScopes, ["files:read"]);
  assert.equal(authCalls, beforePause + 1);
  checks.push("Pause clears the live observation without an API call; resume verifies the current token again.");

  for (const [name, value] of [
    ["missing header", null],
    ["invalid scope text", `chat:write, ${INVALID_HEADER_SECRET}`],
    ["oversized scope name", `${"a".repeat(65)}:read`],
    ["too many scopes", Array.from({ length: 65 }, (_, index) => `scope${index}:read`).join(",")],
    ["oversized header", Array.from({ length: 40 }, (_, index) => `scope${index}:${"r".repeat(56)}`).join(",")],
  ] as const) {
    header = value;
    await runCauseEffect(service.reconnect("slack", record.workspaceId, false));
    assert.equal(connection().current, false, name);
    assert.equal(connection().grantedScopes, null, name);
    assert.equal(service.slackOverview().connections[0]?.state, "connected", name);
    if (name === "invalid scope text") {
      for (const invalid of ["unknown", "chat:write:owner", "chat:write:user:admin"]) {
        header = invalid;
        await runCauseEffect(service.reconnect("slack", record.workspaceId, false));
        assert.equal(connection().current, false, invalid);
        assert.equal(connection().grantedScopes, null, invalid);
        assert.equal(service.slackOverview().connections[0]?.state, "connected", invalid);
      }
    }
    checks.push(`${name} gives unknown metadata and preserves the healthy connection.`);
  }
  header = "";
  await runCauseEffect(service.reconnect("slack", record.workspaceId, false));
  assert.deepEqual(connection().grantedScopes, []);
  assert.equal(connection().current, true);
  checks.push("An explicit empty header is a verified empty scope set.");

  tokenValid = false;
  header = "chat:write";
  await runCauseEffect(service.reconnect("slack", record.workspaceId, false));
  assert.equal(service.slackOverview().connections[0]?.state, "invalid_token");
  assert.equal(connection().current, false);
  assert.equal(connection().verifiedAt, null);
  checks.push("Failed auth.test never exposes a header as verified grants.");
  tokenValid = true;
  await runCauseEffect(service.reconnect("slack", record.workspaceId, false));
  await runCauseEffect(service.disconnectSlackWorkspace(record.workspaceId));
  assert.deepEqual(service.slackAccessOverview(), { connections: [] });
  assert.ok(threads.store.connection(record.connectionId), "Disconnect must keep the stored workspace identity.");
  checks.push("Disconnect removes scope metadata and keeps the existing workspace record.");
  assert.ok(
    methods.every((method) => ["auth.test", "bots.info", "conversations.list", "auth.revoke"].includes(method)),
  );
  assert.deepEqual(fixtureErrors, []);
  assert.equal(checks.length, EXPECTED_CHECKS);
  passed = true;
} catch (error) {
  failure = failureText(error);
} finally {
  await finalize("Messaging service", () => runCauseEffect(service?.stop() ?? Effect.void));
  await finalize("Team request drain", async () => {
    await Promise.all([...tasks]);
  });
  for (const [index, server] of servers.entries()) {
    await finalize(`Fixture connections ${index}`, async () => {
      server.closeAllConnections();
    });
    await finalize(
      `Fixture listener ${index}`,
      () =>
        new Promise<void>((done, fail) => {
          server.close((error) => {
            // Bun can complete closeAllConnections before close is called.
            if (error && !("code" in error && error.code === "ERR_SERVER_NOT_RUNNING" && !server.listening))
              fail(error);
            else done();
          });
        }),
    );
  }
  await finalize("Database", async () => {
    database?.close();
  });
  await finalize("Synthetic credentials", async () => {
    credentials.clear();
  });
  await finalize("Log tee", async () => {
    stopLogTee?.();
  });
  if (root) await finalize("Temporary files", () => rm(root, { recursive: true, force: true }));
  const cleanupComplete = cleanupErrors.length === 0;
  passed = passed && cleanupComplete && fixtureErrors.length === 0;
  try {
    await waitWithin(mkdir(OUT, { recursive: true }), "Artifact directory");
  } catch (error) {
    artifactErrors.push(failureText(error));
  }
  let logWritten = false;
  try {
    const log = fixtureArtifactText(fixtureLog);
    await waitWithin(writeFile(join(OUT, "fixture.log"), log), "Fixture log");
    logWritten = true;
  } catch (error) {
    artifactErrors.push(failureText(error));
  }
  passed = passed && artifactErrors.length === 0;
  const report = {
    passed,
    runNonce,
    sourceHead,
    sourceManifest,
    sourceDigest,
    runtime: {
      javascript: process.versions.bun ? "Bun" : "Node",
      version: process.versions.bun ?? process.version,
      nodeCompatibilityVersion: process.version,
      nodeChildVersion,
      platform: process.platform,
      architecture: process.arch,
    },
    expectedChecks: EXPECTED_CHECKS,
    checks,
    methods,
    fixtureErrors,
    failure,
    cleanupComplete,
    cleanupErrors,
    artifactErrors,
    logWritten,
    limitations: [
      "Signal transport and account authentication context are synthetic.",
      "Real Slack identification, MessagingService, SQLite, Team route, shared client and result decoders are used on loopback.",
      "Legacy grant combinations are syntax fixtures, not a requested permission set or a real Slack authorization.",
      "No account, external Slack request, browser, visual UI, native mobile or paid provider is used.",
      "This feature shows verified grants. It adds no Slack action or member access policy.",
    ],
  };
  let reportWritten = false;
  try {
    const encoded = fixtureArtifactText(JSON.stringify(report, null, 2));
    await waitWithin(writeFile(join(OUT, "report.json"), `${encoded}\n`), "Fixture report");
    reportWritten = true;
  } catch (error) {
    artifactErrors.push(failureText(error));
    passed = false;
  }
  if (!passed) {
    process.exitCode = 1;
    // Machine-readable: bounded redacted diagnostics replace raw assertion output.
    process.stderr.write(
      `${safeText(JSON.stringify({ runNonce, failure, fixtureErrors, cleanupErrors, artifactErrors, cleanupComplete }), 64 * 1_024)}\n`,
    );
  }
  // Machine-readable: the nonce and digest identify this isolated run.
  process.stdout.write(
    `${safeText(JSON.stringify({ passed, runNonce, sourceDigest, checks: checks.length, expectedChecks: EXPECTED_CHECKS, cleanupComplete, logWritten, reportWritten }), 64 * 1_024)}\n`,
  );
}
