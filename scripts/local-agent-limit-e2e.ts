// Drives real SQLite stores, AgentService, archive services and TeamApiServer in an isolated
// directory. Browser methods fail if used. Providers are not started, so no paid turn is sent.
// Run: bun scripts/local-agent-limit-e2e.ts
// Artifact: .openbot-build/local-agent-limit-e2e/report.json
import assert from "node:assert/strict";
import { once } from "node:events";
import { rmSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_ROSTER_BYTES_LIMIT, AGENT_ROSTER_ITEMS_LIMIT, INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AgentEvent,
  type ConversationMessage,
  decodeRemoteAgentImportPreview,
  isAgentEvent,
  isAgentRuntimeSnapshot,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import {
  agentCollectionRoute,
  decodeTeamProtocolV2EventFrame,
  encodeLargeAgentRosterEvent,
  encodeTeamProtocolV2Frame,
  LARGE_AGENT_ROSTER_CAPABILITY,
  type LargeAgentRosterEvent,
  TEAM_CURRENT_CAPABILITIES,
} from "@openbot/contracts/team-protocol";
import { AGENT_IMPORT_ROUTES } from "@openbot/contracts/team-protocol/agent-import-v1";
import { INSTANCE_TRANSFER_ROUTES } from "@openbot/contracts/team-protocol/instance-transfer-v1";
import { optionalTeamEvent, optionalTeamEventToCurrent } from "@openbot/contracts/team-protocol/optional-events";
import { teamSideRouteCodec } from "@openbot/contracts/team-protocol/side-routes";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_VERSION_HEADER,
} from "@openbot/contracts/team-protocol/v1";
import { decodeTeamProtocolV7BaseEvent } from "@openbot/contracts/team-protocol/v7-base";
import { encodeTeamProtocolV7BaseCurrentEvent } from "@openbot/contracts/team-protocol/v7-base-adapter";
import { Effect, Result } from "effect";
import { strToU8, zipSync } from "fflate";
import WebSocket from "ws";
import { duplicateAgentIntoLayout } from "../src/backend/agent/duplication-gate";
import { AgentRosterBudgetExceeded, requireAgentRosterBudget } from "../src/backend/agent/roster-admission";
import { buildRuntimeSnapshot } from "../src/backend/agent/runtime-snapshot";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
import { AGENT_IMPORT_MANIFEST } from "../src/main/agent-import-manifest";
import { AgentImportService } from "../src/main/agent-import-service";
import { agentLimitForHost } from "../src/main/agent-limit-environment";
import { InstanceTransferService } from "../src/main/instance-transfer-service";
import { LocalSkillLibrary } from "../src/main/local-skill-library";
import { decodeAgentSummaries } from "../src/main/remote-agent-decoding";
import type { TeamApiBrowser } from "../src/main/team-api/dependencies";
import { TeamApiServer } from "../src/main/team-api-server";
import { TeamStore } from "../src/main/team-store";

const OUT = resolve(import.meta.dirname, "../.openbot-build/local-agent-limit-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-agent-limit-e2e-"));
const checks: Array<{ name: string; count?: number; bytes?: number }> = [];
const hosts: Array<{ service: AgentService; store: AgentStore }> = [];
const sockets: WebSocket[] = [];
let server: TeamApiServer | null = null;
let passed = false;
let failure: string | null = null;

function unexpected(): never {
  throw new Error("This agent-limit check must not use a browser or an external integration.");
}

const browser = {
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

function draft(name: string) {
  return { name, description: "Synthetic agent-limit fixture", avatarSeed: "agent-limit-e2e", avatarHue: null };
}

async function host(name: string, limit: number) {
  const directory = join(root, name);
  const userData = join(directory, "user-data");
  const store = new AgentStore(userData, join(directory, "home"), undefined, limit);
  await runCauseEffect(store.initialize());
  const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
  await runCauseEffect(mailbox.initialize());
  const sidebar = new SidebarLayoutStore(join(userData, "sidebar.json"));
  await runCauseEffect(sidebar.initialize());
  const service = new AgentService({ store, mailbox, browser, sidebarLayout: sidebar });
  hosts.push({ service, store });
  const library = new LocalSkillLibrary(join(userData, "skills"), () => service.listAgents());
  const skills = { library: () => library, installLocal: unexpected };
  const imports = new AgentImportService(
    service,
    skills,
    () => ({ id: "e2e-owner", name: "E2E owner" }),
    () => "UTC",
    join(userData, "imports"),
  );
  const transfer = new InstanceTransferService({
    agents: service,
    skills,
    sharedRoot: store.sharedRoot,
    uploadDirectory: join(userData, "transfers"),
    appVersion: "0.0.0",
    settings: {
      mcpServers: () => service.listMcpServers(),
      saveMcpServer: (config) => service.saveMcpServer({ config }),
      customProviders: () => [],
      saveCustomProvider: unexpected,
      customAgents: () => Effect.succeed([]),
      providersOff: () => [],
      sidebar: () => sidebar.getSnapshot(),
      mutateSidebar: (action) => sidebar.mutate(action, service.sidebarChatIds()),
      routineFlowLinks: () => Effect.succeed([]),
      connectRoutineFlow: unexpected,
      signedInProviders: () => [],
    },
  });
  return { directory, userData, store, mailbox, sidebar, service, imports, transfer };
}

type ReceivedAgentWireEvent = LargeAgentRosterEvent | Extract<AgentEvent, { type: "error" }>;

function receivedAgentWireEvent(value: unknown): ReceivedAgentWireEvent {
  const optional = optionalTeamEvent(value);
  if (optional?.type === "large-agents-changed" || optional?.type === "large-runtime-snapshot") return optional;
  const decoded = decodeTeamProtocolV7BaseEvent(value);
  if (decoded.kind === "known" && decoded.event.type === "error" && isAgentEvent(decoded.event)) return decoded.event;
  throw new Error("Invalid agent-limit WebSocket event.");
}

function receive(socket: WebSocket, type: ReceivedAgentWireEvent["type"]): Promise<ReceivedAgentWireEvent> {
  return new Promise((resolveEvent, reject) => {
    const timeout = setTimeout(() => finish(new Error(`No ${type} event arrived.`)), 10_000);
    const onMessage = (data: WebSocket.RawData) => {
      try {
        const value = JSON.parse(data.toString());
        if (isDynamicRecord(value) && value.type === type) finish(receivedAgentWireEvent(value));
      } catch (error) {
        finish(error instanceof Error ? error : new Error("Invalid event JSON."));
      }
    };
    const onClose = () => finish(new Error(`The socket closed before ${type}.`));
    function finish(result: ReceivedAgentWireEvent | Error) {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("close", onClose);
      if (result instanceof Error) reject(result);
      else resolveEvent(result);
    }
    socket.on("message", onMessage);
    socket.once("close", onClose);
  });
}

function currentEvent(value: unknown): AgentEvent {
  const optional = optionalTeamEvent(value);
  assert.ok(optional);
  const event = optionalTeamEventToCurrent(optional);
  assert.ok(isAgentEvent(event));
  return event;
}

try {
  assert.equal(agentLimitForHost({}, false), INPUT_LIMITS.agents);
  for (const configured of ["0", "-1", "1.5", "abc", "Infinity", String(AGENT_ROSTER_ITEMS_LIMIT + 1)])
    assert.equal(agentLimitForHost({ OPENBOT_AGENT_LIMIT: configured }, false), INPUT_LIMITS.agents);
  assert.equal(agentLimitForHost({ OPENBOT_AGENT_LIMIT: "128" }, true), INPUT_LIMITS.agents);
  assert.equal(agentLimitForHost({ OPENBOT_AGENT_LIMIT: " 128 " }, false), 128);
  checks.push({ name: "invalid configuration falls back and hosted defaults stay at 100" });

  const hostedDefault = await host("hosted-default", agentLimitForHost({ OPENBOT_AGENT_LIMIT: "128" }, true));
  for (let index = 0; index < 100; index++)
    await runCauseEffect(hostedDefault.service.createAgentProfile(draft(`Hosted ${index}`)));
  await assert.rejects(runCauseEffect(hostedDefault.service.createAgentProfile(draft("Hosted over cap"))), /100/u);
  assert.equal(hostedDefault.store.database.listAgents().length, 100);
  checks.push({ name: "real default store refuses the 101st hosted agent", count: 100 });

  const local = await host("local", agentLimitForHost({ OPENBOT_AGENT_LIMIT: "128" }, false));
  for (let index = 0; index < 101; index++)
    await runCauseEffect(local.service.createAgentProfile(draft(`Agent ${index}`)));
  assert.equal(local.service.listAgents().length, 101);
  assert.deepEqual(
    local.store.database
      .listAgents()
      .map((agent) => agent.name)
      .sort(),
    Array.from({ length: 101 }, (_, index) => `Agent ${index}`).sort(),
  );
  const source = local.service.listAgents()[0];
  assert.ok(source);
  await writeFile(join(source.workspacePath, "proof.txt"), "The source workspace stays intact.\n");
  local.service.createMemory({ agentId: source.id, text: "Synthetic source memory survives restore." });
  const copy = await runCauseEffect(duplicateAgentIntoLayout(local.service, local.sidebar, source.id));
  assert.equal(local.service.listAgents().length, 102);
  assert.equal(
    await readFile(join(copy.agent.workspacePath, "proof.txt"), "utf8"),
    await readFile(join(source.workspacePath, "proof.txt"), "utf8"),
  );
  await runCauseEffect(local.service.deleteAgent(copy.agent.id));
  assert.equal(local.service.listAgents().length, 101);
  assert.equal(await readFile(join(source.workspacePath, "proof.txt"), "utf8"), "The source workspace stays intact.\n");
  checks.push({ name: "create and duplicate above 100, then delete the copy", count: 101 });

  const importFile = join(root, "agents.zip");
  const importAgents = Array.from({ length: 110 }, (_, index) => ({
    key: `import-${index}`,
    name: `Imported ${index}`,
    title: "",
    description: "Synthetic import fixture",
    skills: [],
    memories: [],
    routines: [],
  }));
  await writeFile(
    importFile,
    zipSync({
      [AGENT_IMPORT_MANIFEST]: strToU8(
        JSON.stringify({ format: "openbot-agent-import", version: 1, agents: importAgents }),
      ),
    }),
  );
  let preview = await runCauseEffect(local.imports.stage(importFile));
  assert.equal(preview.agents.length, 110);
  const beforeImport = local.store.database.listAgents().map((agent) => agent.id);
  await assert.rejects(
    runCauseEffect(
      local.imports.apply({ token: preview.token, keys: preview.agents.map((agent) => agent.key), channelKeys: [] }),
    ),
    /128/u,
  );
  assert.deepEqual(
    local.store.database.listAgents().map((agent) => agent.id),
    beforeImport,
  );
  preview = await runCauseEffect(local.imports.stage(importFile));
  const imported = await runCauseEffect(
    local.imports.apply({
      token: preview.token,
      keys: preview.agents.slice(0, 3).map((agent) => agent.key),
      channelKeys: [],
    }),
  );
  assert.equal(imported.agents.length, 3);
  assert.equal(imported.skipped.length, 0);
  assert.equal(local.service.listAgents().length, 104);
  checks.push({ name: "large import preview, atomic cap refusal and selected import", count: 104 });

  const transferFile = join(root, "transfer.zip");
  await runCauseEffect(
    local.transfer.exportTo(transferFile, {
      agentIds: local.service.listAgents().map((agent) => agent.id),
      includeFiles: true,
      includeSettings: false,
    }),
  );
  const restored = await host("restored", 128);
  let transferPreview = await runCauseEffect(restored.transfer.stage(transferFile));
  assert.equal(transferPreview.agents.length, 104);
  const transferResult = await runCauseEffect(
    restored.transfer.apply({
      token: transferPreview.token,
      keys: transferPreview.agents.map((agent) => agent.key),
      includeSettings: false,
    }),
  );
  assert.equal(transferResult.agents.length, 104);
  assert.equal(transferResult.skipped.length, 0);
  const restoredSource = restored.service.listAgents().find((agent) => agent.name === source.name);
  assert.ok(restoredSource);
  assert.equal(restored.service.listMemories(restoredSource.id)[0]?.text, "Synthetic source memory survives restore.");
  assert.equal(
    await readFile(join(restoredSource.workspacePath, "proof.txt"), "utf8"),
    "The source workspace stays intact.\n",
  );
  transferPreview = await runCauseEffect(restored.transfer.stage(transferFile));
  const beforeRestore = restored.store.database.listAgents().map((agent) => agent.id);
  await assert.rejects(
    runCauseEffect(
      restored.transfer.apply({
        token: transferPreview.token,
        keys: transferPreview.agents.map((agent) => agent.key),
        includeSettings: false,
      }),
    ),
    /128/u,
  );
  assert.deepEqual(
    restored.store.database.listAgents().map((agent) => agent.id),
    beforeRestore,
  );
  checks.push({
    name: "export and restore over 100 with memory and workspace data; over-cap restore changes no agents",
    count: 104,
  });

  const concurrent = await Promise.allSettled(
    Array.from({ length: 25 }, (_, index) =>
      runCauseEffect(local.service.createAgentProfile(draft(`Concurrent ${index}`))),
    ),
  );
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 24);
  assert.equal(local.service.listAgents().length, 128);
  const beforeWorkspaces = (await readdir(join(local.directory, "home", "OpenBot", "Agents"))).sort();
  await assert.rejects(runCauseEffect(local.store.createAgent(draft("At cap"))), /128/u);
  await assert.rejects(runCauseEffect(local.service.createAgentProfile(draft("Profile at cap"))), /128/u);
  await assert.rejects(runCauseEffect(local.store.duplicateAgent(source.id)), /128/u);
  await assert.rejects(runCauseEffect(local.store.getOrCreate("new-agent-at-cap")), /128/u);
  assert.deepEqual((await readdir(join(local.directory, "home", "OpenBot", "Agents"))).sort(), beforeWorkspaces);
  checks.push({ name: "concurrent last seats and all creation refusals leave no workspace", count: 128 });

  local.store.setMarketplaceSource(source.id, {
    listingId: "fixture-listing",
    versionId: "fixture-version",
    version: 1,
    skillIds: [],
    routineIds: [],
  });
  const team = new TeamStore(join(local.userData, "team.json"));
  await runCauseEffect(team.initialize());
  await runCauseEffect(team.configure("Agent limit E2E", "fixture-owner", "synthetic-password-123"));
  const authenticated = await runCauseEffect(team.login("fixture-owner", "synthetic-password-123"));
  server = new TeamApiServer({
    store: team,
    agents: local.service,
    mailbox: local.mailbox,
    browser,
    sidebarLayout: local.sidebar,
    agentImport: local.imports,
    instanceTransfer: local.transfer,
    appVersion: "0.0.0",
  });
  const port = await runCauseEffect(server.start());
  const headers = {
    Authorization: `Bearer ${authenticated.sessionToken}`,
    [TEAM_PROTOCOL_VERSION_HEADER]: "7",
    [TEAM_APP_VERSION_HEADER]: "0.0.0",
    [TEAM_CAPABILITIES_HEADER]: TEAM_CURRENT_CAPABILITIES.join(","),
  };
  const rosterPath = agentCollectionRoute("/v1/agents", true);
  const response = await fetch(`http://127.0.0.1:${port}${rosterPath}`, { headers });
  assert.equal(response.status, 200);
  const rosterCodec = teamSideRouteCodec(rosterPath);
  assert.ok(rosterCodec);
  const roster = decodeAgentSummaries(rosterCodec.response(rosterPath, 200, await response.json(), { fromHost: true }));
  assert.equal(roster.length, 128);
  assert.ok(roster.some((agent) => agent.id === source.id && agent.name === source.name));
  assert.equal(roster.find((agent) => agent.id === source.id)?.marketplaceSource?.listingId, "fixture-listing");
  const legacy = await fetch(`http://127.0.0.1:${port}/v1/agents`, {
    headers: {
      ...headers,
      [TEAM_CAPABILITIES_HEADER]: TEAM_CURRENT_CAPABILITIES.filter(
        (capability) => capability !== LARGE_AGENT_ROSTER_CAPABILITY,
      ).join(","),
    },
  });
  assert.equal(legacy.status, 409);
  assert.match(await legacy.text(), /Update OpenBot/u);

  const socket = new WebSocket(
    `ws://127.0.0.1:${port}/v1/events`,
    ["openbot-team-v1", `openbot-token.${authenticated.sessionToken}`],
    { headers },
  );
  sockets.push(socket);
  await once(socket, "open");
  const pendingSnapshot = receive(socket, "large-runtime-snapshot");
  socket.send(
    JSON.stringify({ type: "agent-event-scope", includeConversations: false, capabilities: TEAM_CURRENT_CAPABILITIES }),
  );
  const snapshotWire = await pendingSnapshot;
  const snapshot = currentEvent(snapshotWire);
  assert.equal(snapshot.type, "runtime-snapshot");
  assert.ok(snapshot.type === "runtime-snapshot" && isAgentRuntimeSnapshot(snapshot.snapshot));
  if (snapshot.type === "runtime-snapshot") assert.equal(snapshot.snapshot.agents.length, 128);
  const optional = optionalTeamEvent(snapshotWire);
  assert.ok(optional);
  const frame = encodeTeamProtocolV2Frame(
    decodeTeamProtocolV2EventFrame({ version: 2, type: "event", sequence: 1, payload: optional }),
  );
  const decodedFrame = decodeTeamProtocolV2EventFrame(frame);
  assert.ok(decodedFrame.type === "event");
  assert.equal(currentEvent(decodedFrame.payload).type, "runtime-snapshot");
  const pendingRoster = receive(socket, "large-agents-changed");
  await runCauseEffect(local.service.deleteAgent(local.service.listAgents()[0]?.id ?? unexpected()));
  const changed = currentEvent(await pendingRoster);
  assert.equal(changed.type, "agents-changed");
  if (changed.type === "agents-changed") assert.equal(changed.agents.length, 127);

  const oldSocket = new WebSocket(
    `ws://127.0.0.1:${port}/v1/events`,
    ["openbot-team-v1", `openbot-token.${authenticated.sessionToken}`],
    { headers },
  );
  sockets.push(oldSocket);
  await once(oldSocket, "open");
  const pendingError = receive(oldSocket, "error");
  const closed = once(oldSocket, "close");
  oldSocket.send(
    JSON.stringify({
      type: "agent-event-scope",
      includeConversations: false,
      capabilities: TEAM_CURRENT_CAPABILITIES.filter((capability) => capability !== LARGE_AGENT_ROSTER_CAPABILITY),
    }),
  );
  assert.match(JSON.stringify(await pendingError), /client_update_required/u);
  assert.equal((await closed)[0], 1008);
  const control = encodeTeamProtocolV7BaseCurrentEvent({
    type: "agents-changed",
    agents: local.service.listAgents().slice(0, 100),
  });
  assert.ok(control);
  assert.equal(decodeTeamProtocolV7BaseEvent(JSON.parse(control)).kind, "known");
  checks.push({
    name: "real HTTPS and WebSocket large roster, WebRTC frame round trip, legacy update notice and unchanged 100-agent codec",
    count: 127,
  });

  const largeSummaryPath = agentCollectionRoute(INSTANCE_TRANSFER_ROUTES.summary, true);
  const summaryReply = await fetch(`http://127.0.0.1:${port}${largeSummaryPath}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(summaryReply.status, 200);
  const summaryCodec = teamSideRouteCodec(largeSummaryPath);
  assert.ok(summaryCodec);
  const summary = summaryCodec.response(largeSummaryPath, 200, await summaryReply.json());
  assert.match(JSON.stringify(summary), /Agent 0/u);
  const largeImportPath = agentCollectionRoute(AGENT_IMPORT_ROUTES.stage, true);
  const importReply = await fetch(`http://127.0.0.1:${port}${largeImportPath}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/zip" },
    body: await readFile(importFile),
  });
  assert.equal(importReply.status, 200);
  const remotePreview = decodeRemoteAgentImportPreview(await importReply.json());
  assert.equal(remotePreview.agents.length, 110);
  await Effect.runPromise(local.imports.discard(remotePreview.token, authenticated.member.id));
  const largeCodec = teamSideRouteCodec(agentCollectionRoute(INSTANCE_TRANSFER_ROUTES.export, true));
  assert.ok(largeCodec);
  assert.throws(() =>
    largeCodec.request("", {
      agentIds: Array.from({ length: 10_000 }, () => "x".repeat(128)),
      includeFiles: false,
      includeSettings: false,
    }),
  );
  assert.ok(Buffer.byteLength(frame) < AGENT_ROSTER_BYTES_LIMIT);
  checks.push({ name: "negotiated archive routes and encoded byte resource refusal" });

  const nearBudget = await host("near-budget", 1000);
  for (let index = 0; index < 100; index++)
    await runCauseEffect(nearBudget.service.createAgentProfile(draft(`Budget base ${index}`)));
  let saturated = false;
  for (let index = 0; index < 100; index++) {
    try {
      await runCauseEffect(
        nearBudget.service.createAgentProfile({
          ...draft(`Budget large ${index}`),
          description: "\u0001".repeat(INPUT_LIMITS.agentDescription),
        }),
      );
    } catch (error) {
      assert.match(error instanceof Error ? error.message : String(error), /transport budget/u);
      saturated = true;
      break;
    }
  }
  assert.ok(saturated);
  const budgetRoster = nearBudget.service.listAgents();
  assert.ok(budgetRoster.length > 100);
  const budgetEvent = encodeLargeAgentRosterEvent({ type: "agents-changed", agents: budgetRoster });
  assert.ok(budgetEvent);
  assert.ok(Buffer.byteLength(budgetEvent) > AGENT_ROSTER_BYTES_LIMIT * 0.95);
  assert.ok(Buffer.byteLength(budgetEvent) <= AGENT_ROSTER_BYTES_LIMIT);
  assert.ok(isAgentEvent({ type: "agents-changed", agents: budgetRoster }));
  const turnId = "\u0001".repeat(INPUT_LIMITS.identifier);
  for (const [index, agent] of budgetRoster.entries()) {
    const threadId = nearBudget.store.ensureThreadIdNow(agent.id);
    nearBudget.store.database.persistConversation(
      {
        agentId: agent.id,
        threadId,
        activeTurnId: turnId,
        revision: 0,
        messages: [
          {
            id: `message-${index}`,
            turnId,
            author: "assistant",
            text: "\u0001".repeat(240),
            createdAt: "2026-10-15T00:00:00.000Z",
            status: "streaming",
          },
        ] satisfies ConversationMessage[],
      },
      "e2e.runtime-populated",
    );
  }
  // The real builder reads real SQLite and mailbox state. Only attention is an injected bounded
  // external input, so this can force its resource reduction without a provider or a UI window.
  const runtime = buildRuntimeSnapshot({
    agents: nearBudget.service.listAgents(),
    conversation: { loadedSnapshot: () => undefined },
    database: nearBudget.store.database,
    mailbox: nearBudget.mailbox,
    turn: { failedTurns: () => new Map<string, string>() },
    usageLimits: {
      limitedAgents: () => budgetRoster.map((agent) => ({ agentId: agent.id, resetsAt: Number.MAX_VALUE })),
      limitedModels: () => [],
    },
    attention: {
      runtimeAttention: () => ({
        attentionComplete: true,
        pendingApprovals: [],
        pendingBrowserTakeovers: [],
        pendingPrompts: budgetRoster.slice(0, 4).map((agent, index) => ({
          requestId: `prompt-${index}`,
          agentId: agent.id,
          threadId: nearBudget.store.ensureThreadIdNow(agent.id),
          turnId,
          questions: Array.from({ length: INPUT_LIMITS.promptQuestions }, (_, question) => ({
            id: `question-${question}`,
            header: "\u0001".repeat(80),
            question: "\u0001".repeat(240),
            isSecret: false,
            options: Array.from({ length: INPUT_LIMITS.promptOptions }, () => ({
              label: "\u0001".repeat(120),
              description: "\u0001".repeat(120),
            })),
          })),
        })),
      }),
    },
  });
  assert.ok(isAgentRuntimeSnapshot(runtime));
  assert.deepEqual(runtime.agents.map((agent) => agent.id).sort(), budgetRoster.map((agent) => agent.id).sort());
  assert.equal(runtime.activeTurns.length, budgetRoster.length);
  assert.ok(runtime.activeTurns.every((turn) => turn.turnId === turnId));
  const budgetRuntimeEvent = encodeLargeAgentRosterEvent({ type: "runtime-snapshot", snapshot: runtime });
  assert.ok(budgetRuntimeEvent);
  const runtimeRoundTrip = currentEvent(JSON.parse(budgetRuntimeEvent));
  assert.ok(runtimeRoundTrip.type === "runtime-snapshot");
  if (runtimeRoundTrip.type === "runtime-snapshot") {
    assert.deepEqual(runtimeRoundTrip.snapshot.usageLimits, runtime.usageLimits);
    assert.equal(runtimeRoundTrip.snapshot.activeTurns.length, budgetRoster.length);
  }
  assert.ok(Buffer.byteLength(budgetRuntimeEvent) <= AGENT_ROSTER_BYTES_LIMIT);
  const historyAgent = budgetRoster[0];
  assert.ok(historyAgent);
  assert.equal(
    nearBudget.store.database.readConversationMessages(
      historyAgent.id,
      nearBudget.store.ensureThreadIdNow(historyAgent.id),
      ["message-0"],
    )[0]?.text,
    "\u0001".repeat(240),
  );
  checks.push({
    name: "near-budget production roster and runtime reduction retain every agent and active turn",
    count: budgetRoster.length,
    bytes: Buffer.byteLength(budgetEvent),
  });

  const priorBarrierFolders = (await readdir(join(nearBudget.directory, "home", "OpenBot", "Agents"))).sort();
  const changedDuringCreation: Array<{ id: string; description: string }> = [];
  let barrierReached = false;
  let successfulBarrierEdits = 0;
  let initializerReturnedRollback = false;
  let initializationRolledBack = false;
  let unpublishedId: string | null = null;
  await assert.rejects(
    runCauseEffect(
      nearBudget.store.createAgent(draft("Budget changes before publication"), undefined, (id) => {
        unpublishedId = id;
        barrierReached = true;
        const proof = join(nearBudget.directory, "home", "OpenBot", "Agents", id, "initializer-proof.txt");
        try {
          writeFileSync(proof, "Real owned metadata before roster publication");
          // The supported synchronous initializer is a deterministic commit barrier. These are real
          // profile edits through the store, while the new workspace exists but its row is unpublished.
          for (const agent of budgetRoster.filter((entry) => entry.name.startsWith("Budget base"))) {
            changedDuringCreation.push({ id: agent.id, description: agent.description });
            let minimum = 0;
            let maximum = INPUT_LIMITS.agentDescription;
            while (minimum < maximum) {
              const length = Math.ceil((minimum + maximum) / 2);
              // Inspect the typed result. runSync would wrap a failure in FiberFailure, obscuring the
              // actual expected admission error and throwing out of initialization before its rollback.
              const edited = Effect.runSync(
                Effect.result(
                  nearBudget.store.updateAgent({ agentId: agent.id, description: "\u0001".repeat(length) }),
                ),
              );
              if (Result.isFailure(edited)) {
                if (!(edited.failure.cause instanceof AgentRosterBudgetExceeded)) throw edited.failure.cause;
                maximum = length - 1;
              } else {
                successfulBarrierEdits += 1;
                minimum = length;
              }
            }
            if (minimum < INPUT_LIMITS.agentDescription) break;
          }
          initializerReturnedRollback = true;
          return () => {
            initializationRolledBack = true;
            rmSync(proof, { force: true });
          };
        } catch (error) {
          // A callback owns its partial writes until it returns the supported rollback function.
          rmSync(proof, { force: true });
          throw error;
        }
      }),
    ),
    /transport budget/u,
  );
  assert.ok(barrierReached);
  assert.ok(initializerReturnedRollback);
  assert.ok(initializationRolledBack);
  assert.ok(successfulBarrierEdits > 0);
  requireAgentRosterBudget(nearBudget.service.listAgents());
  assert.ok(unpublishedId);
  assert.ok(!nearBudget.service.listAgents().some((agent) => agent.id === unpublishedId));
  assert.equal(nearBudget.service.listAgents().length, budgetRoster.length);
  assert.deepEqual(
    (await readdir(join(nearBudget.directory, "home", "OpenBot", "Agents"))).sort(),
    priorBarrierFolders,
  );
  for (const previous of changedDuringCreation)
    await runCauseEffect(nearBudget.store.updateAgent({ agentId: previous.id, description: previous.description }));
  checks.push({
    name: "real initializer commit barrier rechecks edited bytes, rolls metadata back and removes its unpublished workspace",
  });

  const failedCreation = await host("failed-creation", 128);
  const preservedId = "agent-preexisting-files";
  const preservedFolder = join(failedCreation.directory, "home", "OpenBot", "Agents", preservedId);
  await mkdir(preservedFolder);
  await writeFile(join(preservedFolder, "keep.txt"), "Keep files that existed before a recovered profile");
  failedCreation.store.database.close();
  await assert.rejects(runCauseEffect(failedCreation.store.getOrCreate(preservedId)));
  assert.equal(
    await readFile(join(preservedFolder, "keep.txt"), "utf8"),
    "Keep files that existed before a recovered profile",
  );
  const ownedId = "agent-owned-failed-creation";
  await assert.rejects(runCauseEffect(failedCreation.store.getOrCreate(ownedId)));
  assert.ok(!(await readdir(join(failedCreation.directory, "home", "OpenBot", "Agents"))).includes(ownedId));
  assert.equal(failedCreation.store.list().length, 0);
  await runCauseEffect(failedCreation.service.stop());
  hosts.splice(
    hosts.findIndex((item) => item.store === failedCreation.store),
    1,
  );
  checks.push({
    name: "real SQLite write failure removes only new recovered-profile workspace and keeps preexisting files",
  });

  const heavy = nearBudget.service.listAgents().find((agent) => agent.name.startsWith("Budget large"));
  assert.ok(heavy);
  await runCauseEffect(nearBudget.service.deleteAgent(heavy.id));
  nearBudget.service.checkAgentProfileAdmission([
    { ...draft("Fits by itself"), description: "", avatarSeed: "x".repeat(128) },
  ]);
  const aggregateFile = join(root, "aggregate.zip");
  await writeFile(
    aggregateFile,
    zipSync({
      [AGENT_IMPORT_MANIFEST]: strToU8(
        JSON.stringify({
          format: "openbot-agent-import",
          version: 1,
          agents: Array.from({ length: 100 }, (_, index) => ({
            key: `aggregate-${index}`,
            name: `Aggregate ${index}`,
            title: "",
            description: "",
            skills: [],
            memories: [],
            routines: [],
          })),
        }),
      ),
    }),
  );
  const aggregatePreview = await runCauseEffect(nearBudget.imports.stage(aggregateFile));
  const beforeAggregate = nearBudget.store.database.listAgents().map((agent) => agent.id);
  const beforeAggregateFiles = (await readdir(join(nearBudget.directory, "home", "OpenBot", "Agents"))).sort();
  await assert.rejects(
    runCauseEffect(
      nearBudget.imports.apply({
        token: aggregatePreview.token,
        keys: aggregatePreview.agents.map((agent) => agent.key),
        channelKeys: [],
      }),
    ),
    /transport budget/u,
  );
  assert.deepEqual(
    nearBudget.store.database.listAgents().map((agent) => agent.id),
    beforeAggregate,
  );
  assert.deepEqual(
    (await readdir(join(nearBudget.directory, "home", "OpenBot", "Agents"))).sort(),
    beforeAggregateFiles,
  );
  await runCauseEffect(
    local.sidebar.mutate({ type: "create", name: "Transferred settings" }, local.service.sidebarChatIds()),
  );
  const aggregateTransfer = join(root, "aggregate-transfer.zip");
  await runCauseEffect(
    local.transfer.exportTo(aggregateTransfer, {
      agentIds: local.service
        .listAgents()
        .slice(0, 100)
        .map((agent) => agent.id),
      includeFiles: false,
      includeSettings: true,
    }),
  );
  const aggregateTransferPreview = await runCauseEffect(nearBudget.transfer.stage(aggregateTransfer));
  const beforeSettings = nearBudget.sidebar.getSnapshot();
  await assert.rejects(
    runCauseEffect(
      nearBudget.transfer.apply({
        token: aggregateTransferPreview.token,
        keys: aggregateTransferPreview.agents.map((agent) => agent.key),
        includeSettings: true,
      }),
    ),
    /transport budget/u,
  );
  assert.deepEqual(
    nearBudget.store.database.listAgents().map((agent) => agent.id),
    beforeAggregate,
  );
  assert.deepEqual(nearBudget.sidebar.getSnapshot(), beforeSettings);
  checks.push({ name: "aggregate byte refusal changes no imported agents, workspace or transferred settings" });

  await runCauseEffect(server.stop());
  server = null;
  await runCauseEffect(local.service.stop());
  local.store.database.close();
  hosts.splice(
    hosts.findIndex((item) => item.store === local.store),
    1,
  );
  const lowered = await host("local", 64);
  assert.equal(lowered.service.listAgents().length, 127);
  await assert.rejects(runCauseEffect(lowered.service.createAgentProfile(draft("Reduced cap"))), /64/u);
  await runCauseEffect(lowered.service.updateAgent({ agentId: source.id, name: "Renamed after reduced cap" }));
  assert.equal(lowered.service.listAgents().find((agent) => agent.id === source.id)?.name, "Renamed after reduced cap");
  const remove = lowered.service.listAgents().find((agent) => agent.id !== source.id);
  assert.ok(remove);
  await runCauseEffect(lowered.service.deleteAgent(remove.id));
  assert.equal(lowered.service.listAgents().length, 126);
  checks.push({ name: "restart below saved count preserves data and allows edit/delete", count: 126 });
  const oversizedSource = await host("saved-oversize", 1000);
  for (let index = 0; index < 127; index++)
    await runCauseEffect(oversizedSource.service.createAgentProfile(draft(`Saved oversized ${index}`)));
  const oversizedSaved = oversizedSource.store
    .list()
    .map((agent) => ({ ...agent, description: "\u0001".repeat(INPUT_LIMITS.agentDescription) }));
  oversizedSource.store.database.replaceAgents("e2e.saved-oversize", oversizedSaved, "e2e.saved-oversize");
  await runCauseEffect(oversizedSource.service.stop());
  oversizedSource.store.database.close();
  hosts.splice(
    hosts.findIndex((item) => item.store === oversizedSource.store),
    1,
  );
  const oversized = await host("saved-oversize", 1000);
  assert.equal(oversized.service.listAgents().length, oversizedSaved.length);
  assert.deepEqual(
    oversized.service.listAgents().map((agent) => agent.description),
    oversizedSaved.map((agent) => agent.description),
  );
  const oversizedFolders = (await readdir(join(oversized.directory, "home", "OpenBot", "Agents"))).sort();
  await assert.rejects(
    runCauseEffect(oversized.service.createAgentProfile(draft("No room in saved data"))),
    /transport budget/u,
  );
  const repair = oversizedSaved[0];
  assert.ok(repair);
  for (const length of [1900, 1800]) {
    await runCauseEffect(oversized.service.updateAgent({ agentId: repair.id, description: "\u0001".repeat(length) }));
    assert.equal(
      oversized.store.database.listAgents().find((agent) => agent.id === repair.id)?.description,
      "\u0001".repeat(length),
    );
    assert.throws(
      () => encodeLargeAgentRosterEvent({ type: "agents-changed", agents: oversized.service.listAgents() }),
      /transport budget/u,
    );
  }
  await assert.rejects(
    runCauseEffect(oversized.service.updateAgent({ agentId: repair.id, description: "\u0001".repeat(2000) })),
    /transport budget/u,
  );
  assert.equal(oversized.service.listAgents().find((agent) => agent.id === repair.id)?.description.length, 1800);
  assert.deepEqual((await readdir(join(oversized.directory, "home", "OpenBot", "Agents"))).sort(), oversizedFolders);
  const oversizedTeam = new TeamStore(join(oversized.userData, "team.json"));
  await runCauseEffect(oversizedTeam.initialize());
  await runCauseEffect(oversizedTeam.configure("Saved oversized E2E", "oversized-owner", "synthetic-password-123"));
  const oversizedLogin = await runCauseEffect(oversizedTeam.login("oversized-owner", "synthetic-password-123"));
  server = new TeamApiServer({
    store: oversizedTeam,
    agents: oversized.service,
    mailbox: oversized.mailbox,
    browser,
    sidebarLayout: oversized.sidebar,
    appVersion: "0.0.0",
  });
  const oversizedPort = await runCauseEffect(server.start());
  const oversizedHeaders = { ...headers, Authorization: `Bearer ${oversizedLogin.sessionToken}` };
  const oversizedRemote = await fetch(`http://127.0.0.1:${oversizedPort}${rosterPath}`, { headers: oversizedHeaders });
  assert.equal(oversizedRemote.status, 409);
  assert.match(await oversizedRemote.text(), /transport budget/u);
  const oversizedLegacy = await fetch(`http://127.0.0.1:${oversizedPort}/v1/agents`, {
    headers: {
      ...oversizedHeaders,
      [TEAM_CAPABILITIES_HEADER]: TEAM_CURRENT_CAPABILITIES.filter(
        (capability) => capability !== LARGE_AGENT_ROSTER_CAPABILITY,
      ).join(","),
    },
  });
  assert.equal(oversizedLegacy.status, 409);
  assert.match(await oversizedLegacy.text(), /Update OpenBot/u);
  await runCauseEffect(server.stop());
  server = null;
  for (const agent of oversizedSaved)
    await runCauseEffect(oversized.service.updateAgent({ agentId: agent.id, description: "" }));
  assert.equal(oversized.service.listAgents().length, oversizedSaved.length);
  assert.ok(encodeLargeAgentRosterEvent({ type: "agents-changed", agents: oversized.service.listAgents() }));
  await runCauseEffect(oversized.service.createAgentProfile(draft("Created after saved data repair")));
  checks.push({
    name: "saved oversized profiles survive restart, reduce in multiple steps, block expansion and tell both remote clients",
    count: oversizedSaved.length,
  });
  passed = true;
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  for (const socket of sockets) socket.terminate();
  if (server) await runCauseEffect(server.stop());
  for (const item of hosts) {
    await runCauseEffect(item.service.stop());
    item.store.database.close();
  }
  await mkdir(OUT, { recursive: true });
  await writeFile(
    join(OUT, "report.json"),
    `${JSON.stringify({ passed, failure, checks, paidProviderTurns: 0, browserOperations: 0, transportBudget: AGENT_ROSTER_BYTES_LIMIT }, null, 2)}\n`,
  );
  await rm(root, { recursive: true, force: true });
  // Machine-readable: the local script and CI record the same bounded report.
  process.stdout.write(`${JSON.stringify({ passed, checks: checks.length, report: join(OUT, "report.json") })}\n`);
}
