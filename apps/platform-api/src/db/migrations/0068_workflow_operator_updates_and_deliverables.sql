CREATE TABLE IF NOT EXISTS workflow_operator_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  work_item_id uuid REFERENCES workflow_work_items(id) ON DELETE SET NULL,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  request_id uuid NOT NULL,
  execution_context_id uuid NOT NULL,
  source_kind text NOT NULL,
  source_role_name text,
  update_kind text NOT NULL,
  headline text NOT NULL,
  summary text,
  linked_target_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  visibility_mode text NOT NULL,
  promoted_brief_id uuid REFERENCES workflow_operator_briefs(id) ON DELETE SET NULL,
  sequence_number integer NOT NULL,
  created_by_type text NOT NULL,
  created_by_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_operator_updates_workflow_sequence
  ON workflow_operator_updates (tenant_id, workflow_id, sequence_number DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_operator_updates_work_item
  ON workflow_operator_updates (tenant_id, work_item_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_operator_updates_request
  ON workflow_operator_updates (tenant_id, workflow_id, request_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'workflow_operator_updates_sequence_positive'
  ) THEN
    ALTER TABLE workflow_operator_updates
      ADD CONSTRAINT workflow_operator_updates_sequence_positive CHECK (sequence_number > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'workflow_operator_updates_visibility_mode_check'
  ) THEN
    ALTER TABLE workflow_operator_updates
      ADD CONSTRAINT workflow_operator_updates_visibility_mode_check CHECK (visibility_mode IN ('standard', 'enhanced'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS workflow_output_descriptors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  work_item_id uuid REFERENCES workflow_work_items(id) ON DELETE SET NULL,
  descriptor_kind text NOT NULL,
  delivery_stage text NOT NULL,
  title text NOT NULL,
  state text NOT NULL,
  summary_brief text,
  preview_capabilities_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  primary_target_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  secondary_targets_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  content_preview_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_brief_id uuid REFERENCES workflow_operator_briefs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_output_descriptors_workflow
  ON workflow_output_descriptors (tenant_id, workflow_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_output_descriptors_work_item
  ON workflow_output_descriptors (tenant_id, work_item_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'workflow_output_descriptors_delivery_stage_check'
  ) THEN
    ALTER TABLE workflow_output_descriptors
      ADD CONSTRAINT workflow_output_descriptors_delivery_stage_check CHECK (delivery_stage IN ('in_progress', 'final'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'workflow_output_descriptors_state_check'
  ) THEN
    ALTER TABLE workflow_output_descriptors
      ADD CONSTRAINT workflow_output_descriptors_state_check CHECK (state IN ('draft', 'under_review', 'approved', 'superseded', 'final'));
  END IF;
END $$;
