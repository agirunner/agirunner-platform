-- 0029: Add OAuth authentication support for LLM providers
-- Adds auth_mode, oauth_config, and oauth_credentials columns to llm_providers.
-- Creates oauth_states table for CSRF protection during in-flight OAuth flows.

ALTER TABLE llm_providers
  ADD COLUMN IF NOT EXISTS auth_mode TEXT NOT NULL DEFAULT 'api_key'
    CHECK (auth_mode IN ('api_key', 'oauth'));

ALTER TABLE llm_providers
  ADD COLUMN IF NOT EXISTS oauth_config JSONB;

ALTER TABLE llm_providers
  ADD COLUMN IF NOT EXISTS oauth_credentials JSONB;

COMMENT ON COLUMN llm_providers.auth_mode IS
  'Authentication mode: api_key (manual key entry) or oauth (delegated authorization)';
COMMENT ON COLUMN llm_providers.oauth_config IS
  'OAuth provider configuration (client_id, URLs, endpoint_type). Not secret.';
COMMENT ON COLUMN llm_providers.oauth_credentials IS
  'OAuth tokens (access_token, refresh_token, expiry, account_id). Secret — stored same as API keys.';

CREATE TABLE IF NOT EXISTS oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL,
  profile_id TEXT NOT NULL,
  state TEXT NOT NULL UNIQUE,
  code_verifier TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '10 minutes')
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_state ON oauth_states(state);
