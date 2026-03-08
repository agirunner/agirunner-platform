-- Dynamic Container Management: runtime heartbeats and fleet events

CREATE TABLE runtime_heartbeats (
    runtime_id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    template_id UUID NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    state TEXT NOT NULL DEFAULT 'idle'
        CHECK (state IN ('idle', 'executing', 'draining')),
    task_id UUID,
    uptime_seconds INTEGER NOT NULL DEFAULT 0,
    last_claim_at TIMESTAMPTZ,
    image TEXT NOT NULL,
    drain_requested BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_runtime_heartbeats_tenant ON runtime_heartbeats (tenant_id);
CREATE INDEX idx_runtime_heartbeats_template ON runtime_heartbeats (template_id);
CREATE INDEX idx_runtime_heartbeats_state ON runtime_heartbeats (state);

CREATE TABLE fleet_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    event_type TEXT NOT NULL,
    level TEXT NOT NULL DEFAULT 'info'
        CHECK (level IN ('debug', 'info', 'warn', 'error')),
    runtime_id UUID,
    template_id UUID,
    task_id UUID,
    workflow_id UUID,
    container_id TEXT,
    payload JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fleet_events_tenant_created ON fleet_events (tenant_id, created_at DESC);
CREATE INDEX idx_fleet_events_template ON fleet_events (template_id, created_at DESC);
CREATE INDEX idx_fleet_events_runtime ON fleet_events (runtime_id, created_at DESC);
CREATE INDEX idx_fleet_events_type ON fleet_events (event_type);
