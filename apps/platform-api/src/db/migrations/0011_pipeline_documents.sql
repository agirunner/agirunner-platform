CREATE TABLE IF NOT EXISTS workflow_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  workflow_id UUID NOT NULL REFERENCES workflows(id),
  project_id UUID REFERENCES projects(id),
  task_id UUID REFERENCES tasks(id),
  logical_name TEXT NOT NULL,
  source TEXT NOT NULL,
  location TEXT NOT NULL,
  artifact_id UUID REFERENCES workflow_artifacts(id),
  content_type TEXT,
  title TEXT,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_documents_tenant_workflow
  ON workflow_documents(tenant_id, workflow_id, created_at ASC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_documents_workflow_logical_name
  ON workflow_documents(tenant_id, workflow_id, logical_name);

CREATE INDEX IF NOT EXISTS idx_workflow_documents_tenant_task
  ON workflow_documents(tenant_id, task_id);
