// Real member access workflows with throwaway TeamStore and Wrangler-local SQLite-backed D1.
// Membership requests use loopback services. No account login, remote D1, paid provider or visible app is used.
// Startup network traffic from Wrangler, Storybook and Chromium is not measured.
// Run: bun scripts/member-access-e2e.ts
// Artifact: .openbot-build/member-access-e2e/report.json
import assert from "node:assert/strict";
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DEFAULT_TEAM_MEMBER_LIMIT } from "@openbot/contracts/input-limits";
import type { ServerCompatibility, UpdateTeamMemberInput } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { TEAM_CURRENT_CAPABILITIES } from "@openbot/contracts/team-protocol/current";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_V1_WEBSOCKET,
  TEAM_PROTOCOL_VERSION_HEADER,
} from "@openbot/contracts/team-protocol/v1";
import { RemoteTeamDirectoryClient as DirectoryClient, runTeamEffect } from "@openbot/team-client";
import { Effect, Schema } from "effect";
import { type Browser, chromium } from "playwright-core";
import WebSocket from "ws";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
import { RemoteServerClient } from "../src/main/remote-server-client";
import type { StoredRemoteServerView } from "../src/main/remote-server-store";
import { RemoteWorkflowError } from "../src/main/remote-service-effects";
import { decodeTeamPresenceSnapshot } from "../src/main/remote-team-decoding";
import { RemoteTeamDirectory } from "../src/main/remote-team-directory";
import type { TeamApiBrowser } from "../src/main/team-api/dependencies";
import { TeamApiServer } from "../src/main/team-api-server";
import { TeamStore } from "../src/main/team-store";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build/member-access-e2e");
const RUN_WAIT_MS = 10_000;
const STARTUP_WAIT_MS = 60_000;
const BROWSER_WAIT_MS = 30_000;
const runNonce = randomUUID();
const root = await mkdtemp(join(tmpdir(), "openbot-member-access-e2e-"));
const checks: Array<{ area: "local" | "cloud" | "controllers"; name: string }> = [];
const children: ChildProcess[] = [];
const childLogWrites: Array<Promise<string | null>> = [];
const sockets: WebSocket[] = [];
const secretValues: string[] = ["synthetic-password-123"];
let service: AgentService | undefined;
let agents: AgentStore | undefined;
let host: TeamApiServer | undefined;
let bridge: Server | undefined;
let browser: Browser | undefined;
let browserVersion: string | null = null;
let sourceHead: string | null = null;
let nodeChildVersion: string | null = null;
const cleanupErrors: Array<{ resource: string; error: string }> = [];
// Fixed source inventory: the same files are hashed in dirty development and clean CI checkouts.
// Include the real services, helper imports and every migration this fixture applies.
const sourcePaths = [
  "apps/auth-api/migrations/0001_google_auth.sql",
  "apps/auth-api/migrations/0002_email_login_codes.sql",
  "apps/auth-api/migrations/0003_remove_google_oauth.sql",
  "apps/auth-api/migrations/0004_team_auth_tickets.sql",
  "apps/auth-api/migrations/0005_team_tunnels.sql",
  "apps/auth-api/migrations/0006_one_team_server_per_user.sql",
  "apps/auth-api/migrations/0007_team_host_machine_tokens.sql",
  "apps/auth-api/migrations/0008_remove_team_tunnel_vnc.sql",
  "apps/auth-api/migrations/0009_skills_marketplace.sql",
  "apps/auth-api/migrations/0010_agents_marketplace.sql",
  "apps/auth-api/migrations/0011_marketplace_catalog_indexes.sql",
  "apps/auth-api/migrations/0012_remote_control_plane.sql",
  "apps/auth-api/migrations/0013_remote_session_lifecycle.sql",
  "apps/auth-api/migrations/0014_mobile_auth_sessions.sql",
  "apps/auth-api/migrations/0015_email_challenge_delivery_state.sql",
  "apps/auth-api/migrations/0016_hosted_sites.sql",
  "apps/auth-api/migrations/0017_mobile_session_security.sql",
  "apps/auth-api/migrations/0018_remote_device_sessions.sql",
  "apps/auth-api/migrations/0019_marketplace_presentation.sql",
  "apps/auth-api/migrations/0020_permanent_invites.sql",
  "apps/auth-api/migrations/0021_agent_templates.sql",
  "apps/auth-api/migrations/0022_billing.sql",
  "apps/auth-api/migrations/0023_hosted_servers.sql",
  "apps/auth-api/migrations/0024_hosted_site_servers.sql",
  "apps/auth-api/migrations/0025_slack_workspace_routes.sql",
  "apps/auth-api/migrations/0026_discord_guild_routes.sql",
  "apps/auth-api/migrations/0027_webhook_routes.sql",
  "apps/auth-api/migrations/0028_hosted_server_lifecycle.sql",
  "apps/auth-api/migrations/0029_telegram_chat_routes.sql",
  "apps/auth-api/migrations/0030_sales_analytics.sql",
  "apps/auth-api/migrations/0031_billing_sales.sql",
  "apps/auth-api/migrations/0032_mobile_connect_links.sql",
  "apps/auth-api/migrations/0033_mobile_session_connect_link.sql",
  "apps/auth-api/migrations/0034_account_attribution.sql",
  "apps/auth-api/migrations/0034_server_claims.sql",
  "apps/auth-api/src/server/billing-entitlement.ts",
  "apps/auth-api/src/server/remote-control-plane.ts",
  "apps/mobile/changelog.d/codex-member-access-actions.md",
  "apps/mobile/src/features/servers/screens/server-members-screen.tsx",
  "changelog.d/codex-member-access-actions.md",
  "docs/architecture/member-access.md",
  "packages/i18n/src/messages/de/mobile/server.ts",
  "packages/i18n/src/messages/de/server.ts",
  "packages/i18n/src/messages/en/mobile/server.ts",
  "packages/i18n/src/messages/en/server.ts",
  "packages/i18n/src/messages/es/mobile/server.ts",
  "packages/i18n/src/messages/es/server.ts",
  "packages/i18n/src/messages/fr/mobile/server.ts",
  "packages/i18n/src/messages/fr/server.ts",
  "packages/i18n/src/messages/it/mobile/server.ts",
  "packages/i18n/src/messages/it/server.ts",
  "packages/i18n/src/messages/ja/mobile/server.ts",
  "packages/i18n/src/messages/ja/server.ts",
  "packages/i18n/src/messages/pl/mobile/server.ts",
  "packages/i18n/src/messages/pl/server.ts",
  "packages/i18n/src/messages/pt/mobile/server.ts",
  "packages/i18n/src/messages/pt/server.ts",
  "packages/i18n/src/messages/ru/mobile/server.ts",
  "packages/i18n/src/messages/ru/server.ts",
  "packages/i18n/src/messages/tr/mobile/server.ts",
  "packages/i18n/src/messages/tr/server.ts",
  "packages/team-client/src/remote-directory.ts",
  "scripts/member-access-e2e.ts",
  "scripts/member-access-worker.mjs",
  "src/backend/agent-service.ts",
  "src/backend/agent-store.ts",
  "src/backend/mailbox-store.ts",
  "src/backend/openbot-database.ts",
  "src/backend/sidebar-layout-store.ts",
  "src/main/ipc/agent-template-handlers.ts",
  "src/main/ipc/agent-template-inputs.ts",
  "src/main/ipc/mcp-server-handlers.ts",
  "src/main/ipc/provider-handlers.ts",
  "src/main/ipc/provider-inputs.ts",
  "src/main/mcp-tool-runtime-preparation.ts",
  "src/main/remote-server-client.ts",
  "src/main/remote-team-directory.ts",
  "src/main/team-api-server.ts",
  "src/main/team-api/dependencies.ts",
  "src/main/team-api/route-agent-install.ts",
  "src/main/team-api/route-agent-publish.ts",
  "src/main/team-api/route-mcp.ts",
  "src/main/team-api/route-providers.ts",
  "src/main/team-api/route-team.ts",
  "src/main/team-store.ts",
  "src/renderer/src/features/servers/ServerMembersSection.tsx",
  "src/renderer/src/features/servers/server-settings.tsx",
  "src/renderer/src/features/web-client/web-runtime.ts",
  "src/renderer/src/features/web-client/web-server-settings.ts",
  "src/renderer/src/preview/mock-team.ts",
  "src/renderer/stories/ServerSettingsModal.stories.tsx",
  "src/renderer/stories/member-access-controller-fixture.tsx",
];
const sourceHash = createHash("sha256");
for (const path of sourcePaths) {
  sourceHash.update(path);
  sourceHash.update(await readFile(join(ROOT, path)));
}
const sourceDigest = sourceHash.digest("hex");
let passed = false;
let failure: string | null = null;

function record(area: "local" | "cloud" | "controllers", name: string): void {
  checks.push({ area, name });
  // Machine-readable: progress contains names only, never credentials or private state.
  process.stdout.write(`${JSON.stringify({ area, check: name })}\n`);
}
function unexpected(): never {
  throw new Error("This fixture must not use a browser host or external integration.");
}

function redact(value: string, limit = 64 * 1024): string {
  return secretValues
    .reduce((current, secret) => current.replaceAll(secret, "[redacted]"), value)
    .split("\n")
    .filter((line) => !/REMOTE_TICKET_(?:PRIVATE_JWK|PUBLIC_JWKS)|FIXTURE_KEY/u.test(line))
    .join("\n")
    .replace(/"(?:d|x|y)"\s*:\s*"[^"]+"/gu, '"key":"[redacted]"')
    .replace(/Bearer\s+[^\s"']+/gu, "Bearer [redacted]")
    .replaceAll(root, "[fixture-root]")
    .replaceAll(ROOT, "[worktree]")
    .slice(-limit);
}

function failureText(error: unknown): string {
  return redact(error instanceof Error ? error.message : String(error), 8 * 1024) || "Member access check failed.";
}

async function waitWithin<A>(operation: Promise<A>, timeoutMs: number, name: string): Promise<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_done, fail) => {
    timer = setTimeout(() => fail(new Error(`${name} did not finish within its fixture deadline.`)), timeoutMs);
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function finalize(resource: string, operation: () => Promise<void>): Promise<void> {
  try {
    await waitWithin(Promise.resolve().then(operation), RUN_WAIT_MS, resource);
  } catch (error) {
    cleanupErrors.push({ resource, error: failureText(error) });
  }
}
const browserHost = {
  listTabs: () => [],
  getControlState: () => ({ sessions: [] }),
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  endTakeover: () => {},
  close: () => Effect.void,
  beginTakeover: unexpected,
  resolveUploadTarget: unexpected,
  handleDynamicTool: unexpected,
  open: unexpected,
  activate: unexpected,
  navigate: unexpected,
  reload: unexpected,
  capturePreview: unexpected,
  setVisible: unexpected,
  getDisplayState: unexpected,
  loadUrl: unexpected,
  isPrivate: () => false,
  startView: unexpected,
  dispatchViewInput: unexpected,
  copyViewSelection: unexpected,
} satisfies AgentBrowserHost & TeamApiBrowser;

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((done, fail) => server.close((error) => (error ? fail(error) : done())));
  return address.port;
}
function childEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true", BROWSER: "none" };
  delete env.CLOUDFLARE_API_TOKEN;
  delete env.CLOUDFLARE_API_KEY;
  delete env.CLOUDFLARE_ACCOUNT_ID;
  delete env.DOTENV_PRIVATE_KEY_DEV;
  delete env.DOTENV_PRIVATE_KEY_PRODUCTION;
  delete env.OP_SERVICE_ACCOUNT_TOKEN;
  return env;
}
function startChild(name: string, command: string, args: string[]): ChildProcess {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: childEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  children.push(child);
  let output = "";
  const capture = (chunk: Buffer) => {
    output = `${output}${chunk.toString()}`.slice(-64 * 1024);
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  child.on("error", () => undefined);
  childLogWrites.push(
    new Promise<string | null>((resolveLog) => {
      child.once("close", () => {
        // Keep bounded diagnostics without fixture credentials, key material or HTTP authorization.
        writeFile(join(OUT, `${name}.log`), redact(output)).then(
          () => resolveLog(null),
          () => resolveLog(`Could not write ${name}.log.`),
        );
      });
    }),
  );
  return child;
}
async function finishChild(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  const stopped = once(child, "close").then(() => undefined);
  const signal = (value: NodeJS.Signals) => {
    try {
      process.kill(process.platform === "win32" ? pid : -pid, value);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
    }
  };
  signal("SIGTERM");
  let signalFailure: string | null = null;
  const timeout = setTimeout(() => {
    try {
      signal("SIGKILL");
    } catch (error) {
      signalFailure = failureText(error);
    }
  }, RUN_WAIT_MS / 2);
  try {
    await waitWithin(stopped, RUN_WAIT_MS, "Owned child shutdown");
    if (signalFailure) throw new Error(signalFailure);
  } finally {
    clearTimeout(timeout);
  }
}
async function waitReady(origin: string, path: string, child: ChildProcess, headers?: HeadersInit): Promise<void> {
  const deadline = Date.now() + STARTUP_WAIT_MS;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, "The owned fixture process exited before it was ready.");
    try {
      if ((await fetch(`${origin}${path}`, { headers, signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* Wait for the listener, not a fixed startup delay. */
    }
    await new Promise<void>((done) => setTimeout(done, 100));
  }
  throw new Error("The local fixture did not become ready within its deadline.");
}
async function completed(child: ChildProcess, name: string): Promise<void> {
  const [code] = await waitWithin(once(child, "close"), STARTUP_WAIT_MS, name);
  assert.equal(code, 0, `${name} failed. Read its bounded local log.`);
}
const SeedSchema = Schema.Struct({
  hostId: Schema.String,
  joined: Schema.Struct({
    target: Schema.Struct({ membershipId: Schema.String }),
    ordinary: Schema.Struct({ membershipId: Schema.String }),
  }),
});
const EvidenceSchema = Schema.Struct({
  memberships: Schema.Array(
    Schema.Struct({
      membership_id: Schema.String,
      user_id: Schema.String,
      role: Schema.Literals(["owner", "admin", "member"]),
      status: Schema.Literals(["active", "revoked"]),
      created_at: Schema.Number,
    }),
  ),
  sessions: Schema.Array(
    Schema.Struct({ session_id: Schema.String, user_id: Schema.String, ended_at: Schema.NullOr(Schema.Number) }),
  ),
  events: Schema.Array(
    Schema.Struct({
      type: Schema.String,
      userId: Schema.optional(Schema.String),
      sessionId: Schema.optional(Schema.String),
    }),
  ),
  hosts: Schema.Array(Schema.Struct({ auth_epoch: Schema.Number })),
});
const SessionSchema = Schema.Struct({ sessionId: Schema.String, hostId: Schema.String, expiresAt: Schema.Number });
const ValidSchema = Schema.Struct({ valid: Schema.Boolean });
const ReceiptSchema = Schema.Struct({
  surface: Schema.Literals(["desktop", "web"]),
  operation: Schema.Literals(["disable", "restore", "retry", "refused"]),
  memberId: Schema.String,
  disabled: Schema.Boolean,
  loadError: Schema.Boolean,
  refused: Schema.Boolean,
});

try {
  await mkdir(OUT, { recursive: true });
  sourceHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  nodeChildVersion = execFileSync("node", ["--version"], { encoding: "utf8" }).trim();
  const state = join(root, "host");
  agents = new AgentStore(state, join(root, "home"));
  await runCauseEffect(agents.initialize());
  const mailbox = new MailboxStore(state, agents.sharedRoot, agents.database);
  await runCauseEffect(mailbox.initialize());
  const sidebar = new SidebarLayoutStore(join(state, "sidebar.json"));
  await runCauseEffect(sidebar.initialize());
  service = new AgentService({ store: agents, mailbox, browser: browserHost, sidebarLayout: sidebar });
  const teamPath = join(state, "team.json");
  let team = new TeamStore(teamPath);
  await runCauseEffect(team.initialize());
  const identity = await runCauseEffect(
    team.configure("Member access fixture", "fixture-owner", "synthetic-password-123"),
  );
  const owner = await runCauseEffect(team.login("fixture-owner", "synthetic-password-123"));
  async function addMember(username: string, role: "admin" | "member" = "member") {
    const invite = await runCauseEffect(team.createInvite(role));
    secretValues.push(invite.token);
    const result = await runCauseEffect(team.acceptInvite(invite.token, username, "synthetic-password-123"));
    secretValues.push(result.sessionToken);
    return result;
  }
  const target = await addMember("fixture-target", "admin");
  secretValues.push(owner.sessionToken, target.sessionToken);
  const savedTarget = target.member;
  host = new TeamApiServer({
    store: team,
    agents: service,
    mailbox,
    browser: browserHost,
    sidebarLayout: sidebar,
    appVersion: "0.0.0",
  });
  let port = await runCauseEffect(host.start());
  let localOrigin = `http://127.0.0.1:${port}`;
  let ownerToken = owner.sessionToken;
  let compatibility: ServerCompatibility | null = null;
  const serverView: StoredRemoteServerView = {
    id: identity.serverId,
    name: identity.serverName,
    apiUrl: localOrigin,
    publicKey: identity.publicKey,
    fingerprint: identity.fingerprint,
    username: "fixture-owner",
    role: "owner",
    encryptedToken: "unused",
    remoteDesktopAvailable: false,
  };
  const localClient = new RemoteServerClient({
    appVersion: "0.0.0",
    servers: { require: () => ({ ...serverView, apiUrl: localOrigin }), token: () => ownerToken },
    connections: {
      compatibilityFor: () => compatibility,
      issueFor: () => null,
      setCompatibility: (_id, value) => {
        compatibility = value;
      },
      clearStaleIssue: () => {},
      reportError: () => {},
    },
    transport: null,
  });
  const localDirectory = new RemoteTeamDirectory({
    servers: { require: () => serverView },
    request: (serverId, path, decoder, init) => localClient.request(serverId, path, decoder, init),
    transport: null,
    sendInviteEmail: unexpected,
  });
  const headers = (token: string) => ({
    Authorization: `Bearer ${token}`,
    [TEAM_APP_VERSION_HEADER]: "0.0.0",
    [TEAM_PROTOCOL_VERSION_HEADER]: "7",
    [TEAM_CAPABILITIES_HEADER]: TEAM_CURRENT_CAPABILITIES.join(","),
  });
  const socket = new WebSocket(
    `${localOrigin.replace("http", "ws")}${TEAM_API_ROUTES.events}`,
    [TEAM_PROTOCOL_V1_WEBSOCKET, `openbot-token.${target.sessionToken}`],
    { headers: headers(target.sessionToken) },
  );
  sockets.push(socket);
  await waitWithin(once(socket, "open"), RUN_WAIT_MS, "Member event connection");
  const ended = once(socket, "close");
  const disabled = await runCauseEffect(
    localDirectory.updateMember(identity.serverId, { memberId: target.member.id, disabled: true }),
  );
  await waitWithin(ended, RUN_WAIT_MS, "Revoked member event connection");
  assert.deepEqual({ ...disabled, disabled: false }, savedTarget);
  assert.equal(team.authenticate(target.sessionToken), null);
  assert.equal(
    (await fetch(`${localOrigin}${TEAM_API_ROUTES.me}`, { headers: headers(target.sessionToken) })).status,
    401,
  );
  record(
    "local",
    "disable keeps member identity and profile, revokes credentials and closes the existing event socket",
  );
  await runCauseEffect(host.stop());
  team = new TeamStore(teamPath);
  await runCauseEffect(team.initialize());
  assert.deepEqual(
    team.listMembers().find((member) => member.id === savedTarget.id),
    disabled,
  );
  host = new TeamApiServer({
    store: team,
    agents: service,
    mailbox,
    browser: browserHost,
    sidebarLayout: sidebar,
    appVersion: "0.0.0",
  });
  port = await runCauseEffect(host.start());
  localOrigin = `http://127.0.0.1:${port}`;
  ownerToken = (await runCauseEffect(team.login("fixture-owner", "synthetic-password-123"))).sessionToken;
  secretValues.push(ownerToken);
  const restored = await runCauseEffect(
    localDirectory.updateMember(identity.serverId, { memberId: savedTarget.id, disabled: false }),
  );
  assert.deepEqual(restored, savedTarget);
  assert.equal(team.authenticate(target.sessionToken), null);
  const freshLogin = await runCauseEffect(team.login("fixture-target", "synthetic-password-123"));
  secretValues.push(freshLogin.sessionToken);
  assert.equal(freshLogin.member.id, savedTarget.id);
  record("local", "restart retains disabled state; restore retains the same row and requires fresh credentials");
  await runCauseEffect(localDirectory.updateMember(identity.serverId, { memberId: savedTarget.id, disabled: true }));
  const seatA = await addMember("fixture-seat-a");
  const seatB = await addMember("fixture-seat-b");
  assert.equal(team.listMembers().filter((member) => !member.disabled).length, DEFAULT_TEAM_MEMBER_LIMIT);
  await assert.rejects(
    runCauseEffect(localDirectory.updateMember(identity.serverId, { memberId: savedTarget.id, disabled: false })),
  );
  assert.equal(team.listMembers().find((member) => member.id === savedTarget.id)?.disabled, true);
  await runCauseEffect(localDirectory.updateMember(identity.serverId, { memberId: seatB.member.id, disabled: true }));
  await runCauseEffect(localDirectory.updateMember(identity.serverId, { memberId: savedTarget.id, disabled: false }));
  record("local", "full seats refuse restore without losing the inactive row; a freed seat permits the reverse action");
  const refusedMember = await fetch(`${localOrigin}${TEAM_API_ROUTES.team.member(savedTarget.id)}`, {
    method: "PATCH",
    headers: { ...headers(seatA.sessionToken), "Content-Type": "application/json" },
    body: JSON.stringify({ disabled: true }),
  });
  assert.equal(refusedMember.status, 403);
  await assert.rejects(
    runCauseEffect(localDirectory.updateMember(identity.serverId, { memberId: owner.member.id, disabled: true })),
  );
  assert.equal(team.listMembers().find((member) => member.id === savedTarget.id)?.disabled, false);
  record("local", "current HTTP authorization refuses an ordinary member and protects the owner");

  const fixtureKey = randomUUID();
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const privateJwk = privateKey.export({ format: "jwk" });
  assert.ok(privateJwk.d);
  secretValues.push(fixtureKey, privateJwk.d, JSON.stringify(privateJwk));
  const publicJwk = { ...publicKey.export({ format: "jwk" }), kid: "member-access-fixture", alg: "ES256", use: "sig" };
  const workerPort = await freePort();
  const workerOrigin = `http://127.0.0.1:${workerPort}`;
  const persist = join(root, "wrangler-state");
  const config = join(root, "wrangler.json");
  await writeFile(
    config,
    JSON.stringify({
      name: "openbot-member-access-e2e",
      main: join(ROOT, "scripts/member-access-worker.mjs"),
      compatibility_date: "2026-08-18",
      compatibility_flags: ["nodejs_compat"],
      workers_dev: false,
      preview_urls: false,
      d1_databases: [
        { binding: "DB", database_name: "member-access-e2e", database_id: "00000000-0000-0000-0000-000000000001" },
      ],
      vars: {
        FIXTURE_KEY: fixtureKey,
        REMOTE_TICKET_PRIVATE_JWK: JSON.stringify(privateJwk),
        REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({ keys: [publicJwk] }),
      },
    }),
  );
  const migrationNames = (await readdir(join(ROOT, "apps/auth-api/migrations")))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const migrationFile = join(root, "actual-migrations.sql");
  const migrationSql: string[] = [];
  for (const name of migrationNames)
    migrationSql.push(await readFile(join(ROOT, "apps/auth-api/migrations", name), "utf8"));
  await writeFile(migrationFile, migrationSql.join("\n"));
  const wrangler = join(ROOT, "node_modules/wrangler/bin/wrangler.js");
  await completed(
    startChild("cloud-migrations", "node", [
      wrangler,
      "d1",
      "execute",
      "member-access-e2e",
      "--config",
      config,
      "--local",
      "--persist-to",
      persist,
      "--file",
      migrationFile,
      "--yes",
    ]),
    "The actual auth-api migrations",
  );
  const worker = startChild("cloud-worker", "node", [
    wrangler,
    "dev",
    "--config",
    config,
    "--local",
    "--persist-to",
    persist,
    "--ip",
    "127.0.0.1",
    "--port",
    String(workerPort),
    "--inspector-port",
    String(await freePort()),
    "--show-interactive-dev-session=false",
    "--log-level",
    "error",
  ]);
  const fixtureHeaders = (actor = "owner") => ({
    "X-Fixture-Key": fixtureKey,
    Authorization: `Bearer fixture-account-${actor}`,
  });
  await waitReady(workerOrigin, "/fixture/ready", worker, fixtureHeaders());
  async function workerRequest(path: string, init: RequestInit = {}, actor = "owner"): Promise<Response> {
    return fetch(`${workerOrigin}${path}`, {
      ...init,
      headers: { ...fixtureHeaders(actor), ...(init.body ? { "Content-Type": "application/json" } : {}) },
      signal: AbortSignal.timeout(10_000),
    });
  }
  const seedResponse = await workerRequest("/fixture/seed", { method: "POST" });
  assert.equal(seedResponse.status, 200);
  const seed = Schema.decodeUnknownSync(SeedSchema)(await seedResponse.json());
  const hostId = seed.hostId;
  const cloudTargetId = seed.joined.target.membershipId;
  let cloudWrites = 0;
  let cloudReads = 0;
  let armCloudReadFailure = false;
  let failCloudRead = false;
  const patchBodies: Array<{ role: string; reactivate: boolean }> = [];
  const directory = (actor: string) =>
    new DirectoryClient({
      apiUrl: workerOrigin,
      token: `fixture-account-${actor}`,
      fetch: async (input, init) => {
        if (init?.method === "PATCH" || init?.method === "DELETE") {
          cloudWrites += 1;
          if (armCloudReadFailure) {
            failCloudRead = true;
            armCloudReadFailure = false;
          }
        }
        if ((!init?.method || init.method === "GET") && String(input).endsWith("/members/")) {
          cloudReads += 1;
          if (failCloudRead) {
            failCloudRead = false;
            return new Response(JSON.stringify({ error: "Fixture roster read failed." }), { status: 503 });
          }
        }
        if (init?.method === "PATCH" && typeof init.body === "string") {
          const body = Schema.decodeUnknownSync(
            Schema.Struct({ role: Schema.String, reactivate: Schema.optional(Schema.Boolean) }),
          )(JSON.parse(init.body));
          patchBodies.push({ role: body.role, reactivate: body.reactivate ?? false });
        }
        return fetch(input, {
          ...init,
          headers: { ...Object.fromEntries(new Headers(init?.headers)), "X-Fixture-Key": fixtureKey },
        });
      },
    });
  const cloud = directory("owner");
  const cloudBefore = (await runTeamEffect(cloud.listMembers(hostId))).find(
    (member) => member.membershipId === cloudTargetId,
  );
  assert.ok(cloudBefore);
  const sessionResponse = await workerRequest("/fixture/start-session", { method: "POST" }, "target");
  assert.equal(sessionResponse.status, 200);
  const session = Schema.decodeUnknownSync(SessionSchema)(await sessionResponse.json());
  const evidence = async () =>
    Schema.decodeUnknownSync(EvidenceSchema)(await (await workerRequest("/fixture/evidence")).json());
  const initialEvidence = await evidence();
  const initialEpoch = initialEvidence.hosts[0]?.auth_epoch;
  assert.ok(initialEpoch);
  const claims = {
    sessionId: session.sessionId,
    hostId,
    userId: "target",
    membershipId: cloudTargetId,
    role: "admin",
    authEpoch: initialEpoch,
    sessionExpiresAt: Math.floor(session.expiresAt / 1000),
  };
  const validate = async () =>
    Schema.decodeUnknownSync(ValidSchema)(
      await (await workerRequest("/fixture/validate-resume", { method: "POST", body: JSON.stringify(claims) })).json(),
    ).valid;
  assert.equal(await validate(), true);
  await runTeamEffect(cloud.leaveHost(hostId, cloudTargetId));
  const revoked = (await runTeamEffect(cloud.listMembers(hostId))).find(
    (member) => member.membershipId === cloudTargetId,
  );
  assert.deepEqual(revoked, { ...cloudBefore, status: "revoked" });
  assert.equal((await runTeamEffect(directory("target").listHosts())).length, 0);
  assert.equal(await validate(), false);
  assert.equal((await workerRequest("/fixture/start-session", { method: "POST" }, "target")).status, 403);
  const revokedEvidence = await evidence();
  assert.ok(revokedEvidence.sessions.find((item) => item.session_id === session.sessionId)?.ended_at);
  assert.ok(
    revokedEvidence.events.some((event) => event.type === "account-servers-changed" && event.userId === "target"),
  );
  assert.ok(
    revokedEvidence.events.some(
      (event) => event.type === "remote-session-ended" && event.sessionId === session.sessionId,
    ),
  );
  record(
    "cloud",
    "real D1 revoke retains membership/profile, hides the host, ends its logical session and queues target auth events",
  );
  await runTeamEffect(cloud.updateMember(hostId, cloudTargetId, "admin", true));
  assert.deepEqual(
    (await runTeamEffect(cloud.listMembers(hostId))).find((member) => member.membershipId === cloudTargetId),
    cloudBefore,
  );
  assert.equal((await runTeamEffect(directory("target").listHosts())).length, 1);
  assert.equal(await validate(), false);
  const freshSession = Schema.decodeUnknownSync(SessionSchema)(
    await (await workerRequest("/fixture/start-session", { method: "POST" }, "target")).json(),
  );
  assert.notEqual(freshSession.sessionId, session.sessionId);
  assert.deepEqual(patchBodies[0], { role: "admin", reactivate: true });
  record(
    "cloud",
    "the shared phone adapter sends role plus reactivate true; restore keeps the same row and old resume claims fail",
  );
  await assert.rejects(runTeamEffect(directory("ordinary").updateMember(hostId, cloudTargetId, "member")));
  await assert.rejects(
    runTeamEffect(directory("target").updateMember(hostId, seed.joined.ordinary.membershipId, "admin")),
  );
  const ownerMembership = (await runTeamEffect(cloud.listMembers(hostId))).find((member) => member.role === "owner");
  assert.ok(ownerMembership);
  await assert.rejects(runTeamEffect(cloud.leaveHost(hostId, ownerMembership.membershipId)));
  assert.equal(
    (await runTeamEffect(cloud.listMembers(hostId))).find((member) => member.membershipId === cloudTargetId)?.role,
    "admin",
  );
  record("cloud", "the production account-plane owner check refuses admin/member changes and protects the owner");
  await runTeamEffect(cloud.leaveHost(hostId, cloudTargetId));
  assert.equal((await workerRequest("/fixture/reserve", { method: "POST" })).status, 200);
  const reserved = (await evidence()).memberships.filter((member) => member.user_id.startsWith("reserve-"));
  assert.equal(reserved.length, 2);
  const outcomes = await Promise.allSettled(
    reserved.map((member) => runTeamEffect(cloud.updateMember(hostId, member.membership_id, "member", true))),
  );
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((result) => result.status === "rejected").length, 1);
  const lastSeat = await evidence();
  assert.equal(lastSeat.memberships.filter((member) => member.status === "active").length, DEFAULT_TEAM_MEMBER_LIMIT);
  assert.equal(lastSeat.memberships.find((member) => member.membership_id === cloudTargetId)?.status, "revoked");
  const winner = lastSeat.memberships.find(
    (member) => member.user_id.startsWith("reserve-") && member.status === "active",
  );
  assert.ok(winner);
  await runTeamEffect(cloud.leaveHost(hostId, winner.membership_id));
  await runTeamEffect(cloud.updateMember(hostId, cloudTargetId, "admin", true));
  record(
    "cloud",
    "two real reactivations compete for the last seat; one succeeds and the other retains its inactive row",
  );
  const cloudDirectory = new RemoteTeamDirectory({
    servers: { require: () => ({ ...serverView, id: hostId, transport: "webrtc-v2" }) },
    request: unexpected,
    transport: {
      controlPlaneUrl: workerOrigin,
      listMembers: (id) =>
        cloud.listMembers(id).pipe(
          Effect.map((members) =>
            members.map((member) => ({
              ...member,
              avatarUrl: member.avatarUrl ?? null,
              createdAt: member.createdAt ?? 0,
            })),
          ),
          Effect.mapError((cause) => new RemoteWorkflowError({ cause })),
        ),
      updateMember: (id, membershipId, role, reactivate) =>
        cloud
          .updateMember(id, membershipId, role, reactivate)
          .pipe(Effect.mapError((cause) => new RemoteWorkflowError({ cause }))),
      removeMember: (id, membershipId) =>
        cloud.leaveHost(id, membershipId).pipe(Effect.mapError((cause) => new RemoteWorkflowError({ cause }))),
      listInvites: unexpected,
      createInvite: unexpected,
      revokeInvite: unexpected,
    },
    sendInviteEmail: unexpected,
  });
  const adapterReads = cloudReads;
  armCloudReadFailure = true;
  const adapterSaved = await runCauseEffect(
    cloudDirectory.updateMember(hostId, { memberId: cloudTargetId, disabled: true }),
  );
  assert.equal(adapterSaved.disabled, true);
  assert.equal(adapterSaved.name, cloudBefore.name);
  assert.equal(cloudReads, adapterReads + 1);
  const acceptedCloudWrites = cloudWrites;
  await assert.rejects(runTeamEffect(cloud.listMembers(hostId)));
  assert.equal(
    (await runTeamEffect(cloud.listMembers(hostId))).find((member) => member.membershipId === cloudTargetId)?.status,
    "revoked",
  );
  assert.equal(cloudWrites, acceptedCloudWrites);
  armCloudReadFailure = true;
  const adapterRestored = await runCauseEffect(
    cloudDirectory.updateMember(hostId, { memberId: cloudTargetId, disabled: false }),
  );
  assert.equal(adapterRestored.disabled, false);
  await assert.rejects(runTeamEffect(cloud.listMembers(hostId)));
  assert.equal(
    (await runTeamEffect(cloud.listMembers(hostId))).find((member) => member.membershipId === cloudTargetId)?.status,
    "active",
  );
  record(
    "cloud",
    "the desktop cloud adapter returns accepted fields before a refused post-commit read; retry does not resend disable or restore",
  );

  let failNextRead = false;
  let memberWrites = 0;
  let memberReads = 0;
  bridge = createServer((request, response) => {
    const origin = request.headers.origin;
    if (origin && /^http:\/\/127\.0\.0\.1:\d+$/u.test(origin))
      response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    void (async () => {
      const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      if (path === "/fixture/read-failure") {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        failNextRead = Schema.decodeUnknownSync(Schema.Struct({ fail: Schema.Boolean }))(
          JSON.parse(Buffer.concat(chunks).toString()),
        ).fail;
        response.writeHead(204);
        response.end();
        return;
      }
      if (path === "/fixture/members") {
        memberReads += 1;
        if (failNextRead) {
          failNextRead = false;
          response.writeHead(503);
          response.end();
          return;
        }
      }
      if (path === "/fixture/member") {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const input: UpdateTeamMemberInput = Schema.decodeUnknownSync(
          Schema.Struct({
            memberId: Schema.String,
            disabled: Schema.optional(Schema.Boolean),
            role: Schema.optional(Schema.Literals(["admin", "member"])),
          }),
        )(JSON.parse(Buffer.concat(chunks).toString()));
        memberWrites += 1;
        await runCauseEffect(localDirectory.updateMember(identity.serverId, input));
      }
      const presence = await runCauseEffect(
        localClient.request(identity.serverId, TEAM_API_ROUTES.team.presence, decodeTeamPresenceSnapshot),
      );
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(presence));
    })().catch(() => {
      response.writeHead(409);
      response.end();
    });
  });
  await new Promise<void>((done) => bridge?.listen(0, "127.0.0.1", done));
  const bridgeAddress = bridge.address();
  assert.ok(bridgeAddress && typeof bridgeAddress !== "string");
  const bridgeOrigin = `http://127.0.0.1:${bridgeAddress.port}`;
  const storybookPort = await freePort();
  const storybookOrigin = `http://127.0.0.1:${storybookPort}`;
  const storybook = startChild("controller-storybook", "node", [
    join(ROOT, "node_modules/storybook/dist/bin/dispatcher.js"),
    "dev",
    "--ci",
    "--no-open",
    "--exact-port",
    "--host",
    "127.0.0.1",
    "--port",
    String(storybookPort),
  ]);
  await waitReady(storybookOrigin, "/index.json", storybook);
  const executablePath =
    process.env.OPENBOT_MEMBER_ACCESS_BROWSER ??
    (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined);
  browser = await chromium.launch({
    headless: true,
    timeout: BROWSER_WAIT_MS,
    ...(executablePath ? { executablePath } : {}),
    args: ["--no-first-run", "--disable-background-networking"],
  });
  browserVersion = browser.version();
  const page = await waitWithin(browser.newPage(), BROWSER_WAIT_MS, "Controller browser page");
  page.setDefaultTimeout(BROWSER_WAIT_MS);
  page.setDefaultNavigationTimeout(BROWSER_WAIT_MS);
  await page.goto(
    `${storybookOrigin}/iframe.html?id=settings-serversettingsmodal--member-access-controllers&viewMode=story&fixtureOrigin=${encodeURIComponent(bridgeOrigin)}`,
  );
  const output = page.locator('output[aria-label="Member access controller receipt"]');
  async function command(
    label: string,
    surface: "desktop" | "web",
    operation: "disable" | "restore" | "retry" | "refused",
  ) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await output.filter({ hasText: `"operation":"${operation}"` }).waitFor();
    const result = Schema.decodeUnknownSync(ReceiptSchema)(JSON.parse(await output.innerText()));
    assert.equal(result.surface, surface);
    assert.equal(result.operation, operation);
    return result;
  }
  for (const surface of ["desktop", "web"] as const) {
    const label = surface === "desktop" ? "Desktop" : "Web";
    const writes = memberWrites;
    const result = await command(`${label} disable`, surface, "disable");
    assert.equal(result.disabled, true);
    assert.equal(result.loadError, true);
    assert.equal(memberWrites, writes + 1);
    const reads = memberReads;
    const retried = await command(`${label} read retry`, surface, "retry");
    assert.equal(retried.disabled, true);
    assert.equal(retried.loadError, false);
    assert.equal(memberWrites, writes + 1);
    assert.equal(memberReads, reads + 1);
    const restoredResult = await command(`${label} restore`, surface, "restore");
    assert.equal(restoredResult.disabled, false);
    assert.equal(restoredResult.loadError, true);
    assert.equal(memberWrites, writes + 2);
    await command(`${label} read retry`, surface, "retry");
    record(
      "controllers",
      `${surface} retains accepted disable/restore fields after a failed real roster read; retry sends only a read`,
    );
    await runCauseEffect(localDirectory.updateMember(identity.serverId, { memberId: savedTarget.id, disabled: true }));
    await runCauseEffect(
      localDirectory.updateMember(identity.serverId, { memberId: seatB.member.id, disabled: false }),
    );
    const refused = await command(`${label} refused restore`, surface, "refused");
    assert.equal(refused.refused, true);
    assert.equal(refused.disabled, true);
    await runCauseEffect(localDirectory.updateMember(identity.serverId, { memberId: seatB.member.id, disabled: true }));
    await runCauseEffect(localDirectory.updateMember(identity.serverId, { memberId: savedTarget.id, disabled: false }));
    record("controllers", `${surface} rejects a full-seat restore and retains the inactive row for a later attempt`);
  }
  assert.ok(cloudWrites > 0);
  passed = true;
} catch (error) {
  failure = failureText(error);
} finally {
  const ownedBrowser = browser;
  if (ownedBrowser) await finalize("Controller browser", () => ownedBrowser.close());
  for (const child of children.reverse()) {
    await finalize(`Owned child ${child.pid ?? "without PID"}`, () => finishChild(child));
  }
  const ownedBridge = bridge;
  if (ownedBridge) {
    await finalize("Controller bridge", async () => {
      if (!ownedBridge.listening) return;
      ownedBridge.closeAllConnections();
      if (!ownedBridge.listening) return;
      await new Promise<void>((done, fail) =>
        ownedBridge.close((error) => {
          if (!error || ("code" in error && error.code === "ERR_SERVER_NOT_RUNNING" && !ownedBridge.listening)) done();
          else fail(error);
        }),
      );
    });
  }
  for (const socket of sockets) {
    await finalize("Member event socket", async () => {
      if (socket.readyState === WebSocket.CLOSED) return;
      const closed = once(socket, "close");
      socket.terminate();
      await closed;
    });
  }
  const ownedHost = host;
  if (ownedHost) await finalize("Team API host", () => runCauseEffect(ownedHost.stop()));
  const ownedService = service;
  if (ownedService) await finalize("Agent service", () => runCauseEffect(ownedService.stop()));
  const ownedAgents = agents;
  if (ownedAgents)
    await finalize("Agent database", async () => {
      ownedAgents.database.close();
    });
  await finalize("Disposable fixture directory", () => rm(root, { recursive: true, force: true }));

  const artifactErrors: string[] = [];
  let logsFlushed = false;
  try {
    const results = await waitWithin(Promise.all(childLogWrites), RUN_WAIT_MS, "Owned child logs");
    artifactErrors.push(...results.filter((error) => error !== null));
    logsFlushed = true;
  } catch (error) {
    artifactErrors.push(failureText(error));
  }
  const cleanupComplete = cleanupErrors.length === 0 && logsFlushed;
  passed = passed && cleanupComplete && artifactErrors.length === 0;
  process.exitCode = passed ? 0 : 1;
  let reportWritten = false;
  try {
    await waitWithin(mkdir(OUT, { recursive: true }), RUN_WAIT_MS, "Report directory");
    await waitWithin(
      writeFile(
        join(OUT, "report.json"),
        `${JSON.stringify(
          {
            passed,
            failure,
            cleanupComplete,
            cleanupErrors,
            artifactErrors,
            runNonce,
            checks,
            sourceDigest,
            sourcePaths,
            sourceHead,
            runtime: {
              runner: process.versions.bun ? "Bun" : "Node",
              runnerVersion: process.versions.bun ?? process.version,
              nodeChildVersion,
              chromiumVersion: browserVersion,
              platform: process.platform,
              arch: process.arch,
            },
            limitations: [
              "Synthetic account identity at the cloud Worker boundary, not account login",
              "Auth events are checked in the durable outbox; real Signal delivery is not tested",
              "Phone alerts and native rendering are not exercised",
              "Cloud adapter profile fields are retained known data, not a fresh post-commit read",
              "Startup network traffic from Wrangler, Storybook and Chromium is not measured",
            ],
            membershipRequestScope: "Loopback Team API and Wrangler-local account-plane fixture",
            paidProviderTurns: 0,
          },
          null,
          2,
        )}\n`,
      ),
      RUN_WAIT_MS,
      "Fixture report",
    );
    reportWritten = true;
  } catch (error) {
    artifactErrors.push(failureText(error));
    passed = false;
    process.exitCode = 1;
  }
  if (!passed) {
    // Machine-readable: emit only the bounded redacted failure fields, never a raw assertion.
    process.stderr.write(`${JSON.stringify({ runNonce, failure, cleanupErrors, artifactErrors, cleanupComplete })}\n`);
  }
  // Machine-readable: CI records this run's report without credentials.
  process.stdout.write(
    `${JSON.stringify({ passed, runNonce, cleanupComplete, reportWritten, checks: checks.length, report: join(OUT, "report.json") })}\n`,
  );
}
