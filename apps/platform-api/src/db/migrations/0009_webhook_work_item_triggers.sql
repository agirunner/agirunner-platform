BEGIN;

DROP TABLE IF EXISTS webhook_task_trigger_invocations;
DROP TABLE IF EXISTS webhook_task_triggers;

CREATE TABLE IF NOT EXISTS webhook_work_item_triggers (
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

CREATE INDEX IF NOT EXISTS idx_webhook_work_item_triggers_tenant
    ON webhook_work_item_triggers (tenant_id, is_active, created_at DESC);

CREATE TABLE IF NOT EXISTS webhook_work_item_trigger_invocations (
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

CREATE INDEX IF NOT EXISTS idx_webhook_work_item_trigger_invocations_tenant_trigger
    ON webhook_work_item_trigger_invocations (tenant_id, trigger_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_work_item_trigger_invocations_dedupe
    ON webhook_work_item_trigger_invocations (trigger_id, dedupe_key)
    WHERE dedupe_key IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'workflow_work_items'
  ) AND NOT EXISTS (
    SELECT 1
      FROM information_schema.table_constraints
     WHERE table_schema = 'public'
       AND table_name = 'webhook_work_item_trigger_invocations'
       AND constraint_name = 'webhook_work_item_trigger_invocations_work_item_id_fkey'
  ) THEN
    ALTER TABLE webhook_work_item_trigger_invocations
      ADD CONSTRAINT webhook_work_item_trigger_invocations_work_item_id_fkey
      FOREIGN KEY (work_item_id) REFERENCES workflow_work_items(id);
  END IF;
END $$;

COMMIT;
