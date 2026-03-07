CREATE TABLE IF NOT EXISTS pipeline_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  pipeline_id UUID NOT NULL REFERENCES pipelines(id),
  project_id UUID REFERENCES projects(id),
  task_id UUID REFERENCES tasks(id),
  logical_name TEXT NOT NULL,
  source TEXT NOT NULL,
  location TEXT NOT NULL,
  artifact_id UUID REFERENCES pipeline_artifacts(id),
  content_type TEXT,
  title TEXT,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_documents_tenant_pipeline
  ON pipeline_documents(tenant_id, pipeline_id, created_at ASC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pipeline_documents_pipeline_logical_name
  ON pipeline_documents(tenant_id, pipeline_id, logical_name);

CREATE INDEX IF NOT EXISTS idx_pipeline_documents_tenant_task
  ON pipeline_documents(tenant_id, task_id);
