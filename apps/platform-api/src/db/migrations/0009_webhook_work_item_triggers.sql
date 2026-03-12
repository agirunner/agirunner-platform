BEGIN;

DROP TABLE IF EXISTS webhook_task_trigger_invocations;
DROP TABLE IF EXISTS webhook_task_triggers;

CREATE TABLE webhook_work_item_triggers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    name text NOT NULL,
    source text NOT NULL,
    project_id uuid REFERENCES projects(id),
    workflow_id uuid NOT NULL REFERENCES workflows(id),
    event_header text,
    event_types text[] NOT NULL DEFAULT '{}',
    signature_header text NOT NULL,
    signature_mode text NOT NULL,
    secret text NOT NULL,
    field_mappings jsonb NOT NULL DEFAULT '{}'::jsonb,
    defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_webhook_work_item_triggers_tenant
    ON webhook_work_item_triggers (tenant_id, is_active, created_at DESC);

CREATE TABLE webhook_work_item_trigger_invocations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    trigger_id uuid NOT NULL REFERENCES webhook_work_item_triggers(id),
    event_type text,
    dedupe_key text,
    work_item_id uuid REFERENCES workflow_work_items(id),
    status text NOT NULL,
    error text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_webhook_work_item_trigger_invocations_tenant_trigger
    ON webhook_work_item_trigger_invocations (tenant_id, trigger_id, created_at DESC);

CREATE UNIQUE INDEX uq_webhook_work_item_trigger_invocations_dedupe
    ON webhook_work_item_trigger_invocations (trigger_id, dedupe_key)
    WHERE dedupe_key IS NOT NULL;

COMMIT;
