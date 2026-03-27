CREATE TABLE IF NOT EXISTS workflow_operator_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  work_item_id uuid REFERENCES workflow_work_items(id) ON DELETE SET NULL,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  request_id uuid NOT NULL,
  execution_context_id uuid NOT NULL,
  brief_kind text NOT NULL,
  brief_scope text NOT NULL,
  source_kind text NOT NULL,
  source_role_name text,
  status_kind text NOT NULL,
  short_brief jsonb NOT NULL DEFAULT '{}'::jsonb,
  detailed_brief_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  sequence_number integer NOT NULL,
  related_artifact_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  related_output_descriptor_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  related_intervention_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  canonical_workflow_brief_id uuid REFERENCES workflow_operator_briefs(id) ON DELETE SET NULL,
  created_by_type text NOT NULL,
  created_by_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_operator_briefs_workflow_sequence
  ON workflow_operator_briefs (tenant_id, workflow_id, sequence_number DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_operator_briefs_work_item
  ON workflow_operator_briefs (tenant_id, work_item_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_operator_briefs_request
  ON workflow_operator_briefs (tenant_id, workflow_id, request_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'workflow_operator_briefs_sequence_positive'
  ) THEN
    ALTER TABLE workflow_operator_briefs
      ADD CONSTRAINT workflow_operator_briefs_sequence_positive CHECK (sequence_number > 0);
  END IF;
END $$;
