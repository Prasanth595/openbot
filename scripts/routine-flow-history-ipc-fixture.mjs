// Owned synthetic IPC host. No Electron app, provider or user profile is opened.

import { mock } from "bun:test";
import assert from "node:assert/strict";
import { IPC_ENDPOINTS } from "@openbot/contracts/ipc";
import { ROUTINE_FLOW_HISTORY_CAPABILITY } from "@openbot/contracts/team-protocol/routine-flow-history-v1";
import { TEAM_CAPABILITIES_HEADER, TEAM_PROTOCOL_VERSION_HEADER } from "@openbot/contracts/team-protocol/v1";
import { createOpenBotLogger, registerSecretValue } from "@openbot/logging";
import { Effect } from "effect";
import { AgentRoutineStore } from "../src/backend/agent-routine-store.ts";
import { OpenBotDatabase } from "../src/backend/openbot-database.ts";
import { routineFlowRoutines } from "../src/backend/routine-flows/routine-flow-routines.ts";
import { RoutineFlowStore } from "../src/backend/routine-flows/routine-flow-store.ts";
import { createRoutineFlows } from "../src/backend/routine-flows/routine-flows.ts";
import {
  decodeRoutineFlowHistoryPage,
  decodeRoutineFlowHistoryRun,
} from "../src/preload/routine-flow-history-decoding.ts";

const [directory, origin, agentId, routineId, runId] = process.argv.slice(2);
assert.ok(directory && origin && agentId && routineId && runId, "Fixture arguments are required.");
registerSecretValue(directory);
registerSecretValue(process.cwd());
const registrations = new Map();
mock.module("electron", () => ({ ipcMain: { handle: (channel, listener) => registrations.set(channel, listener) } }));
const { routineFlowHistoryIpcHandlers } = await import("../src/main/ipc/routine-flow-history-handlers.ts");
const database = new OpenBotDatabase(directory);
let flow;
let capability = true;
let remoteCalls = 0;
try {
  await Effect.runPromise(database.initialize());
  flow = await Effect.runPromise(
    createRoutineFlows({
      store: new RoutineFlowStore({ database }),
      routines: routineFlowRoutines(new AgentRoutineStore(database)),
      delivery: () => {
        throw new Error("History must not read a delivery.");
      },
      turnAnswer: () => {
        throw new Error("History must not read provider history.");
      },
      agentName: (id) => id,
      sendHandoff: () => Effect.die("History must not send work."),
      changed: () => {
        throw new Error("History must not publish a mutation.");
      },
    }),
  );
  const group = routineFlowHistoryIpcHandlers({
    routineFlows: flow,
    remoteServers: {
      supportsCapability: (_server, name) => capability && name === ROUTINE_FLOW_HISTORY_CAPABILITY,
      request: (_server, path, decode, init) =>
        Effect.tryPromise({
          try: async () => {
            remoteCalls += 1;
            const response = await fetch(origin + path, {
              method: init?.method,
              headers: {
                "Content-Type": "application/json",
                [TEAM_PROTOCOL_VERSION_HEADER]: "7",
                [TEAM_CAPABILITIES_HEADER]: ROUTINE_FLOW_HISTORY_CAPABILITY,
              },
              body: JSON.stringify(init?.body),
              signal: AbortSignal.timeout(10000),
            });
            assert.equal(response.status, 200);
            return decode(await response.json());
          },
          catch: (cause) => ({ cause }),
        }),
    },
  }).routineFlowHistory;
  group.page(IPC_ENDPOINTS.routineFlowHistory.page.channel);
  group.run(IPC_ENDPOINTS.routineFlowHistory.run.channel);
  const invoke = async (name, serverId, payload) => {
    const handler = registrations.get(IPC_ENDPOINTS.routineFlowHistory[name].channel);
    assert.ok(handler);
    return handler({ senderFrame: { url: "openbot-app://app/index.html" } }, { serverId, payload });
  };
  const localPage = decodeRoutineFlowHistoryPage(await invoke("page", "local", { agentId, routineId }));
  assert.equal(localPage.runs.length, 20);
  const localRun = decodeRoutineFlowHistoryRun(await invoke("run", "local", { agentId, routineId, runId }));
  assert.equal(localRun.run.id, runId);
  assert.ok(localRun.steps.length > 0);
  const remotePage = decodeRoutineFlowHistoryPage(await invoke("page", "fixture-host", { agentId, routineId }));
  assert.deepEqual(remotePage, localPage);
  const remoteRun = decodeRoutineFlowHistoryRun(await invoke("run", "fixture-host", { agentId, routineId, runId }));
  assert.deepEqual(remoteRun, localRun);
  capability = false;
  await assert.rejects(invoke("page", "fixture-old-host", { agentId, routineId }));
  assert.equal(remoteCalls, 2);
  await assert.rejects(invoke("run", "local", { agentId, routineId }));
  createOpenBotLogger("routine-flow-history-ipc-fixture").info("IPC fixture passed.", {
    localReads: 2,
    remoteReads: 2,
    oldHostRequests: 0,
    malformedRequests: 1,
  });
} catch (error) {
  createOpenBotLogger("routine-flow-history-ipc-fixture").error("IPC fixture failed.", error);
  process.exitCode = 1;
} finally {
  try {
    if (flow) await Effect.runPromise(flow.close().pipe(Effect.timeout(10000)));
  } catch (error) {
    createOpenBotLogger("routine-flow-history-ipc-fixture").error("IPC runtime cleanup failed.", error);
    process.exitCode = 1;
  }
  try {
    database.close();
  } catch (error) {
    createOpenBotLogger("routine-flow-history-ipc-fixture").error("IPC database cleanup failed.", error);
    process.exitCode = 1;
  }
}
