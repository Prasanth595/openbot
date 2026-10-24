-- A new table only. The Worker that runs before this deploy does not read it.
-- A member limit for one server, such as an enterprise customer's. When a row exists, its limit
-- replaces the limit of the server's plan, or the default of a server with no plan. Staff add and
-- change rows by hand; no route writes them.
-- The key is the server ID, with no reference to remote_hosts, so the row stays when an owner deletes
-- the host and registers it again, and applies to a hosted server before it publishes its host.
CREATE TABLE IF NOT EXISTS server_member_limits (
  server_id TEXT PRIMARY KEY,
  member_limit INTEGER NOT NULL CHECK(member_limit >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
