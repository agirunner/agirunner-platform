-- Migration 0021: Fleet management tables for reconciler
-- Tracks desired container state, actual container state, and available images.

-- Desired state for worker containers
CREATE TABLE worker_desired_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    worker_name TEXT NOT NULL,
    role TEXT NOT NULL,
    runtime_image TEXT NOT NULL,
    cpu_limit TEXT DEFAULT '2',
    memory_limit TEXT DEFAULT '2g',
    network_policy TEXT DEFAULT 'restricted',
    environment JSONB DEFAULT '{}',
    llm_provider TEXT,
    llm_model TEXT,
    llm_api_key_secret_ref TEXT,
    replicas INTEGER DEFAULT 1,
    enabled BOOLEAN DEFAULT true,
    restart_requested BOOLEAN DEFAULT false,
    draining BOOLEAN DEFAULT false,
    version INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID,
    UNIQUE (tenant_id, worker_name)
);

CREATE INDEX idx_worker_desired_state_tenant ON worker_desired_state(tenant_id);
CREATE INDEX idx_worker_desired_state_enabled ON worker_desired_state(tenant_id, enabled);

-- Actual state reported by reconciler
CREATE TABLE worker_actual_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    desired_state_id UUID NOT NULL REFERENCES worker_desired_state(id) ON DELETE CASCADE,
    container_id TEXT,
    container_status TEXT,
    cpu_usage_percent REAL,
    memory_usage_bytes BIGINT,
    network_rx_bytes BIGINT,
    network_tx_bytes BIGINT,
    started_at TIMESTAMPTZ,
    last_updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_worker_actual_state_desired ON worker_actual_state(desired_state_id);

-- Available Docker images reported by reconciler
CREATE TABLE container_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository TEXT NOT NULL,
    tag TEXT,
    digest TEXT,
    size_bytes BIGINT,
    created_at TIMESTAMPTZ,
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (repository, tag)
);
