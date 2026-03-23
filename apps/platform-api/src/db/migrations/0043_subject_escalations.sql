ALTER TABLE workflow_work_items
  ADD COLUMN IF NOT EXISTS escalation_status text;

ALTER TABLE workflow_work_items
  DROP CONSTRAINT IF EXISTS workflow_work_items_escalation_status_check;

ALTER TABLE workflow_work_items
  ADD CONSTRAINT workflow_work_items_escalation_status_check
  CHECK (escalation_status IS NULL OR escalation_status IN ('open'));

CREATE INDEX IF NOT EXISTS idx_workflow_work_items_escalation_status
  ON workflow_work_items (tenant_id, workflow_id, escalation_status)
  WHERE escalation_status IS NOT NULL;

CREATE TABLE IF NOT EXISTS workflow_subject_escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id),
  work_item_id uuid REFERENCES workflow_work_items(id),
  subject_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  subject_revision integer,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  created_by_task_id uuid REFERENCES tasks(id),
  resolution_action text,
  resolution_feedback text,
  resolved_by_type text,
  resolved_by_id text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_subject_escalations_status_check
    CHECK (status IN ('open', 'resolved', 'dismissed'))
);

CREATE INDEX IF NOT EXISTS idx_workflow_subject_escalations_workflow
  ON workflow_subject_escalations (tenant_id, workflow_id, created_at);

CREATE INDEX IF NOT EXISTS idx_workflow_subject_escalations_status
  ON workflow_subject_escalations (tenant_id, workflow_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_workflow_subject_escalations_work_item
  ON workflow_subject_escalations (tenant_id, workflow_id, work_item_id)
  WHERE work_item_id IS NOT NULL;
