CREATE TABLE IF NOT EXISTS webhook_task_triggers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  project_id UUID REFERENCES projects(id),
  pipeline_id UUID REFERENCES pipelines(id),
  event_header TEXT,
  event_types TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  signature_header TEXT NOT NULL,
  signature_mode TEXT NOT NULL,
  secret TEXT NOT NULL,
  field_mappings JSONB NOT NULL DEFAULT '{}'::jsonb,
  defaults JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_task_triggers_tenant
  ON webhook_task_triggers(tenant_id, is_active, created_at DESC);

CREATE TABLE IF NOT EXISTS webhook_task_trigger_invocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  trigger_id UUID NOT NULL REFERENCES webhook_task_triggers(id),
  event_type TEXT,
  dedupe_key TEXT,
  task_id UUID REFERENCES tasks(id),
  status TEXT NOT NULL,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_task_trigger_invocations_tenant_trigger
  ON webhook_task_trigger_invocations(tenant_id, trigger_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_task_trigger_invocations_dedupe
  ON webhook_task_trigger_invocations(trigger_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
