CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN CREATE TYPE task_state AS ENUM ('pending','ready','claimed','running','completed','failed','cancelled','awaiting_approval','output_pending_review'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE task_priority AS ENUM ('critical','high','normal','low'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE task_type AS ENUM ('analysis','code','review','test','docs','orchestration','custom'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE agent_status AS ENUM ('active','idle','busy','degraded','inactive','offline'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE worker_status AS ENUM ('online','degraded','offline'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE worker_connection_mode AS ENUM ('websocket','sse','polling'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE worker_runtime_type AS ENUM ('internal','openclaw','claude_code','codex','acp','custom','external'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE api_key_scope AS ENUM ('agent','worker','admin'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE event_entity_type AS ENUM ('task','workflow','agent','worker','project','template','system'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE workflow_state AS ENUM ('pending','active','completed','failed','cancelled','paused'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  settings JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  repository_url TEXT,
  memory JSONB NOT NULL DEFAULT '{}',
  memory_size_bytes INTEGER NOT NULL DEFAULT 0,
  memory_max_bytes INTEGER NOT NULL DEFAULT 1048576,
  settings JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_project_tenant_slug UNIQUE (tenant_id, slug)
);

CREATE TABLE IF NOT EXISTS templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  is_built_in BOOLEAN NOT NULL DEFAULT false,
  is_published BOOLEAN NOT NULL DEFAULT false,
  schema JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_template_tenant_slug_version UNIQUE (tenant_id, slug, version)
);

CREATE TABLE IF NOT EXISTS workflows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  project_id UUID REFERENCES projects(id),
  template_id UUID REFERENCES templates(id),
  template_version INTEGER,
  name TEXT NOT NULL,
  state workflow_state NOT NULL DEFAULT 'pending',
  parameters JSONB NOT NULL DEFAULT '{}',
  context JSONB NOT NULL DEFAULT '{}',
  context_size_bytes INTEGER NOT NULL DEFAULT 0,
  context_max_bytes INTEGER NOT NULL DEFAULT 5242880,
  git_branch TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  status worker_status NOT NULL DEFAULT 'online',
  connection_mode worker_connection_mode NOT NULL DEFAULT 'websocket',
  runtime_type worker_runtime_type NOT NULL DEFAULT 'external',
  host_info JSONB NOT NULL DEFAULT '{}',
  heartbeat_interval_seconds INTEGER NOT NULL DEFAULT 30,
  last_heartbeat_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  worker_id UUID REFERENCES workers(id),
  name TEXT NOT NULL,
  capabilities TEXT[] NOT NULL DEFAULT '{}',
  status agent_status NOT NULL DEFAULT 'idle',
  current_task_id UUID,
  heartbeat_interval_seconds INTEGER NOT NULL DEFAULT 30,
  last_heartbeat_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}',
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  workflow_id UUID REFERENCES workflows(id),
  project_id UUID REFERENCES projects(id),
  title TEXT NOT NULL,
  type task_type NOT NULL DEFAULT 'custom',
  role TEXT,
  priority task_priority NOT NULL DEFAULT 'normal',
  state task_state NOT NULL DEFAULT 'pending',
  state_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_agent_id UUID REFERENCES agents(id),
  assigned_worker_id UUID REFERENCES workers(id),
  claimed_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  depends_on UUID[] NOT NULL DEFAULT '{}',
  requires_approval BOOLEAN NOT NULL DEFAULT false,
  input JSONB NOT NULL DEFAULT '{}',
  output JSONB,
  error JSONB,
  capabilities_required TEXT[] NOT NULL DEFAULT '{}',
  role_config JSONB,
  environment JSONB,
  resource_bindings JSONB NOT NULL DEFAULT '[]',
  timeout_minutes INTEGER NOT NULL DEFAULT 30,
  token_budget INTEGER,
  cost_cap_usd NUMERIC(10,4),
  auto_retry BOOLEAN NOT NULL DEFAULT false,
  max_retries INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  metrics JSONB,
  git_info JSONB,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  key_hash TEXT NOT NULL,
  key_prefix VARCHAR(12) NOT NULL,
  scope api_key_scope NOT NULL,
  owner_type TEXT NOT NULL,
  owner_id UUID,
  label TEXT,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  is_revoked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orchestrator_grants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  agent_id UUID NOT NULL REFERENCES agents(id),
  workflow_id UUID NOT NULL REFERENCES workflows(id),
  permissions TEXT[] NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  type TEXT NOT NULL,
  entity_type event_entity_type NOT NULL,
  entity_id UUID NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS worker_signals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  worker_id UUID NOT NULL REFERENCES workers(id),
  signal_type TEXT NOT NULL,
  task_id UUID REFERENCES tasks(id),
  data JSONB NOT NULL DEFAULT '{}',
  delivered BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_owner ON api_keys(owner_type, owner_id);

CREATE INDEX IF NOT EXISTS idx_projects_tenant ON projects(tenant_id);

CREATE INDEX IF NOT EXISTS idx_templates_tenant ON templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_templates_built_in ON templates(is_built_in) WHERE is_built_in = true;

CREATE INDEX IF NOT EXISTS idx_workflows_tenant ON workflows(tenant_id);
CREATE INDEX IF NOT EXISTS idx_workflows_project ON workflows(project_id);
CREATE INDEX IF NOT EXISTS idx_workflows_state ON workflows(tenant_id, state);
CREATE INDEX IF NOT EXISTS idx_workflows_template ON workflows(template_id);

CREATE INDEX IF NOT EXISTS idx_tasks_tenant ON tasks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tasks_workflow ON tasks(workflow_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_claimable ON tasks(tenant_id, priority DESC, created_at ASC) WHERE state = 'ready';
CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(tenant_id, state);
CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(assigned_agent_id) WHERE assigned_agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_depends_on ON tasks USING GIN(depends_on);
CREATE INDEX IF NOT EXISTS idx_tasks_running_timeout ON tasks(started_at) WHERE state = 'running';

CREATE INDEX IF NOT EXISTS idx_agents_tenant ON agents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agents_worker ON agents(worker_id);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_agents_capabilities ON agents USING GIN(capabilities);
CREATE INDEX IF NOT EXISTS idx_agents_current_task ON agents(current_task_id) WHERE current_task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workers_tenant ON workers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_workers_status ON workers(tenant_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orchestrator_grants_agent_workflow ON orchestrator_grants(agent_id, workflow_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_orchestrator_grants_tenant ON orchestrator_grants(tenant_id);

CREATE INDEX IF NOT EXISTS idx_events_tenant_time ON events(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_entity ON events(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(tenant_id, type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_worker_signals_pending ON worker_signals(worker_id, delivered) WHERE delivered = false;

CREATE OR REPLACE FUNCTION notify_event() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'agirunner_events',
    json_build_object('id', NEW.id, 'type', NEW.type, 'entity_type', NEW.entity_type, 'entity_id', NEW.entity_id, 'tenant_id', NEW.tenant_id)::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_events_notify ON events;
CREATE TRIGGER trg_events_notify AFTER INSERT ON events FOR EACH ROW EXECUTE FUNCTION notify_event();

CREATE OR REPLACE FUNCTION update_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tenants_updated_at ON tenants;
DROP TRIGGER IF EXISTS trg_projects_updated_at ON projects;
DROP TRIGGER IF EXISTS trg_templates_updated_at ON templates;
DROP TRIGGER IF EXISTS trg_workflows_updated_at ON workflows;
DROP TRIGGER IF EXISTS trg_tasks_updated_at ON tasks;
DROP TRIGGER IF EXISTS trg_agents_updated_at ON agents;
DROP TRIGGER IF EXISTS trg_workers_updated_at ON workers;

CREATE TRIGGER trg_tenants_updated_at BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_templates_updated_at BEFORE UPDATE ON templates FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_workflows_updated_at BEFORE UPDATE ON workflows FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_agents_updated_at BEFORE UPDATE ON agents FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_workers_updated_at BEFORE UPDATE ON workers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
