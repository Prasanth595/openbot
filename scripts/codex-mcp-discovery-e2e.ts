// Runs the real Codex app-server with a local model and a key-protected MCP server. No account,
// network service, or model billing is used. Requires a supported Codex CLI on PATH, or set
// OPENBOT_TEST_CODEX_EXECUTABLE to the installed runtime executable.
// A code_mode_only model must see and call external MCP tools after OpenBot registers them.
// Run: bun scripts/codex-mcp-discovery-e2e.ts
// Report: .openbot-build/codex-mcp-discovery-e2e/report.json
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer, type Server as HttpServer } from "node:http";
import { join, resolve } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { readCodexMcpConfig } from "../src/backend/agent/codex-mcp-config";
import { VISIBLE_DYNAMIC_TOOLS } from "../src/backend/agent/tool-catalog";
import { CodexAppServerClient } from "../src/backend/app-server-client";
import { resolveCodexCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import {
  CODEX_PLACEHOLDER_URL,
  type CodexOwnTransports,
  codexDisabledServers,
  codexMcpServers,
  codexMcpToolNamespaces,
  codexThreadMcpServers,
  toMcpShapeFailed,
  usableMcpServers,
} from "../src/backend/mcp-provider-shapes";
import { decodeRecordResponse, getRecord, getString } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/codex-mcp-discovery-e2e");
const NL = String.fromCharCode(10);
const SEARCH_TOOL = "COMPOSIO_SEARCH_TOOLS";
const FIXTURE_KEY = "local-mcp-discovery-fixture";
const SAFE_RESULT = "fixture_calendar_read_succeeded";

// Explicit metadata keeps this test independent of the user's model cache and account identity.
// Only public ModelInfo fields needed for code-mode-only tool routing are set here.
const MODEL_CATALOG = {
  models: [
    {
      slug: "local-code-mode-model",
      display_name: "Local code mode fixture",
      description: "Local E2E model",
      default_reasoning_level: "low",
      supported_reasoning_levels: [{ effort: "low", description: "Local fixture" }],
      shell_type: "unified_exec",
      visibility: "list",
      supported_in_api: true,
      priority: 0,
      support_verbosity: false,
      truncation_policy: { mode: "tokens", limit: 10000 },
      context_window: 272000,
      experimental_supported_tools: [],
      input_modalities: ["text"],
      supports_search_tool: true,
      use_responses_lite: true,
      tool_mode: "code_mode_only",
      model_messages: { instructions_template: "Use the available tools for the local test." },
    },
  ],
};

interface ModelTool {
  type?: string;
  name?: string;
  tools?: Array<{ name: string }>;
}

interface ModelInput {
  type?: string;
  tools?: ModelTool[];
}

interface ModelRequest {
  input?: ModelInput[];
  tools?: ModelTool[];
}

interface ModelItem {
  type: string;
  id: string;
  role?: string;
  call_id?: string;
  name?: string;
  namespace?: string;
  arguments?: string;
  content?: Array<{ type: string; text: string }>;
}

interface ModelEvent {
  type: string;
  response?: {
    id: string;
    status: string;
    output?: ModelItem[];
    usage?: { input_tokens: number; output_tokens: number; total_tokens: number };
  };
  output_index?: number;
  item?: ModelItem;
}

interface ModelObservation {
  namespaces: string[];
  toolCount: number;
  receivedSafeResult: boolean;
}

async function startModel() {
  const observations: ModelObservation[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const parsed: ModelRequest = JSON.parse(body || "{}");
      const input = parsed.input ?? [];
      // Code mode only sends its tool definitions inside a configuration item in `input`.
      const tools = parsed.tools ?? input.find((item) => item.tools)?.tools ?? [];
      const external = tools.filter((tool) => tool.name?.startsWith("mcp__"));
      observations.push({
        namespaces: tools.flatMap((tool) => (tool.name ? [tool.name] : [])).sort(),
        toolCount: external.reduce((count, tool) => count + (tool.tools?.length ?? 0), 0),
        receivedSafeResult: JSON.stringify(input).includes(SAFE_RESULT),
      });
      const called = input.some((item) => item.type?.startsWith("function_call"));
      const namespace = external.find((tool) => tool.tools?.some((entry) => entry.name === SEARCH_TOOL));
      const item: ModelItem =
        !called && namespace?.name
          ? {
              type: "function_call",
              id: "fixture-call",
              call_id: "fixture-call",
              name: SEARCH_TOOL,
              namespace: namespace.name,
              arguments: "{}",
            }
          : {
              type: "message",
              role: "assistant",
              id: "fixture-answer",
              content: [{ type: "output_text", text: "done" }],
            };
      const send = (event: ModelEvent) =>
        response.write(`event: ${event.type}${NL}data: ${JSON.stringify(event)}${NL}${NL}`);
      response.writeHead(200, { "content-type": "text/event-stream" });
      send({ type: "response.created", response: { id: "fixture-response", status: "in_progress" } });
      send({ type: "response.output_item.done", output_index: 0, item });
      send({
        type: "response.completed",
        response: {
          id: "fixture-response",
          status: "completed",
          output: [item],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        },
      });
      response.end();
    });
  });
  return { observations, ...(await listen(server)) };
}

async function startMcp() {
  const calls: string[] = [];
  const listings: number[] = [];
  const server = createServer(async (request, response) => {
    if (request.headers["x-api-key"] !== FIXTURE_KEY) {
      response.writeHead(401);
      response.end();
      return;
    }
    const mcp = new Server({ name: "local-discovery", version: "1" }, { capabilities: { tools: {} } });
    mcp.setRequestHandler(ListToolsRequestSchema, async () => {
      listings.push(11);
      return {
        tools: Array.from({ length: 11 }, (_, index) => ({
          name: index === 0 ? SEARCH_TOOL : `fixture_${index}`,
          description: "Local fixture tool",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
        })),
      };
    });
    mcp.setRequestHandler(CallToolRequestSchema, async (message) => {
      calls.push(message.params.name);
      return { content: [{ type: "text", text: JSON.stringify({ result: SAFE_RESULT }) }] };
    });
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    response.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    await mcp.connect(asTransport(transport));
    await transport.handleRequest(request, response);
  });
  return { calls, listings, ...(await listen(server)) };
}

async function listen(server: HttpServer) {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert(address && typeof address === "object");
  return {
    port: address.port,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

function asTransport(inner: StreamableHTTPServerTransport): Transport {
  const transport: Transport = {
    start: () => {
      inner.onclose = () => transport.onclose?.();
      inner.onerror = (error) => transport.onerror?.(error);
      inner.onmessage = (message, extra) => transport.onmessage?.(message, extra);
      return inner.start();
    },
    send: (message, options) => inner.send(message, options),
    close: () => inner.close(),
  };
  return transport;
}

interface Case {
  name: string;
  legacy?: boolean;
  clash?: boolean;
  disabled?: boolean;
}

interface Outcome {
  name: string;
  configuredKeys: string[];
  directNamespaces: string[];
  turnStatus: string;
  discoveredToolCounts: number[];
  toolCalls: string[];
  modelRequests: ModelObservation[];
}

await mkdir(OUT, { recursive: true });
const profileRoot = await mkdtemp(join(OUT, "profiles-"));
const catalogPath = join(profileRoot, "model-catalog.json");
await writeFile(catalogPath, JSON.stringify(MODEL_CATALOG));
const configuredExecutable = process.env.OPENBOT_TEST_CODEX_EXECUTABLE;
const cli = await runCauseEffect(
  resolveCodexCli(
    configuredExecutable ? { systemCandidates: [configuredExecutable], bundledExecutable: null } : undefined,
  ),
);
const model = await startModel();
const mcp = await startMcp();
const outcomes: Outcome[] = [];

async function run(test: Case): Promise<Outcome> {
  const home = join(profileRoot, test.name);
  await mkdir(home, { recursive: true });
  const key = test.clash ? "openbot_composio" : "composio";
  await writeFile(
    join(home, "config.toml"),
    [
      'model = "local-code-mode-model"',
      `model_catalog_json = ${JSON.stringify(catalogPath)}`,
      'model_provider = "local"',
      "[model_providers.local]",
      'name = "Local test"',
      `base_url = "http://127.0.0.1:${model.port}/v1"`,
      'env_key = "OPENBOT_MCP_FIXTURE_KEY"',
      'wire_api = "responses"',
      ...(test.clash ? ["[mcp_servers.composio]", 'command = "node"', "enabled = false"] : []),
      `[mcp_servers.${key}]`,
      `url = "${CODEX_PLACEHOLDER_URL}"`,
      "enabled = false",
      `[mcp_servers.${key}.tools.${SEARCH_TOOL}]`,
      'approval_mode = "approve"',
    ].join(NL),
  );
  const client = new CodexAppServerClient(cli.executable, 30_000, {
    CODEX_HOME: home,
    OPENBOT_MCP_FIXTURE_KEY: "local-model-fixture",
  });
  const completed = new Promise<string>((done) => {
    client.on("notification", (notification) => {
      if (notification.method === "turn/completed")
        done(getString(getRecord(notification.params, "turn"), "status") ?? "missing");
    });
  });
  const firstRequest = model.observations.length;
  const firstCall = mcp.calls.length;
  const firstListing = mcp.listings.length;
  client.start();
  try {
    await runCauseEffect(
      client.request(
        "initialize",
        {
          clientInfo: { name: "openbot_mcp_discovery_e2e", title: "OpenBot MCP E2E", version: "0.0.0" },
          capabilities: { experimentalApi: true, mcpServerOpenaiFormElicitation: true },
        },
        decodeRecordResponse,
      ),
    );
    client.notify("initialized");
    const row: McpServerConfig = {
      id: "fixture-composio",
      name: "composio",
      transport: "http",
      enabled: !test.disabled,
      url: `http://127.0.0.1:${mcp.port}/mcp`,
      headers: [{ key: "x-api-key", value: FIXTURE_KEY }],
      command: "",
      args: [],
      env: [],
      envPassthrough: [],
      workingDirectory: "",
    };
    const usable = await runCauseEffect(usableMcpServers([row]));
    const keyed = (own: CodexOwnTransports) => codexMcpServers(usable, own).servers;
    const own = await runCauseEffect(
      codexDisabledServers(() => readCodexMcpConfig(client, keyed).pipe(toMcpShapeFailed)),
    );
    const servers = keyed(own.transports);
    const directNamespaces = [
      ...VISIBLE_DYNAMIC_TOOLS.map((namespace) => namespace.name),
      ...(test.legacy ? [] : codexMcpToolNamespaces(servers)),
    ];
    const started = await runCauseEffect(
      client.request(
        "thread/start",
        {
          cwd: home,
          model: "local-code-mode-model",
          approvalPolicy: "on-request",
          sandbox: "danger-full-access",
          config: {
            mcp_servers: codexThreadMcpServers(own.disabled, servers),
            tools: { update_plan: { enabled: true } },
            "features.code_mode.direct_only_tool_namespaces": directNamespaces,
          },
          dynamicTools: VISIBLE_DYNAMIC_TOOLS,
        },
        decodeRecordResponse,
      ),
    );
    const threadId = getString(getRecord(started, "thread"), "id");
    assert(threadId, "Codex returned no thread id.");
    await runCauseEffect(
      client.request(
        "turn/start",
        {
          threadId,
          input: [{ type: "text", text: "Read the local calendar fixture." }],
        },
        decodeRecordResponse,
      ),
    );
    const deadline = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`No completed turn for ${test.name}.`)), 30_000).unref();
    });
    return {
      name: test.name,
      configuredKeys: Object.keys(servers).sort(),
      directNamespaces,
      turnStatus: await Promise.race([completed, deadline]),
      discoveredToolCounts: mcp.listings.slice(firstListing),
      toolCalls: mcp.calls.slice(firstCall),
      modelRequests: model.observations.slice(firstRequest),
    };
  } finally {
    await runCauseEffect(client.stop());
  }
}

try {
  for (const test of [
    { name: "legacy", legacy: true },
    { name: "fixed" },
    { name: "clash", clash: true },
    { name: "disabled", disabled: true },
  ]) {
    const outcome = await run(test);
    outcomes.push(outcome);
    assert.equal(outcome.turnStatus, "completed");
    const key = test.clash ? "openbot_composio" : "composio";
    const exposed = outcome.modelRequests[0]?.namespaces.includes(`mcp__${key}`) ?? false;
    assert.equal(exposed, !test.legacy && !test.disabled);
    assert.deepEqual(outcome.configuredKeys, test.disabled ? [] : [key]);
    assert.deepEqual(outcome.toolCalls, test.legacy || test.disabled ? [] : [SEARCH_TOOL]);
    assert.ok(test.disabled ? outcome.discoveredToolCounts.length === 0 : outcome.discoveredToolCounts.includes(11));
    if (exposed) {
      assert.equal(outcome.modelRequests[0]?.toolCount, 11);
      assert.ok(
        outcome.modelRequests.some((request) => request.receivedSafeResult),
        "The model did not receive the MCP result.",
      );
    }
    if (test.clash) assert.ok(!outcome.modelRequests[0]?.namespaces.includes("mcp__composio"));
    if (test.disabled) assert.ok(!outcome.directNamespaces.some((namespace) => namespace.startsWith("mcp__")));
  }
  await writeFile(join(OUT, "report.json"), JSON.stringify({ ok: true, codex: cli.version, outcomes }, null, 2));
  process.stdout.write(`codex-mcp-discovery-e2e: ${outcomes.length} cases passed with Codex ${cli.version}${NL}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await writeFile(join(OUT, "report.json"), JSON.stringify({ ok: false, error: message, outcomes }, null, 2));
  process.stderr.write(`codex-mcp-discovery-e2e failed: ${message}${NL}`);
  process.exitCode = 1;
} finally {
  await mcp.close();
  await model.close();
}
