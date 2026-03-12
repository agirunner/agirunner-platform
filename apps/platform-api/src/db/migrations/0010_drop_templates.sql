ALTER TABLE workflows
  DROP CONSTRAINT IF EXISTS workflows_template_id_fkey;

DROP INDEX IF EXISTS idx_workflows_template;

ALTER TABLE workflows
  DROP COLUMN IF EXISTS template_id,
  DROP COLUMN IF EXISTS template_version;

DROP TABLE IF EXISTS templates CASCADE;
