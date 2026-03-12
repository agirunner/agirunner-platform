DROP INDEX IF EXISTS idx_tasks_request_id;

CREATE UNIQUE INDEX idx_tasks_request_id_workflow
  ON tasks (tenant_id, workflow_id, request_id)
  WHERE request_id IS NOT NULL
    AND workflow_id IS NOT NULL;

CREATE UNIQUE INDEX idx_tasks_request_id_no_workflow
  ON tasks (tenant_id, request_id)
  WHERE request_id IS NOT NULL
    AND workflow_id IS NULL;
