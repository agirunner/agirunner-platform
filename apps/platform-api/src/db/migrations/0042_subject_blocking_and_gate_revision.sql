ALTER TABLE workflow_work_items
  ADD COLUMN IF NOT EXISTS blocked_state text,
  ADD COLUMN IF NOT EXISTS blocked_reason text;

ALTER TABLE workflow_work_items
  DROP CONSTRAINT IF EXISTS workflow_work_items_blocked_state_check;

ALTER TABLE workflow_work_items
  ADD CONSTRAINT workflow_work_items_blocked_state_check
  CHECK (blocked_state IS NULL OR blocked_state IN ('blocked'));

CREATE INDEX IF NOT EXISTS idx_workflow_work_items_blocked_state
  ON workflow_work_items (tenant_id, workflow_id, blocked_state)
  WHERE blocked_state IS NOT NULL;

ALTER TABLE workflow_stages
  DROP CONSTRAINT IF EXISTS workflow_stages_gate_status_check;

ALTER TABLE workflow_stages
  ADD CONSTRAINT workflow_stages_gate_status_check
  CHECK (gate_status IN ('not_requested', 'awaiting_approval', 'approved', 'rejected', 'changes_requested', 'blocked'));

ALTER TABLE workflow_stage_gates
  ADD COLUMN IF NOT EXISTS subject_revision integer,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by_revision integer;

ALTER TABLE workflow_stage_gates
  DROP CONSTRAINT IF EXISTS workflow_stage_gates_status_check;

ALTER TABLE workflow_stage_gates
  ADD CONSTRAINT workflow_stage_gates_status_check
  CHECK (status IN ('awaiting_approval', 'approved', 'rejected', 'changes_requested', 'blocked'));

ALTER TABLE task_handoffs
  DROP CONSTRAINT IF EXISTS task_handoffs_resolution_check;

ALTER TABLE task_handoffs
  ADD CONSTRAINT task_handoffs_resolution_check
  CHECK (resolution IS NULL OR resolution IN ('approved', 'request_changes', 'rejected', 'blocked'));
