ALTER TABLE templates
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_templates_not_deleted
  ON templates(tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;
