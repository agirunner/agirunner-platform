ALTER TABLE workflow_operator_updates
  ADD COLUMN IF NOT EXISTS llm_turn_count integer;

ALTER TABLE workflow_operator_briefs
  ADD COLUMN IF NOT EXISTS llm_turn_count integer;
