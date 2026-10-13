-- The permanent Mobile Connect link that signed in a mobile session, or NULL for a one-time code.
-- A nullable column only: the deployed Worker inserts sessions without it.
-- Revoking a link signs out the phones that it signed in.
ALTER TABLE mobile_auth_sessions ADD COLUMN connect_link_hash TEXT;

CREATE INDEX mobile_auth_sessions_connect_link ON mobile_auth_sessions(connect_link_hash);
