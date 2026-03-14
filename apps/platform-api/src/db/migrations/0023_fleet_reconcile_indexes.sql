CREATE INDEX IF NOT EXISTS idx_workflows_tenant_playbook_active
  ON workflows (tenant_id, playbook_id)
  WHERE state NOT IN ('cancelled', 'failed', 'completed');

CREATE INDEX IF NOT EXISTS idx_playbooks_tenant_active_runtime
  ON playbooks (tenant_id)
  WHERE is_active = true
    AND definition::jsonb ? 'runtime';

CREATE INDEX IF NOT EXISTS idx_tasks_ready_workflow_orchestrator
  ON tasks (tenant_id, workflow_id)
  WHERE state = 'ready'
    AND is_orchestrator_task = true;

CREATE INDEX IF NOT EXISTS idx_tasks_ready_workflow_specialist
  ON tasks (tenant_id, workflow_id)
  WHERE state = 'ready'
    AND COALESCE(is_orchestrator_task, false) = false;

CREATE INDEX IF NOT EXISTS idx_tasks_ready_workflow_specialist_capabilities
  ON tasks (tenant_id, workflow_id)
  WHERE state = 'ready'
    AND COALESCE(is_orchestrator_task, false) = false
    AND cardinality(capabilities_required) > 0;

CREATE INDEX IF NOT EXISTS idx_worker_actual_state_desired_last_updated
  ON worker_actual_state (desired_state_id, last_updated DESC);
