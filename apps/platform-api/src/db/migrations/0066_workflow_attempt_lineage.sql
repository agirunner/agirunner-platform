ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS root_workflow_id uuid REFERENCES workflows(id),
  ADD COLUMN IF NOT EXISTS previous_attempt_workflow_id uuid REFERENCES workflows(id),
  ADD COLUMN IF NOT EXISTS attempt_number integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS attempt_kind text NOT NULL DEFAULT 'initial';

CREATE INDEX IF NOT EXISTS idx_workflows_attempt_root
  ON workflows (tenant_id, root_workflow_id, attempt_number);

CREATE INDEX IF NOT EXISTS idx_workflows_previous_attempt
  ON workflows (tenant_id, previous_attempt_workflow_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'workflows_attempt_number_positive'
  ) THEN
    ALTER TABLE workflows
      ADD CONSTRAINT workflows_attempt_number_positive CHECK (attempt_number > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'workflows_attempt_kind_check'
  ) THEN
    ALTER TABLE workflows
      ADD CONSTRAINT workflows_attempt_kind_check CHECK (attempt_kind IN ('initial', 'redrive'));
  END IF;
END $$;
