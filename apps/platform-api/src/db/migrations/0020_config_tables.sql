-- Migration 0020: Configuration tables for DB-backed config
-- Replaces file-based config (built-in-roles.json, models.yaml, defaults.yaml)
-- with database-first configuration that supports runtime changes via UI.

-- Role definitions (replaces configs/built-in-roles.json)
CREATE TABLE role_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    description TEXT,
    system_prompt TEXT,
    allowed_tools TEXT[] DEFAULT '{}',
    model_preference TEXT,
    fallback_model TEXT,
    verification_strategy TEXT,
    capabilities TEXT[] DEFAULT '{}',
    is_built_in BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    version INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tenant_id, name)
);

CREATE INDEX idx_role_definitions_tenant ON role_definitions(tenant_id);
CREATE INDEX idx_role_definitions_active ON role_definitions(tenant_id, is_active);

-- LLM provider configurations
CREATE TABLE llm_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key_secret_ref TEXT,
    is_enabled BOOLEAN DEFAULT true,
    rate_limit_rpm INTEGER,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tenant_id, name)
);

CREATE INDEX idx_llm_providers_tenant ON llm_providers(tenant_id);

-- LLM model catalog
CREATE TABLE llm_models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    provider_id UUID NOT NULL REFERENCES llm_providers(id),
    model_id TEXT NOT NULL,
    context_window INTEGER,
    max_output_tokens INTEGER,
    supports_tool_use BOOLEAN DEFAULT true,
    supports_vision BOOLEAN DEFAULT false,
    input_cost_per_million_usd NUMERIC,
    output_cost_per_million_usd NUMERIC,
    is_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tenant_id, model_id)
);

CREATE INDEX idx_llm_models_tenant ON llm_models(tenant_id);
CREATE INDEX idx_llm_models_provider ON llm_models(provider_id);

-- Role-to-model default assignments
CREATE TABLE role_model_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    role_name TEXT NOT NULL,
    primary_model_id UUID REFERENCES llm_models(id),
    fallback_model_id UUID REFERENCES llm_models(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tenant_id, role_name)
);

CREATE INDEX idx_role_model_assignments_tenant ON role_model_assignments(tenant_id);

-- Runtime execution defaults (replaces defaults.yaml mutable settings)
CREATE TABLE runtime_defaults (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    config_key TEXT NOT NULL,
    config_value TEXT NOT NULL,
    config_type TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tenant_id, config_key)
);

CREATE INDEX idx_runtime_defaults_tenant ON runtime_defaults(tenant_id);
