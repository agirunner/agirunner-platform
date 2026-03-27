CREATE TABLE IF NOT EXISTS remote_mcp_oauth_client_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  slug text NOT NULL,
  description text NOT NULL DEFAULT '',
  issuer text,
  authorization_endpoint text,
  token_endpoint text NOT NULL,
  registration_endpoint text,
  device_authorization_endpoint text,
  callback_mode text NOT NULL DEFAULT 'loopback',
  token_endpoint_auth_method text NOT NULL DEFAULT 'none',
  client_id text NOT NULL,
  encrypted_client_secret text,
  default_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_resource_indicators jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_audiences jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_remote_mcp_oauth_client_profiles_tenant_slug
  ON remote_mcp_oauth_client_profiles (tenant_id, slug);

CREATE INDEX IF NOT EXISTS idx_remote_mcp_oauth_client_profiles_tenant
  ON remote_mcp_oauth_client_profiles (tenant_id);

ALTER TABLE remote_mcp_servers
  ADD COLUMN IF NOT EXISTS oauth_client_profile_id uuid REFERENCES remote_mcp_oauth_client_profiles(id);

ALTER TABLE remote_mcp_registration_drafts
  ADD COLUMN IF NOT EXISTS oauth_client_profile_id uuid REFERENCES remote_mcp_oauth_client_profiles(id);
