ALTER TABLE workflow_stage_gates
  ADD COLUMN IF NOT EXISTS requested_by_work_item_id uuid;

