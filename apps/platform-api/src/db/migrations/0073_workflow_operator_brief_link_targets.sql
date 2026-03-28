ALTER TABLE workflow_operator_briefs
  ADD COLUMN IF NOT EXISTS linked_target_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
