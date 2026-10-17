// Runs the real account server authorization checks on a migrated SQLite database. Each scenario
// is one finding of the cloud authorization audit, and it fails if that access comes back.
//
// Run: bun run test:cloud-authorization
// It writes .openbot-build/cloud-authorization-e2e/report.json and exits non-zero on a failure.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import { RemoteControlPlane } from "../src/server/remote-control-plane";
import type { AuthUser } from "../src/server/types";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "cloud-authorization-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const HOST_ID = "host-1";

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

async function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of (await readdir(MIGRATIONS)).sort()) database.exec(await readFile(join(MIGRATIONS, name), "utf8"));
  return database;
}

function addUser(database: DatabaseSync, id: string): AuthUser {
  const email = `${id}@example.test`;
  database
    .prepare("INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES (?, ?, ?, 1, 1)")
    .run(id, `email:${id}`, email);
  return { id, email, name: null, avatarUrl: null };
}

async function ticketKeys() {
  const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const publicJwk = await crypto.subtle.exportKey("jwk", publicKey);
  const privateJwk = await crypto.subtle.exportKey("jwk", privateKey);
  return {
    REMOTE_TICKET_PRIVATE_JWK: JSON.stringify({ ...privateJwk, kid: "ticket-1" }),
    REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({ keys: [{ ...publicJwk, kid: "ticket-1" }] }),
    REMOTE_TICKET_KEY_ID: "ticket-1",
  };
}

/** A host with its owner, on a database with no Signal, and a clock that the scenario moves. */
async function remoteHost() {
  const database = await migratedDatabase();
  const owner = addUser(database, "owner");
  database
    .prepare(
      "INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at) VALUES (?, 'owner', 'Host', 1, 1)",
    )
    .run(HOST_ID);
  database
    .prepare(
      `INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
       VALUES ('membership-owner', ?, 'owner', 'owner', 'active', 1, 1)`,
    )
    .run(HOST_ID);
  const clock = { now: Date.UTC(2026, 9, 17, 12) };
  const remote = new RemoteControlPlane({ DB: sqliteD1(database), ...(await ticketKeys()) }, { now: () => clock.now });
  return { database, owner, clock, remote };
}

/** The error code of a failed operation, or "ok". */
async function outcome<A, E>(operation: Effect.Effect<A, E>): Promise<string> {
  return Effect.runPromise(
    operation.pipe(
      Effect.match({
        onSuccess: () => "ok",
        onFailure: (error) =>
          typeof error === "object" && error !== null && "code" in error ? String(error.code) : "failure",
      }),
    ),
  );
}

function membershipStatus(database: DatabaseSync, userId: string) {
  const row = database
    .prepare("SELECT status, role FROM remote_memberships WHERE host_id = ? AND user_id = ?")
    .get(HOST_ID, userId);
  return row ? `${row.status}:${row.role}` : "none";
}

function membershipId(database: DatabaseSync, userId: string): string {
  return String(
    database
      .prepare("SELECT membership_id FROM remote_memberships WHERE host_id = ? AND user_id = ?")
      .get(HOST_ID, userId)?.membership_id,
  );
}

async function aRemovedMemberCannotRejoinWithAnOldInvite() {
  const { database, owner, clock, remote } = await remoteHost();
  const member = addUser(database, "member");
  const link = await Effect.runPromise(
    remote.createInvite(owner, { hostId: HOST_ID, role: "member", permanent: true }),
  );
  const spare = await Effect.runPromise(remote.createInvite(owner, { hostId: HOST_ID, role: "member" }));
  clock.now += 1_000;
  check("a member joins with the permanent link", (await outcome(remote.acceptInvite(member, link.token))) === "ok");
  clock.now += 1_000;
  await Effect.runPromise(
    remote.changeMembership(owner.id, {
      hostId: HOST_ID,
      membershipId: membershipId(database, member.id),
      revoke: true,
    }),
  );
  clock.now += 1_000;
  const again = await outcome(remote.acceptInvite(member, link.token));
  check("a removed member cannot rejoin with the permanent link", again === "invite_invalid", {
    outcome: again,
    membership: membershipStatus(database, member.id),
  });
  const spareOutcome = await outcome(remote.acceptInvite(member, spare.token));
  check(
    "a removed member cannot rejoin with an unused invite from before the removal",
    spareOutcome === "invite_invalid",
    {
      outcome: spareOutcome,
      membership: membershipStatus(database, member.id),
    },
  );
  const unused = database.prepare("SELECT used_at FROM remote_invites WHERE invite_id = ?").get(spare.inviteId);
  check("the refused invite stays unused", unused?.used_at === null, { unused });
  clock.now += 1_000;
  const fresh = await Effect.runPromise(remote.createInvite(owner, { hostId: HOST_ID, role: "member" }));
  clock.now += 1_000;
  const freshOutcome = await outcome(remote.acceptInvite(member, fresh.token));
  check("a removed member rejoins with an invite made after the removal", freshOutcome === "ok", {
    outcome: freshOutcome,
    membership: membershipStatus(database, member.id),
  });
}

async function anInviteEndsWithTheAdminWhoMadeIt() {
  const { database, owner, clock, remote } = await remoteHost();
  const admin = addUser(database, "admin");
  const other = addUser(database, "other");
  const control = addUser(database, "control");
  const adminInvite = await Effect.runPromise(remote.createInvite(owner, { hostId: HOST_ID, role: "admin" }));
  clock.now += 1_000;
  await Effect.runPromise(remote.acceptInvite(admin, adminInvite.token));
  const link = await Effect.runPromise(remote.createInvite(admin, { hostId: HOST_ID, role: "admin", permanent: true }));
  const ownerLink = await Effect.runPromise(
    remote.createInvite(owner, { hostId: HOST_ID, role: "member", permanent: true }),
  );
  clock.now += 1_000;
  await Effect.runPromise(
    remote.changeMembership(owner.id, {
      hostId: HOST_ID,
      membershipId: membershipId(database, admin.id),
      revoke: true,
    }),
  );
  clock.now += 1_000;
  const joined = await outcome(remote.acceptInvite(other, link.token));
  check("an invite from an admin who was removed admits nobody", joined === "invite_invalid", {
    outcome: joined,
    membership: membershipStatus(database, other.id),
  });
  const ownerJoined = await outcome(remote.acceptInvite(control, ownerLink.token));
  check("the owner's link still admits a new member", ownerJoined === "ok", {
    outcome: ownerJoined,
    membership: membershipStatus(database, control.id),
  });
}

const scenarios = [aRemovedMemberCannotRejoinWithAnOldInvite, anInviteEndsWithTheAdminWhoMadeIt];
for (const scenario of scenarios) {
  try {
    await scenario();
  } catch (error) {
    check(scenario.name, false, { error: error instanceof Error ? error.message : String(error) });
  }
}

await mkdir(OUT, { recursive: true });
const report = { passed: checks.every((entry) => entry.passed), checks };
await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
for (const entry of checks) console.log(`${entry.passed ? "PASS" : "FAIL"} ${entry.name}`);
console.log(`Report: ${join(OUT, "report.json")}`);
if (!report.passed) process.exitCode = 1;
