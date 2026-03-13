CREATE TABLE task_tool_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  request_id text NOT NULL,
  response jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_task_tool_results_request
    UNIQUE (tenant_id, task_id, tool_name, request_id)
);

CREATE INDEX idx_task_tool_results_task
  ON task_tool_results (tenant_id, task_id, created_at DESC);
