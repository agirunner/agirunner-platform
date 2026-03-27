CREATE TABLE IF NOT EXISTS agentic_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  live_visibility_mode_default text NOT NULL DEFAULT 'enhanced',
  revision integer NOT NULL DEFAULT 0,
  updated_by_operator_id text,
  updated_at timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'agentic_settings_live_visibility_mode_default_check'
  ) THEN
    ALTER TABLE agentic_settings
      ADD CONSTRAINT agentic_settings_live_visibility_mode_default_check CHECK (
        live_visibility_mode_default IN ('standard', 'enhanced')
      );
  END IF;
END $$;
