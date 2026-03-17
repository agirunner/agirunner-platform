ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS max_iterations integer;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS llm_max_retries integer;
