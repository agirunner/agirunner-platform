ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS resolved_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS config_layers JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS instruction_config JSONB;

CREATE TABLE IF NOT EXISTS platform_instructions (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT 'text',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_type TEXT,
  updated_by_id TEXT
);

CREATE TABLE IF NOT EXISTS platform_instruction_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'text',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_type TEXT,
  created_by_id TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_instruction_versions_tenant_version
  ON platform_instruction_versions(tenant_id, version);

CREATE INDEX IF NOT EXISTS idx_platform_instruction_versions_tenant
  ON platform_instruction_versions(tenant_id, version DESC);
