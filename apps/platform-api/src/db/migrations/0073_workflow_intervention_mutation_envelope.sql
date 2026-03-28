ALTER TABLE workflow_interventions
  ADD COLUMN IF NOT EXISTS request_id text,
  ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'applied',
  ADD COLUMN IF NOT EXISTS result_kind text NOT NULL DEFAULT 'intervention_recorded',
  ADD COLUMN IF NOT EXISTS snapshot_version text,
  ADD COLUMN IF NOT EXISTS settings_revision integer,
  ADD COLUMN IF NOT EXISTS message text;
