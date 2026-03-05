CREATE TABLE IF NOT EXISTS refresh_token_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  token_id UUID NOT NULL UNIQUE,
  csrf_token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  replaced_by_token_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_token_sessions_tenant_api_key
  ON refresh_token_sessions (tenant_id, api_key_id);

CREATE INDEX IF NOT EXISTS idx_refresh_token_sessions_tenant_token
  ON refresh_token_sessions (tenant_id, token_id);
