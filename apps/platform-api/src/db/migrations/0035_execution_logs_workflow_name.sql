ALTER TABLE execution_logs ADD COLUMN workflow_name TEXT;

CREATE INDEX idx_execution_logs_workflow_name
  ON execution_logs (tenant_id, workflow_name)
  WHERE workflow_name IS NOT NULL;
