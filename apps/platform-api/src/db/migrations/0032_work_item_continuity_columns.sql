ALTER TABLE workflow_work_items
  ADD COLUMN IF NOT EXISTS current_checkpoint text,
  ADD COLUMN IF NOT EXISTS next_expected_actor text,
  ADD COLUMN IF NOT EXISTS next_expected_action text,
  ADD COLUMN IF NOT EXISTS rework_count integer NOT NULL DEFAULT 0;

UPDATE workflow_work_items
   SET current_checkpoint = stage_name
 WHERE current_checkpoint IS NULL
   AND stage_name IS NOT NULL;
