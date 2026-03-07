CREATE TYPE acp_session_status AS ENUM ('initializing', 'active', 'idle', 'closed');

CREATE TABLE acp_sessions (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,
  pipeline_id UUID REFERENCES pipelines(id) ON DELETE CASCADE,
  transport TEXT NOT NULL,
  mode TEXT NOT NULL,
  status acp_session_status NOT NULL DEFAULT 'initializing',
  workspace_path TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_heartbeat_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_acp_sessions_tenant_agent ON acp_sessions (tenant_id, agent_id, created_at DESC);
CREATE INDEX idx_acp_sessions_tenant_pipeline ON acp_sessions (tenant_id, pipeline_id, created_at DESC);
CREATE INDEX idx_acp_sessions_tenant_status ON acp_sessions (tenant_id, status, updated_at DESC);
