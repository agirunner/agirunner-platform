ALTER TABLE workflow_work_items
  ADD COLUMN IF NOT EXISTS next_expected_actor text,
  ADD COLUMN IF NOT EXISTS next_expected_action text,
  ADD COLUMN IF NOT EXISTS rework_count integer NOT NULL DEFAULT 0;
