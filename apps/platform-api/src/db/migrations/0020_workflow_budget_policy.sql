ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS token_budget integer,
  ADD COLUMN IF NOT EXISTS cost_cap_usd numeric(10,4),
  ADD COLUMN IF NOT EXISTS max_duration_minutes integer;
