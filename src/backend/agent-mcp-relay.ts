import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  CallToolResultSchema,
  CancelledNotificationSchema,
  GetPromptRequestSchema,
  type GetPromptResult,
  GetPromptResultSchema,
  ListPromptsRequestSchema,
  type ListPromptsResult,
  ListPromptsResultSchema,
  ListResourcesRequestSchema,
  type ListResourcesResult,
  ListResourcesResultSchema,
  ListResourceTemplatesRequestSchema,
  type ListResourceTemplatesResult,
  ListResourceTemplatesResultSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type ReadResourceResult,
  ReadResourceResultSchema,
  type RequestId,
  type ServerCapabilities,
  type Tool,
  ToolSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AGENT_MCP_LIMITS,
  type AgentMcpGrants,
  type AgentMcpTool,
  agentMcpServerAllowed,
  agentMcpToolAllowed,
  agentMcpWithinBytes,
  type McpServerConfig,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Semaphore } from "effect";
import { runCauseEffect } from "./effect-boundary";
import { readJsonBody } from "./local-mcp-bridge";
import { type McpOperationError, mcpCall, mcpFailure } from "./mcp-effects";
import {
  type McpAuthorizationSource,
  type McpToolRuntimeSource,
  mcpHandoffHeaders,
  mcpLaunchEnvironment,
  usableMcpServer,
} from "./mcp-provider-shapes";
import { McpServerError } from "./mcp-server-store";

type RelayPayload =
  | Tool
  | CallToolResult
  | ListResourcesResult
  | ListResourceTemplatesResult
  | ReadResourceResult
  | ListPromptsResult
  | GetPromptResult;

interface RelayRoute {
  agentId: string;
  serverId: string;
  token: string;
  gate: Semaphore.Semaphore;
  lifetime: AbortController;
  clients: Set<Client>;
  pending: Set<Deferred.Deferred<void>>;
  running: Map<RequestId, AbortController>;
  link: { client: Client; fingerprint: string } | null;
}
export interface AgentMcpRelayOptions {
  agentExists(agentId: string): boolean;
  grants(agentId: string): AgentMcpGrants;
  servers(): readonly McpServerConfig[];
  runtimes?: McpToolRuntimeSource;
  authorization?: McpAuthorizationSource;
  redact(text: string): string;
  registerSecret(value: string): void;
}

/** Owns agent-scoped loopback routes and their upstream clients. It never imports the agent facade. */
export class AgentMcpRelay {
  readonly #routes = new Map<string, RelayRoute>();
  readonly #tokens = new Map<string, RelayRoute>();
  readonly #listenGate = Semaphore.makeUnsafe(1);
  readonly #requests = new Set<Promise<void>>();
  #server: HttpServer | null = null;
  #port: number | null = null;
  #closed = false;
  constructor(private readonly options: AgentMcpRelayOptions) {}

  readonly configs = Effect.fn("AgentMcpRelay.configs")(function* (
    this: AgentMcpRelay,
    agentId: string,
    servers: readonly McpServerConfig[],
  ) {
    const grants = this.options.grants(agentId);
    if (grants === null) return servers;
    yield* this.#listenGate.withPermit(this.#listen());
    if (this.#closed) return yield* mcpFailure(new Error(sourceText("error.backend.shuttingDown")));
    return servers
      .filter((server) => agentMcpServerAllowed(grants, server.id))
      .map((server): McpServerConfig => {
        const route = this.#route(agentId, server.id);
        return {
          ...server,
          transport: "http",
          command: "",
          args: [],
          env: [],
          envPassthrough: [],
          workingDirectory: "",
          url: `http://127.0.0.1:${this.#port}/mcp`,
          headers: [{ key: "Authorization", value: `Bearer ${route.token}` }],
        };
      });
  });

  readonly tools = Effect.fnUntraced(function* (
    this: AgentMcpRelay,
    agentId: string,
    serverId: string,
    query?: string,
  ): Effect.fn.Return<AgentMcpTool[], McpOperationError> {
    const route = this.#route(agentId, serverId);
    return yield* this.#withRoute(route, (signal) =>
      Effect.gen({ self: this }, function* () {
        const client = yield* this.#client(route, signal, false);
        const tools = (yield* this.#tools(client, signal))
          .filter((tool) => tool.name.toLowerCase().includes((query ?? "").toLowerCase()))
          .map((tool) => ({
            name: tool.name,
            description: this.options.redact(tool.description ?? "").slice(0, AGENT_MCP_LIMITS.descriptionChars),
          }));
        if (tools.length > AGENT_MCP_LIMITS.toolsCount || !agentMcpWithinBytes(tools, AGENT_MCP_LIMITS.payloadBytes))
          return yield* mcpFailure(new McpServerError(sourceText("error.backend.agentMcpToolsTooLarge")));
        if (tools.some((tool) => tool.name.length > 256 || this.options.redact(tool.name) !== tool.name))
          return yield* mcpFailure(new McpServerError(sourceText("error.backend.agentMcpRequestFailed")));
        return tools;
      }),
    ).pipe(
      Effect.mapError((failure) =>
        failure.cause instanceof McpServerError
          ? failure
          : mcpFailure(new McpServerError(sourceText("error.backend.agentMcpRequestFailed"))),
      ),
    );
  });

  readonly close = Effect.fn("AgentMcpRelay.close")(function* (this: AgentMcpRelay) {
    this.#closed = true;
    const routes = [...this.#routes.values()];
    for (const route of routes) route.lifetime.abort();
    // Closing a client cancels its SDK requests. It must not wait behind the request's permit.
    yield* this.#closeClients(routes);
    yield* Effect.forEach(
      routes.flatMap((route) => [...route.pending]),
      Deferred.await,
      { concurrency: "unbounded", discard: true },
    );
    // Let the downstream MCP server send the owned request's error before closing its SSE stream.
    // A bare stream EOF leaves the SDK caller waiting for its original request timeout.
    yield* mcpCall(() => Promise.all([...this.#requests]));
    yield* this.#listenGate.withPermit(
      Effect.gen({ self: this }, function* () {
        const server = this.#server;
        this.#server = null;
        this.#port = null;
        this.#tokens.clear();
        if (server)
          yield* mcpCall(
            () =>
              new Promise<void>((resolve) => {
                server.close(() => resolve());
                server.closeIdleConnections();
              }),
          );
      }),
    );
    yield* mcpCall(() => Promise.all([...this.#requests]));
    this.#routes.clear();
  }, Effect.uninterruptible);

  open(): void {
    this.#closed = false;
  }

  readonly clearAgent = Effect.fn("AgentMcpRelay.clearAgent")(function* (this: AgentMcpRelay, agentId: string) {
    const routes: RelayRoute[] = [];
    for (const [key, route] of this.#routes) {
      if (route.agentId !== agentId) continue;
      route.lifetime.abort();
      this.#tokens.delete(route.token);
      this.#routes.delete(key);
      routes.push(route);
    }
    yield* this.#closeClients(routes);
    yield* Effect.forEach(
      routes.flatMap((route) => [...route.pending]),
      Deferred.await,
      { concurrency: "unbounded", discard: true },
    );
  });

  readonly #closeClients = Effect.fnUntraced(function* (this: AgentMcpRelay, routes: readonly RelayRoute[]) {
    const clients = new Set(routes.flatMap((route) => [...route.clients]));
    for (const route of routes) route.link = null;
    yield* Effect.forEach(clients, (client) => mcpCall(() => client.close()).pipe(Effect.ignore), {
      concurrency: "unbounded",
      discard: true,
    });
  });

  #aborted(signal: AbortSignal): Effect.Effect<never, McpOperationError> {
    return Effect.callback((resume) => {
      const abort = () => resume(Effect.fail(mcpFailure(new Error(sourceText("error.backend.agentMcpDenied")))));
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
      return Effect.sync(() => signal.removeEventListener("abort", abort));
    });
  }

  #withRoute<A>(
    route: RelayRoute,
    operation: (signal: AbortSignal) => Effect.Effect<A, McpOperationError>,
    signal = route.lifetime.signal,
  ): Effect.Effect<A, McpOperationError> {
    return Effect.acquireUseRelease(
      Effect.sync(() => {
        const done = Deferred.makeUnsafe<void>();
        route.pending.add(done);
        return done;
      }),
      () => Effect.raceFirst(route.gate.withPermit(Effect.suspend(() => operation(signal))), this.#aborted(signal)),
      (done) =>
        Effect.gen(function* () {
          route.pending.delete(done);
          yield* Deferred.succeed(done, undefined);
        }),
    );
  }

  #redactResult(value: RelayPayload): unknown {
    return JSON.parse(
      JSON.stringify(value, (_key: string, entry: unknown) => {
        if (typeof entry === "string") return this.options.redact(entry);
        if (entry !== null && typeof entry === "object" && !Array.isArray(entry))
          return Object.fromEntries(Object.entries(entry).map(([key, value]) => [this.options.redact(key), value]));
        return entry;
      }),
    );
  }

  #route(agentId: string, serverId: string): RelayRoute {
    const key = JSON.stringify([agentId, serverId]);
    const prior = this.#routes.get(key);
    if (prior) return prior;
    const route: RelayRoute = {
      agentId,
      serverId,
      token: randomBytes(32).toString("base64url"),
      gate: Semaphore.makeUnsafe(1),
      lifetime: new AbortController(),
      clients: new Set(),
      pending: new Set(),
      running: new Map(),
      link: null,
    };
    this.options.registerSecret(route.token);
    this.#routes.set(key, route);
    this.#tokens.set(route.token, route);
    return route;
  }

  #serverFor(route: RelayRoute, enforceGrant: boolean): McpServerConfig {
    const server = this.options.servers().find((candidate) => candidate.id === route.serverId && candidate.enabled);
    if (
      this.#closed ||
      !this.options.agentExists(route.agentId) ||
      !server ||
      (enforceGrant && !agentMcpServerAllowed(this.options.grants(route.agentId), route.serverId))
    )
      throw new Error(sourceText("error.backend.agentMcpDenied"));
    return server;
  }

  readonly #client = Effect.fnUntraced(function* (
    this: AgentMcpRelay,
    route: RelayRoute,
    signal: AbortSignal,
    enforceGrant = true,
  ): Effect.fn.Return<Client, McpOperationError> {
    const config = yield* Effect.try({ try: () => this.#serverFor(route, enforceGrant), catch: mcpFailure });
    const resolved = yield* usableMcpServer(config, this.options.runtimes?.(), this.options.authorization).pipe(
      Effect.mapError((failure) => mcpFailure(failure.cause)),
    );
    if (resolved.error !== undefined) return yield* mcpFailure(new Error(this.options.redact(resolved.error)));
    yield* Effect.try({
      try: () => {
        signal.throwIfAborted();
        this.#serverFor(route, enforceGrant);
      },
      catch: mcpFailure,
    });
    const fingerprint = createHash("sha256").update(JSON.stringify(resolved)).digest("hex");
    if (route.link?.fingerprint === fingerprint) return route.link.client;
    const previous = route.link;
    route.link = null;
    if (previous) yield* mcpCall(() => previous.client.close()).pipe(Effect.ignore);
    const transport =
      config.transport === "http"
        ? new StreamableHTTPClientTransport(new URL(config.url), {
            requestInit: { headers: mcpHandoffHeaders(resolved) },
          })
        : new StdioClientTransport({
            command: resolved.command,
            args: config.args,
            ...(resolved.workingDirectory ? { cwd: resolved.workingDirectory } : {}),
            env: { ...getDefaultEnvironment(), ...mcpLaunchEnvironment(resolved) },
            stderr: "ignore",
          });
    const client = new Client({ name: "openbot-agent-mcp", version: "1" }, { capabilities: {} });
    route.clients.add(client);
    client.onclose = () => {
      route.clients.delete(client);
      if (route.link?.client === client) route.link = null;
    };
    yield* Effect.tryPromise({
      try: (effectSignal) => client.connect(transport, { signal: AbortSignal.any([signal, effectSignal]) }),
      catch: mcpFailure,
    }).pipe(
      Effect.onError(() => mcpCall(() => client.close()).pipe(Effect.ignore)),
      Effect.onInterrupt(() => mcpCall(() => client.close()).pipe(Effect.ignore)),
    );
    yield* Effect.try({ try: () => this.#serverFor(route, enforceGrant), catch: mcpFailure }).pipe(
      Effect.onError(() => mcpCall(() => client.close()).pipe(Effect.ignore)),
    );
    route.link = { client, fingerprint };
    return client;
  });

  readonly #tools = Effect.fnUntraced(function* (this: AgentMcpRelay, client: Client, signal: AbortSignal) {
    if (!client.getServerCapabilities()?.tools) return [];
    const tools: Tool[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (;;) {
      const page = yield* Effect.tryPromise({
        try: (effectSignal) =>
          client.listTools(cursor === undefined ? undefined : { cursor }, {
            signal: AbortSignal.any([signal, effectSignal]),
          }),
        catch: mcpFailure,
      });
      tools.push(...page.tools);
      if (tools.length > INPUT_LIMITS.mcpToolCount) return yield* mcpFailure(new Error("Too many MCP tools."));
      if (page.nextCursor === undefined) return tools;
      if (cursors.has(page.nextCursor)) return yield* mcpFailure(new Error("Repeated MCP tools cursor."));
      cursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
  });

  readonly #listen = Effect.fnUntraced(function* (this: AgentMcpRelay) {
    if (this.#server || this.#closed) return;
    const server = createServer((request, response) => {
      const task = runCauseEffect(this.#handle(request, response)).catch(() => {
        if (!response.headersSent) response.writeHead(500);
        response.end();
      });
      this.#requests.add(task);
      void task.then(
        () => this.#requests.delete(task),
        () => this.#requests.delete(task),
      );
    });
    yield* mcpCall(
      () =>
        new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", () => {
            server.off("error", reject);
            resolve();
          });
        }),
    ).pipe(
      Effect.onError(() =>
        mcpCall(() => new Promise<void>((resolve) => server.close(() => resolve()))).pipe(Effect.ignore),
      ),
    );
    const address = server.address();
    if (!address || typeof address === "string") return yield* mcpFailure(new Error("Unable to bind agent MCP relay."));
    this.#server = server;
    this.#port = address.port;
  });

  readonly #handle = Effect.fnUntraced(function* (
    this: AgentMcpRelay,
    request: IncomingMessage,
    response: ServerResponse,
  ) {
    const bearer = request.headers.authorization;
    const route = bearer?.startsWith("Bearer ") ? this.#tokens.get(bearer.slice(7)) : undefined;
    if (!route || request.url !== "/mcp") {
      response.writeHead(401);
      response.end();
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405, { allow: "POST" });
      response.end();
      return;
    }
    const lifetime = route.lifetime.signal;
    const body = yield* Effect.raceFirst(readJsonBody(request), this.#aborted(lifetime));
    // Stateless POST transports cannot find the previous POST's request. Cancel it at its owner.
    const cancelled = CancelledNotificationSchema.safeParse(body);
    if (cancelled.success) {
      const requestId = cancelled.data.params.requestId;
      if (requestId !== undefined) route.running.get(requestId)?.abort();
      response.writeHead(202);
      response.end();
      return;
    }
    const upstream = yield* this.#withRoute(
      route,
      (signal) => this.#client(route, signal).pipe(Effect.map((client) => client.getServerCapabilities())),
      lifetime,
    );
    const capabilities: ServerCapabilities = {
      ...(upstream?.tools ? { tools: {} } : {}),
      ...(upstream?.resources ? { resources: {} } : {}),
      ...(upstream?.prompts ? { prompts: {} } : {}),
    };
    const mcp = new Server({ name: "openbot-agent-mcp", version: "1" }, { capabilities });
    const perform = <A>(
      operation: (client: Client, signal: AbortSignal) => Effect.Effect<A, McpOperationError>,
      signal: AbortSignal,
      requestId: RequestId,
    ) =>
      runCauseEffect(
        Effect.acquireUseRelease(
          Effect.sync(() => {
            const controller = new AbortController();
            route.running.set(requestId, controller);
            return controller;
          }),
          (controller) =>
            this.#withRoute(
              route,
              (signal) =>
                Effect.gen({ self: this }, function* () {
                  const client = yield* this.#client(route, signal);
                  return yield* operation(client, signal);
                }),
              AbortSignal.any([lifetime, signal, controller.signal]),
            ),
          (controller) =>
            Effect.sync(() => {
              if (route.running.get(requestId) === controller) route.running.delete(requestId);
            }),
        ),
      );
    const call =
      <A>(operation: (client: Client, signal: AbortSignal) => Promise<A>) =>
      (client: Client, signal: AbortSignal) =>
        Effect.tryPromise({
          try: (effectSignal) => operation(client, AbortSignal.any([signal, effectSignal])),
          catch: () => mcpFailure(new Error(sourceText("error.backend.agentMcpRequestFailed"))),
        });
    if (capabilities.tools) {
      mcp.setRequestHandler(ListToolsRequestSchema, (_request, extra) =>
        perform(
          (client, signal) =>
            this.#tools(client, signal).pipe(
              Effect.map((tools) => {
                const grants = this.options.grants(route.agentId);
                const selected = grants?.find((grant) => grant.mcpServerId === route.serverId);
                const names = grants === null || selected?.tools === null ? null : new Set(selected?.tools ?? []);
                return {
                  tools: tools
                    .filter((tool) => names === null || names.has(tool.name))
                    .map((tool) => ToolSchema.parse(this.#redactResult(tool))),
                };
              }),
            ),
          extra.signal,
          extra.requestId,
        ),
      );
      mcp.setRequestHandler(CallToolRequestSchema, ({ params }, extra) =>
        perform(
          call(async (client, signal) => {
            this.#serverFor(route, true);
            if (!agentMcpToolAllowed(this.options.grants(route.agentId), route.serverId, params.name))
              throw new Error(sourceText("error.backend.agentMcpDenied"));
            const result = CallToolResultSchema.parse(await client.callTool(params, CallToolResultSchema, { signal }));
            return CallToolResultSchema.parse(this.#redactResult(result));
          }),
          extra.signal,
          extra.requestId,
        ),
      );
    }
    if (capabilities.resources) {
      mcp.setRequestHandler(ListResourcesRequestSchema, ({ params }, extra) =>
        perform(
          call(async (client, signal) =>
            ListResourcesResultSchema.parse(this.#redactResult(await client.listResources(params, { signal }))),
          ),
          extra.signal,
          extra.requestId,
        ),
      );
      mcp.setRequestHandler(ListResourceTemplatesRequestSchema, ({ params }, extra) =>
        perform(
          call(async (client, signal) =>
            ListResourceTemplatesResultSchema.parse(
              this.#redactResult(await client.listResourceTemplates(params, { signal })),
            ),
          ),
          extra.signal,
          extra.requestId,
        ),
      );
      mcp.setRequestHandler(ReadResourceRequestSchema, ({ params }, extra) =>
        perform(
          call(async (client, signal) =>
            ReadResourceResultSchema.parse(this.#redactResult(await client.readResource(params, { signal }))),
          ),
          extra.signal,
          extra.requestId,
        ),
      );
    }
    if (capabilities.prompts) {
      mcp.setRequestHandler(ListPromptsRequestSchema, ({ params }, extra) =>
        perform(
          call(async (client, signal) =>
            ListPromptsResultSchema.parse(this.#redactResult(await client.listPrompts(params, { signal }))),
          ),
          extra.signal,
          extra.requestId,
        ),
      );
      mcp.setRequestHandler(GetPromptRequestSchema, ({ params }, extra) =>
        perform(
          call(async (client, signal) =>
            GetPromptResultSchema.parse(this.#redactResult(await client.getPrompt(params, { signal }))),
          ),
          extra.signal,
          extra.requestId,
        ),
      );
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    yield* Effect.gen(function* () {
      yield* mcpCall(() => mcp.connect(transport));
      yield* mcpCall(() => transport.handleRequest(request, response, body));
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          yield* mcpCall(() => transport.close()).pipe(Effect.ignore);
          yield* mcpCall(() => mcp.close()).pipe(Effect.ignore);
        }),
      ),
    );
  });
}
