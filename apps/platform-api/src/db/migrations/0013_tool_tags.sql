CREATE TABLE IF NOT EXISTS tool_tags (
  id TEXT NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_tool_tags_tenant_created
  ON tool_tags(tenant_id, created_at DESC);
