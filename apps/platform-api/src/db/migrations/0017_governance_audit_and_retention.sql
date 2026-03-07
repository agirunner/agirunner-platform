CREATE TABLE audit_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  outcome TEXT NOT NULL,
  reason TEXT,
  request_id TEXT,
  source_ip TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_tenant_time
  ON audit_logs (tenant_id, created_at DESC);

CREATE INDEX idx_audit_logs_actor
  ON audit_logs (tenant_id, actor_id, created_at DESC);

CREATE INDEX idx_audit_logs_action
  ON audit_logs (tenant_id, action, created_at DESC);

CREATE INDEX idx_audit_logs_resource
  ON audit_logs (tenant_id, resource_id, created_at DESC);

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS legal_hold BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

ALTER TABLE pipelines
  ADD COLUMN IF NOT EXISTS legal_hold BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
