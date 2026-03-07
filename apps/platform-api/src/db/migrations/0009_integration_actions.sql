CREATE TABLE IF NOT EXISTS integration_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  adapter_id UUID NOT NULL REFERENCES integration_adapters(id),
  task_id UUID NOT NULL REFERENCES tasks(id),
  action_type TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_integration_actions_lookup
  ON integration_actions(token_hash, expires_at);

CREATE INDEX IF NOT EXISTS idx_integration_actions_task
  ON integration_actions(tenant_id, task_id, action_type, created_at DESC);

DROP TRIGGER IF EXISTS trg_integration_actions_updated_at ON integration_actions;
CREATE TRIGGER trg_integration_actions_updated_at
  BEFORE UPDATE ON integration_actions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
