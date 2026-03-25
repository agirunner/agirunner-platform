ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS completion_callouts jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE workflow_work_items
  ADD COLUMN IF NOT EXISTS completion_callouts jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE workflow_stage_gates
  ADD COLUMN IF NOT EXISTS closure_effect text NOT NULL DEFAULT 'blocking',
  ADD COLUMN IF NOT EXISTS requested_by_task_id uuid REFERENCES tasks(id),
  ADD COLUMN IF NOT EXISTS requested_reason text,
  ADD COLUMN IF NOT EXISTS resolution_status text,
  ADD COLUMN IF NOT EXISTS resolved_by_task_id uuid REFERENCES tasks(id);

ALTER TABLE workflow_stage_gates
  DROP CONSTRAINT IF EXISTS workflow_stage_gates_closure_effect_check;

ALTER TABLE workflow_stage_gates
  ADD CONSTRAINT workflow_stage_gates_closure_effect_check
  CHECK (closure_effect IN ('blocking', 'advisory'));

ALTER TABLE workflow_subject_escalations
  ADD COLUMN IF NOT EXISTS closure_effect text NOT NULL DEFAULT 'advisory',
  ADD COLUMN IF NOT EXISTS resolution_status text,
  ADD COLUMN IF NOT EXISTS resolved_by_task_id uuid REFERENCES tasks(id);

ALTER TABLE workflow_subject_escalations
  DROP CONSTRAINT IF EXISTS workflow_subject_escalations_closure_effect_check;

ALTER TABLE workflow_subject_escalations
  ADD CONSTRAINT workflow_subject_escalations_closure_effect_check
  CHECK (closure_effect IN ('blocking', 'advisory'));

ALTER TABLE task_handoffs
  ADD COLUMN IF NOT EXISTS recommended_next_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS waived_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS completion_callouts jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE workflow_tool_results
  ADD COLUMN IF NOT EXISTS mutation_outcome text,
  ADD COLUMN IF NOT EXISTS recovery_class text;

CREATE INDEX IF NOT EXISTS idx_workflow_tool_results_mutation_outcome
  ON workflow_tool_results (tenant_id, workflow_id, mutation_outcome, created_at)
  WHERE mutation_outcome IS NOT NULL;

ALTER TABLE workflow_activations
  ADD COLUMN IF NOT EXISTS closure_context jsonb NOT NULL DEFAULT '{}'::jsonb;
