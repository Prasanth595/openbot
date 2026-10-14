import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Effect } from "effect";
import { ChannelRoutineStore } from "../src/backend/channel-routine-store.ts";
import { ChannelStore } from "../src/backend/channel-store.ts";
import { OpenBotDatabase } from "../src/backend/openbot-database.ts";

const workspace = fileURLToPath(new URL("../", import.meta.url));
const script = fileURLToPath(import.meta.url);
const schedulerSource = process.argv[3] ?? join(workspace, "src/backend/channel-routine-scheduler.ts");
const { ChannelRoutineScheduler } = await import(pathToFileURL(schedulerSource).href);
const now = new Date("2030-01-02T12:00:00.000Z");
const createdAt = new Date("2030-01-02T11:00:00.000Z");
const channelId = "recovery-channel";
const crashExit = 73;

function child(args) {
  return spawnSync(process.execPath, [...process.execArgv, script, ...args], {
    cwd: workspace,
    encoding: "utf8",
    timeout: 30_000,
  });
}

async function open(path, limited = false) {
  const database = new OpenBotDatabase(path);
  await Effect.runPromise(database.initialize());
  const store = new ChannelStore(database);
  const calls = [];
  // Inject only the external channel command boundary. ChannelStore commits the real receipt
  // and request task in one database dispatch; a replay must not add another task or event.
  const channels = {
    store,
    command: (command, actor, prepare) =>
      Effect.sync(() => {
        const request = prepare(command);
        assert.ok(request);
        calls.push({ runId: request.origin.runId, requestId: request.requestMessageId });
        const operation = `${actor.id}:${request.operationId}`;
        return store.commit(operation, {
          channel: store.get(channelId),
          messages: [],
          assignments: [],
          tasks: [
            {
              id: request.requestMessageId,
              channelId,
              parentTaskId: null,
              rootTaskId: request.requestMessageId,
              ownerAgentId: null,
              requestMessageId: request.requestMessageId,
              instruction: request.text,
              attachmentDraftIds: [],
              expectedResult: "",
              sourceMessageIds: [],
              dependencies: [],
              resources: [],
              state: "queued",
              revision: 0,
              assignmentCount: 0,
              error: null,
            },
          ],
        });
      }),
  };
  const scheduler = new ChannelRoutineScheduler({
    channels,
    hooks: {
      changed: () => {},
      emitError: (code, error) => {
        throw new Error(code, { cause: error });
      },
      excludedChannels: () => new Set(),
      usageLimited: () => limited,
    },
  });
  return { database, store, scheduler, calls, routines: new ChannelRoutineStore(database) };
}

async function fixture(path, recurring, limited) {
  const context = await open(path, limited);
  try {
    context.store.commit("fixture", {
      channel: context.store.create(channelId, {
        name: "Recovery",
        title: "",
        instructions: "",
        members: [],
        leadAgentId: null,
      }),
      messages: [],
      tasks: [],
      assignments: [],
    });
    return context.routines.create(
      {
        channelId,
        name: "Due occurrence",
        instruction: "Check recovery",
        active: true,
        timezone: "UTC",
        schedule: recurring ? { kind: "hourly", minute: 30 } : { kind: "once", date: "2030-01-02", time: "11:30" },
        limitPolicy: limited ? "skip" : "wait",
        missedPolicy: "run-once",
      },
      createdAt,
    );
  } finally {
    context.database.close();
  }
}

async function suite(root) {
  const results = [];
  for (const boundary of ["completeTrigger", "createRun", "none", "once-limited", "recurring", "recurring-skip"]) {
    const result = { boundary, status: "fail", stage: "fixture" };
    results.push(result);
    try {
      const path = join(root, boundary);
      const recurring = boundary.startsWith("recurring");
      const limited = boundary === "once-limited" || boundary === "recurring-skip";
      const routine = await fixture(path, recurring, limited);
      assert.equal(routine.limitPolicy, recurring && limited ? "skip" : "wait");
      const crash = boundary === "completeTrigger" || boundary === "createRun";
      result.stage = "worker";
      const run = child(["--worker", schedulerSource, path, boundary]);
      result.workerExitCode = run.status;
      result.workerSignal = run.signal;
      assert.equal(run.error, undefined);
      assert.equal(run.status, crash ? crashExit : 0, run.stderr);
      const context = await open(path, limited);
      try {
        result.stage = "durable run after worker";
        const before = context.routines.listRuns(channelId, routine.id, 50, true);
        const expected = boundary === "recurring-skip" ? 0 : 1;
        result.runsBeforeRecovery = before.length;
        assert.equal(before.length, expected, `${boundary}: one durable run must remain`);
        if (crash) {
          assert.equal(before[0].requestMessageId, null);
          assert.equal(context.routines.get(channelId, routine.id).active, boundary === "createRun");
          assert.equal(context.store.tasks(channelId).length, 0);
        }
        // Use the same startup operations as the real scheduler. skipMissed must complete the
        // trigger when the crash happened after createRun but before completeTrigger.
        result.stage = "startup recovery";
        context.scheduler.skipMissed(now);
        await Effect.runPromise(context.scheduler.resumePendingRuns());
        await Effect.runPromise(context.scheduler.processDue(now));
        const recovered = context.routines.listRuns(channelId, routine.id, 50, true);
        result.runsAfterRecovery = recovered.length;
        assert.equal(recovered.length, expected);
        assert.equal(context.routines.get(channelId, routine.id).active, recurring);
        if (recurring)
          assert.ok(Date.parse(context.routines.get(channelId, routine.id).trigger.nextRunAt) > now.getTime());
        if (expected) {
          assert.equal(recovered[0].id, before[0].id);
          assert.equal(recovered[0].kind, "scheduled");
          assert.ok(recovered[0].requestMessageId);
          if (before[0].requestMessageId) assert.equal(recovered[0].requestMessageId, before[0].requestMessageId);
          assert.equal(context.store.tasks(channelId).length, 1);
          const revision = context.store.get(channelId).revision;
          result.stage = "dispatch receipt replay";
          await Effect.runPromise(context.scheduler.resumePendingRuns());
          await Effect.runPromise(context.scheduler.resumePendingRuns());
          assert.equal(context.store.get(channelId).revision, revision);
          assert.equal(context.store.tasks(channelId).length, 1);
          assert.ok(context.calls.length >= 2);
          for (const call of context.calls) {
            assert.equal(call.runId, recovered[0].id);
            assert.equal(call.requestId, recovered[0].requestMessageId);
          }
          const receipt = `channels:routine:${routine.id}:channel-routine-run:${recovered[0].id}`;
          assert.ok(context.database.commandResult(receipt));
        } else {
          assert.equal(context.calls.length, 0);
          assert.equal(context.store.tasks(channelId).length, 0);
        }
        assert.equal(context.routines.listRuns(channelId, routine.id, 50, true).length, expected);
        Object.assign(result, {
          status: "pass",
          stage: "complete",
          runs: expected,
          runId: recovered[0]?.id,
          requestId: recovered[0]?.requestMessageId,
        });
      } finally {
        context.database.close();
      }
    } catch {
      // Record only case names, counts and exit codes. Child logs and database data stay private.
      result.status = "fail";
    }
  }
  return results;
}

async function main() {
  if (process.argv[2] === "--worker") {
    const boundary = process.argv[5];
    const context = await open(process.argv[4], boundary === "once-limited" || boundary === "recurring-skip");
    if (boundary === "createRun" || boundary === "completeTrigger") {
      const original = ChannelRoutineStore.prototype[boundary];
      ChannelRoutineStore.prototype[boundary] = function (...args) {
        original.apply(this, args);
        // Exit after the real persistence method returns, with no orderly database close.
        process.exit(crashExit);
      };
    }
    try {
      await Effect.runPromise(context.scheduler.processDue(now));
    } finally {
      context.database.close();
    }
    return;
  }
  const report = { status: "fail", results: [], cleanup: "not-started" };
  let root;
  try {
    root = await mkdtemp(join(tmpdir(), "channel-once-recovery-"));
    report.results = await suite(root);
    report.status = report.results.every((result) => result.status === "pass") ? "pass" : "fail";
  } catch {
    report.failure = "suite setup failed";
  } finally {
    if (root) {
      try {
        await rm(root, { recursive: true, force: true });
        report.cleanup = "complete";
      } catch {
        report.cleanup = "fail";
        report.status = "fail";
      }
    }
  }
  const artifact = resolve(workspace, ".openbot-build/channel-once-recovery-e2e.json");
  await mkdir(join(workspace, ".openbot-build"), { recursive: true });
  await writeFile(artifact, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${report.status.toUpperCase()}: ${artifact}\n`);
  if (report.status !== "pass") process.exitCode = 1;
}

await main().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
