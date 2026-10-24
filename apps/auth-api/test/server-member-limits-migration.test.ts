import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("server member limits migration", () => {
  it("keeps host rows, accepts old Worker writes, and can run again", () => {
    const database = migratedDatabase("0039_remote_host_key_handovers.sql");
    databases.push(database);
    database.exec(`
      INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
      VALUES ('owner', 'email:owner@example.test', 'owner@example.test', 'Owner', NULL, 1, 1);
      INSERT INTO remote_hosts(host_id, owner_user_id, name, device_public_key, machine_token_hash, auth_epoch, created_at, updated_at)
      VALUES ('host-1', 'owner', 'Studio', 'key-a', 'token-hash', 4, 1, 1);
      INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
      VALUES ('m-owner', 'host-1', 'owner', 'owner', 'active', 1, 1);
    `);
    const before = snapshot(database);

    database.exec("BEGIN");
    database.exec(migration("0040_server_member_limits.sql"));
    database.exec("COMMIT");
    database.exec(migration("0040_server_member_limits.sql"));

    expect(snapshot(database)).toEqual(before);
    // The old Worker's host registration and removal still run.
    database.exec(`
      UPDATE remote_hosts SET device_public_key = 'key-b', auth_epoch = auth_epoch + 1, updated_at = 2
       WHERE host_id = 'host-1' AND owner_user_id = 'owner';
    `);
    expect(
      database.prepare("SELECT device_public_key, auth_epoch FROM remote_hosts WHERE host_id = 'host-1'").get(),
    ).toEqual({ device_public_key: "key-b", auth_epoch: 5 });

    const insert = database.prepare(
      "INSERT INTO server_member_limits(server_id, member_limit, created_at, updated_at) VALUES (?, ?, ?, ?)",
    );
    insert.run("host-1", 40, 3, 3);
    // A hosted server that has not published its host yet can have a limit too.
    insert.run("hosted-1", 60, 3, 3);
    expect(() => insert.run("host-1", 50, 4, 4)).toThrow();
    expect(() => insert.run("host-2", 0, 4, 4)).toThrow();

    // A host that the owner deletes and registers again keeps its limit.
    database.exec("DELETE FROM remote_hosts WHERE host_id = 'host-1'");
    expect(
      database.prepare("SELECT server_id, member_limit FROM server_member_limits ORDER BY server_id").all(),
    ).toEqual([
      { server_id: "host-1", member_limit: 40 },
      { server_id: "hosted-1", member_limit: 60 },
    ]);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });
});

const snapshot = (database: DatabaseSync) => ({
  users: database.prepare("SELECT * FROM users ORDER BY id").all(),
  hosts: database.prepare("SELECT * FROM remote_hosts ORDER BY host_id").all(),
  memberships: database.prepare("SELECT * FROM remote_memberships ORDER BY membership_id").all(),
});
