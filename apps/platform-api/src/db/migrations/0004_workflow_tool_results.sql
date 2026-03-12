CREATE TABLE workflow_tool_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  request_id text NOT NULL,
  response jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_workflow_tool_results_request
    UNIQUE (tenant_id, workflow_id, tool_name, request_id)
);

CREATE INDEX idx_workflow_tool_results_workflow
  ON workflow_tool_results (tenant_id, workflow_id, created_at DESC);
