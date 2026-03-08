CREATE TABLE IF NOT EXISTS workflow_artifacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  workflow_id UUID REFERENCES workflows(id),
  project_id UUID REFERENCES projects(id),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  logical_path TEXT NOT NULL,
  storage_backend TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  retention_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_artifacts_tenant_task
  ON workflow_artifacts (tenant_id, task_id);

CREATE INDEX IF NOT EXISTS idx_workflow_artifacts_tenant_workflow
  ON workflow_artifacts (tenant_id, workflow_id);

CREATE INDEX IF NOT EXISTS idx_workflow_artifacts_tenant_path
  ON workflow_artifacts (tenant_id, logical_path);
