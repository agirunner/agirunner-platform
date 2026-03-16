CREATE TABLE IF NOT EXISTS task_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  work_item_id uuid REFERENCES workflow_work_items(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  task_rework_count integer NOT NULL DEFAULT 0,
  request_id text,
  role text NOT NULL,
  team_name text,
  stage_name text,
  sequence integer NOT NULL DEFAULT 0,
  summary text NOT NULL,
  completion text NOT NULL DEFAULT 'full',
  changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  decisions jsonb NOT NULL DEFAULT '[]'::jsonb,
  remaining_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  review_focus text[] NOT NULL DEFAULT '{}'::text[],
  known_risks text[] NOT NULL DEFAULT '{}'::text[],
  successor_context text,
  role_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  artifact_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_handoffs_completion_check
    CHECK (completion IN ('full', 'partial', 'blocked'))
);

CREATE INDEX IF NOT EXISTS idx_task_handoffs_work_item
  ON task_handoffs (tenant_id, work_item_id, sequence);

CREATE INDEX IF NOT EXISTS idx_task_handoffs_workflow
  ON task_handoffs (tenant_id, workflow_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_handoffs_task_attempt
  ON task_handoffs (task_id, task_rework_count);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_handoffs_request_id
  ON task_handoffs (tenant_id, workflow_id, request_id)
  WHERE request_id IS NOT NULL;
