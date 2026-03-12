CREATE TABLE IF NOT EXISTS orchestrator_task_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id),
  task_id uuid NOT NULL REFERENCES tasks(id),
  orchestrator_task_id uuid NOT NULL REFERENCES tasks(id),
  activation_id uuid REFERENCES workflow_activations(id),
  stage_name text,
  worker_id uuid REFERENCES workers(id),
  request_id text NOT NULL,
  urgency text NOT NULL,
  message text NOT NULL,
  delivery_state text NOT NULL DEFAULT 'pending_delivery',
  delivery_attempt_count integer NOT NULL DEFAULT 0,
  last_delivery_attempt_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orchestrator_task_messages_request
  ON orchestrator_task_messages (tenant_id, workflow_id, request_id);

CREATE INDEX IF NOT EXISTS idx_orchestrator_task_messages_task
  ON orchestrator_task_messages (tenant_id, task_id);

CREATE INDEX IF NOT EXISTS idx_orchestrator_task_messages_pending
  ON orchestrator_task_messages (tenant_id, workflow_id, delivery_state)
  WHERE delivery_state IN ('pending_delivery', 'delivery_in_progress');
