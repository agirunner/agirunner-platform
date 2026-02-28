DO $$ BEGIN
  ALTER TYPE worker_status ADD VALUE IF NOT EXISTS 'busy';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE worker_status ADD VALUE IF NOT EXISTS 'draining';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE workers
  ADD COLUMN IF NOT EXISTS capabilities TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS current_task_id UUID REFERENCES tasks(id);

CREATE INDEX IF NOT EXISTS idx_workers_capabilities ON workers USING GIN(capabilities);

CREATE TABLE IF NOT EXISTS webhooks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  event_types TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhooks_tenant ON webhooks(tenant_id, is_active);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  webhook_id UUID NOT NULL REFERENCES webhooks(id),
  event_id BIGINT NOT NULL REFERENCES events(id),
  event_type TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  last_status_code INTEGER,
  last_error TEXT,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_pending ON webhook_deliveries(tenant_id, status, created_at DESC);

DROP TRIGGER IF EXISTS trg_webhook_deliveries_updated_at ON webhook_deliveries;
CREATE TRIGGER trg_webhook_deliveries_updated_at
  BEFORE UPDATE ON webhook_deliveries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
