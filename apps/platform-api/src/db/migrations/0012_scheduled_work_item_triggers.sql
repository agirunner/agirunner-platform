BEGIN;

CREATE TABLE scheduled_work_item_triggers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    name text NOT NULL,
    source text NOT NULL,
    project_id uuid REFERENCES projects(id),
    workflow_id uuid NOT NULL REFERENCES workflows(id),
    cadence_minutes integer NOT NULL CHECK (cadence_minutes > 0),
    defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_active boolean NOT NULL DEFAULT true,
    last_fired_at timestamptz,
    next_fire_at timestamptz NOT NULL,
    lease_token text,
    lease_expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_scheduled_work_item_triggers_due
    ON scheduled_work_item_triggers (tenant_id, is_active, next_fire_at ASC);

CREATE INDEX idx_scheduled_work_item_triggers_lease
    ON scheduled_work_item_triggers (tenant_id, lease_expires_at ASC);

CREATE TABLE scheduled_work_item_trigger_invocations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    trigger_id uuid NOT NULL REFERENCES scheduled_work_item_triggers(id),
    scheduled_for timestamptz NOT NULL,
    work_item_id uuid REFERENCES workflow_work_items(id),
    status text NOT NULL,
    error text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_scheduled_work_item_trigger_invocations_tenant_trigger
    ON scheduled_work_item_trigger_invocations (tenant_id, trigger_id, created_at DESC);

CREATE UNIQUE INDEX uq_scheduled_work_item_trigger_invocations_dedupe
    ON scheduled_work_item_trigger_invocations (trigger_id, scheduled_for);

COMMIT;
