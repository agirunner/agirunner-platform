CREATE TABLE IF NOT EXISTS workflow_branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id),
  parent_branch_id uuid REFERENCES workflow_branches(id),
  parent_subject_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  branch_key text NOT NULL,
  branch_status text NOT NULL DEFAULT 'active',
  termination_policy text NOT NULL,
  created_by_task_id uuid REFERENCES tasks(id),
  terminated_by_type text,
  terminated_by_id text,
  termination_reason text,
  terminated_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_branches_status_check
    CHECK (branch_status IN ('active', 'completed', 'blocked', 'terminated')),
  CONSTRAINT workflow_branches_termination_policy_check
    CHECK (termination_policy IN ('stop_branch_only', 'stop_branch_and_descendants', 'stop_all_siblings'))
);

CREATE INDEX IF NOT EXISTS idx_workflow_branches_workflow
  ON workflow_branches (tenant_id, workflow_id, created_at);

CREATE INDEX IF NOT EXISTS idx_workflow_branches_status
  ON workflow_branches (tenant_id, workflow_id, branch_status, created_at);

CREATE INDEX IF NOT EXISTS idx_workflow_branches_parent
  ON workflow_branches (tenant_id, workflow_id, parent_branch_id)
  WHERE parent_branch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workflow_branches_key
  ON workflow_branches (tenant_id, workflow_id, branch_key);

ALTER TABLE workflow_work_items
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES workflow_branches(id);

CREATE INDEX IF NOT EXISTS idx_workflow_work_items_branch
  ON workflow_work_items (tenant_id, workflow_id, branch_id)
  WHERE branch_id IS NOT NULL;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES workflow_branches(id);

CREATE INDEX IF NOT EXISTS idx_tasks_branch
  ON tasks (tenant_id, workflow_id, branch_id)
  WHERE branch_id IS NOT NULL;
