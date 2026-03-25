ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS last_claim_at timestamp with time zone;
