-- Dedicated orchestrator configuration (singleton per tenant).
-- Stores the orchestrator-specific system prompt, separate from
-- platform_instructions (org-wide baseline for all agents).
CREATE TABLE IF NOT EXISTS orchestrator_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id),
  prompt TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
