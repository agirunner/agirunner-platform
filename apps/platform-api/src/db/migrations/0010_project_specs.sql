ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS current_spec_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS project_spec_version INTEGER;

CREATE TABLE IF NOT EXISTS project_spec_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  version INTEGER NOT NULL,
  spec JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_type TEXT NOT NULL,
  created_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_spec_versions_project_version
  ON project_spec_versions(project_id, version);

CREATE INDEX IF NOT EXISTS idx_project_spec_versions_tenant_project
  ON project_spec_versions(tenant_id, project_id, version DESC);
