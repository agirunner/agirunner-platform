ALTER TABLE role_definitions
  ADD COLUMN IF NOT EXISTS execution_container_config jsonb;

CREATE TABLE IF NOT EXISTS execution_container_leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  workflow_id uuid,
  work_item_id uuid,
  role_name text NOT NULL,
  agent_id text,
  worker_id text,
  acquired_at timestamp with time zone NOT NULL DEFAULT now(),
  released_at timestamp with time zone,
  released_reason text
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'uq_execution_container_leases_tenant_task'
  ) THEN
    ALTER TABLE execution_container_leases
      ADD CONSTRAINT uq_execution_container_leases_tenant_task UNIQUE (tenant_id, task_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_execution_container_leases_tenant_active
  ON execution_container_leases (tenant_id, released_at);

CREATE INDEX IF NOT EXISTS idx_execution_container_leases_task
  ON execution_container_leases (task_id);
