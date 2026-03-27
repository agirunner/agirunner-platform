ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS live_visibility_mode_override text,
  ADD COLUMN IF NOT EXISTS live_visibility_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS live_visibility_updated_by_operator_id text,
  ADD COLUMN IF NOT EXISTS live_visibility_updated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'workflows_live_visibility_mode_override_check'
  ) THEN
    ALTER TABLE workflows
      ADD CONSTRAINT workflows_live_visibility_mode_override_check CHECK (
        live_visibility_mode_override IS NULL OR
        live_visibility_mode_override IN ('standard', 'enhanced')
      );
  END IF;
END $$;
