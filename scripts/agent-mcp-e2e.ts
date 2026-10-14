// Drives real SQLite grant storage, the MCP relay and admin routes, and the native ACP adapter
// against isolated HTTP and stdio MCP fixtures. No installed provider or real credential is used.
// `bun scripts/agent-mcp-e2e.ts`. Writes .openbot-build/agent-mcp-e2e/report.json.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { access as accessFile, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createServer, type Server as HttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  CallToolResultSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  AGENT_MCP_LIMITS,
  type AgentEvent,
  type AgentMcpSettings,
  type AgentProviderId,
  agentMcpWithinBytes,
  isAgentMcpSettings,
  isAgentMcpTools,
  type ListAgentMcpToolsInput,
  type McpServerConfig,
  parseSetAgentMcpGrants,
  type SetAgentMcpGrantsInput,
  type TeamMemberSummary,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import {
  AGENT_MCP_CAPABILITY,
  AGENT_MCP_CODECS,
  AGENT_MCP_ROUTES,
} from "@openbot/contracts/team-protocol/agent-mcp-v1";
import { teamCapabilitiesForProtocol } from "@openbot/contracts/team-protocol/current";
import { TEAM_CAPABILITIES_HEADER, TEAM_PROTOCOL_VERSION_HEADER } from "@openbot/contracts/team-protocol/v1";
import { Effect } from "effect";
import { AcpAgentClient } from "../src/backend/acp-client";
import { AgentMemories } from "../src/backend/agent/agent-memories";
import { ContextCompaction } from "../src/backend/agent/context-compaction";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { DuplicationGate, toAgentDuplicationFailed } from "../src/backend/agent/duplication-gate";
import { RoutineScheduler } from "../src/backend/agent/routine-scheduler";
import { ThreadLifecycle } from "../src/backend/agent/thread-lifecycle";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient } from "../src/backend/agent-client";
import { AgentMcpAccess } from "../src/backend/agent-mcp-access";
import { agentMcpCreationInitializer } from "../src/backend/agent-mcp-creation";
import { AgentMcpGrantStore } from "../src/backend/agent-mcp-grant-store";
import { AgentMcpRelay } from "../src/backend/agent-mcp-relay";
import { AgentLifecycleFailed, AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { AgentWaitStore } from "../src/backend/agent-waits/agent-wait-store";
import { AgentWaits } from "../src/backend/agent-waits/agent-waits";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { toMcpOperationError } from "../src/backend/mcp-effects";
import { mcpHandoffHeaders, mcpServersParam, usableMcpServer } from "../src/backend/mcp-provider-shapes";
import { redactMcpValues } from "../src/backend/mcp-redaction";
import { openCodeSignInMessage } from "../src/backend/opencode-config";
import {
  type AppServerNotification,
  decodeRecordResponse,
  decodeThreadItem,
  decodeThreadResponse,
  decodeTurnResponse,
  getRecord,
  getString,
  type ResponseDecoder,
} from "../src/backend/protocol";
import { ProviderClientOperationError, providerCall } from "../src/backend/provider-client-effects";
import { RoutineTimer } from "../src/backend/routine-timer";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
import type { TeamApiAdmin } from "../src/main/team-api/dependencies";
import { HttpError } from "../src/main/team-api/http-error";
import { requestCapabilities, requestProtocol } from "../src/main/team-api/request-helpers";
import { routeAgentMcp } from "../src/main/team-api/route-agent-mcp";

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-mcp-e2e");
type AdminFixtureInput = SetAgentMcpGrantsInput | ListAgentMcpToolsInput | { agentId: string };
const root = await mkdtemp(join(tmpdir(), "openbot-agent-mcp-e2e-"));
const SECRET = 'synthetic-mcp-token-"quoted"';
const ESCAPED_SECRET = JSON.stringify(SECRET).slice(1, -1);
const checks: string[] = [];
const report: { passed: boolean; checks: string[]; surfaces: string[]; error?: string } = {
  passed: false,
  checks,
  surfaces: [
    "SQLite grants",
    "HTTP and stdio MCP relay",
    "native ACP adapter with fixture agent",
    "admin HTTP routes",
    "provider session retirement",
    "global registry service subscriptions",
  ],
};
const httpCalls: string[] = [];
const tokens: string[] = [];
let scopeReads = 0;
const clients: Client[] = [];
const servers: HttpServer[] = [];
const isolatedRelays: AgentMcpRelay[] = [];
const serviceHosts: Array<{ service: AgentService; store: AgentStore }> = [];
const store = new AgentStore(join(root, "state"), join(root, "home"));
let relay: AgentMcpRelay | undefined;
let acp: AcpAgentClient | undefined;

const unusedBrowserOperation = () => {
  throw new Error("The MCP registry fixture must not use a browser.");
};
const fixtureBrowser = {
  listTabs: () => [],
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  endTakeover: () => {},
  close: () => Effect.void,
  beginTakeover: unusedBrowserOperation,
  resolveUploadTarget: unusedBrowserOperation,
  handleDynamicTool: unusedBrowserOperation,
} satisfies AgentBrowserHost;

class FixtureProvider extends EventEmitter implements AgentClient {
  running = true;
  refuseClose = false;
  readonly closed: string[] = [];
  constructor(
    readonly provider: AgentProviderId,
    private readonly peer?: Client,
  ) {
    super();
  }
  start() {
    this.running = true;
  }
  stop() {
    return providerCall(async () => {
      await this.peer?.close();
      this.running = false;
    });
  }
  releaseThread(id: string, options?: { strict?: boolean }) {
    return Effect.gen({ self: this }, function* () {
      assert.equal(options?.strict, true);
      if (this.refuseClose)
        return yield* new ProviderClientOperationError({ cause: new Error("Fixture close refused.") });
      yield* providerCall(() => this.peer?.close());
      this.closed.push(id);
    });
  }
  request<T>(method: string, _params: unknown, decode: ResponseDecoder<T>) {
    return Effect.try({
      try: () =>
        decode(
          method === "config/read"
            ? {
                config: { mcp_servers: {} },
                layers: [
                  {
                    name: { type: "user", file: join(root, "codex.toml") },
                    version: "fixture",
                    config: { mcp_servers: {} },
                  },
                ],
              }
            : {},
        ),
      catch: (cause) => new ProviderClientOperationError({ cause }),
    });
  }
  notify() {}
  respond() {}
  respondError() {}
}

async function listen(server: HttpServer): Promise<string> {
  servers.push(server);
  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", fail);
      done();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}
async function peer(config: McpServerConfig): Promise<Client> {
  const client = new Client({ name: "fixture-provider", version: "1" }, { capabilities: {} });
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: { headers: Object.fromEntries(config.headers.map(({ key, value }) => [key, value])) },
    }),
  );
  return client;
}
async function denied(client: Client, name: string) {
  const count = httpCalls.length;
  let refused = false;
  try {
    const result = await client.callTool({ name, arguments: {} }, CallToolResultSchema);
    refused = result.isError === true;
  } catch (error) {
    assert.ok(error instanceof Error);
    refused = true;
  }
  assert.equal(refused, true);
  assert.equal(httpCalls.length, count, "A denied tool must not reach the upstream service.");
}
function latch() {
  let release = () => {};
  const promise = new Promise<void>((done) => {
    release = done;
  });
  return { promise, release };
}
async function within<A>(promise: Promise<A>, label: string, milliseconds = 5000): Promise<A> {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_done, fail) => {
        deadline = setTimeout(() => fail(new Error(`Timed out: ${label}`)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(deadline);
  }
}

try {
  await mkdir(OUT, { recursive: true });
  await runCauseEffect(store.initialize());
  const agent = await runCauseEffect(
    store.createAgent({ name: "Fixture", description: "", avatarSeed: randomUUID(), avatarHue: null }),
  );
  const agentId = agent.id;
  const second = await runCauseEffect(
    store.createAgent({ name: "Other", description: "", avatarSeed: randomUUID(), avatarHue: null }),
  );
  const http = await listen(
    createServer((request, response) => {
      void (async () => {
        if (request.method !== "POST") {
          response.writeHead(405);
          response.end();
          return;
        }
        assert.equal(request.headers.authorization, `Bearer ${SECRET}`);
        const server = new Server({ name: "fixture-mail", version: "1" }, { capabilities: { tools: {} } });
        server.setRequestHandler(ListToolsRequestSchema, ({ params }) =>
          params?.cursor === "write"
            ? {
                tools: [
                  {
                    name: "send_mail",
                    description: "Send mail",
                    inputSchema: { type: "object" },
                    annotations: { readOnlyHint: false },
                  },
                ],
              }
            : {
                tools: [
                  {
                    name: "read_inbox",
                    description: `Read ${SECRET}`,
                    inputSchema: { type: "object" },
                    annotations: { readOnlyHint: true },
                  },
                ],
                nextCursor: "write",
              },
        );
        server.setRequestHandler(CallToolRequestSchema, ({ params }) => {
          httpCalls.push(params.name);
          return {
            content: [{ type: "text", text: `${params.name}: ${SECRET}` }],
            structuredContent: { credential: SECRET, nested: { [SECRET]: SECRET } },
          };
        });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        try {
          await server.connect(transport);
          await transport.handleRequest(request, response);
        } finally {
          await transport.close();
          await server.close();
        }
      })().catch(() => {
        if (!response.headersSent) response.writeHead(500);
        response.end();
      });
    }),
  );
  const httpConfig: McpServerConfig = {
    id: "fixture-http",
    name: "fixture_mail",
    enabled: true,
    transport: "http",
    url: `${http}/mcp`,
    headers: [],
    command: "",
    args: [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
  };
  const registryState = join(root, "registry-state");
  const registryStore = new AgentStore(registryState, join(root, "registry-home"));
  await runCauseEffect(registryStore.initialize());
  const registryMailbox = new MailboxStore(registryState, registryStore.sharedRoot, registryStore.database);
  await runCauseEffect(registryMailbox.initialize());
  const registryAgent = await runCauseEffect(
    registryStore.createAgent({ name: "Registry reader", description: "", avatarSeed: randomUUID(), avatarHue: null }),
  );
  let builtInServer: McpServerConfig | null = null;
  const registryService = new AgentService({
    store: registryStore,
    mailbox: registryMailbox,
    browser: fixtureBrowser,
    computerUseMcpServer: () => builtInServer,
  });
  serviceHosts.push({ service: registryService, store: registryStore });
  const observedSettings: AgentMcpSettings[] = [];
  registryService.on("event", (event: AgentEvent) => {
    if (event.type !== "agents-changed") return;
    assert.ok(event.agents.some((item) => item.id === registryAgent.id));
    observedSettings.push(registryService.readAgentMcpSettings(registryAgent.id));
  });
  const [registryServer] = await runCauseEffect(registryService.saveMcpServer({ config: { ...httpConfig, id: "" } }));
  assert.ok(registryServer);
  assert.deepEqual(observedSettings.at(-1)?.servers, [
    { id: registryServer.id, name: registryServer.name, enabled: true },
  ]);
  await runCauseEffect(registryService.saveMcpServer({ config: { ...registryServer, name: "fixture_renamed" } }));
  assert.equal(observedSettings.at(-1)?.servers[0]?.name, "fixture_renamed");
  await runCauseEffect(registryService.setMcpServerEnabled({ mcpServerId: registryServer.id, enabled: false }));
  assert.equal(observedSettings.at(-1)?.servers[0]?.enabled, false);
  await runCauseEffect(registryService.setMcpServerEnabled({ mcpServerId: registryServer.id, enabled: true }));
  assert.equal(observedSettings.at(-1)?.servers[0]?.enabled, true);
  await runCauseEffect(registryService.removeMcpServer({ mcpServerId: registryServer.id }));
  assert.deepEqual(observedSettings.at(-1)?.servers, []);
  builtInServer = { ...httpConfig, id: "fixture-built-in", name: "fixture_builtin" };
  await runCauseEffect(registryService.notifyComputerUseChanged());
  assert.deepEqual(observedSettings.at(-1)?.servers, [
    { id: builtInServer.id, name: builtInServer.name, enabled: true },
  ]);
  builtInServer = null;
  await runCauseEffect(registryService.notifyComputerUseChanged());
  assert.deepEqual(observedSettings.at(-1)?.servers, []);
  assert.equal(observedSettings.length, 7);
  assert.ok(observedSettings.every((settings) => settings.grants === null));
  checks.push(
    "A real AgentService subscription rereads committed settings after global MCP add, edit, disable, re-enable, remove and built-in entry changes.",
  );
  await assert.rejects(runCauseEffect(registryService.saveMcpServer({ config: { ...httpConfig, id: "", name: "" } })));
  await runCauseEffect(registryService.refreshAllAgentRuntimes());
  assert.equal(observedSettings.length, 7);
  assert.deepEqual(registryService.listMcpServers(), []);
  checks.push("Rejected registry writes and unrelated runtime refreshes do not emit server-list change notifications.");
  const registryThreadId = await runCauseEffect(registryStore.ensureThreadId(registryAgent.id));
  registryStore.database.bindProviderSession({
    threadId: registryThreadId,
    provider: registryAgent.provider,
    externalSessionId: "fixture-subscription-session",
    model: registryAgent.model,
    effort: registryAgent.reasoningEffort,
  });
  registryStore.database.connection.exec(
    "CREATE TRIGGER fixture_reject_refresh BEFORE UPDATE OF state ON projection_provider_sessions WHEN NEW.state = 'inactive' BEGIN SELECT RAISE(ABORT, 'Fixture subscription refresh failed'); END",
  );
  try {
    await assert.rejects(
      runCauseEffect(
        registryService.saveMcpServer({ config: { ...httpConfig, id: "", name: "fixture_refresh_failure" } }),
      ),
      /Fixture subscription refresh failed/,
    );
    const [committedServer] = registryService.listMcpServers();
    assert.ok(committedServer);
    assert.equal(observedSettings.length, 8);
    assert.deepEqual(observedSettings.at(-1)?.servers, [
      { id: committedServer.id, name: "fixture_refresh_failure", enabled: true },
    ]);
    assert.ok(registryStore.database.activeProviderSession(registryThreadId, registryAgent.provider));
  } finally {
    registryStore.database.connection.exec("DROP TRIGGER fixture_reject_refresh");
  }
  checks.push(
    "A committed global MCP change notifies subscribed settings readers before a genuine downstream SQLite runtime-refresh failure rejects the operation.",
  );
  let configured = [httpConfig];
  const grants = new AgentMcpGrantStore(store.database);
  const callerScope = [{ mcpServerId: httpConfig.id, tools: ["read_inbox"] }];
  grants.write(agentId, callerScope);
  const initializeChild = agentMcpCreationInitializer(grants, agentId);
  grants.write(agentId, []);
  const child = await runCauseEffect(
    store.createAgent(
      { name: "Scoped child", description: "", avatarSeed: randomUUID(), avatarHue: null },
      undefined,
      (id) => {
        assert.equal(
          store.list().some((item) => item.id === id),
          false,
        );
        const rollback = initializeChild(id);
        assert.deepEqual(grants.read(id), callerScope);
        return rollback;
      },
    ),
  );
  assert.deepEqual(grants.read(child.id), callerScope);
  assert.deepEqual(grants.read(agentId), []);
  checks.push(
    "Actual agent creation saves a captured caller scope before roster visibility, even when the caller changes before creation completes.",
  );
  let failedChild = "";
  const failedGrantCommands: string[] = [];
  const initializeRejected = agentMcpCreationInitializer(grants, child.id);
  store.database.connection.exec(
    "CREATE TRIGGER fixture_reject_agent BEFORE INSERT ON projection_agents WHEN json_extract(NEW.agent_json, '$.name') = 'Rejected child' BEGIN SELECT RAISE(ABORT, 'Fixture roster failure'); END",
  );
  try {
    await assert.rejects(
      runCauseEffect(
        store.createAgent(
          { name: "Rejected child", description: "", avatarSeed: randomUUID(), avatarHue: null },
          undefined,
          (id) => {
            failedChild = id;
            const rollback = initializeRejected(id);
            for (const row of store.database.connection
              .prepare(
                "SELECT command_id FROM orchestration_events WHERE aggregate_type = 'agent-mcp' AND aggregate_id = ?",
              )
              .all(id)) {
              assert.ok(typeof row.command_id === "string");
              failedGrantCommands.push(row.command_id);
            }
            return rollback;
          },
        ),
      ),
    );
  } finally {
    store.database.connection.exec("DROP TRIGGER fixture_reject_agent");
  }
  assert.ok(failedChild);
  assert.equal(
    store.list().some((item) => item.id === failedChild),
    false,
  );
  assert.equal(grants.read(failedChild), null);
  await assert.rejects(accessFile(join(root, "home", "OpenBot", "Agents", failedChild)));
  assert.ok(failedGrantCommands.length > 0);
  for (const command of failedGrantCommands)
    assert.ok(
      !store.database.connection
        .prepare("SELECT command_id FROM orchestration_command_receipts WHERE command_id = ?")
        .get(command),
    );
  assert.equal(
    store.database.connection
      .prepare(
        "SELECT COUNT(*) AS count FROM orchestration_events WHERE aggregate_type = 'agent-mcp' AND aggregate_id = ?",
      )
      .get(failedChild)?.count,
    0,
  );
  const beforeFailure = store.list().map((item) => item.id);
  await assert.rejects(
    runCauseEffect(
      store.createAgent(
        { name: "Initializer failure", description: "", avatarSeed: randomUUID(), avatarHue: null },
        undefined,
        () => {
          throw new Error("Fixture initializer failure.");
        },
      ),
    ),
  );
  assert.deepEqual(
    store.list().map((item) => item.id),
    beforeFailure,
  );
  checks.push(
    "Initializer and subsequent SQLite roster failures publish no child and clean only newly owned scope metadata and workspace.",
  );
  grants.write(agentId, null);
  relay = new AgentMcpRelay({
    agentExists: (id) => store.list().some((item) => item.id === id),
    grants: (id) => {
      scopeReads++;
      return grants.read(id);
    },
    servers: () => configured,
    authorization: () => Effect.succeed(SECRET),
    redact: (text) => redactMcpValues(text, [SECRET, ...tokens]),
    registerSecret: (value) => tokens.push(value),
  });
  const activeRelay = relay;
  assert.deepEqual(await runCauseEffect(relay.configs(agentId, configured)), configured);
  assert.equal(tokens.length, 0, "Default grants must not start a relay route.");
  checks.push("Missing grants preserve native MCP configurations.");
  grants.write(agentId, [{ mcpServerId: httpConfig.id, tools: ["read_inbox"] }]);
  const [restricted] = await runCauseEffect(relay.configs(agentId, configured));
  assert.ok(restricted);
  const resolvedRestricted = await runCauseEffect(usableMcpServer(restricted, undefined, () => Effect.succeed(SECRET)));
  assert.equal(resolvedRestricted.error, undefined);
  if (resolvedRestricted.error !== undefined) throw new Error("The restricted handoff could not be resolved.");
  assert.notEqual(mcpHandoffHeaders(resolvedRestricted).Authorization, `Bearer ${SECRET}`);
  assert.equal(mcpHandoffHeaders(resolvedRestricted).Authorization, restricted.headers[0]?.value);
  checks.push(
    "Production handoff resolution preserves the explicit relay bearer when a native authorization source also returns a credential.",
  );
  const reader = await peer(restricted);
  assert.deepEqual(reader.getServerCapabilities(), { tools: {} });
  await assert.rejects(reader.listResources());
  await assert.rejects(reader.listPrompts());
  checks.push("A tools-only upstream advertises only tools through the restricted relay.");
  assert.deepEqual(
    (await reader.listTools()).tools.map((tool) => tool.name),
    ["read_inbox"],
  );
  const read = CallToolResultSchema.parse(
    await reader.callTool({ name: "read_inbox", arguments: {} }, CallToolResultSchema),
  );
  assert.equal(read.isError, undefined);
  assert.notEqual(read.structuredContent?.credential, SECRET);
  assert.ok(isDynamicRecord(read.structuredContent?.nested));
  assert.equal(Object.keys(read.structuredContent.nested).includes(SECRET), false);
  assert.ok(read.content[0]?.type === "text");
  assert.equal(read.content[0].text.includes(SECRET), false);
  assert.equal(
    (await reader.listTools()).tools.some((tool) => tool.description?.includes(SECRET)),
    false,
  );
  await denied(reader, "send_mail");
  checks.push("Paged tool discovery and actual calls enforce the exact allowlist.");
  checks.push("Quoted synthetic credentials are removed from metadata and structured results.");
  grants.write(agentId, []);
  await denied(reader, "read_inbox");
  assert.deepEqual(await runCauseEffect(relay.configs(agentId, configured)), []);
  grants.write(agentId, [{ mcpServerId: httpConfig.id, tools: ["read_inbox"] }]);
  assert.equal((await reader.callTool({ name: "read_inbox", arguments: {} }, CallToolResultSchema)).isError, undefined);
  configured = [{ ...httpConfig, enabled: false }];
  await denied(reader, "read_inbox");
  configured = [httpConfig];
  assert.equal((await reader.callTool({ name: "read_inbox", arguments: {} }, CallToolResultSchema)).isError, undefined);
  configured = [];
  await denied(reader, "read_inbox");
  const replacement = { ...httpConfig, id: "replacement-http" };
  configured = [replacement];
  assert.deepEqual(await runCauseEffect(relay.configs(agentId, configured)), []);
  configured = [httpConfig];
  checks.push(
    "Existing relay sessions honor revoke, re-enable, host disable and removal; replacement IDs get no stale grants.",
  );
  const [otherNative] = await runCauseEffect(relay.configs(second.id, configured));
  assert.deepEqual(otherNative, httpConfig);
  checks.push("Grants remain isolated between agents.");
  grants.write(second.id, [{ mcpServerId: httpConfig.id, tools: ["read_inbox"] }]);
  const [otherScoped] = await runCauseEffect(relay.configs(second.id, configured));
  assert.ok(otherScoped);
  const otherPeer = await peer(otherScoped);
  await runCauseEffect(store.deleteAgent(second.id));
  assert.equal(grants.read(second.id), null);
  await denied(otherPeer, "read_inbox");
  assert.ok(store.list().some((item) => item.id === agentId));
  checks.push("Real agent deletion removes scope metadata and rejects the deleted agent's existing relay peer.");

  const stdioFixture = join(root, "fixture-mcp.mjs");
  const workspace = join(root, "stdio-workspace");
  await mkdir(workspace);
  await writeFile(
    stdioFixture,
    `import { Server } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/server/index.js"))};
import { StdioServerTransport } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/server/stdio.js"))};
import { ListToolsRequestSchema, CallToolRequestSchema } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/types.js"))};
const server = new Server({ name: "fixture-files", version: "1" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [{ name: "where", inputSchema: { type: "object" } }] }));
server.setRequestHandler(CallToolRequestSchema, () => ({ content: [{ type: "text", text: JSON.stringify({ cwd: process.cwd(), env: process.env.FIXTURE_PUBLIC, secret: process.env.FIXTURE_SECRET }) }] }));
await server.connect(new StdioServerTransport());
`,
  );
  const stdio: McpServerConfig = {
    ...httpConfig,
    id: "fixture-stdio",
    name: "fixture_files",
    transport: "stdio",
    url: "",
    headers: [],
    command: process.execPath,
    args: [stdioFixture],
    workingDirectory: workspace,
    env: [
      { key: "FIXTURE_PUBLIC", value: "fixture-public-value" },
      { key: "FIXTURE_SECRET", value: SECRET },
    ],
  };
  configured = [httpConfig, stdio];
  grants.write(agentId, [{ mcpServerId: stdio.id, tools: ["where"] }]);
  const [stdioRelay] = await runCauseEffect(relay.configs(agentId, configured));
  assert.ok(stdioRelay);
  const filePeer = await peer(stdioRelay);
  const where = CallToolResultSchema.parse(
    await filePeer.callTool({ name: "where", arguments: {} }, CallToolResultSchema),
  );
  assert.ok(where.content[0]?.type === "text");
  const location = JSON.parse(where.content[0].text);
  assert.ok(isDynamicRecord(location));
  assert.equal(location.cwd, await realpath(workspace));
  assert.equal(location.env, "fixture-public-value");
  assert.equal(typeof location.secret === "string" && location.secret.includes(SECRET), false);
  checks.push("The real stdio child keeps its configured working directory and environment.");

  const contentBase = await listen(
    createServer((request, response) => {
      void (async () => {
        if (request.method !== "POST") {
          response.writeHead(405);
          response.end();
          return;
        }
        assert.equal(request.headers.authorization, `Bearer ${SECRET}`);
        const server = new Server(
          { name: "fixture-content", version: "1" },
          {
            capabilities: { resources: { subscribe: true, listChanged: true }, prompts: { listChanged: true } },
          },
        );
        server.setRequestHandler(ListResourcesRequestSchema, () => ({
          resources: [{ uri: "fixture://notes", name: "Notes", description: SECRET }],
        }));
        server.setRequestHandler(ListResourceTemplatesRequestSchema, () => ({
          resourceTemplates: [{ uriTemplate: "fixture://notes/{name}", name: "Notes" }],
        }));
        server.setRequestHandler(ReadResourceRequestSchema, ({ params }) => ({
          contents: [{ uri: params.uri, text: SECRET }],
        }));
        server.setRequestHandler(ListPromptsRequestSchema, () => ({
          prompts: [{ name: "summary", description: SECRET }],
        }));
        server.setRequestHandler(GetPromptRequestSchema, () => ({
          messages: [{ role: "user", content: { type: "text", text: SECRET } }],
        }));
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        try {
          await server.connect(transport);
          await transport.handleRequest(request, response);
        } finally {
          await transport.close();
          await server.close();
        }
      })().catch(() => {
        if (!response.headersSent) response.writeHead(500);
        response.end();
      });
    }),
  );
  const contentConfig = { ...httpConfig, id: "fixture-content", name: "fixture_content", url: `${contentBase}/mcp` };
  configured = [httpConfig, contentConfig];
  grants.write(agentId, [{ mcpServerId: contentConfig.id, tools: [] }]);
  const [contentScoped] = await runCauseEffect(relay.configs(agentId, configured));
  assert.ok(contentScoped);
  const contentPeer = await peer(contentScoped);
  assert.deepEqual(contentPeer.getServerCapabilities(), { resources: {}, prompts: {} });
  await assert.rejects(contentPeer.listTools());
  assert.equal((await contentPeer.listResources()).resources[0]?.description?.includes(SECRET), false);
  assert.equal((await contentPeer.listResourceTemplates()).resourceTemplates[0]?.uriTemplate, "fixture://notes/{name}");
  const notes = await contentPeer.readResource({ uri: "fixture://notes" });
  assert.equal(JSON.stringify(notes).includes(ESCAPED_SECRET), false);
  assert.equal((await contentPeer.listPrompts()).prompts[0]?.description?.includes(SECRET), false);
  assert.equal(JSON.stringify(await contentPeer.getPrompt({ name: "summary" })).includes(ESCAPED_SECRET), false);
  checks.push(
    "Resource reads, templates and prompts retain their supported capabilities and redact results; subscription and list-change capabilities are omitted.",
  );
  configured = [httpConfig];

  const mailbox = new MailboxStore(join(root, "state"), store.sharedRoot, store.database);
  await runCauseEffect(mailbox.initialize());
  const conversation = new ConversationRuntime(
    store,
    () => {},
    () => store.list(),
  );
  const memories = new AgentMemories({ store, conversation, emit: () => {}, emitError: () => {} });
  const compaction = new ContextCompaction({
    store,
    providers: { isReady: () => true, clientFor: () => null, clientForAgent: () => null, listModels: () => [] },
    emitError: () => {},
    scheduleDrain: () => {},
  });
  const threads = new ThreadLifecycle({
    store,
    mailbox,
    conversation,
    memories,
    compaction,
    mcpServers: () => configured,
    scopedMcpServers: (id, servers) => activeRelay.configs(id, servers),
    hooks: {
      logRecovery: () => {},
      logReleaseFailure: () => {},
      reportMcpDrops: () => {},
      logHandoffReadFailure: () => {},
    },
  });
  const access = new AgentMcpAccess({
    grants,
    relay,
    agentExists: (id) => store.list().some((item) => item.id === id),
    servers: () => configured,
    changed: () => Effect.void,
    edit: (id, operation) =>
      threads
        .retireAgentMcpSessions(id)
        .pipe(toMcpOperationError, Effect.andThen(activeRelay.clearAgent(id)), Effect.andThen(operation)),
  });
  const threadId = await runCauseEffect(store.ensureThreadId(agentId));
  const nativePeer = await peer({ ...httpConfig, headers: [{ key: "Authorization", value: `Bearer ${SECRET}` }] });
  const fixture = new FixtureProvider("codex", nativePeer);
  const oldSession = "fixture-native-session";
  store.database.bindProviderSession({
    threadId,
    provider: "codex",
    externalSessionId: oldSession,
    model: agent.model,
    effort: agent.reasoningEffort,
  });
  conversation.bindThread(oldSession, agentId, threadId);
  conversation.markThreadLoaded(oldSession, fixture);
  fixture.refuseClose = true;
  const previous = grants.read(agentId);
  const oversized = [
    {
      mcpServerId: httpConfig.id,
      tools: Array.from({ length: 650 }, (_entry, index) => `tool_${index}_${"도".repeat(70)}`),
    },
  ];
  assert.equal(agentMcpWithinBytes(oversized, AGENT_MCP_LIMITS.grantsBytes), false);
  assert.equal(agentMcpWithinBytes({ agentId, grants: oversized }, AGENT_MCP_LIMITS.payloadBytes), true);
  assert.throws(() => parseSetAgentMcpGrants({ agentId, grants: oversized }), /too large/);
  const setCodec = AGENT_MCP_CODECS.get(AGENT_MCP_ROUTES.set);
  assert.ok(setCodec);
  assert.throws(() => setCodec.request({ agentId, grants: oversized }), /too large/);
  await assert.rejects(runCauseEffect(access.set({ agentId, grants: oversized })), /too large/);
  assert.deepEqual(grants.read(agentId), previous);
  assert.equal(store.database.activeProviderSession(threadId, "codex")?.externalSessionId, oldSession);
  assert.deepEqual(fixture.closed, []);
  checks.push(
    "UTF-8 grant budgets reject a real oversized selection at IPC, frozen wire and service boundaries before retiring the existing provider or saving grants.",
  );
  await assert.rejects(runCauseEffect(access.set({ agentId, grants: [] })));
  assert.deepEqual(grants.read(agentId), previous);
  assert.ok(store.database.activeProviderSession(threadId, "codex"));
  fixture.refuseClose = false;
  const releaseStart = threads.holdRuntimeRefresh(agentId);
  await assert.rejects(runCauseEffect(access.set({ agentId, grants: [] })));
  assert.deepEqual(grants.read(agentId), previous);
  releaseStart();
  await runCauseEffect(access.set({ agentId, grants: [{ mcpServerId: httpConfig.id, tools: ["read_inbox"] }] }));
  assert.deepEqual(fixture.closed, [oldSession]);
  assert.equal(store.database.activeProviderSession(threadId, "codex"), null);
  assert.equal(conversation.loadedClientFor(oldSession), undefined);
  await assert.rejects(nativePeer.listTools());
  checks.push("Native close failure and a starting provider session reject edits without changing saved grants.");
  checks.push(
    "A successful edit closes the old native MCP peer and retires its provider session before grant persistence.",
  );

  for (const provider of [
    "codex",
    "claude",
    "grok",
    "opencode",
    "antigravity",
    "cursor",
    "cline",
    "acp",
    "muse",
    "pi",
  ] as const) {
    const params = await runCauseEffect(
      threads.threadParams({ ...agent, provider }, new FixtureProvider(provider), "fixture-resume"),
    );
    if (provider === "codex") {
      const config = getRecord(params, "config");
      const mcp = getRecord(config, "mcp_servers");
      const server = getRecord(mcp, "fixture_mail");
      assert.ok(getString(server, "url")?.startsWith("http://127.0.0.1:"));
      assert.notEqual(
        getString(server, "url"),
        httpConfig.url,
        "Codex must get the scoped relay, not the original URL.",
      );
    } else {
      const configs = mcpServersParam(params, () => {
        throw new Error("A restricted session must not read the global source.");
      });
      assert.equal(configs.length, 1);
      assert.notEqual(configs[0]?.url, httpConfig.url);
    }
  }
  checks.push(
    "Production resume parameters give each provider a scoped handoff; this does not claim live model execution.",
  );

  const acpFixture = join(root, "fixture-acp.mjs");
  await writeFile(
    acpFixture,
    `import { Client } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/client/index.js"))};
import { StreamableHTTPClientTransport } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/client/streamableHttp.js"))};
const sessions = new Map(); let sequence = 0; let buffered = "";
const modelId = ${JSON.stringify(agent.model)};
const setup = { configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: modelId,
    options: [{ value: modelId, name: "Fixture model" }] }] };
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
async function handle(message) {
  if (message.id === undefined) return;
  const params = message.params ?? {};
  if (message.method === "initialize") return send({ id: message.id, result: { protocolVersion: 1,
    agentInfo: { name: "fixture", version: "1" }, agentCapabilities: { loadSession: true, mcpCapabilities: { http: true } } } });
  if (message.method === "session/new") {
    const sessionId = "fixture-session-" + (++sequence); sessions.set(sessionId, params.mcpServers);
    return send({ id: message.id, result: { sessionId, ...setup } });
  }
  if (message.method === "session/load" || message.method === "session/resume") {
    sessions.set(params.sessionId, params.mcpServers); return send({ id: message.id, result: setup });
  }
  if (message.method === "session/set_config_option") {
    if (params.configId !== "model" || params.value !== modelId)
      return send({ id: message.id, error: { code: -32602, message: "Unknown fixture configuration value." } });
    return send({ id: message.id, result: { configOptions: setup.configOptions } });
  }
  if (message.method === "session/close") { sessions.delete(params.sessionId); return send({ id: message.id, result: {} }); }
  if (message.method === "session/prompt") {
    const result = { names: [], writeDenied: true };
    for (const server of sessions.get(params.sessionId) ?? []) {
      if (server.name !== "fixture_mail") continue;
      const client = new Client({ name: "fixture-agent", version: "1" }, { capabilities: {} });
      try {
        await client.connect(new StreamableHTTPClientTransport(new URL(server.url), {
          requestInit: { headers: Object.fromEntries(server.headers.map(({ name, value }) => [name, value])) } }));
        result.names.push(...(await client.listTools()).tools.map((tool) => tool.name));
        if (result.names.includes("read_inbox")) await client.callTool({ name: "read_inbox", arguments: {} });
        try { const response = await client.callTool({ name: "send_mail", arguments: {} }); result.writeDenied = response.isError === true; }
        catch { result.writeDenied = true; }
      } finally { await client.close(); }
    }
    send({ method: "session/update", params: { sessionId: params.sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: JSON.stringify(result) } } } });
    return send({ id: message.id, result: { stopReason: "end_turn" } });
  }
  send({ id: message.id, error: { code: -32601, message: "Unknown fixture method." } });
}
process.stdin.setEncoding("utf8"); process.stdin.on("data", (chunk) => {
  buffered += chunk; let newline;
  while ((newline = buffered.indexOf("\\n")) >= 0) { const line = buffered.slice(0, newline); buffered = buffered.slice(newline + 1);
    if (line.trim()) void handle(JSON.parse(line)).catch((error) => send({ id: JSON.parse(line).id, error: { code: -32603, message: error.message } })); }
});
`,
  );
  acp = new AcpAgentClient({ executable: process.execPath, version: "fixture", source: "system" }, 10000, {
    provider: "opencode",
    argv: [acpFixture],
    env: {},
    signInMessage: openCodeSignInMessage(0),
    mcpServers: () => configured,
  });
  acp.start();
  await runCauseEffect(acp.request("initialize", {}, decodeRecordResponse));
  const runAcp = async (resume?: string) => {
    assert.ok(acp);
    const params = await runCauseEffect(
      threads.threadParams({ ...agent, provider: "opencode" }, acp, resume ?? "unused"),
    );
    const started = await runCauseEffect(
      acp.request(resume ? "thread/resume" : "thread/start", params, decodeThreadResponse),
    );
    const id = started.thread.id;
    let text = "";
    const complete = new Promise<void>((done, fail) => {
      assert.ok(acp);
      const deadline = AbortSignal.timeout(10000);
      const expired = () => {
        acp?.off("notification", onNotification);
        fail(new Error("The fixture ACP turn did not complete."));
      };
      deadline.addEventListener("abort", expired, { once: true });
      function onNotification(event: AppServerNotification) {
        if (getString(event.params, "threadId") !== id) return;
        if (event.method === "item/completed") {
          const item = decodeThreadItem(getRecord(event.params, "item"));
          if (item.type === "agentMessage" && item.phase === "final_answer") text += item.text ?? "";
        }
        if (event.method === "turn/completed") {
          deadline.removeEventListener("abort", expired);
          acp?.off("notification", onNotification);
          const status = getString(getRecord(event.params, "turn"), "status");
          if (status !== "completed") fail(new Error(`The fixture ACP turn ended as ${status ?? "unknown"}.`));
          else done();
        }
      }
      acp.on("notification", onNotification);
    });
    await Promise.all([
      runCauseEffect(
        acp.request(
          "turn/start",
          { threadId: id, input: [{ type: "text", text: "Read the fixture inbox." }] },
          decodeTurnResponse,
        ),
      ),
      complete,
    ]);
    const value = JSON.parse(text);
    assert.ok(isDynamicRecord(value));
    return { id, value };
  };
  const first = await runAcp();
  assert.deepEqual(first.value.names, ["read_inbox"]);
  assert.equal(first.value.writeDenied, true);
  await runCauseEffect(acp.releaseThread(first.id, { strict: true }));
  const resumed = await runAcp(first.id);
  assert.deepEqual(resumed.value.names, ["read_inbox"]);
  assert.equal(resumed.value.writeDenied, true);
  await runCauseEffect(acp.releaseThread(resumed.id, { strict: true }));
  grants.write(agentId, []);
  const empty = await runAcp();
  assert.deepEqual(empty.value.names, []);
  await runCauseEffect(acp.releaseThread(empty.id, { strict: true }));
  checks.push(
    "The real ACP adapter sends restricted servers on start and resume; an explicit empty scope never falls back to global MCP.",
  );
  grants.write(agentId, [{ mcpServerId: httpConfig.id, tools: ["read_inbox"] }]);
  const timer = new RoutineTimer(
    () => [],
    () => false,
    () => {},
  );
  const waits = new AgentWaits({
    store: new AgentWaitStore({ database: store.database }),
    mailbox,
    hooks: { emit: () => {}, ownsRoutine: () => false, hasRoutine: () => false },
  });
  const routines = new RoutineScheduler({
    store,
    mailbox,
    conversation,
    timer,
    waits,
    hooks: {
      emit: () => {},
      emitError: () => {},
      emitQueue: () => {},
      scheduleDrain: () => {},
      interrupt: () => Effect.void,
      awaitDrain: () => undefined,
      syncMailboxMessages: () => {},
      listAgents: () => store.list(),
      excludedAgents: () => new Set(),
      isRunning: () => false,
      usageLimited: () => false,
    },
  });
  let duplicateId = "";
  let publishedWithScope = false;
  const duplication: DuplicationGate = new DuplicationGate({
    store,
    mailbox,
    conversation,
    memories,
    routines,
    hooks: {
      emit: (event) => {
        if (event.type === "agents-changed" && event.agents.some((item) => item.id === duplicateId)) {
          assert.deepEqual(grants.read(duplicateId), grants.read(agentId));
          publishedWithScope = true;
        }
      },
      listAgents: () => duplication.visibleAgents(store.list()),
      hasAttentionFor: () => false,
      scheduleDrain: () => {},
      deleteAgentData: (item) => store.deleteAgent(item.id).pipe(toAgentDuplicationFailed, Effect.asVoid),
      copyMcpGrants: (source, id) => grants.write(id, grants.read(source)),
    },
  });
  const duplicate = await runCauseEffect(duplication.duplicate(agentId));
  duplicateId = duplicate.id;
  assert.equal(
    duplication.visibleAgents(store.list()).some((item) => item.id === duplicateId),
    false,
  );
  const sidebar = new SidebarLayoutStore(join(root, "sidebar.json"));
  const layout = await runCauseEffect(
    sidebar.placeDuplicateAfter(
      agentId,
      duplicate.id,
      store.list().map((item) => item.id),
    ),
  );
  await runCauseEffect(duplication.commit(duplicate.id, layout));
  assert.equal(publishedWithScope, true);
  await runCauseEffect(store.deleteAgent(duplicate.id));
  assert.equal(grants.read(duplicate.id), null);
  timer.dispose();
  checks.push("The production duplication gate preserves grants before it publishes the copy.");

  let hidden = new Set<string>();
  const member: TeamMemberSummary = {
    id: "fixture-admin",
    username: "fixture",
    email: null,
    name: null,
    role: "admin",
    createdAt: new Date().toISOString(),
    disabled: false,
  };
  const admin: TeamApiAdmin = {
    agentMcp: {
      readAgentMcpSettings: (id) => access.read(id),
      setAgentMcpGrants: (input) =>
        access
          .set(input)
          .pipe(
            Effect.mapError(
              (failure) => new AgentLifecycleFailed({ operation: "fixture set MCP", cause: failure.cause }),
            ),
          ),
      listAgentMcpTools: (input) =>
        access
          .tools(input)
          .pipe(
            Effect.mapError(
              (failure) => new AgentLifecycleFailed({ operation: "fixture list MCP", cause: failure.cause }),
            ),
          ),
    },
  };
  const adminBase = await listen(
    createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://fixture.invalid");
      void routeAgentMcp(
        {
          request,
          response,
          method: request.method ?? "GET",
          url,
          protocol: requestProtocol(request),
          capabilities: requestCapabilities(request),
          member: { ...member, role: request.headers["x-fixture-role"] === "member" ? "member" : "admin" },
          token: "fixture",
          sessionId: "fixture",
          sessionExpiresAt: new Date().toISOString(),
          json: (status, value) => {
            response.writeHead(status, { "content-type": "application/json" });
            response.end(JSON.stringify(value));
            return "handled";
          },
          empty: (status) => {
            response.writeHead(status);
            response.end();
            return "handled";
          },
        },
        admin,
        hidden,
      )
        .then((outcome) => {
          if (outcome !== "handled") {
            response.writeHead(404);
            response.end();
          }
        })
        .catch((error) => {
          response.writeHead(error instanceof HttpError ? error.status : 500);
          response.end();
        });
    }),
  );
  const adminCall = (
    path: string,
    body: AdminFixtureInput,
    role = "admin",
    capability = AGENT_MCP_CAPABILITY,
    protocol = 7,
  ) =>
    fetch(`${adminBase}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [TEAM_PROTOCOL_VERSION_HEADER]: String(protocol),
        [TEAM_CAPABILITIES_HEADER]: capability,
        "x-fixture-role": role,
      },
      body: JSON.stringify(body),
    });
  const sizeSession = "fixture-size-session";
  const sizeProvider = new FixtureProvider("codex");
  store.database.bindProviderSession({
    threadId,
    provider: "codex",
    externalSessionId: sizeSession,
    model: agent.model,
    effort: agent.reasoningEffort,
  });
  conversation.bindThread(sizeSession, agentId, threadId);
  conversation.markThreadLoaded(sizeSession, sizeProvider);
  const beforeOversizedHttp = grants.read(agentId);
  const tooLarge = await adminCall(AGENT_MCP_ROUTES.set, { agentId, grants: oversized });
  assert.equal(tooLarge.status, 400);
  assert.deepEqual(grants.read(agentId), beforeOversizedHttp);
  assert.equal(store.database.activeProviderSession(threadId, "codex")?.externalSessionId, sizeSession);
  assert.deepEqual(sizeProvider.closed, []);
  checks.push(
    "The real admin HTTP request parser rejects oversized optional grants before touching an existing native session.",
  );
  assert.equal((await adminCall(AGENT_MCP_ROUTES.read, { agentId }, "member")).status, 403);
  assert.equal((await adminCall(AGENT_MCP_ROUTES.read, { agentId }, "admin", "")).status, 400);
  assert.equal((await adminCall(AGENT_MCP_ROUTES.read, { agentId }, "admin", AGENT_MCP_CAPABILITY, 6)).status, 400);
  hidden = new Set([agentId]);
  assert.equal((await adminCall(AGENT_MCP_ROUTES.set, { agentId, grants: [] })).status, 404);
  hidden = new Set();
  assert.equal((await adminCall(AGENT_MCP_ROUTES.set, { agentId, grants: [] })).status, 200);
  const saved = await (await adminCall(AGENT_MCP_ROUTES.read, { agentId })).json();
  assert.ok(isAgentMcpSettings(saved));
  assert.deepEqual(saved.grants, []);
  assert.equal(teamCapabilitiesForProtocol(6).includes(AGENT_MCP_CAPABILITY), false);
  assert.equal(teamCapabilitiesForProtocol(7).includes(AGENT_MCP_CAPABILITY), true);
  checks.push(
    "Real admin HTTP routes enforce role, advertised capability and hidden-agent scope; older protocols omit the capability.",
  );

  const inventoryBase = await listen(
    createServer((request, response) => {
      void (async () => {
        if (request.method !== "POST") {
          response.writeHead(405);
          response.end();
          return;
        }
        const server = new Server({ name: "fixture-inventory", version: "1" }, { capabilities: { tools: {} } });
        server.setRequestHandler(ListToolsRequestSchema, () => ({
          tools: Array.from({ length: 600 }, (_entry, index) => ({
            name: `fixture_tool_${String(index).padStart(4, "0")}`,
            description: `${SECRET} ${"Description. ".repeat(200)}`,
            inputSchema: { type: "object" },
          })),
        }));
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        try {
          await server.connect(transport);
          await transport.handleRequest(request, response);
        } finally {
          await transport.close();
          await server.close();
        }
      })().catch(() => {
        if (!response.headersSent) response.writeHead(500);
        response.end();
      });
    }),
  );
  const inventory = { ...httpConfig, id: "fixture-inventory", name: "fixture_inventory", url: `${inventoryBase}/mcp` };
  configured = [httpConfig, inventory];
  await assert.rejects(runCauseEffect(access.tools({ agentId, mcpServerId: inventory.id })), /filter/);
  const filtered = await runCauseEffect(
    access.tools({ agentId, mcpServerId: inventory.id, query: "fixture_tool_0042" }),
  );
  assert.ok(isAgentMcpTools(filtered));
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.name, "fixture_tool_0042");
  assert.ok((filtered[0]?.description.length ?? 0) <= AGENT_MCP_LIMITS.descriptionChars);
  assert.equal(filtered[0]?.description.includes(SECRET), false);
  const inventoryHttp = await adminCall(AGENT_MCP_ROUTES.tools, {
    agentId,
    mcpServerId: inventory.id,
    query: "fixture_tool_0042",
  });
  assert.equal(inventoryHttp.status, 200);
  assert.deepEqual(await inventoryHttp.json(), filtered);
  const toolsCodec = AGENT_MCP_CODECS.get(AGENT_MCP_ROUTES.tools);
  assert.ok(toolsCodec);
  assert.throws(
    () =>
      toolsCodec.response(
        200,
        Array.from({ length: 600 }, (_entry, index) => ({ name: `tool_${index}`, description: "x".repeat(512) })),
      ),
    /too large/,
  );
  checks.push(
    "A real oversized MCP inventory returns a filter error; filtered and shortened metadata remains below the IPC and optional-wire response budget.",
  );
  const previousInventoryGrants = grants.read(agentId);
  await runCauseEffect(access.set({ agentId, grants: [{ mcpServerId: inventory.id, tools: ["fixture_tool_0042"] }] }));
  const [inventoryScoped] = await runCauseEffect(relay.configs(agentId, configured));
  assert.ok(inventoryScoped);
  const inventoryPeer = await peer(inventoryScoped);
  const beforeInventoryReads = scopeReads;
  assert.deepEqual(
    (await inventoryPeer.listTools()).tools.map((tool) => tool.name),
    ["fixture_tool_0042"],
  );
  assert.ok(scopeReads - beforeInventoryReads <= 8, "A 600-tool discovery must not read SQLite grants once per tool.");
  await runCauseEffect(access.set({ agentId, grants: previousInventoryGrants }));
  checks.push(
    "A real 600-tool provider discovery reads grants a bounded number of times and filters exact names with one scope snapshot.",
  );
  const failingBase = await listen(
    createServer((_request, response) => {
      response.writeHead(500);
      response.end(`Fixture error: ${SECRET}`);
    }),
  );
  const failingConfig = { ...httpConfig, id: "fixture-failing", name: "fixture_failing", url: `${failingBase}/mcp` };
  configured = [httpConfig, failingConfig];
  const exposedError = await runCauseEffect(access.tools({ agentId, mcpServerId: failingConfig.id })).then(
    () => null,
    (error: unknown) => error,
  );
  assert.ok(exposedError instanceof Error);
  assert.equal(exposedError.message.includes(SECRET), false);
  checks.push("A real upstream HTTP error that echoes a quoted credential becomes a safe tool-inventory error.");
  configured = [httpConfig];

  for (const operation of ["discovery", "call"] as const) {
    const entered = latch();
    const release = latch();
    const abandoned = latch();
    const base = await listen(
      createServer((request, response) => {
        void (async () => {
          if (request.method !== "POST") {
            response.writeHead(405);
            response.end();
            return;
          }
          const server = new Server(
            { name: `fixture-held-${operation}`, version: "1" },
            { capabilities: { tools: {} } },
          );
          const hold = async (signal: AbortSignal) => {
            const cancel = () => {
              abandoned.release();
              release.release();
            };
            signal.addEventListener("abort", cancel, { once: true });
            response.once("close", cancel);
            entered.release();
            try {
              await release.promise;
            } finally {
              signal.removeEventListener("abort", cancel);
              response.off("close", cancel);
            }
          };
          server.setRequestHandler(ListToolsRequestSchema, async (_request, extra) => {
            if (operation === "discovery") await hold(extra.signal);
            return { tools: [{ name: "hold", inputSchema: { type: "object" } }] };
          });
          server.setRequestHandler(CallToolRequestSchema, async (_request, extra) => {
            await hold(extra.signal);
            return { content: [{ type: "text", text: "Released." }] };
          });
          const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
          try {
            await server.connect(transport);
            await transport.handleRequest(request, response);
          } finally {
            await transport.close();
            await server.close();
          }
        })().catch(() => {
          if (!response.headersSent) response.writeHead(500);
          response.end();
        });
      }),
    );
    const heldConfig = { ...httpConfig, id: `fixture-held-${operation}`, name: "fixture_held", url: `${base}/mcp` };
    const heldRelay = new AgentMcpRelay({
      agentExists: () => true,
      grants: () => [{ mcpServerId: heldConfig.id, tools: ["hold"] }],
      servers: () => [heldConfig],
      redact: (text) => redactMcpValues(text, tokens),
      registerSecret: (value) => tokens.push(value),
    });
    isolatedRelays.push(heldRelay);
    try {
      const [scoped] = await runCauseEffect(heldRelay.configs(agentId, [heldConfig]));
      assert.ok(scoped);
      const heldPeer = await peer(scoped);
      const pending = (
        operation === "discovery"
          ? runCauseEffect(heldRelay.tools(agentId, heldConfig.id))
          : heldPeer.callTool({ name: "hold", arguments: {} }, CallToolResultSchema)
      ).then(
        () => false,
        () => true,
      );
      await within(entered.promise, `upstream ${operation} entry`);
      const queued = runCauseEffect(heldRelay.tools(agentId, heldConfig.id)).then(
        () => false,
        () => true,
      );
      await within(runCauseEffect(heldRelay.close()), `relay close during held ${operation}`);
      assert.equal(await within(pending, `held ${operation} settlement`), true);
      assert.equal(await within(queued, "queued discovery settlement"), true);
      await within(abandoned.promise, `upstream ${operation} cancellation`);
      const response = await fetch(scoped.url, {
        method: "POST",
        headers: Object.fromEntries(scoped.headers.map(({ key, value }) => [key, value])),
        body: "{}",
      }).then(
        () => "open",
        () => "closed",
      );
      assert.equal(response, "closed");
    } finally {
      release.release();
      await runCauseEffect(heldRelay.close());
    }
  }
  checks.push(
    "Shutdown cancels real held upstream discovery and calls, settles permit waiters and closes the listener within five seconds.",
  );

  const persisted = [{ mcpServerId: httpConfig.id, tools: ["read_inbox"] }];
  grants.write(agentId, persisted);
  await runCauseEffect(relay.close());
  store.database.close();
  await runCauseEffect(store.database.initialize());
  assert.deepEqual(new AgentMcpGrantStore(store.database).read(agentId), persisted);
  checks.push("Grants survive SQLite close and reopen.");
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? redactMcpValues(error.message, [SECRET, ...tokens]) : "E2E failed.";
  throw error;
} finally {
  for (const host of serviceHosts) {
    await runCauseEffect(host.service.stop()).catch(() => {});
    host.store.database.close();
  }
  await runCauseEffect(acp?.stop() ?? Effect.void).catch(() => {});
  for (const client of clients) await client.close().catch(() => {});
  if (relay) await runCauseEffect(relay.close()).catch(() => {});
  for (const isolated of isolatedRelays) await runCauseEffect(isolated.close()).catch(() => {});
  for (const server of servers)
    await new Promise<void>((done) => {
      server.close(() => done());
      server.closeAllConnections();
    });
  store.database.close();
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`Agent MCP E2E passed ${checks.length} checks.\n`);
