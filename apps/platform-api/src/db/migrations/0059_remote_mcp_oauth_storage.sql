ALTER TABLE remote_mcp_servers
  ADD COLUMN IF NOT EXISTS oauth_config jsonb,
  ADD COLUMN IF NOT EXISTS oauth_credentials jsonb;
