-- The time an owner or admin removed the member. A member who leaves, or one who is active, has none.
-- An invitation from before this time cannot bring the member back. A revoked membership from before
-- this migration does not record who revoked it, so it counts as a removal. The Worker that runs
-- before this deploy does not read the column.
ALTER TABLE remote_memberships ADD COLUMN removed_at INTEGER;

UPDATE remote_memberships SET removed_at = updated_at WHERE status = 'revoked';
