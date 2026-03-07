CREATE TABLE IF NOT EXISTS pipeline_artifacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  pipeline_id UUID REFERENCES pipelines(id),
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

CREATE INDEX IF NOT EXISTS idx_pipeline_artifacts_tenant_task
  ON pipeline_artifacts (tenant_id, task_id);

CREATE INDEX IF NOT EXISTS idx_pipeline_artifacts_tenant_pipeline
  ON pipeline_artifacts (tenant_id, pipeline_id);

CREATE INDEX IF NOT EXISTS idx_pipeline_artifacts_tenant_path
  ON pipeline_artifacts (tenant_id, logical_path);
