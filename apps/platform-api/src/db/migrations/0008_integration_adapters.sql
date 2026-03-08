CREATE TABLE IF NOT EXISTS integration_adapters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  workflow_id UUID REFERENCES workflows(id),
  kind TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  subscriptions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_integration_adapters_tenant
  ON integration_adapters(tenant_id, is_active);

CREATE INDEX IF NOT EXISTS idx_integration_adapters_workflow
  ON integration_adapters(tenant_id, workflow_id);

CREATE TABLE IF NOT EXISTS integration_adapter_deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  adapter_id UUID NOT NULL REFERENCES integration_adapters(id),
  event_id BIGINT NOT NULL REFERENCES events(id),
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_status_code INTEGER,
  last_error TEXT,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_integration_adapter_deliveries_pending
  ON integration_adapter_deliveries(tenant_id, status, created_at DESC);

DROP TRIGGER IF EXISTS trg_integration_adapters_updated_at ON integration_adapters;
CREATE TRIGGER trg_integration_adapters_updated_at
  BEFORE UPDATE ON integration_adapters
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_integration_adapter_deliveries_updated_at ON integration_adapter_deliveries;
CREATE TRIGGER trg_integration_adapter_deliveries_updated_at
  BEFORE UPDATE ON integration_adapter_deliveries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
