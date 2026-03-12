UPDATE workflows
   SET current_stage = NULL,
       updated_at = now()
 WHERE lifecycle = 'continuous'
   AND current_stage IS NOT NULL;

ALTER TABLE workflows
  ADD CONSTRAINT chk_workflows_continuous_current_stage_null
  CHECK (lifecycle IS DISTINCT FROM 'continuous' OR current_stage IS NULL);

CREATE INDEX IF NOT EXISTS idx_workflow_stages_workflow_status
  ON workflow_stages (tenant_id, workflow_id, status, position);

CREATE INDEX IF NOT EXISTS idx_workflow_stages_workflow_gate_status
  ON workflow_stages (tenant_id, workflow_id, gate_status, position);
