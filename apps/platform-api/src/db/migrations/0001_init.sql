-- Agirunner platform schema init migration
-- Consolidated from migrations 0001-0041

-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;

-- Enum types
DO $$ BEGIN
  CREATE TYPE public.acp_session_status AS ENUM (
    'initializing',
    'active',
    'idle',
    'closed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.agent_status AS ENUM (
    'active',
    'idle',
    'busy',
    'degraded',
    'inactive',
    'offline'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.api_key_scope AS ENUM (
    'agent',
    'worker',
    'admin'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.event_entity_type AS ENUM (
    'task',
    'workflow',
    'agent',
    'worker',
    'workspace',
    'system'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.execution_log_category AS ENUM (
    'llm',
    'tool',
    'agent_loop',
    'task_lifecycle',
    'runtime_lifecycle',
    'container',
    'api',
    'config',
    'auth'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.execution_log_level AS ENUM (
    'debug',
    'info',
    'warn',
    'error'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.execution_log_source AS ENUM (
    'runtime',
    'container_manager',
    'platform',
    'task_container'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.execution_log_status AS ENUM (
    'started',
    'completed',
    'failed',
    'skipped'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.task_priority AS ENUM (
    'critical',
    'high',
    'normal',
    'low'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.task_state AS ENUM (
    'pending',
    'ready',
    'claimed',
    'in_progress',
    'completed',
    'failed',
    'cancelled',
    'awaiting_approval',
    'output_pending_review',
    'escalated'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.worker_connection_mode AS ENUM (
    'websocket',
    'sse',
    'polling'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.worker_runtime_type AS ENUM (
    'internal',
    'openclaw',
    'claude_code',
    'codex',
    'acp',
    'custom',
    'external'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.worker_status AS ENUM (
    'online',
    'degraded',
    'offline',
    'busy',
    'draining',
    'disconnected'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.workflow_state AS ENUM (
    'pending',
    'active',
    'completed',
    'failed',
    'cancelled',
    'paused'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Functions

CREATE FUNCTION public.create_execution_logs_partition(partition_date date) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  partition_name text;
  start_date date;
  end_date date;
BEGIN
  start_date := partition_date;
  end_date := start_date + interval '1 day';
  partition_name := 'execution_logs_' || to_char(start_date, 'YYYY_MM_DD');

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF execution_logs
     FOR VALUES FROM (%L) TO (%L)',
    partition_name, start_date, end_date
  );
END;
$$;

CREATE FUNCTION public.drop_old_execution_log_partitions(retention_days integer DEFAULT 30) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  partition record;
  cutoff date;
  cutoff_name text;
BEGIN
  cutoff := current_date - (retention_days || ' days')::interval;
  cutoff_name := 'execution_logs_' || to_char(cutoff, 'YYYY_MM_DD');
  FOR partition IN
    SELECT inhrelid::regclass::text AS name
    FROM pg_inherits
    WHERE inhparent = 'execution_logs'::regclass
  LOOP
    IF partition.name < cutoff_name THEN
      EXECUTE format('DROP TABLE IF EXISTS %I', partition.name);
    END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION public.notify_event() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM pg_notify(
    'agirunner_events',
    json_build_object('id', NEW.id, 'type', NEW.type, 'entity_type', NEW.entity_type, 'entity_id', NEW.entity_id, 'tenant_id', NEW.tenant_id)::text
  );
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.notify_execution_log() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM pg_notify('agirunner_execution_logs', json_build_object(
    'id', NEW.id,
    'tenant_id', NEW.tenant_id,
    'trace_id', NEW.trace_id,
    'source', NEW.source,
    'category', NEW.category,
    'level', NEW.level,
    'operation', NEW.operation,
    'workspace_id', NEW.workspace_id,
    'workflow_id', NEW.workflow_id,
    'task_id', NEW.task_id,
    'created_at', NEW.created_at
  )::text);
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Tables

CREATE TABLE public.tenants (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.workspaces (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    repository_url text,
    memory jsonb DEFAULT '{}'::jsonb NOT NULL,
    memory_size_bytes integer DEFAULT 0 NOT NULL,
    memory_max_bytes integer DEFAULT 1048576 NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    current_spec_version integer DEFAULT 0 NOT NULL,
    git_webhook_provider text,
    git_webhook_secret text,
    CONSTRAINT workspaces_git_webhook_provider_check CHECK ((git_webhook_provider = ANY (ARRAY['github'::text, 'gitea'::text, 'gitlab'::text])))
);

CREATE TABLE public.workers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    status public.worker_status DEFAULT 'online'::public.worker_status NOT NULL,
    connection_mode public.worker_connection_mode DEFAULT 'websocket'::public.worker_connection_mode NOT NULL,
    runtime_type public.worker_runtime_type DEFAULT 'external'::public.worker_runtime_type NOT NULL,
    host_info jsonb DEFAULT '{}'::jsonb NOT NULL,
    heartbeat_interval_seconds integer DEFAULT 30 NOT NULL,
    last_heartbeat_at timestamp with time zone,
    connected_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    routing_tags text[] DEFAULT '{}'::text[] NOT NULL,
    current_task_id uuid,
    quality_score numeric(5,3) DEFAULT 1.000 NOT NULL,
    circuit_breaker_state text DEFAULT 'closed'::text NOT NULL,
    circuit_breaker_tripped_at timestamp with time zone
);

CREATE TABLE public.agents (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    worker_id uuid,
    name text NOT NULL,
    routing_tags text[] DEFAULT '{}'::text[] NOT NULL,
    status public.agent_status DEFAULT 'idle'::public.agent_status NOT NULL,
    current_task_id uuid,
    heartbeat_interval_seconds integer DEFAULT 30 NOT NULL,
    last_heartbeat_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    registered_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.workflows (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid,
    name text NOT NULL,
    state public.workflow_state DEFAULT 'pending'::public.workflow_state NOT NULL,
    parameters jsonb DEFAULT '{}'::jsonb NOT NULL,
    context jsonb DEFAULT '{}'::jsonb NOT NULL,
    context_size_bytes integer DEFAULT 0 NOT NULL,
    context_max_bytes integer DEFAULT 5242880 NOT NULL,
    git_branch text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    workspace_spec_version integer,
    resolved_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    config_layers jsonb DEFAULT '{}'::jsonb NOT NULL,
    instruction_config jsonb,
    legal_hold boolean DEFAULT false NOT NULL,
    archived_at timestamp with time zone
);

CREATE TABLE public.tasks (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    workflow_id uuid,
    workspace_id uuid,
    title text NOT NULL,
    role text,
    priority public.task_priority DEFAULT 'normal'::public.task_priority NOT NULL,
    state public.task_state DEFAULT 'pending'::public.task_state NOT NULL,
    state_changed_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_agent_id uuid,
    assigned_worker_id uuid,
    claimed_at timestamp with time zone,
    started_at timestamp with time zone,
    depends_on uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    requires_approval boolean DEFAULT false NOT NULL,
    requires_output_review boolean DEFAULT false NOT NULL,
    input jsonb DEFAULT '{}'::jsonb NOT NULL,
    output jsonb,
    error jsonb,
    role_config jsonb,
    environment jsonb,
    resource_bindings jsonb DEFAULT '[]'::jsonb NOT NULL,
    timeout_minutes integer DEFAULT 30 NOT NULL,
    token_budget integer,
    cost_cap_usd numeric(10,4),
    auto_retry boolean DEFAULT false NOT NULL,
    max_retries integer DEFAULT 0 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    completed_at timestamp with time zone,
    metrics jsonb,
    git_info jsonb,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    context jsonb DEFAULT '{}'::jsonb NOT NULL,
    rework_count integer DEFAULT 0 NOT NULL,
    legal_hold boolean DEFAULT false NOT NULL,
    archived_at timestamp with time zone
);

CREATE TABLE public.api_keys (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    key_hash text NOT NULL,
    key_prefix character varying(12) NOT NULL,
    scope public.api_key_scope NOT NULL,
    owner_type text NOT NULL,
    owner_id uuid,
    label text,
    last_used_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    is_revoked boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.events (
    id bigint NOT NULL,
    tenant_id uuid NOT NULL,
    type text NOT NULL,
    entity_type public.event_entity_type NOT NULL,
    entity_id uuid NOT NULL,
    actor_type text NOT NULL,
    actor_id text,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.events_id_seq OWNED BY public.events.id;

ALTER TABLE ONLY public.events ALTER COLUMN id SET DEFAULT nextval('public.events_id_seq'::regclass);

CREATE TABLE public.webhooks (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    url text NOT NULL,
    secret text NOT NULL,
    event_types text[] DEFAULT '{}'::text[] NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.webhook_deliveries (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    webhook_id uuid NOT NULL,
    event_id bigint NOT NULL,
    event_type text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    last_status_code integer,
    last_error text,
    delivered_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.orchestrator_grants (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    workflow_id uuid NOT NULL,
    permissions text[] NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone
);

CREATE TABLE public.acp_sessions (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    worker_id uuid,
    workflow_id uuid,
    transport text NOT NULL,
    mode text NOT NULL,
    status public.acp_session_status DEFAULT 'initializing'::public.acp_session_status NOT NULL,
    workspace_path text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_heartbeat_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.refresh_token_sessions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    api_key_id uuid NOT NULL,
    token_id uuid NOT NULL,
    csrf_token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    replaced_by_token_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.workflow_artifacts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    workflow_id uuid,
    workspace_id uuid,
    task_id uuid NOT NULL,
    logical_path text NOT NULL,
    storage_backend text NOT NULL,
    storage_key text NOT NULL,
    content_type text NOT NULL,
    size_bytes bigint NOT NULL,
    checksum_sha256 text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    retention_policy jsonb DEFAULT '{}'::jsonb NOT NULL,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.integration_adapters (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    workflow_id uuid,
    kind text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    subscriptions text[] DEFAULT ARRAY[]::text[] NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.integration_adapter_deliveries (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    adapter_id uuid NOT NULL,
    event_id bigint NOT NULL,
    status text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_status_code integer,
    last_error text,
    delivered_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.integration_actions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    adapter_id uuid NOT NULL,
    task_id uuid NOT NULL,
    action_type text NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.integration_resource_links (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    adapter_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    external_id text NOT NULL,
    external_url text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.workspace_spec_versions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    version integer NOT NULL,
    spec jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by_type text NOT NULL,
    created_by_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.workflow_documents (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    workflow_id uuid NOT NULL,
    workspace_id uuid,
    task_id uuid,
    logical_name text NOT NULL,
    source text NOT NULL,
    location text NOT NULL,
    artifact_id uuid,
    content_type text,
    title text,
    description text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.webhook_work_item_triggers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    source text NOT NULL,
    workspace_id uuid,
    workflow_id uuid NOT NULL,
    event_header text,
    event_types text[] DEFAULT ARRAY[]::text[] NOT NULL,
    signature_header text NOT NULL,
    signature_mode text NOT NULL,
    secret text NOT NULL,
    field_mappings jsonb DEFAULT '{}'::jsonb NOT NULL,
    defaults jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.webhook_work_item_trigger_invocations (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    trigger_id uuid NOT NULL,
    event_type text,
    dedupe_key text,
    work_item_id uuid,
    status text NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.tool_tags (
    id text NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    category text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.worker_signals (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    worker_id uuid NOT NULL,
    signal_type text NOT NULL,
    task_id uuid,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    delivered boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.audit_logs (
    id bigint NOT NULL,
    tenant_id uuid NOT NULL,
    action text NOT NULL,
    resource_type text NOT NULL,
    resource_id text,
    actor_type text NOT NULL,
    actor_id text,
    outcome text NOT NULL,
    reason text,
    request_id text,
    source_ip text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.audit_logs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.audit_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.circuit_breaker_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    worker_id uuid NOT NULL,
    trigger_type text NOT NULL,
    reason text NOT NULL,
    previous_state text NOT NULL,
    new_state text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.container_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    repository text NOT NULL,
    tag text,
    digest text,
    size_bytes bigint,
    created_at timestamp with time zone,
    last_seen timestamp with time zone DEFAULT now()
);

CREATE TABLE public.worker_desired_state (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    worker_name text NOT NULL,
    role text NOT NULL,
    runtime_image text NOT NULL,
    cpu_limit text DEFAULT '2'::text,
    memory_limit text DEFAULT '2g'::text,
    network_policy text DEFAULT 'restricted'::text,
    environment jsonb DEFAULT '{}'::jsonb,
    llm_provider text,
    llm_model text,
    llm_api_key_secret_ref text,
    replicas integer DEFAULT 1,
    enabled boolean DEFAULT true,
    restart_requested boolean DEFAULT false,
    draining boolean DEFAULT false,
    version integer DEFAULT 1,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    updated_by uuid
);

CREATE TABLE public.worker_actual_state (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    desired_state_id uuid NOT NULL,
    container_id text,
    container_status text,
    cpu_usage_percent real,
    memory_usage_bytes bigint,
    network_rx_bytes bigint,
    network_tx_bytes bigint,
    started_at timestamp with time zone,
    last_updated timestamp with time zone DEFAULT now()
);

CREATE TABLE public.platform_instructions (
    tenant_id uuid NOT NULL,
    version integer DEFAULT 0 NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    format text DEFAULT 'text'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_type text,
    updated_by_id text
);

CREATE TABLE public.platform_instruction_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    version integer NOT NULL,
    content text NOT NULL,
    format text DEFAULT 'text'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_type text,
    created_by_id text
);

CREATE TABLE public.llm_providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    base_url text NOT NULL,
    api_key_secret_ref text,
    is_enabled boolean DEFAULT true,
    rate_limit_rpm integer,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    auth_mode text DEFAULT 'api_key'::text NOT NULL,
    oauth_config jsonb,
    oauth_credentials jsonb,
    CONSTRAINT llm_providers_auth_mode_check CHECK ((auth_mode = ANY (ARRAY['api_key'::text, 'oauth'::text])))
);

CREATE TABLE public.llm_models (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    provider_id uuid NOT NULL,
    model_id text NOT NULL,
    context_window integer,
    max_output_tokens integer,
    supports_tool_use boolean DEFAULT true,
    supports_vision boolean DEFAULT false,
    input_cost_per_million_usd numeric,
    output_cost_per_million_usd numeric,
    is_enabled boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    endpoint_type text,
    reasoning_config jsonb
);

CREATE TABLE public.runtime_defaults (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    config_key text NOT NULL,
    config_value text NOT NULL,
    config_type text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.role_definitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    system_prompt text,
    allowed_tools text[] DEFAULT '{}'::text[],
    model_preference text,
    fallback_model text,
    verification_strategy text,
    is_built_in boolean DEFAULT false,
    escalation_target text DEFAULT NULL,
    max_escalation_depth integer NOT NULL DEFAULT 5,
    is_active boolean DEFAULT true,
    version integer DEFAULT 1,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.role_model_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    role_name text NOT NULL,
    primary_model_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    reasoning_config jsonb
);

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    email text NOT NULL,
    password_hash text,
    display_name text,
    role text DEFAULT 'viewer'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.user_identities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    provider text NOT NULL,
    provider_user_id text NOT NULL,
    provider_email text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.metering_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    task_id uuid NOT NULL,
    workflow_id uuid,
    worker_id uuid,
    agent_id uuid,
    tokens_input bigint DEFAULT 0 NOT NULL,
    tokens_output bigint DEFAULT 0 NOT NULL,
    cost_usd numeric(12,6) DEFAULT 0 NOT NULL,
    wall_time_ms bigint DEFAULT 0 NOT NULL,
    cpu_ms bigint,
    memory_peak_bytes bigint,
    network_bytes bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.fleet_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    event_type text NOT NULL,
    level text DEFAULT 'info'::text NOT NULL,
    runtime_id uuid,
    playbook_id uuid,
    task_id uuid,
    workflow_id uuid,
    container_id text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fleet_events_level_check CHECK ((level = ANY (ARRAY['debug'::text, 'info'::text, 'warn'::text, 'error'::text])))
);

CREATE TABLE public.runtime_heartbeats (
    runtime_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    playbook_id uuid NOT NULL,
    state text DEFAULT 'idle'::text NOT NULL,
    task_id uuid,
    uptime_seconds integer DEFAULT 0 NOT NULL,
    last_claim_at timestamp with time zone,
    image text NOT NULL,
    drain_requested boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_heartbeat_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT runtime_heartbeats_state_check CHECK ((state = ANY (ARRAY['idle'::text, 'executing'::text, 'draining'::text])))
);

CREATE TABLE public.oauth_states (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    profile_id text NOT NULL,
    state text NOT NULL,
    code_verifier text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:10:00'::interval) NOT NULL
);

CREATE TABLE public.execution_logs (
    id bigint NOT NULL,
    tenant_id uuid NOT NULL,
    trace_id uuid NOT NULL,
    span_id uuid NOT NULL,
    parent_span_id uuid,
    source public.execution_log_source NOT NULL,
    category public.execution_log_category NOT NULL,
    level public.execution_log_level DEFAULT 'info'::public.execution_log_level NOT NULL,
    operation text NOT NULL,
    status public.execution_log_status NOT NULL,
    duration_ms integer,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    error jsonb,
    workspace_id uuid,
    workflow_id uuid,
    task_id uuid,
    actor_type text,
    actor_id text,
    actor_name text,
    resource_type text,
    resource_id uuid,
    resource_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    workflow_name text,
    workspace_name text,
    role text,
    task_title text
)
PARTITION BY RANGE (created_at);

ALTER TABLE public.execution_logs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.execution_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

-- Primary keys

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.workers
    ADD CONSTRAINT workers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.workflows
    ADD CONSTRAINT workflows_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.webhooks
    ADD CONSTRAINT webhooks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.orchestrator_grants
    ADD CONSTRAINT orchestrator_grants_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.acp_sessions
    ADD CONSTRAINT acp_sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.refresh_token_sessions
    ADD CONSTRAINT refresh_token_sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.workflow_artifacts
    ADD CONSTRAINT workflow_artifacts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.integration_adapters
    ADD CONSTRAINT integration_adapters_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.integration_adapter_deliveries
    ADD CONSTRAINT integration_adapter_deliveries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.integration_actions
    ADD CONSTRAINT integration_actions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.integration_resource_links
    ADD CONSTRAINT integration_resource_links_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.workspace_spec_versions
    ADD CONSTRAINT workspace_spec_versions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.workflow_documents
    ADD CONSTRAINT workflow_documents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.webhook_work_item_triggers
    ADD CONSTRAINT webhook_work_item_triggers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.webhook_work_item_trigger_invocations
    ADD CONSTRAINT webhook_work_item_trigger_invocations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.circuit_breaker_events
    ADD CONSTRAINT circuit_breaker_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.container_images
    ADD CONSTRAINT container_images_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.worker_desired_state
    ADD CONSTRAINT worker_desired_state_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.worker_actual_state
    ADD CONSTRAINT worker_actual_state_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.platform_instructions
    ADD CONSTRAINT platform_instructions_pkey PRIMARY KEY (tenant_id);

ALTER TABLE ONLY public.platform_instruction_versions
    ADD CONSTRAINT platform_instruction_versions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.llm_providers
    ADD CONSTRAINT llm_providers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.llm_models
    ADD CONSTRAINT llm_models_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.runtime_defaults
    ADD CONSTRAINT runtime_defaults_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.role_definitions
    ADD CONSTRAINT role_definitions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.role_model_assignments
    ADD CONSTRAINT role_model_assignments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_identities
    ADD CONSTRAINT user_identities_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.metering_events
    ADD CONSTRAINT metering_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.fleet_events
    ADD CONSTRAINT fleet_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.runtime_heartbeats
    ADD CONSTRAINT runtime_heartbeats_pkey PRIMARY KEY (runtime_id);

ALTER TABLE ONLY public.oauth_states
    ADD CONSTRAINT oauth_states_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.worker_signals
    ADD CONSTRAINT worker_signals_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.tool_tags
    ADD CONSTRAINT tool_tags_pkey PRIMARY KEY (tenant_id, id);

ALTER TABLE ONLY public.execution_logs
    ADD CONSTRAINT execution_logs_pkey PRIMARY KEY (id, created_at);

-- Unique constraints

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_slug_key UNIQUE (slug);

ALTER TABLE ONLY public.container_images
    ADD CONSTRAINT container_images_repository_tag_key UNIQUE (repository, tag);

ALTER TABLE ONLY public.integration_actions
    ADD CONSTRAINT integration_actions_token_hash_key UNIQUE (token_hash);

ALTER TABLE ONLY public.llm_models
    ADD CONSTRAINT llm_models_tenant_provider_model_key UNIQUE (tenant_id, provider_id, model_id);

ALTER TABLE ONLY public.llm_providers
    ADD CONSTRAINT llm_providers_tenant_id_name_key UNIQUE (tenant_id, name);

ALTER TABLE ONLY public.oauth_states
    ADD CONSTRAINT oauth_states_state_key UNIQUE (state);

ALTER TABLE ONLY public.refresh_token_sessions
    ADD CONSTRAINT refresh_token_sessions_token_id_key UNIQUE (token_id);

ALTER TABLE ONLY public.role_definitions
    ADD CONSTRAINT role_definitions_tenant_id_name_key UNIQUE (tenant_id, name);

ALTER TABLE ONLY public.role_model_assignments
    ADD CONSTRAINT role_model_assignments_tenant_id_role_name_key UNIQUE (tenant_id, role_name);

ALTER TABLE ONLY public.runtime_defaults
    ADD CONSTRAINT runtime_defaults_tenant_id_config_key_key UNIQUE (tenant_id, config_key);

ALTER TABLE ONLY public.worker_desired_state
    ADD CONSTRAINT worker_desired_state_tenant_id_worker_name_key UNIQUE (tenant_id, worker_name);

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT uq_workspace_tenant_slug UNIQUE (tenant_id, slug);

ALTER TABLE ONLY public.user_identities
    ADD CONSTRAINT user_identities_provider_provider_user_id_key UNIQUE (provider, provider_user_id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_tenant_id_email_key UNIQUE (tenant_id, email);

-- Indexes: execution_logs parent-level (partition indexes are auto-created)
-- Keep wide text/json fields in heap rows only; do not INCLUDE them in covering indexes.

CREATE INDEX idx_exlogs_llm_model ON ONLY public.execution_logs USING btree (((payload ->> 'model'::text)), created_at DESC) WHERE (category = 'llm'::public.execution_log_category);
CREATE INDEX idx_exlogs_llm_provider ON ONLY public.execution_logs USING btree (((payload ->> 'provider'::text)), created_at DESC) WHERE (category = 'llm'::public.execution_log_category);
CREATE INDEX idx_exlogs_tool_name ON ONLY public.execution_logs USING btree (((payload ->> 'tool_name'::text)), created_at DESC) WHERE (category = 'tool'::public.execution_log_category);
CREATE INDEX idx_exlogs_config_type ON ONLY public.execution_logs USING btree (((payload ->> 'config_type'::text)), created_at DESC) WHERE (category = 'config'::public.execution_log_category);
CREATE INDEX idx_exlogs_span ON ONLY public.execution_logs USING btree (parent_span_id, created_at) INCLUDE (span_id, source, category, status, duration_ms) WHERE (parent_span_id IS NOT NULL);
CREATE INDEX idx_exlogs_workspace ON ONLY public.execution_logs USING btree (workspace_id, created_at DESC) INCLUDE (source, category, level, status, workflow_id, task_id) WHERE (workspace_id IS NOT NULL);
CREATE INDEX idx_exlogs_task_category ON ONLY public.execution_logs USING btree (task_id, category, created_at) INCLUDE (source, level, status, duration_ms) WHERE (task_id IS NOT NULL);
CREATE INDEX idx_exlogs_task ON ONLY public.execution_logs USING btree (task_id, created_at) INCLUDE (source, category, level, status, duration_ms) WHERE (task_id IS NOT NULL);
CREATE INDEX idx_exlogs_task_level ON ONLY public.execution_logs USING btree (task_id, level, created_at) INCLUDE (source, category, status, duration_ms) WHERE (task_id IS NOT NULL);
CREATE INDEX idx_exlogs_actor ON ONLY public.execution_logs USING btree (tenant_id, actor_id, created_at DESC) INCLUDE (source, category, status, workflow_id, task_id) WHERE (actor_id IS NOT NULL);
CREATE INDEX idx_exlogs_actors_distinct ON ONLY public.execution_logs USING btree (tenant_id, actor_type, actor_id, actor_name, created_at DESC) WHERE (actor_id IS NOT NULL);
CREATE INDEX idx_exlogs_stats ON ONLY public.execution_logs USING btree (tenant_id, category, created_at DESC) INCLUDE (duration_ms) WHERE (status = ANY (ARRAY['completed'::public.execution_log_status, 'failed'::public.execution_log_status]));
CREATE INDEX idx_exlogs_category ON ONLY public.execution_logs USING btree (tenant_id, category, created_at DESC) INCLUDE (source, level, status, duration_ms, workflow_id, task_id);
CREATE INDEX idx_exlogs_category_op ON ONLY public.execution_logs USING btree (tenant_id, category, operation, created_at DESC) INCLUDE (source, level, status, duration_ms, workflow_id, task_id);
CREATE INDEX idx_exlogs_errors ON ONLY public.execution_logs USING btree (tenant_id, created_at DESC) INCLUDE (source, category, workflow_id, task_id) WHERE ((level = 'error'::public.execution_log_level) OR (status = 'failed'::public.execution_log_status));
CREATE INDEX idx_exlogs_tenant_time ON ONLY public.execution_logs USING btree (tenant_id, created_at DESC) INCLUDE (source, category, level, status, duration_ms, workflow_id, task_id);
CREATE INDEX idx_exlogs_level ON ONLY public.execution_logs USING btree (tenant_id, level, created_at DESC) INCLUDE (source, category, status, duration_ms, workflow_id, task_id);
CREATE INDEX idx_exlogs_ops_distinct ON ONLY public.execution_logs USING btree (tenant_id, operation, created_at DESC);
CREATE INDEX idx_exlogs_workspace_name_time ON ONLY public.execution_logs USING btree (tenant_id, workspace_name, created_at DESC) WHERE (workspace_name IS NOT NULL);
CREATE INDEX idx_execution_logs_workspace_name ON ONLY public.execution_logs USING btree (tenant_id, workspace_name) WHERE (workspace_name IS NOT NULL);
CREATE INDEX idx_exlogs_resource ON ONLY public.execution_logs USING btree (tenant_id, resource_type, resource_id, created_at DESC) INCLUDE (category, status) WHERE (resource_id IS NOT NULL);
CREATE INDEX idx_execution_logs_role ON ONLY public.execution_logs USING btree (tenant_id, role) WHERE (role IS NOT NULL);
CREATE INDEX idx_exlogs_source ON ONLY public.execution_logs USING btree (tenant_id, source, created_at DESC) INCLUDE (category, level, status, duration_ms, workflow_id, task_id);
CREATE INDEX idx_exlogs_status_full ON ONLY public.execution_logs USING btree (tenant_id, status, created_at DESC) INCLUDE (source, category, level, workflow_id, task_id);
CREATE INDEX idx_exlogs_status ON ONLY public.execution_logs USING btree (tenant_id, status, created_at DESC) INCLUDE (source, category, level, workflow_id, task_id) WHERE (status = ANY (ARRAY['failed'::public.execution_log_status, 'started'::public.execution_log_status]));
CREATE INDEX idx_exlogs_workflow_name_time ON ONLY public.execution_logs USING btree (tenant_id, workflow_name, created_at DESC) WHERE (workflow_name IS NOT NULL);
CREATE INDEX idx_execution_logs_workflow_name ON ONLY public.execution_logs USING btree (tenant_id, workflow_name) WHERE (workflow_name IS NOT NULL);
CREATE INDEX idx_exlogs_search ON ONLY public.execution_logs USING gin (to_tsvector('english'::regconfig, ((operation || ' '::text) || COALESCE((payload)::text, ''::text))));
CREATE INDEX idx_exlogs_trace ON ONLY public.execution_logs USING btree (trace_id, created_at) INCLUDE (span_id, parent_span_id, source, category, status, duration_ms);
CREATE INDEX idx_exlogs_wf_category ON ONLY public.execution_logs USING btree (workflow_id, category, created_at) INCLUDE (source, level, status, duration_ms, task_id) WHERE (workflow_id IS NOT NULL);
CREATE INDEX idx_exlogs_workflow ON ONLY public.execution_logs USING btree (workflow_id, created_at) INCLUDE (source, category, level, status, duration_ms, task_id) WHERE (workflow_id IS NOT NULL);
CREATE INDEX idx_exlogs_wf_level ON ONLY public.execution_logs USING btree (workflow_id, level, created_at) INCLUDE (source, category, status, duration_ms, task_id) WHERE (workflow_id IS NOT NULL);

-- Indexes: other tables

CREATE INDEX idx_acp_sessions_tenant_agent ON public.acp_sessions USING btree (tenant_id, agent_id, created_at DESC);
CREATE INDEX idx_acp_sessions_tenant_status ON public.acp_sessions USING btree (tenant_id, status, updated_at DESC);
CREATE INDEX idx_acp_sessions_tenant_workflow ON public.acp_sessions USING btree (tenant_id, workflow_id, created_at DESC);
CREATE INDEX idx_agents_routing_tags ON public.agents USING gin (routing_tags);
CREATE INDEX idx_agents_current_task ON public.agents USING btree (current_task_id) WHERE (current_task_id IS NOT NULL);
CREATE INDEX idx_agents_status ON public.agents USING btree (tenant_id, status);
CREATE INDEX idx_agents_tenant ON public.agents USING btree (tenant_id);
CREATE INDEX idx_agents_worker ON public.agents USING btree (worker_id);
CREATE INDEX idx_api_keys_owner ON public.api_keys USING btree (owner_type, owner_id);
CREATE UNIQUE INDEX idx_api_keys_prefix ON public.api_keys USING btree (key_prefix);
CREATE INDEX idx_api_keys_tenant ON public.api_keys USING btree (tenant_id);
CREATE INDEX idx_audit_logs_action ON public.audit_logs USING btree (tenant_id, action, created_at DESC);
CREATE INDEX idx_audit_logs_actor ON public.audit_logs USING btree (tenant_id, actor_id, created_at DESC);
CREATE INDEX idx_audit_logs_resource ON public.audit_logs USING btree (tenant_id, resource_id, created_at DESC);
CREATE INDEX idx_audit_logs_tenant_time ON public.audit_logs USING btree (tenant_id, created_at DESC);
CREATE INDEX idx_circuit_breaker_events_worker ON public.circuit_breaker_events USING btree (worker_id);
CREATE INDEX idx_events_entity ON public.events USING btree (entity_type, entity_id, created_at DESC);
CREATE INDEX idx_events_tenant_time ON public.events USING btree (tenant_id, created_at DESC);
CREATE INDEX idx_events_type ON public.events USING btree (tenant_id, type, created_at DESC);
CREATE INDEX idx_fleet_events_runtime ON public.fleet_events USING btree (runtime_id, created_at DESC);
CREATE INDEX idx_fleet_events_playbook ON public.fleet_events USING btree (playbook_id, created_at DESC);
CREATE INDEX idx_fleet_events_tenant_created ON public.fleet_events USING btree (tenant_id, created_at DESC);
CREATE INDEX idx_fleet_events_type ON public.fleet_events USING btree (event_type);
CREATE INDEX idx_integration_actions_lookup ON public.integration_actions USING btree (token_hash, expires_at);
CREATE INDEX idx_integration_actions_task ON public.integration_actions USING btree (tenant_id, task_id, action_type, created_at DESC);
CREATE INDEX idx_integration_adapter_deliveries_pending ON public.integration_adapter_deliveries USING btree (tenant_id, status, created_at DESC);
CREATE INDEX idx_integration_adapters_tenant ON public.integration_adapters USING btree (tenant_id, is_active);
CREATE INDEX idx_integration_adapters_workflow ON public.integration_adapters USING btree (tenant_id, workflow_id);
CREATE INDEX idx_integration_resource_links_external ON public.integration_resource_links USING btree (tenant_id, adapter_id, external_id);
CREATE UNIQUE INDEX idx_integration_resource_links_unique ON public.integration_resource_links USING btree (tenant_id, adapter_id, entity_type, entity_id);
CREATE INDEX idx_llm_models_provider ON public.llm_models USING btree (provider_id);
CREATE INDEX idx_llm_models_tenant ON public.llm_models USING btree (tenant_id);
CREATE INDEX idx_llm_providers_tenant ON public.llm_providers USING btree (tenant_id);
CREATE INDEX idx_metering_events_created ON public.metering_events USING btree (created_at);
CREATE INDEX idx_metering_events_task ON public.metering_events USING btree (task_id);
CREATE INDEX idx_metering_events_tenant ON public.metering_events USING btree (tenant_id);
CREATE INDEX idx_metering_events_workflow ON public.metering_events USING btree (workflow_id);
CREATE INDEX idx_oauth_states_state ON public.oauth_states USING btree (state);
CREATE UNIQUE INDEX idx_orchestrator_grants_agent_workflow ON public.orchestrator_grants USING btree (agent_id, workflow_id) WHERE (revoked_at IS NULL);
CREATE INDEX idx_orchestrator_grants_tenant ON public.orchestrator_grants USING btree (tenant_id);
CREATE INDEX idx_platform_instruction_versions_tenant ON public.platform_instruction_versions USING btree (tenant_id, version DESC);
CREATE INDEX idx_workspace_spec_versions_tenant_workspace ON public.workspace_spec_versions USING btree (tenant_id, workspace_id, version DESC);
CREATE INDEX idx_workspaces_tenant ON public.workspaces USING btree (tenant_id);
CREATE INDEX idx_refresh_token_sessions_tenant_api_key ON public.refresh_token_sessions USING btree (tenant_id, api_key_id);
CREATE INDEX idx_refresh_token_sessions_tenant_token ON public.refresh_token_sessions USING btree (tenant_id, token_id);
CREATE INDEX idx_role_definitions_active ON public.role_definitions USING btree (tenant_id, is_active);
CREATE INDEX idx_role_definitions_tenant ON public.role_definitions USING btree (tenant_id);
CREATE INDEX idx_role_model_assignments_tenant ON public.role_model_assignments USING btree (tenant_id);
CREATE INDEX idx_runtime_defaults_tenant ON public.runtime_defaults USING btree (tenant_id);
CREATE INDEX idx_runtime_heartbeats_state ON public.runtime_heartbeats USING btree (state);
CREATE INDEX idx_runtime_heartbeats_playbook ON public.runtime_heartbeats USING btree (playbook_id);
CREATE INDEX idx_runtime_heartbeats_tenant ON public.runtime_heartbeats USING btree (tenant_id);
CREATE INDEX idx_tasks_agent ON public.tasks USING btree (assigned_agent_id) WHERE (assigned_agent_id IS NOT NULL);
CREATE INDEX idx_tasks_claimable ON public.tasks USING btree (tenant_id, priority DESC, created_at) WHERE (state = 'ready'::public.task_state);
CREATE INDEX idx_tasks_depends_on ON public.tasks USING gin (depends_on);
CREATE INDEX idx_tasks_workspace ON public.tasks USING btree (workspace_id);
CREATE INDEX idx_tasks_running_timeout ON public.tasks USING btree (started_at) WHERE (state = 'in_progress'::public.task_state);
CREATE INDEX idx_tasks_state ON public.tasks USING btree (tenant_id, state);
CREATE INDEX idx_tasks_tenant ON public.tasks USING btree (tenant_id);
CREATE INDEX idx_tasks_workflow ON public.tasks USING btree (workflow_id);
CREATE INDEX idx_tool_tags_tenant_created ON public.tool_tags USING btree (tenant_id, created_at DESC);
CREATE INDEX idx_user_identities_user ON public.user_identities USING btree (user_id);
CREATE INDEX idx_users_email ON public.users USING btree (email);
CREATE INDEX idx_users_tenant ON public.users USING btree (tenant_id);
CREATE INDEX idx_webhook_deliveries_pending ON public.webhook_deliveries USING btree (tenant_id, status, created_at DESC);
CREATE INDEX idx_webhook_work_item_trigger_invocations_tenant_trigger ON public.webhook_work_item_trigger_invocations USING btree (tenant_id, trigger_id, created_at DESC);
CREATE INDEX idx_webhook_work_item_triggers_tenant ON public.webhook_work_item_triggers USING btree (tenant_id, is_active, created_at DESC);
CREATE INDEX idx_webhooks_tenant ON public.webhooks USING btree (tenant_id, is_active);
CREATE INDEX idx_worker_actual_state_desired ON public.worker_actual_state USING btree (desired_state_id);
CREATE INDEX idx_worker_desired_state_enabled ON public.worker_desired_state USING btree (tenant_id, enabled);
CREATE INDEX idx_worker_desired_state_tenant ON public.worker_desired_state USING btree (tenant_id);
CREATE INDEX idx_worker_signals_pending ON public.worker_signals USING btree (worker_id, delivered) WHERE (delivered = false);
CREATE INDEX idx_workers_routing_tags ON public.workers USING gin (routing_tags);
CREATE INDEX idx_workers_status ON public.workers USING btree (tenant_id, status);
CREATE INDEX idx_workers_tenant ON public.workers USING btree (tenant_id);
CREATE INDEX idx_workflow_artifacts_tenant_path ON public.workflow_artifacts USING btree (tenant_id, logical_path);
CREATE INDEX idx_workflow_artifacts_tenant_task ON public.workflow_artifacts USING btree (tenant_id, task_id);
CREATE INDEX idx_workflow_artifacts_tenant_workflow ON public.workflow_artifacts USING btree (tenant_id, workflow_id);
CREATE INDEX idx_workflow_documents_tenant_task ON public.workflow_documents USING btree (tenant_id, task_id);
CREATE INDEX idx_workflow_documents_tenant_workflow ON public.workflow_documents USING btree (tenant_id, workflow_id, created_at);
CREATE INDEX idx_workflows_workspace ON public.workflows USING btree (workspace_id);
CREATE INDEX idx_workflows_state ON public.workflows USING btree (tenant_id, state);
CREATE INDEX idx_workflows_tenant ON public.workflows USING btree (tenant_id);
CREATE UNIQUE INDEX uq_platform_instruction_versions_tenant_version ON public.platform_instruction_versions USING btree (tenant_id, version);
CREATE UNIQUE INDEX uq_workspace_spec_versions_workspace_version ON public.workspace_spec_versions USING btree (workspace_id, version);
CREATE UNIQUE INDEX uq_webhook_work_item_trigger_invocations_dedupe ON public.webhook_work_item_trigger_invocations USING btree (trigger_id, dedupe_key) WHERE (dedupe_key IS NOT NULL);
CREATE UNIQUE INDEX uq_workflow_documents_workflow_logical_name ON public.workflow_documents USING btree (tenant_id, workflow_id, logical_name);

-- Triggers

CREATE TRIGGER trg_agents_updated_at BEFORE UPDATE ON public.agents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER trg_events_notify AFTER INSERT ON public.events FOR EACH ROW EXECUTE FUNCTION public.notify_event();
CREATE TRIGGER trg_execution_logs_notify AFTER INSERT ON public.execution_logs FOR EACH ROW EXECUTE FUNCTION public.notify_execution_log();
CREATE TRIGGER trg_integration_actions_updated_at BEFORE UPDATE ON public.integration_actions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER trg_integration_adapter_deliveries_updated_at BEFORE UPDATE ON public.integration_adapter_deliveries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER trg_integration_adapters_updated_at BEFORE UPDATE ON public.integration_adapters FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER trg_workspaces_updated_at BEFORE UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER trg_tenants_updated_at BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER trg_webhook_deliveries_updated_at BEFORE UPDATE ON public.webhook_deliveries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER trg_workers_updated_at BEFORE UPDATE ON public.workers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER trg_workflows_updated_at BEFORE UPDATE ON public.workflows FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Foreign keys

ALTER TABLE ONLY public.acp_sessions
    ADD CONSTRAINT acp_sessions_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.acp_sessions
    ADD CONSTRAINT acp_sessions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.acp_sessions
    ADD CONSTRAINT acp_sessions_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES public.workers(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.acp_sessions
    ADD CONSTRAINT acp_sessions_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES public.workers(id);

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.circuit_breaker_events
    ADD CONSTRAINT circuit_breaker_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.fleet_events
    ADD CONSTRAINT fleet_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.integration_actions
    ADD CONSTRAINT integration_actions_adapter_id_fkey FOREIGN KEY (adapter_id) REFERENCES public.integration_adapters(id);

ALTER TABLE ONLY public.integration_actions
    ADD CONSTRAINT integration_actions_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id);

ALTER TABLE ONLY public.integration_actions
    ADD CONSTRAINT integration_actions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.integration_adapter_deliveries
    ADD CONSTRAINT integration_adapter_deliveries_adapter_id_fkey FOREIGN KEY (adapter_id) REFERENCES public.integration_adapters(id);

ALTER TABLE ONLY public.integration_adapter_deliveries
    ADD CONSTRAINT integration_adapter_deliveries_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id);

ALTER TABLE ONLY public.integration_adapter_deliveries
    ADD CONSTRAINT integration_adapter_deliveries_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.integration_adapters
    ADD CONSTRAINT integration_adapters_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.integration_adapters
    ADD CONSTRAINT integration_adapters_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id);

ALTER TABLE ONLY public.integration_resource_links
    ADD CONSTRAINT integration_resource_links_adapter_id_fkey FOREIGN KEY (adapter_id) REFERENCES public.integration_adapters(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.integration_resource_links
    ADD CONSTRAINT integration_resource_links_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.llm_models
    ADD CONSTRAINT llm_models_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.llm_providers(id);

ALTER TABLE ONLY public.llm_models
    ADD CONSTRAINT llm_models_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.llm_providers
    ADD CONSTRAINT llm_providers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.metering_events
    ADD CONSTRAINT metering_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.oauth_states
    ADD CONSTRAINT oauth_states_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.orchestrator_grants
    ADD CONSTRAINT orchestrator_grants_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id);

ALTER TABLE ONLY public.orchestrator_grants
    ADD CONSTRAINT orchestrator_grants_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.orchestrator_grants
    ADD CONSTRAINT orchestrator_grants_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id);

ALTER TABLE ONLY public.platform_instruction_versions
    ADD CONSTRAINT platform_instruction_versions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.platform_instructions
    ADD CONSTRAINT platform_instructions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.workspace_spec_versions
    ADD CONSTRAINT workspace_spec_versions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);

ALTER TABLE ONLY public.workspace_spec_versions
    ADD CONSTRAINT workspace_spec_versions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.refresh_token_sessions
    ADD CONSTRAINT refresh_token_sessions_api_key_id_fkey FOREIGN KEY (api_key_id) REFERENCES public.api_keys(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.refresh_token_sessions
    ADD CONSTRAINT refresh_token_sessions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.role_definitions
    ADD CONSTRAINT role_definitions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.role_model_assignments
    ADD CONSTRAINT role_model_assignments_primary_model_id_fkey FOREIGN KEY (primary_model_id) REFERENCES public.llm_models(id);

ALTER TABLE ONLY public.role_model_assignments
    ADD CONSTRAINT role_model_assignments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.runtime_defaults
    ADD CONSTRAINT runtime_defaults_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.runtime_heartbeats
    ADD CONSTRAINT runtime_heartbeats_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_assigned_agent_id_fkey FOREIGN KEY (assigned_agent_id) REFERENCES public.agents(id);

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_assigned_worker_id_fkey FOREIGN KEY (assigned_worker_id) REFERENCES public.workers(id);

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id);

ALTER TABLE ONLY public.tool_tags
    ADD CONSTRAINT tool_tags_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.user_identities
    ADD CONSTRAINT user_identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id);

ALTER TABLE ONLY public.webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_webhook_id_fkey FOREIGN KEY (webhook_id) REFERENCES public.webhooks(id);

ALTER TABLE ONLY public.webhook_work_item_trigger_invocations
    ADD CONSTRAINT webhook_work_item_trigger_invocations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.webhook_work_item_trigger_invocations
    ADD CONSTRAINT webhook_work_item_trigger_invocations_trigger_id_fkey FOREIGN KEY (trigger_id) REFERENCES public.webhook_work_item_triggers(id);

ALTER TABLE ONLY public.webhook_work_item_triggers
    ADD CONSTRAINT webhook_work_item_triggers_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);

ALTER TABLE ONLY public.webhook_work_item_triggers
    ADD CONSTRAINT webhook_work_item_triggers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.webhook_work_item_triggers
    ADD CONSTRAINT webhook_work_item_triggers_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id);

ALTER TABLE ONLY public.webhooks
    ADD CONSTRAINT webhooks_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.worker_actual_state
    ADD CONSTRAINT worker_actual_state_desired_state_id_fkey FOREIGN KEY (desired_state_id) REFERENCES public.worker_desired_state(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.worker_desired_state
    ADD CONSTRAINT worker_desired_state_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.worker_signals
    ADD CONSTRAINT worker_signals_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id);

ALTER TABLE ONLY public.worker_signals
    ADD CONSTRAINT worker_signals_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.worker_signals
    ADD CONSTRAINT worker_signals_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES public.workers(id);

ALTER TABLE ONLY public.workers
    ADD CONSTRAINT workers_current_task_id_fkey FOREIGN KEY (current_task_id) REFERENCES public.tasks(id);

ALTER TABLE ONLY public.workers
    ADD CONSTRAINT workers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.workflow_artifacts
    ADD CONSTRAINT workflow_artifacts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);

ALTER TABLE ONLY public.workflow_artifacts
    ADD CONSTRAINT workflow_artifacts_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.workflow_artifacts
    ADD CONSTRAINT workflow_artifacts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.workflow_artifacts
    ADD CONSTRAINT workflow_artifacts_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id);

ALTER TABLE ONLY public.workflow_documents
    ADD CONSTRAINT workflow_documents_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.workflow_artifacts(id);

ALTER TABLE ONLY public.workflow_documents
    ADD CONSTRAINT workflow_documents_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);

ALTER TABLE ONLY public.workflow_documents
    ADD CONSTRAINT workflow_documents_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id);

ALTER TABLE ONLY public.workflow_documents
    ADD CONSTRAINT workflow_documents_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.workflow_documents
    ADD CONSTRAINT workflow_documents_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id);

ALTER TABLE ONLY public.workflows
    ADD CONSTRAINT workflows_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);

ALTER TABLE ONLY public.workflows
    ADD CONSTRAINT workflows_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
