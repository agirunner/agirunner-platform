ALTER TABLE remote_mcp_servers
  ADD COLUMN IF NOT EXISTS call_timeout_seconds integer NOT NULL DEFAULT 300;

ALTER TABLE remote_mcp_registration_drafts
  ADD COLUMN IF NOT EXISTS call_timeout_seconds integer NOT NULL DEFAULT 300;
