// Runs the production device preference and request boundary with file-backed storage and two
// loopback hosts. No native app, account or user data is used. The native setting and keychain
// adapter still need a device smoke check.
// `bun scripts/mobile-local-agents-e2e.ts` writes .openbot-build/mobile-local-agents-e2e/report.json.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { CONTEXT_RESET_ROUTES } from "@openbot/contracts/team-protocol/context-reset-v1";
import {
  LOCAL_AGENTS_PREFERENCE_KEY,
  LocalAgentsDisabledError,
  LocalAgentsPreference,
  type LocalAgentsPreferenceStorage,
} from "../apps/mobile/src/features/settings/model/local-agents-preference";

const OUT = resolve(import.meta.dirname, "../.openbot-build/mobile-local-agents-e2e");
const LOCAL = "paired-computer";
const REMOTE = "self-hosted-vps";
const DISABLED = "Local agents are disabled on this device.";

function storage(path: string): LocalAgentsPreferenceStorage {
  return {
    get: async (key) => {
      assert.equal(key, LOCAL_AGENTS_PREFERENCE_KEY);
      try {
        return await readFile(path, "utf8");
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
        throw error;
      }
    },
    set: async (key, value) => {
      assert.equal(key, LOCAL_AGENTS_PREFERENCE_KEY);
      await writeFile(path, value, { mode: 0o600 });
    },
  };
}

interface Host {
  id: string;
  baseUrl: string;
  requests: string[];
  started: Promise<void>;
  finish: () => void;
  close: () => Promise<void>;
}

async function host(id: string): Promise<Host> {
  const requests: string[] = [];
  let started: () => void = () => {};
  let finish: () => void = () => {};
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const finishPromise = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const server = createServer(async (request, response) => {
    const path = request.url ?? "/";
    requests.push(path);
    if (path === "/in-flight") {
      started();
      await finishPromise;
    }
    response.writeHead(200, { "content-type": "text/plain" }).end(`${id}:${path}`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    id,
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    started: startedPromise,
    finish,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function request(preference: LocalAgentsPreference, target: Host, path: string): Promise<string> {
  return preference.request(
    target.id,
    LOCAL,
    async () => {
      const response = await fetch(`${target.baseUrl}${path}`, { method: "POST" });
      assert.equal(response.status, 200);
      return response.text();
    },
    DISABLED,
  );
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "openbot-mobile-local-agents-e2e-"));
  const preferencePath = join(root, "preference");
  const results: string[] = [];
  const hosts: Host[] = [];
  let passed = false;
  try {
    const local = await host(LOCAL);
    const remote = await host(REMOTE);
    hosts.push(local, remote);
    const agents = [
      { id: "local-agent", serverId: LOCAL, settings: { provider: "codex" }, chats: ["saved-local-chat"] },
      { id: "remote-agent", serverId: REMOTE, settings: { provider: "claude" }, chats: ["saved-vps-chat"] },
    ];
    const originalAgents = JSON.stringify(agents);
    const originalHosts = JSON.stringify(hosts.map((server) => ({ id: server.id, baseUrl: server.baseUrl })));
    const preference = new LocalAgentsPreference(storage(preferencePath));

    await assert.rejects(request(preference, local, TEAM_API_ROUTES.respond.approval), LocalAgentsDisabledError);
    assert.equal(await request(preference, remote, "/before-load"), `${REMOTE}:/before-load`);
    results.push("Startup blocks Local before storage loads and keeps the VPS available.");

    await Promise.all([preference.load(), preference.load()]);
    assert.equal(preference.snapshot().enabled, true);
    assert.equal(await request(preference, local, "/messages"), `${LOCAL}:/messages`);
    results.push("A new device keeps Local enabled after the saved preference loads.");

    const inFlight = request(preference, local, "/in-flight");
    await local.started;
    await preference.save(false);
    local.finish();
    assert.equal(await inFlight, `${LOCAL}:/in-flight`);
    results.push("Disabling Local leaves a request already sent to the computer running.");

    const disabled = preference.project(hosts, agents, LOCAL, LOCAL, preference.snapshot());
    assert.deepEqual(
      disabled.servers.map((server) => server.id),
      [REMOTE],
    );
    assert.deepEqual(
      disabled.agents.map((agent) => agent.id),
      ["remote-agent"],
    );
    assert.equal(disabled.activeServerId, REMOTE);
    assert.deepEqual(
      preference.project(
        [local],
        [agents[0]].filter((agent) => agent !== undefined),
        LOCAL,
        LOCAL,
      ),
      {
        servers: [],
        agents: [],
        activeServerId: null,
      },
    );
    results.push("Navigation and agent choice hide Local and choose the VPS, or no host when there is only Local.");

    const beforeBlocked = local.requests.length;
    for (const path of [
      TEAM_API_ROUTES.agents.all,
      TEAM_API_ROUTES.agent.messages("local-agent"),
      CONTEXT_RESET_ROUTES.clear,
      TEAM_API_ROUTES.agent.routineTest("local-agent", "saved-routine"),
      TEAM_API_ROUTES.respond.approval,
      TEAM_API_ROUTES.respond.prompt,
      TEAM_API_ROUTES.respond.browserTakeover,
    ]) {
      await assert.rejects(request(preference, local, path), LocalAgentsDisabledError);
    }
    assert.equal(local.requests.length, beforeBlocked);
    assert.equal(await request(preference, remote, "/messages"), `${REMOTE}:/messages`);
    results.push(
      "Local create, send, new chat, routine test, approval, prompt and browser actions do not reach the host; VPS sends work.",
    );

    const child = spawnSync(process.execPath, [import.meta.filename, "--read-preference", preferencePath], {
      encoding: "utf8",
    });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.trim(), "disabled");
    const restarted = new LocalAgentsPreference(storage(preferencePath));
    await restarted.load();
    await assert.rejects(request(restarted, local, "/after-restart"), LocalAgentsDisabledError);
    assert.equal(restarted.project(hosts, agents, LOCAL, LOCAL).activeServerId, REMOTE);
    results.push("A new process reads the disabled choice; a restarted controller keeps Local hidden and blocked.");

    await restarted.save(true);
    const enabled = restarted.project(hosts, agents, LOCAL, LOCAL, restarted.snapshot());
    assert.deepEqual(
      enabled.servers.map((server) => server.id),
      [LOCAL, REMOTE],
    );
    assert.deepEqual(enabled.agents, agents);
    assert.equal(enabled.activeServerId, LOCAL);
    assert.equal(await request(restarted, local, "/new-chat"), `${LOCAL}:/new-chat`);
    assert.equal(JSON.stringify(agents), originalAgents);
    assert.equal(JSON.stringify(hosts.map((server) => ({ id: server.id, baseUrl: server.baseUrl }))), originalHosts);
    results.push("Re-enable restores the same agents, settings and saved chats without removing either host.");

    const writeFailure = new LocalAgentsPreference({
      get: storage(preferencePath).get,
      set: async () => {
        throw new Error("Injected storage write failure.");
      },
    });
    await writeFailure.load();
    await assert.rejects(writeFailure.save(false), /Injected storage write failure/);
    assert.equal(writeFailure.snapshot().enabled, true);
    assert.equal(writeFailure.snapshot().saving, false);
    const afterFailedSave = new LocalAgentsPreference(storage(preferencePath));
    await afterFailedSave.load();
    assert.equal(afterFailedSave.snapshot().enabled, true);
    results.push("A failed save restores the previous choice in memory and across a restart.");

    await restarted.save(false);
    let releaseWrite: () => void = () => {};
    const writeReady = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const pendingWrite = new LocalAgentsPreference({
      get: storage(preferencePath).get,
      set: async (key, value) => {
        await writeReady;
        await storage(preferencePath).set(key, value);
      },
    });
    await pendingWrite.load();
    const enabling = pendingWrite.save(true);
    await assert.rejects(request(pendingWrite, local, TEAM_API_ROUTES.respond.approval), LocalAgentsDisabledError);
    assert.equal(await request(pendingWrite, remote, "/while-saving"), `${REMOTE}:/while-saving`);
    releaseWrite();
    await enabling;
    assert.equal(await request(pendingWrite, local, "/after-save"), `${LOCAL}:/after-save`);
    results.push(
      "Re-enable keeps Local actions blocked until the choice is saved, with VPS access throughout the write.",
    );

    let unreadable = true;
    const readFailure = new LocalAgentsPreference({
      get: async (key) => {
        if (unreadable) throw new Error("Injected storage read failure.");
        return storage(preferencePath).get(key);
      },
      set: storage(preferencePath).set,
    });
    await assert.rejects(readFailure.load(), /Injected storage read failure/);
    assert.equal(readFailure.snapshot().ready, false);
    assert.equal(readFailure.snapshot().loadFailed, true);
    await assert.rejects(request(readFailure, local, TEAM_API_ROUTES.respond.approval), LocalAgentsDisabledError);
    assert.equal(await request(readFailure, remote, "/unreadable"), `${REMOTE}:/unreadable`);
    unreadable = false;
    await readFailure.load();
    assert.equal(readFailure.snapshot().loadFailed, false);
    assert.equal(await request(readFailure, local, "/after-retry"), `${LOCAL}:/after-retry`);
    results.push("A read failure is recoverable and blocks only Local; a successful retry restores the saved choice.");

    passed = true;
  } finally {
    for (const server of hosts) {
      server.finish();
      await server.close();
    }
    await mkdir(OUT, { recursive: true });
    await writeFile(
      join(OUT, "report.json"),
      `${JSON.stringify(
        {
          passed,
          checks: results,
          unverified: [
            "Native Settings appearance and interaction",
            "iOS and Android keychain persistence",
            "Full app OutboxProvider integration",
          ],
        },
        null,
        2,
      )}\n`,
    );
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[2] === "--read-preference") {
  const path = process.argv[3];
  assert.ok(path);
  const preference = new LocalAgentsPreference(storage(path));
  await preference.load();
  process.stdout.write(preference.snapshot().enabled ? "enabled\n" : "disabled\n");
} else {
  await main();
}
