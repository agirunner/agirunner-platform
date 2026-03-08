-- Migration 0024: LLM config enhancements (partially superseded by 0025/0026)
-- Originally added endpoint_type to providers (dropped in 0026),
-- default_reasoning_level to models (replaced in 0025), and reasoning_level to assignments (replaced in 0025).

ALTER TABLE llm_providers ADD COLUMN IF NOT EXISTS endpoint_type TEXT NOT NULL DEFAULT 'chat-completions';
ALTER TABLE llm_models ADD COLUMN IF NOT EXISTS default_reasoning_level TEXT NOT NULL DEFAULT 'none';
ALTER TABLE role_model_assignments ADD COLUMN IF NOT EXISTS reasoning_level TEXT;
