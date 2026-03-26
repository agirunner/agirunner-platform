CREATE TABLE IF NOT EXISTS remote_mcp_servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  slug text NOT NULL,
  description text NOT NULL DEFAULT '',
  endpoint_url text NOT NULL,
  auth_mode text NOT NULL,
  enabled_by_default_for_new_specialists boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  verification_status text NOT NULL DEFAULT 'unknown',
  verification_error text,
  verified_transport text,
  verified_at timestamp with time zone,
  verification_contract_version text NOT NULL DEFAULT 'remote-mcp-v1',
  discovered_tools_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT uq_remote_mcp_servers_tenant_slug UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_remote_mcp_servers_tenant
  ON remote_mcp_servers (tenant_id, is_archived, verification_status);

CREATE TABLE IF NOT EXISTS remote_mcp_server_parameters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  remote_mcp_server_id uuid NOT NULL REFERENCES remote_mcp_servers(id) ON DELETE CASCADE,
  placement text NOT NULL,
  key text NOT NULL,
  value_kind text NOT NULL,
  static_value text,
  encrypted_secret_value text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_remote_mcp_server_parameters_server
  ON remote_mcp_server_parameters (remote_mcp_server_id, placement, key);

CREATE TABLE IF NOT EXISTS remote_mcp_registration_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  endpoint_url text NOT NULL,
  auth_mode text NOT NULL,
  enabled_by_default_for_new_specialists boolean NOT NULL DEFAULT false,
  grant_to_all_existing_specialists boolean NOT NULL DEFAULT false,
  parameters jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_remote_mcp_registration_drafts_tenant_user
  ON remote_mcp_registration_drafts (tenant_id, user_id);

CREATE TABLE IF NOT EXISTS specialist_mcp_server_grants (
  specialist_id uuid NOT NULL REFERENCES role_definitions(id) ON DELETE CASCADE,
  remote_mcp_server_id uuid NOT NULL REFERENCES remote_mcp_servers(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT pk_specialist_mcp_server_grants PRIMARY KEY (specialist_id, remote_mcp_server_id)
);

CREATE INDEX IF NOT EXISTS idx_specialist_mcp_server_grants_server
  ON specialist_mcp_server_grants (remote_mcp_server_id);

CREATE TABLE IF NOT EXISTS specialist_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  slug text NOT NULL,
  summary text NOT NULL,
  content text NOT NULL,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT uq_specialist_skills_tenant_slug UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_specialist_skills_tenant
  ON specialist_skills (tenant_id, is_archived);

CREATE TABLE IF NOT EXISTS specialist_skill_assignments (
  specialist_id uuid NOT NULL REFERENCES role_definitions(id) ON DELETE CASCADE,
  skill_id uuid NOT NULL REFERENCES specialist_skills(id) ON DELETE CASCADE,
  sort_order integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT pk_specialist_skill_assignments PRIMARY KEY (specialist_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_specialist_skill_assignments_skill
  ON specialist_skill_assignments (skill_id);

ALTER TABLE oauth_states
  ADD COLUMN IF NOT EXISTS flow_kind text NOT NULL DEFAULT 'llm_provider',
  ADD COLUMN IF NOT EXISTS flow_payload jsonb NOT NULL DEFAULT '{}'::jsonb;
