-- Migration 0023: Metering events and worker quality scores
-- Supports marketplace readiness: usage metering, quality-aware dispatch, circuit breakers.

CREATE TABLE IF NOT EXISTS metering_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    task_id UUID NOT NULL,
    workflow_id UUID,
    worker_id UUID,
    agent_id UUID,
    tokens_input BIGINT NOT NULL DEFAULT 0,
    tokens_output BIGINT NOT NULL DEFAULT 0,
    cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
    wall_time_ms BIGINT NOT NULL DEFAULT 0,
    cpu_ms BIGINT,
    memory_peak_bytes BIGINT,
    network_bytes BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_metering_events_tenant ON metering_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_metering_events_task ON metering_events(task_id);
CREATE INDEX IF NOT EXISTS idx_metering_events_created ON metering_events(created_at);
CREATE INDEX IF NOT EXISTS idx_metering_events_workflow ON metering_events(workflow_id);

-- Worker quality score for marketplace dispatch
ALTER TABLE workers ADD COLUMN IF NOT EXISTS quality_score NUMERIC(5, 3) NOT NULL DEFAULT 1.000;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS circuit_breaker_state TEXT NOT NULL DEFAULT 'closed';
ALTER TABLE workers ADD COLUMN IF NOT EXISTS circuit_breaker_tripped_at TIMESTAMPTZ;

-- Circuit breaker events
CREATE TABLE IF NOT EXISTS circuit_breaker_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    worker_id UUID NOT NULL,
    trigger_type TEXT NOT NULL,
    reason TEXT NOT NULL,
    previous_state TEXT NOT NULL,
    new_state TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_circuit_breaker_events_worker ON circuit_breaker_events(worker_id);
