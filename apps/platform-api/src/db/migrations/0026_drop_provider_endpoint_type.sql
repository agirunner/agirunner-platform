-- Migration 0026: Remove endpoint_type from llm_providers
-- Endpoint type is now per-model (llm_models.endpoint_type), not per-provider.
-- Different models from the same provider use different endpoints
-- (e.g. GPT-4o → chat-completions, GPT-5.4 → responses, both under OpenAI).

ALTER TABLE llm_providers DROP COLUMN IF EXISTS endpoint_type;
