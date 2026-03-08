-- Migration 0025: Replace flat reasoning_level TEXT with JSONB reasoning_config
-- Models declare what reasoning they support (schema). Assignments store chosen values.
-- Also adds per-model endpoint_type (different models from same provider may use different endpoints).

-- Models: add endpoint_type per model (auto-populated from discovery)
ALTER TABLE llm_models ADD COLUMN IF NOT EXISTS endpoint_type TEXT;

-- Models: replace default_reasoning_level TEXT with reasoning_config JSONB
-- null = model doesn't support reasoning
-- Example: {"type":"reasoning_effort","options":["none","low","medium","high","xhigh"],"default":"none"}
ALTER TABLE llm_models DROP COLUMN IF EXISTS default_reasoning_level;
ALTER TABLE llm_models ADD COLUMN IF NOT EXISTS reasoning_config JSONB;

-- Assignments: replace reasoning_level TEXT with reasoning_config JSONB
-- null = use model default
-- Example: {"reasoning_effort":"high"} or {"effort":"max"}
ALTER TABLE role_model_assignments DROP COLUMN IF EXISTS reasoning_level;
ALTER TABLE role_model_assignments ADD COLUMN IF NOT EXISTS reasoning_config JSONB;
