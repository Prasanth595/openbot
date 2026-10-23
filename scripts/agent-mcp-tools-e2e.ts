// Drives the agent MCP tools of issue #2673 on the real modules: the MCP tools, McpGateway, the
// SQLite MCP store and the probe, against local MCP servers. The approval and the sign-in card are
// recorded where the router would show them. No provider or account is used.
// bun scripts/agent-mcp-tools-e2e.ts. Writes .openbot-build/agent-mcp-tools-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import { McpGateway } from "../src/backend/agent/mcp-gateway";
import { handleMcpServerTool, type McpServerToolName, mcpServersFromGateway } from "../src/backend/agent/mcp-tools";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { McpOAuth, type McpOAuthRecord, normalizeResource } from "../src/backend/mcp-oauth-provider";
import { McpServerStore } from "../src/backend/mcp-server-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { NO_PROVIDER_CREDENTIALS } from "../src/backend/provider-drivers";

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-mcp-tools-e2e");
const URL_SECRET = "url-secret-7f3a91";
const HEADER_SECRET = "header-secret-2c8d40";

/** How each local server answers a request without a token. */
type Mode = "open" | "sign-in" | "key" | "consumer-key";

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function json(response: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(value));
}

async function mcpServer(mode: Mode): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      if (path !== "/mcp") return json(response, 404, { error: "not found" });
      if (mode === "sign-in")
        return json(response, 401, { error: "unauthorized" }, { "www-authenticate": 'Bearer realm="e2e"' });
      if (mode === "key") return json(response, 401, { error: "unauthorized" });
      if (mode === "consumer-key" && request.headers["x-consumer-api-key"] !== HEADER_SECRET)
        return json(response, 401, { error: "unauthorized" });
      if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
      }
      const message: { id?: number | string; method: string } = JSON.parse(await body(request));
      if (message.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      if (message.method === "initialize")
        return json(response, 200, {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "e2e", version: "1" },
          },
        });
      if (message.method === "tools/list") {
        const tool = (name: string) => ({ name, description: name, inputSchema: { type: "object", properties: {} } });
        return json(response, 200, {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            tools:
              mode === "consumer-key"
                ? Array.from({ length: 11 }, (_, index) => tool(`discovery_${index + 1}`))
                : [tool("search"), tool("read_page"), tool("create_page")],
          },
        });
      }
      return json(response, 200, { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "unknown" } });
    })().catch((error: unknown) => response.writeHead(500).end(String(error)));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

/** A port nothing listens on: the server is down. */
async function closedUrl(): Promise<string> {
  const server = await mcpServer("open");
  await server.close();
  return server.url;
}

/** The JSON of an MCP tool result, as the agent reads it. */
interface ServerAnswer {
  name: string;
  enabled: boolean;
  headerNames?: string[];
  oauth?: { signedIn: boolean; needsSignIn: boolean };
}

interface ToolAnswer {
  status?: string;
  verificationScope?: string;
  error?: string;
  toolCount?: number;
  tools?: string[];
  server?: ServerAnswer;
  servers?: ServerAnswer[];
  enabled?: boolean;
  removed?: boolean;
}

interface Call {
  name: string;
  tool: McpServerToolName;
  arguments: unknown;
  approved: boolean;
  success: boolean;
  result: ToolAnswer;
  approvals: string[];
  signInCards: string[];
}

const root = await mkdtemp(join(tmpdir(), "openbot-agent-mcp-tools-"));
const database = new OpenBotDatabase(root);
const servers: Record<Mode, { url: string; close: () => Promise<void> }> = {
  open: await mcpServer("open"),
  "sign-in": await mcpServer("sign-in"),
  key: await mcpServer("key"),
  "consumer-key": await mcpServer("consumer-key"),
};
const oauthRecords = new Map<string, McpOAuthRecord>();
const oauth = new McpOAuth({
  storage: {
    read: (resource) => oauthRecords.get(resource) ?? null,
    write: (resource, record) => Effect.sync(() => void oauthRecords.set(resource, record)),
    clear: (resource) => Effect.sync(() => void oauthRecords.delete(resource)),
  },
  openExternal: async () => {
    throw new Error("A silent MCP test must not open a sign-in page.");
  },
  redirectUrl: "http://127.0.0.1:28417/mcp-auth",
});
const calls: Call[] = [];
let refreshes = 0;
const report: { passed: boolean; calls: Call[]; refreshes: number; failures: string[] } = {
  passed: false,
  calls,
  refreshes: 0,
  failures: [],
};

try {
  await runCauseEffect(database.initialize());
  const store = new McpServerStore(database);
  const gateway = new McpGateway({
    servers: store,
    credentials: { ...NO_PROVIDER_CREDENTIALS, mcpOAuth: oauth },
    computerUseMcpServer: () => null,
    logger: createOpenBotLogger("agent-service", () => undefined),
    hooks: {
      emitError: () => undefined,
      refreshAllAgentRuntimes: () =>
        Effect.sync(() => {
          refreshes += 1;
        }),
    },
  });
  const tools = mcpServersFromGateway(gateway);

  const call = async (name: string, tool: McpServerToolName, args: unknown, approved = true) => {
    const approvals: string[] = [];
    const signInCards: string[] = [];
    const response = await runCauseEffect(
      handleMcpServerTool(tools, {
        tool,
        arguments: args,
        approve: (reason) =>
          Effect.sync(() => {
            approvals.push(reason);
            return approved;
          }),
        requestSignIn: (config) =>
          Effect.sync(() => {
            signInCards.push(config.id);
          }),
      }),
    );
    const text = response.contentItems[0]?.type === "inputText" ? response.contentItems[0].text : "{}";
    const entry: Call = {
      name,
      tool,
      arguments: args,
      approved,
      success: response.success,
      result: JSON.parse(text),
      approvals,
      signInCards,
    };
    calls.push(entry);
    return entry;
  };
  const row = (name: string): McpServerConfig | undefined => store.list().find((config) => config.name === name);

  const empty = await call("list empty", "list_mcp_servers", {});
  assert.deepEqual(empty.result, { servers: [] });

  const declined = await call(
    "declined add saves nothing",
    "save_mcp_server",
    { name: "docs", url: servers.open.url },
    false,
  );
  assert.equal(declined.success, false);
  assert.equal(declined.approvals.length, 1);
  assert.equal(row("docs"), undefined);
  assert.equal(refreshes, 0);

  const added = await call("add a server that answers", "save_mcp_server", {
    name: "docs",
    url: `${servers.open.url}?token=${URL_SECRET}`,
  });
  assert.equal(added.result.status, "ready");
  assert.deepEqual(added.result.tools, ["search", "read_page", "create_page"]);
  assert.equal(added.result.toolCount, 3);
  assert.equal(added.result.verificationScope, "mcp_tool_discovery");
  assert.deepEqual(added.result.server?.oauth, { signedIn: false, needsSignIn: false });
  assert.match(added.approvals[0] ?? "", /Every agent on this server/u);
  assert.equal(row("docs")?.enabled, true);
  assert.equal(refreshes, 1);

  const signIn = await call("add a server that needs a sign-in", "save_mcp_server", {
    name: "calendar",
    url: servers["sign-in"].url,
  });
  assert.equal(signIn.result.status, "needs_sign_in");
  assert.deepEqual(signIn.signInCards, [row("calendar")?.id]);

  const key = await call("add a server that needs a key", "save_mcp_server", { name: "crm", url: servers.key.url });
  assert.equal(key.result.status, "needs_key");
  assert.equal(key.signInCards.length, 0);
  assert.ok(row("crm"), "a server that needs a key is saved for the user to add it");

  const down = await call("a server that does not answer is not saved", "save_mcp_server", {
    name: "down",
    url: await closedUrl(),
  });
  assert.equal(down.success, false);
  assert.equal(row("down"), undefined);

  // The user enters a key in Server settings; an agent's edit keeps it.
  const crm = row("crm");
  assert.ok(crm);
  store.save({ ...crm, headers: [{ key: "Authorization", value: `Bearer ${HEADER_SECRET}` }] });
  const keys = [{ key: "Authorization", value: `Bearer ${HEADER_SECRET}` }];
  const moved = await call("keys do not move to another server", "save_mcp_server", {
    name: "crm",
    url: servers.open.url,
  });
  assert.equal(moved.success, false);
  assert.equal(moved.approvals.length, 0);
  assert.equal(row("crm")?.url, servers.key.url);
  const transport = await call("keys do not move to another transport", "save_mcp_server", {
    name: "crm",
    command: "node",
  });
  assert.equal(transport.success, false);
  assert.deepEqual(row("crm")?.headers, keys);

  // A stdio row's environment keys belong to its program, which the arguments also choose.
  const program = store.save({
    ...crm,
    id: "",
    name: "local_tool",
    transport: "stdio",
    command: "npx",
    args: ["-y", "good-package"],
    env: [{ key: "API_TOKEN", value: HEADER_SECRET }],
    headers: [],
    url: "",
  });
  const otherProgram = await call("keys do not move to another program", "save_mcp_server", {
    name: "local_tool",
    args: ["-y", "other-package"],
  });
  assert.equal(otherProgram.success, false);
  assert.equal(otherProgram.approvals.length, 0);
  assert.deepEqual(row("local_tool")?.args, program.args);

  const edited = await call("an edit keeps the headers", "save_mcp_server", {
    name: "crm",
    url: `${servers.key.url}?region=eu`,
  });
  assert.equal(edited.result.status, "needs_key");
  assert.match(edited.approvals[0] ?? "", /^Change the MCP server crm/u);
  assert.deepEqual(row("crm")?.headers, keys);

  const listed = await call("list shows no secret", "list_mcp_servers", {});
  const crmListed = listed.result.servers?.find((entry) => entry.name === "crm");
  assert.deepEqual(crmListed?.headerNames, ["Authorization"]);

  const off = await call("turn a server off", "set_mcp_server_enabled", { name: "docs", enabled: false });
  assert.equal(off.success, true);
  assert.equal(row("docs")?.enabled, false);

  const tested = await call("test a saved server", "test_mcp_server", { name: "docs" });
  assert.equal(tested.result.status, "ready");
  assert.equal(tested.approvals.length, 0);

  const on = await call("turn a server on again", "set_mcp_server_enabled", { name: "docs", enabled: true });
  assert.equal(on.success, true);
  assert.equal(row("docs")?.enabled, true);

  const consumer = await call("add a server that requires a consumer key", "save_mcp_server", {
    name: "discovery",
    url: servers["consumer-key"].url,
  });
  assert.equal(consumer.result.status, "needs_key");
  const consumerRow = row("discovery");
  assert.ok(consumerRow);
  store.save({ ...consumerRow, headers: [{ key: "x-consumer-api-key", value: HEADER_SECRET }] });
  const keyReady = await call("key works without an OpenBot OAuth token", "test_mcp_server", { name: "discovery" });
  assert.equal(keyReady.result.status, "ready");
  assert.equal(keyReady.result.verificationScope, "mcp_tool_discovery");
  assert.equal(keyReady.result.toolCount, 11);
  assert.equal(keyReady.result.tools?.length, 11);
  assert.deepEqual(keyReady.result.server?.oauth, { signedIn: false, needsSignIn: false });
  assert.deepEqual(keyReady.result.server?.headerNames, ["x-consumer-api-key"]);
  assert.equal(keyReady.signInCards.length, 0);
  assert.ok(keyReady.result.server && !("signedIn" in keyReady.result.server));

  const keyListed = await call("list scopes the key server's OAuth state", "list_mcp_servers", {});
  assert.deepEqual(keyListed.result.servers?.find((entry) => entry.name === "discovery")?.oauth, {
    signedIn: false,
    needsSignIn: false,
  });
  store.save({ ...consumerRow, headers: [{ key: "x-consumer-api-key", value: "wrong-fixture-key" }] });
  const invalidKey = await call("an invalid consumer key needs a key", "test_mcp_server", { name: "discovery" });
  assert.equal(invalidKey.result.status, "needs_key");
  assert.equal(invalidKey.signInCards.length, 0);
  store.save({ ...consumerRow, headers: [{ key: "x-consumer-api-key", value: HEADER_SECRET }] });
  const keyRestored = await call("a corrected key restores discovery", "test_mcp_server", { name: "discovery" });
  assert.equal(keyRestored.result.status, "ready");

  const docs = row("docs");
  assert.ok(docs);
  const oauthResource = normalizeResource(docs.url);
  assert.ok(oauthResource);
  oauthRecords.set(oauthResource, { tokens: { access_token: HEADER_SECRET, token_type: "Bearer" } });
  const signedIn = await call("list scopes stored OAuth tokens", "list_mcp_servers", {});
  assert.deepEqual(signedIn.result.servers?.find((entry) => entry.name === "docs")?.oauth, {
    signedIn: true,
    needsSignIn: false,
  });
  oauthRecords.set(oauthResource, { lostAt: Date.now() });
  const lost = await call("list preserves a lost OAuth sign-in", "list_mcp_servers", {});
  assert.deepEqual(lost.result.servers?.find((entry) => entry.name === "docs")?.oauth, {
    signedIn: false,
    needsSignIn: true,
  });

  const unknown = await call("an unknown name", "test_mcp_server", { name: "nothing" });
  assert.equal(unknown.success, false);

  const removed = await call("remove a server", "remove_mcp_server", { name: "calendar" });
  assert.equal(removed.success, true);
  assert.equal(row("calendar"), undefined);

  const reserved = await call("a reserved name is refused", "save_mcp_server", {
    name: "openbot",
    url: servers.open.url,
  });
  assert.equal(reserved.success, false);
  assert.equal(reserved.approvals.length, 0, "an invalid server is corrected before the user is asked");

  // Nothing an agent reads names a key: not the query of an address, not a header value.
  const everything = JSON.stringify(calls.map(({ result, approvals }) => ({ result, approvals })));
  assert.ok(!everything.includes(URL_SECRET), "the address query reached the agent");
  assert.ok(!everything.includes(HEADER_SECRET), "a header value reached the agent");
  report.passed = true;
} catch (error) {
  report.failures.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
} finally {
  report.refreshes = refreshes;
  await Promise.all(Object.values(servers).map((server) => server.close()));
  await runCauseEffect(oauth.close());
  database.close();
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${calls.length} calls. Report: ${join(OUT, "report.json")}\n`);
if (!report.passed) {
  process.stderr.write(`${report.failures.join("\n")}\n`);
  process.exit(1);
}
