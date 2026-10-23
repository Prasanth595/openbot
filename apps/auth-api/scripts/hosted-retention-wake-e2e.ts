// Runs the real account server hosted-server service on a migrated SQLite database, with a boat API
// that starts and stops sandboxes. boat deletes the disk of a sandbox 14 days after its stop, so the
// cron must start an idle server with no use for 10 days, and the idle rule must stop it again when no
// client connects. A server with less sleep, or one whose plan ended, must not start.
//
// Run: bun run test:hosted-retention-wake
// It writes .openbot-build/hosted-retention-wake-e2e/report.json and exits non-zero on a failure.
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import { createAccountAnalytics } from "../src/server/account-analytics";
import { HostedServerService } from "../src/server/hosted-server-service";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "hosted-retention-wake-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const OWNER = { id: "owner", email: "owner@example.test" };
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

async function run() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(MIGRATIONS).sort()) database.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
  const t0 = Date.UTC(2026, 9, 23, 12);
  const clock = { now: t0 };
  database
    .prepare("INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES (?, ?, ?, 1, 1)")
    .run(OWNER.id, `email:${OWNER.email}`, OWNER.email);
  const insert = database.prepare(
    `INSERT INTO hosted_servers(
       server_id, owner_user_id, name, provider_sandbox_id, size, plan, billing_interval, currency,
       desired_state, observed_state, idempotency_key, last_active_at, next_run_at, created_at, updated_at
     ) VALUES (?, ?, 'Cloud server', ?, 'small', 'starter', 'month', 'eur', ?, 'stopped', ?, ?, ?, 1, ?)`,
  );
  const nextRunAt = t0 + 30 * DAY;
  insert.run("due", OWNER.id, "bx_due", "idle", "key-due", t0 - 10 * DAY, nextRunAt, t0 - 10 * DAY);
  insert.run("recent", OWNER.id, "bx_recent", "idle", "key-recent", t0 - 9 * DAY, null, t0 - 9 * DAY);
  insert.run("ended", OWNER.id, "bx_ended", "stopped", "key-ended", t0 - 11 * DAY, null, t0 - 11 * DAY);

  const calls: string[] = [];
  const running = new Set<string>();
  const boatFetch = async (input: string, init: RequestInit) => {
    const path = new URL(input).pathname.replace("/api/v1", "");
    const method = init.method ?? "GET";
    calls.push(`${method} ${path}`);
    const sandboxId = decodeURIComponent(path.split("/")[2] ?? "");
    if (path.endsWith("/resume")) {
      running.add(sandboxId);
      return Response.json({ ok: true, status: "resuming" });
    }
    if (path.endsWith("/stop")) {
      running.delete(sandboxId);
      return Response.json({ ok: true });
    }
    if (method === "GET") {
      return Response.json({
        ok: true,
        sandbox: { id: sandboxId, state: running.has(sandboxId) ? "running" : "archived" },
      });
    }
    return Response.json({ ok: true });
  };
  const events: { name: string; properties: { action?: string; reason?: string } }[] = [];
  const work: Promise<void>[] = [];
  const analytics = createAccountAnalytics({
    clientId: "client",
    clientSecret: "secret",
    fetch: async (_input, init) => {
      const body = JSON.parse(String(init.body));
      events.push({ name: body.payload.name, properties: body.payload.properties });
      return new Response(null, { status: 200 });
    },
    schedule: (send) => work.push(Effect.runPromise(send)),
  });
  const service = new HostedServerService(
    { DB: sqliteD1(database), HOSTED_SERVERS_ENABLED: "true", BOAT_API_KEY: "boat-key" },
    {
      fetch: boatFetch,
      now: () => clock.now,
      analytics,
      schedule: (effect) => work.push(Effect.runPromise(effect)),
    },
  );
  const tick = async (at: number) => {
    clock.now = at;
    const result = await Effect.runPromise(service.tick(at));
    await Promise.all(work.splice(0));
    return result;
  };
  const row = (serverId: string) =>
    database
      .prepare(
        "SELECT desired_state, observed_state, last_wake_reason, last_active_at, next_run_at FROM hosted_servers WHERE server_id = ?",
      )
      .get(serverId);
  const callsFor = (sandboxId: string, action?: string) =>
    calls.filter((call) => call.includes(`/${sandboxId}`) && (action === undefined || call.endsWith(action)));

  const first = await tick(t0);
  const woken = row("due");
  check("the cron starts an idle server with no use for 10 days", callsFor("bx_due", "/resume").length === 1, calls);
  check("the tick counts the keep-alive start", first.retained === 1 && first.scheduled === 0, first);
  check(
    "the server runs with the stored reason schedule and keeps its next routine run",
    woken?.desired_state === "running" &&
      woken.observed_state === "waking" &&
      woken.last_wake_reason === "schedule" &&
      woken.last_active_at === t0 &&
      woken.next_run_at === nextRunAt,
    woken,
  );
  check(
    "analytics gets the wake with the reason retention",
    events.some(
      (event) =>
        event.name === "hosted_server_action" &&
        event.properties.action === "woken" &&
        event.properties.reason === "retention",
    ),
    events,
  );
  check("a server with 9 days of sleep does not start", callsFor("bx_recent").length === 0, calls);
  check("a server whose plan ended does not start", callsFor("bx_ended").length === 0, calls);

  await tick(t0 + 3 * MINUTE);
  check("the started server is running", row("due")?.observed_state === "running", row("due"));

  await tick(t0 + 15 * MINUTE);
  check("the server does not stop before 15 minutes with no use", callsFor("bx_due", "/stop").length === 0, calls);

  await tick(t0 + 19 * MINUTE);
  check(
    "with no client the idle rule stops the server, and boat saves the disk",
    callsFor("bx_due", "/stop").length === 1 && row("due")?.desired_state === "idle",
    { calls, row: row("due") },
  );
  check(
    "analytics gets the idle stop",
    events.some((event) => event.properties.action === "idle_stopped"),
    events,
  );

  await tick(t0 + 22 * MINUTE);
  const asleep = row("due");
  check(
    "the server sleeps again and is not started again",
    asleep?.desired_state === "idle" &&
      asleep.observed_state === "stopped" &&
      callsFor("bx_due", "/resume").length === 1,
    { calls, row: asleep },
  );

  await tick(t0 + 9 * DAY);
  check("no second start before 10 days", callsFor("bx_due", "/resume").length === 1, calls);
  await tick(t0 + 10 * DAY);
  check("a second start after 10 more days", callsFor("bx_due", "/resume").length === 2, calls);
  check("a plan-ended server never starts", callsFor("bx_ended").length === 0, calls);
  database.close();
}

let passed = false;
try {
  await run();
  passed = checks.every((item) => item.passed);
} finally {
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, checks }, null, 2)}\n`);
}
for (const item of checks) console.log(`${item.passed ? "ok  " : "FAIL"} ${item.name}`);
console.log(`Report: ${join(OUT, "report.json")}`);
if (!passed) process.exit(1);
