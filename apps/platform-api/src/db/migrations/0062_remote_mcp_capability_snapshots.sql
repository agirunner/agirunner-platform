ALTER TABLE remote_mcp_servers
  ADD COLUMN IF NOT EXISTS verified_discovery_strategy text,
  ADD COLUMN IF NOT EXISTS verified_oauth_strategy text,
  ADD COLUMN IF NOT EXISTS discovered_resources_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS discovered_prompts_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS verified_capability_summary jsonb NOT NULL DEFAULT '{}'::jsonb;
