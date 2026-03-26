CREATE TABLE IF NOT EXISTS execution_environment_catalog (
  catalog_key text NOT NULL,
  catalog_version integer NOT NULL,
  name text NOT NULL,
  description text,
  image text NOT NULL,
  cpu text NOT NULL,
  memory text NOT NULL,
  pull_policy text NOT NULL,
  bootstrap_commands jsonb NOT NULL DEFAULT '[]'::jsonb,
  bootstrap_required_domains jsonb NOT NULL DEFAULT '[]'::jsonb,
  declared_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  support_status text NOT NULL,
  replacement_catalog_key text,
  replacement_catalog_version integer,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT pk_execution_environment_catalog PRIMARY KEY (catalog_key, catalog_version)
);

CREATE INDEX IF NOT EXISTS idx_execution_environment_catalog_support_status
  ON execution_environment_catalog (support_status);

CREATE TABLE IF NOT EXISTS execution_environments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  source_kind text NOT NULL,
  catalog_key text,
  catalog_version integer,
  image text NOT NULL,
  cpu text NOT NULL,
  memory text NOT NULL,
  pull_policy text NOT NULL,
  bootstrap_commands jsonb NOT NULL DEFAULT '[]'::jsonb,
  bootstrap_required_domains jsonb NOT NULL DEFAULT '[]'::jsonb,
  operator_notes text,
  declared_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  verified_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  tool_capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  compatibility_status text NOT NULL DEFAULT 'unknown',
  compatibility_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  verification_contract_version text,
  last_verified_at timestamp with time zone,
  is_default boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  is_claimable boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT uq_execution_environments_tenant_slug UNIQUE (tenant_id, slug),
  CONSTRAINT fk_execution_environments_catalog
    FOREIGN KEY (catalog_key, catalog_version)
    REFERENCES execution_environment_catalog (catalog_key, catalog_version)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_execution_environments_tenant_default
  ON execution_environments (tenant_id)
  WHERE is_default = true;

CREATE INDEX IF NOT EXISTS idx_execution_environments_tenant
  ON execution_environments (tenant_id);

CREATE INDEX IF NOT EXISTS idx_execution_environments_tenant_claimable
  ON execution_environments (tenant_id, is_claimable, is_archived);

CREATE INDEX IF NOT EXISTS idx_execution_environments_catalog
  ON execution_environments (catalog_key, catalog_version);

CREATE TABLE IF NOT EXISTS execution_environment_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  execution_environment_id uuid NOT NULL REFERENCES execution_environments(id) ON DELETE CASCADE,
  status text NOT NULL,
  contract_version text NOT NULL,
  image text NOT NULL,
  probe_output jsonb NOT NULL DEFAULT '{}'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_execution_environment_verifications_environment
  ON execution_environment_verifications (execution_environment_id, created_at);

CREATE INDEX IF NOT EXISTS idx_execution_environment_verifications_tenant
  ON execution_environment_verifications (tenant_id);

ALTER TABLE role_definitions
  ADD COLUMN IF NOT EXISTS execution_environment_id uuid REFERENCES execution_environments(id);

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS execution_environment_id uuid REFERENCES execution_environments(id);

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS execution_environment_snapshot jsonb;

CREATE INDEX IF NOT EXISTS idx_tasks_execution_environment
  ON tasks (tenant_id, execution_environment_id);

ALTER TABLE role_definitions
  DROP COLUMN IF EXISTS execution_container_config;

DELETE FROM runtime_defaults
 WHERE config_key IN (
   'specialist_execution_default_image',
   'specialist_execution_default_cpu',
   'specialist_execution_default_memory',
   'specialist_execution_default_pull_policy'
 );
