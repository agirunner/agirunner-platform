CREATE TABLE workflow_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  name text NOT NULL,
  position integer NOT NULL,
  goal text NOT NULL,
  guidance text,
  human_gate boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending',
  gate_status text NOT NULL DEFAULT 'not_requested',
  iteration_count integer NOT NULL DEFAULT 0,
  summary text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_workflow_stages_workflow_name UNIQUE (tenant_id, workflow_id, name),
  CONSTRAINT workflow_stages_status_check
    CHECK (status IN ('pending', 'active', 'awaiting_gate', 'completed', 'blocked')),
  CONSTRAINT workflow_stages_gate_status_check
    CHECK (gate_status IN ('not_requested', 'awaiting_approval', 'approved', 'rejected', 'changes_requested'))
);

CREATE INDEX idx_workflow_stages_workflow
  ON workflow_stages (tenant_id, workflow_id, position);

CREATE INDEX idx_workflow_stages_status
  ON workflow_stages (tenant_id, status);
