-- Agirunner platform schema init migration
-- Canonical pre-release baseline reset before the first public launch.

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;




--
-- Name: acp_session_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.acp_session_status AS ENUM (
    'initializing',
    'active',
    'idle',
    'closed'
);


--
-- Name: agent_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.agent_status AS ENUM (
    'active',
    'idle',
    'busy',
    'degraded',
    'inactive',
    'offline'
);


--
-- Name: api_key_scope; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.api_key_scope AS ENUM (
    'agent',
    'worker',
    'admin',
    'service'
);


--
-- Name: event_entity_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.event_entity_type AS ENUM (
    'task',
    'workflow',
    'agent',
    'worker',
    'workspace',
    'system',
    'work_item',
    'gate'
);


--
-- Name: execution_backend; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.execution_backend AS ENUM (
    'runtime_only',
    'runtime_plus_task'
);


--
-- Name: execution_log_category; Type: TYPE; Schema: public; Owner: -
--

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


--
-- Name: execution_log_level; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.execution_log_level AS ENUM (
    'debug',
    'info',
    'warn',
    'error'
);


--
-- Name: execution_log_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.execution_log_source AS ENUM (
    'runtime',
    'container_manager',
    'platform',
    'task_container'
);


--
-- Name: execution_log_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.execution_log_status AS ENUM (
    'started',
    'completed',
    'failed',
    'skipped'
);


--
-- Name: task_priority; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.task_priority AS ENUM (
    'critical',
    'high',
    'normal',
    'low'
);


--
-- Name: task_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.task_state AS ENUM (
    'pending',
    'ready',
    'claimed',
    'in_progress',
    'completed',
    'failed',
    'cancelled',
    'awaiting_approval',
    'output_pending_assessment',
    'escalated'
);


--
-- Name: tool_owner; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tool_owner AS ENUM (
    'runtime',
    'task'
);


--
-- Name: worker_connection_mode; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.worker_connection_mode AS ENUM (
    'websocket',
    'sse',
    'polling'
);


--
-- Name: worker_runtime_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.worker_runtime_type AS ENUM (
    'internal',
    'openclaw',
    'claude_code',
    'codex',
    'acp',
    'custom',
    'external'
);


--
-- Name: worker_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.worker_status AS ENUM (
    'online',
    'degraded',
    'offline',
    'busy',
    'draining',
    'disconnected'
);


--
-- Name: workflow_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.workflow_state AS ENUM (
    'pending',
    'active',
    'completed',
    'failed',
    'cancelled',
    'paused'
);


--
-- Name: create_execution_logs_partition(date); Type: FUNCTION; Schema: public; Owner: -
--

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


--
-- Name: drop_old_execution_log_partitions(integer); Type: FUNCTION; Schema: public; Owner: -
--

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


--
-- Name: notify_event(); Type: FUNCTION; Schema: public; Owner: -
--

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


--
-- Name: notify_execution_log(); Type: FUNCTION; Schema: public; Owner: -
--

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
    'work_item_id', NEW.work_item_id,
    'stage_name', NEW.stage_name,
    'activation_id', NEW.activation_id,
    'is_orchestrator_task', NEW.is_orchestrator_task,
    'execution_backend', NEW.execution_backend,
    'tool_owner', NEW.tool_owner,
    'created_at', NEW.created_at
  )::text);
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;




--
-- Name: acp_sessions; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: agentic_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agentic_settings (
    tenant_id uuid NOT NULL,
    live_visibility_mode_default text DEFAULT 'enhanced'::text NOT NULL,
    revision integer DEFAULT 0 NOT NULL,
    updated_by_operator_id text,
    updated_at timestamp with time zone,
    assembled_prompt_warning_threshold_chars integer DEFAULT 32000 NOT NULL,
    CONSTRAINT agentic_settings_assembled_prompt_warning_threshold_chars_check CHECK ((assembled_prompt_warning_threshold_chars > 0)),
    CONSTRAINT agentic_settings_live_visibility_mode_default_check CHECK ((live_visibility_mode_default = ANY (ARRAY['standard'::text, 'enhanced'::text])))
);


--
-- Name: agents; Type: TABLE; Schema: public; Owner: -
--

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
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_claim_at timestamp with time zone
);


--
-- Name: api_keys; Type: TABLE; Schema: public; Owner: -
--

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
    expires_at timestamp with time zone,
    is_revoked boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    key_lookup_hash character varying(64),
    revoked_at timestamp with time zone
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.audit_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: catalog_import_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_import_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    source_kind text DEFAULT 'github_catalog'::text NOT NULL,
    source_repository text NOT NULL,
    source_ref text NOT NULL,
    source_commit_sha text,
    requested_playbook_ids text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT catalog_import_batches_source_kind_check CHECK ((source_kind = 'github_catalog'::text))
);


--
-- Name: catalog_import_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_import_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    import_batch_id uuid NOT NULL,
    artifact_type text NOT NULL,
    catalog_id text NOT NULL,
    catalog_name text NOT NULL,
    catalog_version text,
    catalog_path text NOT NULL,
    source_repository text NOT NULL,
    source_ref text NOT NULL,
    source_commit_sha text,
    local_entity_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT catalog_import_links_artifact_type_check CHECK ((artifact_type = ANY (ARRAY['playbook'::text, 'specialist'::text, 'skill'::text])))
);


--
-- Name: circuit_breaker_events; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: container_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.container_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    repository text NOT NULL,
    tag text,
    digest text,
    size_bytes bigint,
    created_at timestamp with time zone,
    last_seen timestamp with time zone DEFAULT now()
);


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.events_id_seq OWNED BY public.events.id;


--
-- Name: execution_container_leases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.execution_container_leases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    task_id uuid NOT NULL,
    workflow_id uuid,
    work_item_id uuid,
    role_name text NOT NULL,
    agent_id text,
    worker_id text,
    acquired_at timestamp with time zone DEFAULT now() NOT NULL,
    released_at timestamp with time zone,
    released_reason text
);


--
-- Name: execution_environment_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.execution_environment_catalog (
    catalog_key text NOT NULL,
    catalog_version integer NOT NULL,
    name text NOT NULL,
    description text,
    image text NOT NULL,
    cpu text NOT NULL,
    memory text NOT NULL,
    pull_policy text NOT NULL,
    bootstrap_commands jsonb DEFAULT '[]'::jsonb NOT NULL,
    bootstrap_required_domains jsonb DEFAULT '[]'::jsonb NOT NULL,
    declared_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    support_status text NOT NULL,
    replacement_catalog_key text,
    replacement_catalog_version integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: execution_environment_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.execution_environment_verifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    execution_environment_id uuid NOT NULL,
    status text NOT NULL,
    contract_version text NOT NULL,
    image text NOT NULL,
    probe_output jsonb DEFAULT '{}'::jsonb NOT NULL,
    errors jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: execution_environments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.execution_environments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    source_kind text NOT NULL,
    catalog_key text,
    catalog_version integer,
    image text NOT NULL,
    cpu text NOT NULL,
    memory text NOT NULL,
    pull_policy text NOT NULL,
    bootstrap_commands jsonb DEFAULT '[]'::jsonb NOT NULL,
    bootstrap_required_domains jsonb DEFAULT '[]'::jsonb NOT NULL,
    operator_notes text,
    declared_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    verified_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    tool_capabilities jsonb DEFAULT '{}'::jsonb NOT NULL,
    compatibility_status text DEFAULT 'unknown'::text NOT NULL,
    compatibility_errors jsonb DEFAULT '[]'::jsonb NOT NULL,
    verification_contract_version text,
    last_verified_at timestamp with time zone,
    is_default boolean DEFAULT false NOT NULL,
    is_archived boolean DEFAULT false NOT NULL,
    is_claimable boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: execution_logs; Type: TABLE; Schema: public; Owner: -
--

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
    task_title text,
    work_item_id uuid,
    stage_name text,
    activation_id uuid,
    is_orchestrator_task boolean DEFAULT false NOT NULL,
    execution_backend public.execution_backend,
    tool_owner public.tool_owner,
    CONSTRAINT execution_logs_actor_id_length_check CHECK (((actor_id IS NULL) OR (char_length(actor_id) <= 255))),
    CONSTRAINT execution_logs_actor_name_length_check CHECK (((actor_name IS NULL) OR (char_length(actor_name) <= 255))),
    CONSTRAINT execution_logs_actor_type_length_check CHECK (((actor_type IS NULL) OR (char_length(actor_type) <= 50))),
    CONSTRAINT execution_logs_operation_length_check CHECK ((char_length(operation) <= 500)),
    CONSTRAINT execution_logs_resource_type_length_check CHECK (((resource_type IS NULL) OR (char_length(resource_type) <= 100))),
    CONSTRAINT execution_logs_role_length_check CHECK (((role IS NULL) OR (char_length(role) <= 100))),
    CONSTRAINT execution_logs_stage_name_length_check CHECK (((stage_name IS NULL) OR (char_length(stage_name) <= 200))),
    CONSTRAINT execution_logs_workflow_name_length_check CHECK (((workflow_name IS NULL) OR (char_length(workflow_name) <= 500))),
    CONSTRAINT execution_logs_workspace_name_length_check CHECK (((workspace_name IS NULL) OR (char_length(workspace_name) <= 500)))
)
PARTITION BY RANGE (created_at);


--
-- Name: execution_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.execution_logs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.execution_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: fleet_events; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: integration_actions; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: integration_adapter_deliveries; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: integration_adapters; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: integration_resource_links; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: live_container_inventory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.live_container_inventory (
    tenant_id uuid NOT NULL,
    container_id text NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    state text NOT NULL,
    status text NOT NULL,
    image text NOT NULL,
    cpu_limit text,
    memory_limit text,
    started_at timestamp with time zone,
    desired_state_id uuid,
    runtime_id text,
    task_id uuid,
    workflow_id uuid,
    role_name text,
    playbook_id text,
    playbook_name text,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    execution_backend public.execution_backend
);


--
-- Name: llm_models; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: llm_providers; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: metering_events; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: oauth_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oauth_states (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    profile_id text NOT NULL,
    state text NOT NULL,
    code_verifier text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:10:00'::interval) NOT NULL,
    flow_kind text DEFAULT 'llm_provider'::text NOT NULL,
    flow_payload jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: orchestrator_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orchestrator_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    prompt text DEFAULT ''::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: orchestrator_grants; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: orchestrator_task_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orchestrator_task_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workflow_id uuid NOT NULL,
    task_id uuid NOT NULL,
    orchestrator_task_id uuid NOT NULL,
    activation_id uuid,
    stage_name text,
    worker_id uuid,
    request_id text NOT NULL,
    urgency text NOT NULL,
    message text NOT NULL,
    delivery_state text DEFAULT 'pending_delivery'::text NOT NULL,
    delivery_attempt_count integer DEFAULT 0 NOT NULL,
    last_delivery_attempt_at timestamp with time zone,
    delivered_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: platform_instruction_versions; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: platform_instructions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_instructions (
    tenant_id uuid NOT NULL,
    version integer DEFAULT 0 NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    format text DEFAULT 'text'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_type text,
    updated_by_id text
);


--
-- Name: playbooks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.playbooks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    outcome text NOT NULL,
    lifecycle text DEFAULT 'standard'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    definition jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT playbooks_lifecycle_check CHECK ((lifecycle = ANY (ARRAY['planned'::text, 'ongoing'::text])))
);


--
-- Name: refresh_token_sessions; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: remote_mcp_oauth_client_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.remote_mcp_oauth_client_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    issuer text,
    authorization_endpoint text,
    token_endpoint text NOT NULL,
    registration_endpoint text,
    device_authorization_endpoint text,
    callback_mode text DEFAULT 'loopback'::text NOT NULL,
    token_endpoint_auth_method text DEFAULT 'none'::text NOT NULL,
    client_id text NOT NULL,
    encrypted_client_secret text,
    default_scopes jsonb DEFAULT '[]'::jsonb NOT NULL,
    default_resource_indicators jsonb DEFAULT '[]'::jsonb NOT NULL,
    default_audiences jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: remote_mcp_registration_drafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.remote_mcp_registration_drafts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    endpoint_url text NOT NULL,
    auth_mode text NOT NULL,
    enabled_by_default_for_new_specialists boolean DEFAULT false NOT NULL,
    grant_to_all_existing_specialists boolean DEFAULT false NOT NULL,
    parameters jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    call_timeout_seconds integer DEFAULT 300 NOT NULL,
    transport_preference text DEFAULT 'auto'::text NOT NULL,
    oauth_definition jsonb,
    oauth_client_profile_id uuid
);


--
-- Name: remote_mcp_server_parameters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.remote_mcp_server_parameters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    remote_mcp_server_id uuid NOT NULL,
    placement text NOT NULL,
    key text NOT NULL,
    value_kind text NOT NULL,
    static_value text,
    encrypted_secret_value text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL
);


--
-- Name: remote_mcp_servers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.remote_mcp_servers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    endpoint_url text NOT NULL,
    auth_mode text NOT NULL,
    enabled_by_default_for_new_specialists boolean DEFAULT false NOT NULL,
    is_archived boolean DEFAULT false NOT NULL,
    verification_status text DEFAULT 'unknown'::text NOT NULL,
    verification_error text,
    verified_transport text,
    verified_at timestamp with time zone,
    verification_contract_version text DEFAULT 'remote-mcp-v1'::text NOT NULL,
    discovered_tools_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    oauth_config jsonb,
    oauth_credentials jsonb,
    call_timeout_seconds integer DEFAULT 300 NOT NULL,
    verified_discovery_strategy text,
    verified_oauth_strategy text,
    discovered_resources_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL,
    discovered_prompts_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL,
    verified_capability_summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    transport_preference text DEFAULT 'auto'::text NOT NULL,
    oauth_definition jsonb,
    oauth_client_profile_id uuid
);


--
-- Name: role_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_definitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    system_prompt text,
    allowed_tools text[] DEFAULT '{}'::text[],
    model_preference text,
    verification_strategy text,
    escalation_target text,
    max_escalation_depth integer DEFAULT 5 NOT NULL,
    is_active boolean DEFAULT true,
    version integer DEFAULT 1,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    execution_environment_id uuid
);


--
-- Name: role_model_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_model_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    role_name text NOT NULL,
    primary_model_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    reasoning_config jsonb
);


--
-- Name: runtime_defaults; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: runtime_heartbeats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runtime_heartbeats (
    runtime_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    playbook_id uuid,
    state text DEFAULT 'idle'::text NOT NULL,
    task_id uuid,
    uptime_seconds integer DEFAULT 0 NOT NULL,
    last_claim_at timestamp with time zone,
    image text NOT NULL,
    drain_requested boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_heartbeat_at timestamp with time zone DEFAULT now() NOT NULL,
    pool_kind text DEFAULT 'specialist'::text NOT NULL,
    CONSTRAINT chk_runtime_heartbeats_pool_kind CHECK ((pool_kind = ANY (ARRAY['orchestrator'::text, 'specialist'::text]))),
    CONSTRAINT runtime_heartbeats_state_check CHECK ((state = ANY (ARRAY['idle'::text, 'executing'::text, 'draining'::text])))
);


--
-- Name: scheduled_work_item_trigger_invocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheduled_work_item_trigger_invocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    trigger_id uuid NOT NULL,
    scheduled_for timestamp with time zone NOT NULL,
    work_item_id uuid,
    status text NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: scheduled_work_item_triggers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheduled_work_item_triggers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    source text NOT NULL,
    workspace_id uuid,
    workflow_id uuid NOT NULL,
    cadence_minutes integer,
    defaults jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_fired_at timestamp with time zone,
    next_fire_at timestamp with time zone NOT NULL,
    lease_token text,
    lease_expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    schedule_type text DEFAULT 'interval'::text NOT NULL,
    daily_time text,
    timezone text,
    CONSTRAINT chk_scheduled_work_item_trigger_schedule_mode CHECK ((((schedule_type = 'interval'::text) AND (cadence_minutes IS NOT NULL) AND (cadence_minutes > 0) AND (daily_time IS NULL) AND (timezone IS NULL)) OR ((schedule_type = 'daily_time'::text) AND (cadence_minutes IS NULL) AND (daily_time IS NOT NULL) AND (timezone IS NOT NULL)))),
    CONSTRAINT scheduled_work_item_triggers_cadence_minutes_check CHECK ((cadence_minutes > 0))
);


--
-- Name: specialist_mcp_server_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.specialist_mcp_server_grants (
    specialist_id uuid NOT NULL,
    remote_mcp_server_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: specialist_skill_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.specialist_skill_assignments (
    specialist_id uuid NOT NULL,
    skill_id uuid NOT NULL,
    sort_order integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: specialist_skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.specialist_skills (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    summary text NOT NULL,
    content text NOT NULL,
    is_archived boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: task_handoffs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_handoffs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workflow_id uuid NOT NULL,
    work_item_id uuid,
    task_id uuid NOT NULL,
    task_rework_count integer DEFAULT 0 NOT NULL,
    request_id text,
    role text NOT NULL,
    team_name text,
    stage_name text,
    sequence integer DEFAULT 0 NOT NULL,
    summary text NOT NULL,
    completion text DEFAULT 'full'::text NOT NULL,
    resolution text,
    changes jsonb DEFAULT '[]'::jsonb NOT NULL,
    decisions jsonb DEFAULT '[]'::jsonb NOT NULL,
    remaining_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    blockers jsonb DEFAULT '[]'::jsonb NOT NULL,
    focus_areas text[] DEFAULT '{}'::text[] NOT NULL,
    known_risks text[] DEFAULT '{}'::text[] NOT NULL,
    successor_context text,
    role_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    artifact_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completion_state text DEFAULT 'full'::text NOT NULL,
    decision_state text,
    subject_ref jsonb,
    subject_revision integer,
    outcome_action_applied text,
    branch_id uuid,
    recommended_next_actions jsonb DEFAULT '[]'::jsonb NOT NULL,
    waived_steps jsonb DEFAULT '[]'::jsonb NOT NULL,
    completion_callouts jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT task_handoffs_completion_check CHECK ((completion = ANY (ARRAY['full'::text, 'blocked'::text]))),
    CONSTRAINT task_handoffs_completion_state_check CHECK ((completion_state = ANY (ARRAY['full'::text, 'blocked'::text]))),
    CONSTRAINT task_handoffs_decision_state_check CHECK (((decision_state IS NULL) OR (decision_state = ANY (ARRAY['approved'::text, 'request_changes'::text, 'rejected'::text, 'blocked'::text])))),
    CONSTRAINT task_handoffs_resolution_check CHECK (((resolution IS NULL) OR (resolution = ANY (ARRAY['approved'::text, 'request_changes'::text, 'rejected'::text, 'blocked'::text]))))
);


--
-- Name: task_tool_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_tool_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    task_id uuid NOT NULL,
    tool_name text NOT NULL,
    request_id text NOT NULL,
    response jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

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
    archived_at timestamp with time zone,
    work_item_id uuid,
    stage_name text,
    activation_id uuid,
    request_id text,
    is_orchestrator_task boolean DEFAULT false NOT NULL,
    max_iterations integer,
    llm_max_retries integer,
    branch_id uuid,
    execution_backend public.execution_backend DEFAULT 'runtime_plus_task'::public.execution_backend NOT NULL,
    execution_environment_id uuid,
    execution_environment_snapshot jsonb
);


--
-- Name: tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenants (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tool_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tool_tags (
    id text NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    category text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_identities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    provider text NOT NULL,
    provider_user_id text NOT NULL,
    provider_email text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: webhook_deliveries; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: webhook_work_item_trigger_invocations; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: webhook_work_item_triggers; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: webhooks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhooks (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    url text NOT NULL,
    secret text NOT NULL,
    event_types text[] DEFAULT '{}'::text[] NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: worker_actual_state; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: worker_desired_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.worker_desired_state (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    worker_name text NOT NULL,
    role text NOT NULL,
    runtime_image text NOT NULL,
    cpu_limit text DEFAULT '2'::text,
    memory_limit text DEFAULT '256m'::text,
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
    updated_by uuid,
    pool_kind text DEFAULT 'specialist'::text NOT NULL,
    CONSTRAINT chk_worker_desired_state_pool_kind CHECK ((pool_kind = ANY (ARRAY['orchestrator'::text, 'specialist'::text])))
);


--
-- Name: worker_signals; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: workers; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: workflow_activations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_activations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workflow_id uuid NOT NULL,
    request_id text,
    reason text NOT NULL,
    event_type text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    state text DEFAULT 'queued'::text NOT NULL,
    queued_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    summary text,
    error jsonb,
    activation_id uuid,
    consumed_at timestamp with time zone,
    dispatch_attempt integer DEFAULT 0 NOT NULL,
    dispatch_token uuid,
    closure_context jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT workflow_activations_state_check CHECK ((state = ANY (ARRAY['queued'::text, 'processing'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: workflow_artifacts; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: workflow_branches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_branches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workflow_id uuid NOT NULL,
    parent_branch_id uuid,
    parent_subject_ref jsonb DEFAULT '{}'::jsonb NOT NULL,
    branch_key text NOT NULL,
    branch_status text DEFAULT 'active'::text NOT NULL,
    termination_policy text NOT NULL,
    created_by_task_id uuid,
    terminated_by_type text,
    terminated_by_id text,
    termination_reason text,
    terminated_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workflow_branches_status_check CHECK ((branch_status = ANY (ARRAY['active'::text, 'completed'::text, 'blocked'::text, 'terminated'::text]))),
    CONSTRAINT workflow_branches_termination_policy_check CHECK ((termination_policy = ANY (ARRAY['stop_branch_only'::text, 'stop_branch_and_descendants'::text, 'stop_all_siblings'::text])))
);


--
-- Name: workflow_documents; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: workflow_input_packet_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_input_packet_files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workflow_id uuid NOT NULL,
    packet_id uuid NOT NULL,
    file_name text NOT NULL,
    description text,
    storage_backend text NOT NULL,
    storage_key text NOT NULL,
    content_type text NOT NULL,
    size_bytes bigint NOT NULL,
    checksum_sha256 text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: workflow_input_packets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_input_packets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workflow_id uuid NOT NULL,
    work_item_id uuid,
    packet_kind text NOT NULL,
    source text DEFAULT 'operator'::text NOT NULL,
    summary text,
    structured_inputs jsonb DEFAULT '{}'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by_type text NOT NULL,
    created_by_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    request_id text,
    source_intervention_id uuid,
    source_attempt_id uuid,
    created_by_kind text DEFAULT 'operator'::text NOT NULL
);


--
-- Name: workflow_intervention_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_intervention_files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workflow_id uuid NOT NULL,
    intervention_id uuid NOT NULL,
    file_name text NOT NULL,
    description text,
    storage_backend text NOT NULL,
    storage_key text NOT NULL,
    content_type text NOT NULL,
    size_bytes bigint NOT NULL,
    checksum_sha256 text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: workflow_interventions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_interventions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workflow_id uuid NOT NULL,
    work_item_id uuid,
    task_id uuid,
    kind text NOT NULL,
    origin text DEFAULT 'operator'::text NOT NULL,
    status text DEFAULT 'applied'::text NOT NULL,
    summary text NOT NULL,
    note text,
    structured_action jsonb DEFAULT '{}'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by_type text NOT NULL,
    created_by_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    request_id text,
    outcome text DEFAULT 'applied'::text NOT NULL,
    result_kind text DEFAULT 'intervention_recorded'::text NOT NULL,
    snapshot_version text,
    settings_revision integer,
    message text
);


--
-- Name: workflow_operator_briefs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_operator_briefs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workflow_id uuid NOT NULL,
    work_item_id uuid,
    task_id uuid,
    request_id text NOT NULL,
    execution_context_id text NOT NULL,
    brief_kind text NOT NULL,
    brief_scope text NOT NULL,
    source_kind text NOT NULL,
    source_role_name text,
    status_kind text NOT NULL,
    short_brief jsonb DEFAULT '{}'::jsonb NOT NULL,
    detailed_brief_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    sequence_number integer NOT NULL,
    related_artifact_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    related_output_descriptor_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    related_intervention_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    canonical_workflow_brief_id uuid,
    created_by_type text NOT NULL,
    created_by_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    linked_target_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    llm_turn_count integer,
    CONSTRAINT workflow_operator_briefs_sequence_positive CHECK ((sequence_number > 0))
);


--
-- Name: workflow_operator_updates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_operator_updates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workflow_id uuid NOT NULL,
    work_item_id uuid,
    task_id uuid,
    request_id text NOT NULL,
    execution_context_id text NOT NULL,
    source_kind text NOT NULL,
    source_role_name text,
    update_kind text NOT NULL,
    headline text NOT NULL,
    summary text,
    linked_target_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    visibility_mode text NOT NULL,
    promoted_brief_id uuid,
    sequence_number integer NOT NULL,
    created_by_type text NOT NULL,
    created_by_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    llm_turn_count integer,
    CONSTRAINT workflow_operator_updates_sequence_positive CHECK ((sequence_number > 0)),
    CONSTRAINT workflow_operator_updates_visibility_mode_check CHECK ((visibility_mode = ANY (ARRAY['standard'::text, 'enhanced'::text])))
);


--
-- Name: workflow_output_descriptors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_output_descriptors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workflow_id uuid NOT NULL,
    work_item_id uuid,
    descriptor_kind text NOT NULL,
    delivery_stage text NOT NULL,
    title text NOT NULL,
    state text NOT NULL,
    summary_brief text,
    preview_capabilities_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    primary_target_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    secondary_targets_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    content_preview_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_brief_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workflow_output_descriptors_delivery_stage_check CHECK ((delivery_stage = ANY (ARRAY['in_progress'::text, 'final'::text]))),
    CONSTRAINT workflow_output_descriptors_state_check CHECK ((state = ANY (ARRAY['draft'::text, 'under_review'::text, 'approved'::text, 'superseded'::text, 'final'::text])))
);


--
-- Name: workflow_stage_gates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_stage_gates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workflow_id uuid NOT NULL,
    stage_id uuid NOT NULL,
    stage_name text NOT NULL,
    request_summary text NOT NULL,
    recommendation text,
    concerns jsonb DEFAULT '[]'::jsonb NOT NULL,
    key_artifacts jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text NOT NULL,
    requested_by_type text NOT NULL,
    requested_by_id text,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    decision_feedback text,
    decided_by_type text,
    decided_by_id text,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    subject_revision integer,
    superseded_at timestamp with time zone,
    superseded_by_revision integer,
    requested_by_work_item_id uuid,
    closure_effect text DEFAULT 'blocking'::text NOT NULL,
    requested_by_task_id uuid,
    requested_reason text,
    resolution_status text,
    resolved_by_task_id uuid,
    CONSTRAINT workflow_stage_gates_closure_effect_check CHECK ((closure_effect = ANY (ARRAY['blocking'::text, 'advisory'::text]))),
    CONSTRAINT workflow_stage_gates_status_check CHECK ((status = ANY (ARRAY['awaiting_approval'::text, 'approved'::text, 'rejected'::text, 'changes_requested'::text, 'blocked'::text])))
);


--
-- Name: workflow_stages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_stages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workflow_id uuid NOT NULL,
    name text NOT NULL,
    "position" integer NOT NULL,
    goal text NOT NULL,
    guidance text,
    status text DEFAULT 'pending'::text NOT NULL,
    gate_status text DEFAULT 'not_requested'::text NOT NULL,
    iteration_count integer DEFAULT 0 NOT NULL,
    summary text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workflow_stages_gate_status_check CHECK ((gate_status = ANY (ARRAY['not_requested'::text, 'awaiting_approval'::text, 'approved'::text, 'rejected'::text, 'changes_requested'::text, 'blocked'::text]))),
    CONSTRAINT workflow_stages_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'awaiting_gate'::text, 'completed'::text, 'blocked'::text])))
);


--
-- Name: workflow_steering_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_steering_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workflow_id uuid NOT NULL,
    steering_session_id uuid NOT NULL,
    created_by_type text NOT NULL,
    created_by_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    work_item_id uuid,
    source_kind text NOT NULL,
    message_kind text NOT NULL,
    headline text NOT NULL,
    body text,
    linked_intervention_id uuid,
    linked_input_packet_id uuid,
    linked_operator_update_id uuid
);


--
-- Name: workflow_steering_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_steering_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workflow_id uuid NOT NULL,
    title text,
    status text DEFAULT 'open'::text NOT NULL,
    created_by_type text NOT NULL,
    created_by_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    work_item_id uuid,
    last_message_at timestamp with time zone
);


--
-- Name: workflow_subject_escalations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_subject_escalations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workflow_id uuid NOT NULL,
    work_item_id uuid,
    subject_ref jsonb DEFAULT '{}'::jsonb NOT NULL,
    subject_revision integer,
    reason text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    created_by_task_id uuid,
    resolution_action text,
    resolution_feedback text,
    resolved_by_type text,
    resolved_by_id text,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    closure_effect text DEFAULT 'advisory'::text NOT NULL,
    resolution_status text,
    resolved_by_task_id uuid,
    CONSTRAINT workflow_subject_escalations_closure_effect_check CHECK ((closure_effect = ANY (ARRAY['blocking'::text, 'advisory'::text]))),
    CONSTRAINT workflow_subject_escalations_status_check CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text, 'dismissed'::text])))
);


--
-- Name: workflow_tool_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_tool_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workflow_id uuid NOT NULL,
    tool_name text NOT NULL,
    request_id text NOT NULL,
    response jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    mutation_outcome text,
    recovery_class text
);


--
-- Name: workflow_work_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_work_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workflow_id uuid NOT NULL,
    parent_work_item_id uuid,
    stage_name text NOT NULL,
    title text NOT NULL,
    goal text,
    acceptance_criteria text,
    column_id text NOT NULL,
    owner_role text,
    priority public.task_priority DEFAULT 'normal'::public.task_priority NOT NULL,
    request_id text,
    notes text,
    created_by text DEFAULT 'manual'::text NOT NULL,
    completed_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    next_expected_actor text,
    next_expected_action text,
    rework_count integer DEFAULT 0 NOT NULL,
    blocked_state text,
    blocked_reason text,
    escalation_status text,
    branch_id uuid,
    completion_callouts jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT workflow_work_items_blocked_state_check CHECK (((blocked_state IS NULL) OR (blocked_state = 'blocked'::text))),
    CONSTRAINT workflow_work_items_created_by_check CHECK ((created_by = ANY (ARRAY['orchestrator'::text, 'api'::text, 'webhook'::text, 'manual'::text]))),
    CONSTRAINT workflow_work_items_escalation_status_check CHECK (((escalation_status IS NULL) OR (escalation_status = 'open'::text)))
);


--
-- Name: workflows; Type: TABLE; Schema: public; Owner: -
--

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
    archived_at timestamp with time zone,
    playbook_id uuid,
    playbook_version integer,
    lifecycle text,
    current_stage text,
    orchestration_state jsonb DEFAULT '{}'::jsonb NOT NULL,
    token_budget integer,
    cost_cap_usd numeric(10,4),
    max_duration_minutes integer,
    completion_callouts jsonb DEFAULT '{}'::jsonb NOT NULL,
    root_workflow_id uuid,
    previous_attempt_workflow_id uuid,
    attempt_number integer DEFAULT 1 NOT NULL,
    attempt_kind text DEFAULT 'initial'::text NOT NULL,
    live_visibility_mode_override text,
    live_visibility_revision integer DEFAULT 0 NOT NULL,
    live_visibility_updated_by_operator_id text,
    live_visibility_updated_at timestamp with time zone,
    attempt_group_id uuid,
    redrive_reason text,
    redrive_input_packet_id uuid,
    inherited_input_packet_ids_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT chk_workflows_ongoing_current_stage_null CHECK (((lifecycle IS DISTINCT FROM 'ongoing'::text) OR (current_stage IS NULL))),
    CONSTRAINT workflows_attempt_kind_check CHECK ((attempt_kind = ANY (ARRAY['initial'::text, 'redrive'::text]))),
    CONSTRAINT workflows_attempt_number_positive CHECK ((attempt_number > 0)),
    CONSTRAINT workflows_lifecycle_check CHECK (((lifecycle IS NULL) OR (lifecycle = ANY (ARRAY['planned'::text, 'ongoing'::text])))),
    CONSTRAINT workflows_live_visibility_mode_override_check CHECK (((live_visibility_mode_override IS NULL) OR (live_visibility_mode_override = ANY (ARRAY['standard'::text, 'enhanced'::text]))))
);


--
-- Name: workspace_artifact_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_artifact_files (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    key text NOT NULL,
    description text,
    file_name text NOT NULL,
    storage_backend text NOT NULL,
    storage_key text NOT NULL,
    content_type text NOT NULL,
    size_bytes bigint NOT NULL,
    checksum_sha256 text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: workspace_spec_versions; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: workspaces; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events ALTER COLUMN id SET DEFAULT nextval('public.events_id_seq'::regclass);


--
-- Name: acp_sessions acp_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acp_sessions
    ADD CONSTRAINT acp_sessions_pkey PRIMARY KEY (id);


--
-- Name: agentic_settings agentic_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agentic_settings
    ADD CONSTRAINT agentic_settings_pkey PRIMARY KEY (tenant_id);


--
-- Name: agents agents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_pkey PRIMARY KEY (id);


--
-- Name: api_keys api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: catalog_import_batches catalog_import_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_import_batches
    ADD CONSTRAINT catalog_import_batches_pkey PRIMARY KEY (id);


--
-- Name: catalog_import_links catalog_import_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_import_links
    ADD CONSTRAINT catalog_import_links_pkey PRIMARY KEY (id);


--
-- Name: circuit_breaker_events circuit_breaker_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circuit_breaker_events
    ADD CONSTRAINT circuit_breaker_events_pkey PRIMARY KEY (id);


--
-- Name: container_images container_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.container_images
    ADD CONSTRAINT container_images_pkey PRIMARY KEY (id);


--
-- Name: container_images container_images_repository_tag_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.container_images
    ADD CONSTRAINT container_images_repository_tag_key UNIQUE (repository, tag);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: execution_container_leases execution_container_leases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_container_leases
    ADD CONSTRAINT execution_container_leases_pkey PRIMARY KEY (id);


--
-- Name: execution_environment_verifications execution_environment_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_environment_verifications
    ADD CONSTRAINT execution_environment_verifications_pkey PRIMARY KEY (id);


--
-- Name: execution_environments execution_environments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_environments
    ADD CONSTRAINT execution_environments_pkey PRIMARY KEY (id);


--
-- Name: execution_logs execution_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_logs
    ADD CONSTRAINT execution_logs_pkey PRIMARY KEY (id, created_at);


--
-- Name: fleet_events fleet_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fleet_events
    ADD CONSTRAINT fleet_events_pkey PRIMARY KEY (id);


--
-- Name: integration_actions integration_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_actions
    ADD CONSTRAINT integration_actions_pkey PRIMARY KEY (id);


--
-- Name: integration_actions integration_actions_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_actions
    ADD CONSTRAINT integration_actions_token_hash_key UNIQUE (token_hash);


--
-- Name: integration_adapter_deliveries integration_adapter_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_adapter_deliveries
    ADD CONSTRAINT integration_adapter_deliveries_pkey PRIMARY KEY (id);


--
-- Name: integration_adapters integration_adapters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_adapters
    ADD CONSTRAINT integration_adapters_pkey PRIMARY KEY (id);


--
-- Name: integration_resource_links integration_resource_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_resource_links
    ADD CONSTRAINT integration_resource_links_pkey PRIMARY KEY (id);


--
-- Name: llm_models llm_models_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_models
    ADD CONSTRAINT llm_models_pkey PRIMARY KEY (id);


--
-- Name: llm_models llm_models_tenant_provider_model_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_models
    ADD CONSTRAINT llm_models_tenant_provider_model_key UNIQUE (tenant_id, provider_id, model_id);


--
-- Name: llm_providers llm_providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_providers
    ADD CONSTRAINT llm_providers_pkey PRIMARY KEY (id);


--
-- Name: llm_providers llm_providers_tenant_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_providers
    ADD CONSTRAINT llm_providers_tenant_id_name_key UNIQUE (tenant_id, name);


--
-- Name: metering_events metering_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metering_events
    ADD CONSTRAINT metering_events_pkey PRIMARY KEY (id);


--
-- Name: oauth_states oauth_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_states
    ADD CONSTRAINT oauth_states_pkey PRIMARY KEY (id);


--
-- Name: oauth_states oauth_states_state_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_states
    ADD CONSTRAINT oauth_states_state_key UNIQUE (state);


--
-- Name: orchestrator_config orchestrator_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orchestrator_config
    ADD CONSTRAINT orchestrator_config_pkey PRIMARY KEY (id);


--
-- Name: orchestrator_config orchestrator_config_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orchestrator_config
    ADD CONSTRAINT orchestrator_config_tenant_id_key UNIQUE (tenant_id);


--
-- Name: orchestrator_grants orchestrator_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orchestrator_grants
    ADD CONSTRAINT orchestrator_grants_pkey PRIMARY KEY (id);


--
-- Name: orchestrator_task_messages orchestrator_task_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orchestrator_task_messages
    ADD CONSTRAINT orchestrator_task_messages_pkey PRIMARY KEY (id);


--
-- Name: execution_environment_catalog pk_execution_environment_catalog; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_environment_catalog
    ADD CONSTRAINT pk_execution_environment_catalog PRIMARY KEY (catalog_key, catalog_version);


--
-- Name: live_container_inventory pk_live_container_inventory; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_container_inventory
    ADD CONSTRAINT pk_live_container_inventory PRIMARY KEY (tenant_id, container_id);


--
-- Name: specialist_mcp_server_grants pk_specialist_mcp_server_grants; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.specialist_mcp_server_grants
    ADD CONSTRAINT pk_specialist_mcp_server_grants PRIMARY KEY (specialist_id, remote_mcp_server_id);


--
-- Name: specialist_skill_assignments pk_specialist_skill_assignments; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.specialist_skill_assignments
    ADD CONSTRAINT pk_specialist_skill_assignments PRIMARY KEY (specialist_id, skill_id);


--
-- Name: platform_instruction_versions platform_instruction_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_instruction_versions
    ADD CONSTRAINT platform_instruction_versions_pkey PRIMARY KEY (id);


--
-- Name: platform_instructions platform_instructions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_instructions
    ADD CONSTRAINT platform_instructions_pkey PRIMARY KEY (tenant_id);


--
-- Name: playbooks playbooks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playbooks
    ADD CONSTRAINT playbooks_pkey PRIMARY KEY (id);


--
-- Name: refresh_token_sessions refresh_token_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_token_sessions
    ADD CONSTRAINT refresh_token_sessions_pkey PRIMARY KEY (id);


--
-- Name: refresh_token_sessions refresh_token_sessions_token_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_token_sessions
    ADD CONSTRAINT refresh_token_sessions_token_id_key UNIQUE (token_id);


--
-- Name: remote_mcp_oauth_client_profiles remote_mcp_oauth_client_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_mcp_oauth_client_profiles
    ADD CONSTRAINT remote_mcp_oauth_client_profiles_pkey PRIMARY KEY (id);


--
-- Name: remote_mcp_registration_drafts remote_mcp_registration_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_mcp_registration_drafts
    ADD CONSTRAINT remote_mcp_registration_drafts_pkey PRIMARY KEY (id);


--
-- Name: remote_mcp_server_parameters remote_mcp_server_parameters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_mcp_server_parameters
    ADD CONSTRAINT remote_mcp_server_parameters_pkey PRIMARY KEY (id);


--
-- Name: remote_mcp_servers remote_mcp_servers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_mcp_servers
    ADD CONSTRAINT remote_mcp_servers_pkey PRIMARY KEY (id);


--
-- Name: role_definitions role_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_definitions
    ADD CONSTRAINT role_definitions_pkey PRIMARY KEY (id);


--
-- Name: role_definitions role_definitions_tenant_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_definitions
    ADD CONSTRAINT role_definitions_tenant_id_name_key UNIQUE (tenant_id, name);


--
-- Name: role_model_assignments role_model_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_model_assignments
    ADD CONSTRAINT role_model_assignments_pkey PRIMARY KEY (id);


--
-- Name: role_model_assignments role_model_assignments_tenant_id_role_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_model_assignments
    ADD CONSTRAINT role_model_assignments_tenant_id_role_name_key UNIQUE (tenant_id, role_name);


--
-- Name: runtime_defaults runtime_defaults_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_defaults
    ADD CONSTRAINT runtime_defaults_pkey PRIMARY KEY (id);


--
-- Name: runtime_defaults runtime_defaults_tenant_id_config_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_defaults
    ADD CONSTRAINT runtime_defaults_tenant_id_config_key_key UNIQUE (tenant_id, config_key);


--
-- Name: runtime_heartbeats runtime_heartbeats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_heartbeats
    ADD CONSTRAINT runtime_heartbeats_pkey PRIMARY KEY (runtime_id);


--
-- Name: scheduled_work_item_trigger_invocations scheduled_work_item_trigger_invocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_work_item_trigger_invocations
    ADD CONSTRAINT scheduled_work_item_trigger_invocations_pkey PRIMARY KEY (id);


--
-- Name: scheduled_work_item_triggers scheduled_work_item_triggers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_work_item_triggers
    ADD CONSTRAINT scheduled_work_item_triggers_pkey PRIMARY KEY (id);


--
-- Name: specialist_skills specialist_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.specialist_skills
    ADD CONSTRAINT specialist_skills_pkey PRIMARY KEY (id);


--
-- Name: task_handoffs task_handoffs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_handoffs
    ADD CONSTRAINT task_handoffs_pkey PRIMARY KEY (id);


--
-- Name: task_tool_results task_tool_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_tool_results
    ADD CONSTRAINT task_tool_results_pkey PRIMARY KEY (id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_slug_key UNIQUE (slug);


--
-- Name: tool_tags tool_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_tags
    ADD CONSTRAINT tool_tags_pkey PRIMARY KEY (tenant_id, id);


--
-- Name: execution_container_leases uq_execution_container_leases_tenant_task; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_container_leases
    ADD CONSTRAINT uq_execution_container_leases_tenant_task UNIQUE (tenant_id, task_id);


--
-- Name: execution_environments uq_execution_environments_tenant_slug; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_environments
    ADD CONSTRAINT uq_execution_environments_tenant_slug UNIQUE (tenant_id, slug);


--
-- Name: playbooks uq_playbooks_tenant_slug_version; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playbooks
    ADD CONSTRAINT uq_playbooks_tenant_slug_version UNIQUE (tenant_id, slug, version);


--
-- Name: remote_mcp_servers uq_remote_mcp_servers_tenant_slug; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_mcp_servers
    ADD CONSTRAINT uq_remote_mcp_servers_tenant_slug UNIQUE (tenant_id, slug);


--
-- Name: specialist_skills uq_specialist_skills_tenant_slug; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.specialist_skills
    ADD CONSTRAINT uq_specialist_skills_tenant_slug UNIQUE (tenant_id, slug);


--
-- Name: task_tool_results uq_task_tool_results_request; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_tool_results
    ADD CONSTRAINT uq_task_tool_results_request UNIQUE (tenant_id, task_id, tool_name, request_id);


--
-- Name: workflow_stages uq_workflow_stages_workflow_name; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_stages
    ADD CONSTRAINT uq_workflow_stages_workflow_name UNIQUE (tenant_id, workflow_id, name);


--
-- Name: workflow_tool_results uq_workflow_tool_results_request; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_tool_results
    ADD CONSTRAINT uq_workflow_tool_results_request UNIQUE (tenant_id, workflow_id, tool_name, request_id);


--
-- Name: workspaces uq_workspace_tenant_slug; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT uq_workspace_tenant_slug UNIQUE (tenant_id, slug);


--
-- Name: user_identities user_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_identities
    ADD CONSTRAINT user_identities_pkey PRIMARY KEY (id);


--
-- Name: user_identities user_identities_provider_provider_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_identities
    ADD CONSTRAINT user_identities_provider_provider_user_id_key UNIQUE (provider, provider_user_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_tenant_id_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_tenant_id_email_key UNIQUE (tenant_id, email);


--
-- Name: webhook_deliveries webhook_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_pkey PRIMARY KEY (id);


--
-- Name: webhook_work_item_trigger_invocations webhook_work_item_trigger_invocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_work_item_trigger_invocations
    ADD CONSTRAINT webhook_work_item_trigger_invocations_pkey PRIMARY KEY (id);


--
-- Name: webhook_work_item_triggers webhook_work_item_triggers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_work_item_triggers
    ADD CONSTRAINT webhook_work_item_triggers_pkey PRIMARY KEY (id);


--
-- Name: webhooks webhooks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhooks
    ADD CONSTRAINT webhooks_pkey PRIMARY KEY (id);


--
-- Name: worker_actual_state worker_actual_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_actual_state
    ADD CONSTRAINT worker_actual_state_pkey PRIMARY KEY (id);


--
-- Name: worker_desired_state worker_desired_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_desired_state
    ADD CONSTRAINT worker_desired_state_pkey PRIMARY KEY (id);


--
-- Name: worker_desired_state worker_desired_state_tenant_id_worker_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_desired_state
    ADD CONSTRAINT worker_desired_state_tenant_id_worker_name_key UNIQUE (tenant_id, worker_name);


--
-- Name: worker_signals worker_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_signals
    ADD CONSTRAINT worker_signals_pkey PRIMARY KEY (id);


--
-- Name: workers workers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workers
    ADD CONSTRAINT workers_pkey PRIMARY KEY (id);


--
-- Name: workflow_activations workflow_activations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_activations
    ADD CONSTRAINT workflow_activations_pkey PRIMARY KEY (id);


--
-- Name: workflow_artifacts workflow_artifacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_artifacts
    ADD CONSTRAINT workflow_artifacts_pkey PRIMARY KEY (id);


--
-- Name: workflow_branches workflow_branches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_branches
    ADD CONSTRAINT workflow_branches_pkey PRIMARY KEY (id);


--
-- Name: workflow_documents workflow_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_documents
    ADD CONSTRAINT workflow_documents_pkey PRIMARY KEY (id);


--
-- Name: workflow_input_packet_files workflow_input_packet_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_input_packet_files
    ADD CONSTRAINT workflow_input_packet_files_pkey PRIMARY KEY (id);


--
-- Name: workflow_input_packets workflow_input_packets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_input_packets
    ADD CONSTRAINT workflow_input_packets_pkey PRIMARY KEY (id);


--
-- Name: workflow_intervention_files workflow_intervention_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_intervention_files
    ADD CONSTRAINT workflow_intervention_files_pkey PRIMARY KEY (id);


--
-- Name: workflow_interventions workflow_interventions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_interventions
    ADD CONSTRAINT workflow_interventions_pkey PRIMARY KEY (id);


--
-- Name: workflow_operator_briefs workflow_operator_briefs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_operator_briefs
    ADD CONSTRAINT workflow_operator_briefs_pkey PRIMARY KEY (id);


--
-- Name: workflow_operator_updates workflow_operator_updates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_operator_updates
    ADD CONSTRAINT workflow_operator_updates_pkey PRIMARY KEY (id);


--
-- Name: workflow_output_descriptors workflow_output_descriptors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_output_descriptors
    ADD CONSTRAINT workflow_output_descriptors_pkey PRIMARY KEY (id);


--
-- Name: workflow_stage_gates workflow_stage_gates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_stage_gates
    ADD CONSTRAINT workflow_stage_gates_pkey PRIMARY KEY (id);


--
-- Name: workflow_stages workflow_stages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_stages
    ADD CONSTRAINT workflow_stages_pkey PRIMARY KEY (id);


--
-- Name: workflow_steering_messages workflow_steering_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_steering_messages
    ADD CONSTRAINT workflow_steering_messages_pkey PRIMARY KEY (id);


--
-- Name: workflow_steering_sessions workflow_steering_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_steering_sessions
    ADD CONSTRAINT workflow_steering_sessions_pkey PRIMARY KEY (id);


--
-- Name: workflow_subject_escalations workflow_subject_escalations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_subject_escalations
    ADD CONSTRAINT workflow_subject_escalations_pkey PRIMARY KEY (id);


--
-- Name: workflow_tool_results workflow_tool_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_tool_results
    ADD CONSTRAINT workflow_tool_results_pkey PRIMARY KEY (id);


--
-- Name: workflow_work_items workflow_work_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_work_items
    ADD CONSTRAINT workflow_work_items_pkey PRIMARY KEY (id);


--
-- Name: workflows workflows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflows
    ADD CONSTRAINT workflows_pkey PRIMARY KEY (id);


--
-- Name: workspace_artifact_files workspace_artifact_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_artifact_files
    ADD CONSTRAINT workspace_artifact_files_pkey PRIMARY KEY (id);


--
-- Name: workspace_spec_versions workspace_spec_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_spec_versions
    ADD CONSTRAINT workspace_spec_versions_pkey PRIMARY KEY (id);


--
-- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);


--
-- Name: idx_acp_sessions_reusable; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acp_sessions_reusable ON public.acp_sessions USING btree (tenant_id, agent_id, updated_at DESC) WHERE (status = ANY (ARRAY['initializing'::public.acp_session_status, 'active'::public.acp_session_status, 'idle'::public.acp_session_status]));


--
-- Name: idx_acp_sessions_tenant_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acp_sessions_tenant_agent ON public.acp_sessions USING btree (tenant_id, agent_id, created_at DESC);


--
-- Name: idx_acp_sessions_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acp_sessions_tenant_status ON public.acp_sessions USING btree (tenant_id, status, updated_at DESC);


--
-- Name: idx_acp_sessions_tenant_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acp_sessions_tenant_workflow ON public.acp_sessions USING btree (tenant_id, workflow_id, created_at DESC);


--
-- Name: idx_agents_current_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agents_current_task ON public.agents USING btree (current_task_id) WHERE (current_task_id IS NOT NULL);


--
-- Name: idx_agents_routing_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agents_routing_tags ON public.agents USING gin (routing_tags);


--
-- Name: idx_agents_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agents_status ON public.agents USING btree (tenant_id, status);


--
-- Name: idx_agents_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agents_tenant ON public.agents USING btree (tenant_id);


--
-- Name: idx_agents_tenant_worker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agents_tenant_worker ON public.agents USING btree (tenant_id, worker_id, created_at);


--
-- Name: idx_agents_worker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agents_worker ON public.agents USING btree (worker_id);


--
-- Name: idx_api_keys_lookup_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_api_keys_lookup_hash ON public.api_keys USING btree (key_lookup_hash) WHERE (key_lookup_hash IS NOT NULL);


--
-- Name: idx_api_keys_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_keys_owner ON public.api_keys USING btree (owner_type, owner_id);


--
-- Name: idx_api_keys_prefix; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_api_keys_prefix ON public.api_keys USING btree (key_prefix);


--
-- Name: idx_api_keys_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_keys_tenant ON public.api_keys USING btree (tenant_id);


--
-- Name: idx_audit_logs_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_action ON public.audit_logs USING btree (tenant_id, action, created_at DESC);


--
-- Name: idx_audit_logs_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_actor ON public.audit_logs USING btree (tenant_id, actor_id, created_at DESC);


--
-- Name: idx_audit_logs_resource; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_resource ON public.audit_logs USING btree (tenant_id, resource_id, created_at DESC);


--
-- Name: idx_audit_logs_tenant_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_tenant_time ON public.audit_logs USING btree (tenant_id, created_at DESC);


--
-- Name: idx_catalog_import_batches_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_catalog_import_batches_tenant_created ON public.catalog_import_batches USING btree (tenant_id, created_at DESC);


--
-- Name: idx_catalog_import_links_tenant_catalog; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_catalog_import_links_tenant_catalog ON public.catalog_import_links USING btree (tenant_id, artifact_type, catalog_id, created_at DESC);


--
-- Name: idx_circuit_breaker_events_worker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_circuit_breaker_events_worker ON public.circuit_breaker_events USING btree (worker_id);


--
-- Name: idx_container_images_digest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_container_images_digest ON public.container_images USING btree (digest) WHERE (digest IS NOT NULL);


--
-- Name: idx_container_images_repo_tag; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_container_images_repo_tag ON public.container_images USING btree (repository, tag);


--
-- Name: idx_events_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_entity ON public.events USING btree (entity_type, entity_id, created_at DESC);


--
-- Name: idx_events_tenant_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_tenant_time ON public.events USING btree (tenant_id, created_at DESC);


--
-- Name: idx_events_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_type ON public.events USING btree (tenant_id, type, created_at DESC);


--
-- Name: idx_execution_container_leases_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_execution_container_leases_task ON public.execution_container_leases USING btree (task_id);


--
-- Name: idx_execution_container_leases_tenant_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_execution_container_leases_tenant_active ON public.execution_container_leases USING btree (tenant_id, released_at);


--
-- Name: idx_execution_environment_catalog_support_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_execution_environment_catalog_support_status ON public.execution_environment_catalog USING btree (support_status);


--
-- Name: idx_execution_environment_verifications_environment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_execution_environment_verifications_environment ON public.execution_environment_verifications USING btree (execution_environment_id, created_at);


--
-- Name: idx_execution_environment_verifications_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_execution_environment_verifications_tenant ON public.execution_environment_verifications USING btree (tenant_id);


--
-- Name: idx_execution_environments_catalog; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_execution_environments_catalog ON public.execution_environments USING btree (catalog_key, catalog_version);


--
-- Name: idx_execution_environments_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_execution_environments_tenant ON public.execution_environments USING btree (tenant_id);


--
-- Name: idx_execution_environments_tenant_claimable; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_execution_environments_tenant_claimable ON public.execution_environments USING btree (tenant_id, is_claimable, is_archived);


--
-- Name: idx_execution_logs_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_execution_logs_role ON ONLY public.execution_logs USING btree (tenant_id, role) WHERE (role IS NOT NULL);


--
-- Name: idx_execution_logs_workflow_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_execution_logs_workflow_name ON ONLY public.execution_logs USING btree (tenant_id, workflow_name) WHERE (workflow_name IS NOT NULL);


--
-- Name: idx_execution_logs_workspace_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_execution_logs_workspace_name ON ONLY public.execution_logs USING btree (tenant_id, workspace_name) WHERE (workspace_name IS NOT NULL);


--
-- Name: idx_exlogs_activation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_activation ON ONLY public.execution_logs USING btree (tenant_id, activation_id, created_at DESC) INCLUDE (source, category, level, status, duration_ms, workflow_id, task_id) WHERE (activation_id IS NOT NULL);


--
-- Name: idx_exlogs_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_actor ON ONLY public.execution_logs USING btree (tenant_id, actor_id, created_at DESC) INCLUDE (source, category, status, workflow_id, task_id) WHERE (actor_id IS NOT NULL);


--
-- Name: idx_exlogs_actors_distinct; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_actors_distinct ON ONLY public.execution_logs USING btree (tenant_id, actor_type, actor_id, actor_name, created_at DESC) WHERE (actor_id IS NOT NULL);


--
-- Name: idx_exlogs_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_category ON ONLY public.execution_logs USING btree (tenant_id, category, created_at DESC) INCLUDE (source, level, status, duration_ms, workflow_id, task_id);


--
-- Name: idx_exlogs_category_op; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_category_op ON ONLY public.execution_logs USING btree (tenant_id, category, operation, created_at DESC) INCLUDE (source, level, status, duration_ms, workflow_id, task_id);


--
-- Name: idx_exlogs_config_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_config_type ON ONLY public.execution_logs USING btree (((payload ->> 'config_type'::text)), created_at DESC) WHERE (category = 'config'::public.execution_log_category);


--
-- Name: idx_exlogs_errors; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_errors ON ONLY public.execution_logs USING btree (tenant_id, created_at DESC) INCLUDE (source, category, workflow_id, task_id) WHERE ((level = 'error'::public.execution_log_level) OR (status = 'failed'::public.execution_log_status));


--
-- Name: idx_exlogs_execution_backend; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_execution_backend ON ONLY public.execution_logs USING btree (tenant_id, execution_backend, created_at);


--
-- Name: idx_exlogs_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_level ON ONLY public.execution_logs USING btree (tenant_id, level, created_at DESC) INCLUDE (source, category, status, duration_ms, workflow_id, task_id);


--
-- Name: idx_exlogs_llm_model; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_llm_model ON ONLY public.execution_logs USING btree (((payload ->> 'model'::text)), created_at DESC) WHERE (category = 'llm'::public.execution_log_category);


--
-- Name: idx_exlogs_llm_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_llm_provider ON ONLY public.execution_logs USING btree (((payload ->> 'provider'::text)), created_at DESC) WHERE (category = 'llm'::public.execution_log_category);


--
-- Name: idx_exlogs_ops_distinct; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_ops_distinct ON ONLY public.execution_logs USING btree (tenant_id, operation, created_at DESC);


--
-- Name: idx_exlogs_orchestrator_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_orchestrator_task ON ONLY public.execution_logs USING btree (tenant_id, is_orchestrator_task, created_at DESC) INCLUDE (source, category, level, status, workflow_id, task_id, work_item_id);


--
-- Name: idx_exlogs_resource; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_resource ON ONLY public.execution_logs USING btree (tenant_id, resource_type, resource_id, created_at DESC) INCLUDE (category, status) WHERE (resource_id IS NOT NULL);


--
-- Name: idx_exlogs_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_role ON ONLY public.execution_logs USING btree (tenant_id, role, created_at) WHERE (role IS NOT NULL);


--
-- Name: idx_exlogs_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_search ON ONLY public.execution_logs USING gin (to_tsvector('english'::regconfig, ((operation || ' '::text) || COALESCE((payload)::text, ''::text))));


--
-- Name: idx_exlogs_search_document; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_search_document ON ONLY public.execution_logs USING gin (to_tsvector('simple'::regconfig, ((((((((((((((((((((((((((((((((((((((((((((((((COALESCE(operation, ''::text) || ' '::text) || COALESCE((task_id)::text, ''::text)) || ' '::text) || COALESCE((work_item_id)::text, ''::text)) || ' '::text) || COALESCE((activation_id)::text, ''::text)) || ' '::text) || COALESCE((workflow_id)::text, ''::text)) || ' '::text) || COALESCE((workspace_id)::text, ''::text)) || ' '::text) || COALESCE(stage_name, ''::text)) || ' '::text) || COALESCE((trace_id)::text, ''::text)) || ' '::text) || COALESCE((span_id)::text, ''::text)) || ' '::text) || COALESCE(workflow_name, ''::text)) || ' '::text) || COALESCE(workspace_name, ''::text)) || ' '::text) || COALESCE(task_title, ''::text)) || ' '::text) || COALESCE(role, ''::text)) || ' '::text) || COALESCE(actor_type, ''::text)) || ' '::text) || COALESCE(actor_id, ''::text)) || ' '::text) || COALESCE(actor_name, ''::text)) || ' '::text) || COALESCE(resource_type, ''::text)) || ' '::text) || COALESCE(resource_name, ''::text)) || ' '::text) || COALESCE((error ->> 'message'::text), ''::text)) || ' '::text) || COALESCE((payload ->> 'system_prompt'::text), ''::text)) || ' '::text) || COALESCE((payload ->> 'prompt_summary'::text), ''::text)) || ' '::text) || COALESCE((payload ->> 'response_summary'::text), ''::text)) || ' '::text) || COALESCE((payload ->> 'response_text'::text), ''::text)) || ' '::text) || COALESCE((payload ->> 'tool_name'::text), ''::text)) || ' '::text) || COALESCE((payload)::text, ''::text))));


--
-- Name: idx_exlogs_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_source ON ONLY public.execution_logs USING btree (tenant_id, source, created_at DESC) INCLUDE (category, level, status, duration_ms, workflow_id, task_id);


--
-- Name: idx_exlogs_span; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_span ON ONLY public.execution_logs USING btree (parent_span_id, created_at) INCLUDE (span_id, source, category, status, duration_ms) WHERE (parent_span_id IS NOT NULL);


--
-- Name: idx_exlogs_stage_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_stage_name ON ONLY public.execution_logs USING btree (tenant_id, stage_name, created_at DESC) INCLUDE (source, category, level, status, workflow_id, task_id, work_item_id) WHERE (stage_name IS NOT NULL);


--
-- Name: idx_exlogs_stats; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_stats ON ONLY public.execution_logs USING btree (tenant_id, category, created_at DESC) INCLUDE (duration_ms) WHERE (status = ANY (ARRAY['completed'::public.execution_log_status, 'failed'::public.execution_log_status]));


--
-- Name: idx_exlogs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_status ON ONLY public.execution_logs USING btree (tenant_id, status, created_at DESC) INCLUDE (source, category, level, workflow_id, task_id) WHERE (status = ANY (ARRAY['failed'::public.execution_log_status, 'started'::public.execution_log_status]));


--
-- Name: idx_exlogs_status_full; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_status_full ON ONLY public.execution_logs USING btree (tenant_id, status, created_at DESC) INCLUDE (source, category, level, workflow_id, task_id);


--
-- Name: idx_exlogs_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_task ON ONLY public.execution_logs USING btree (task_id, created_at) INCLUDE (source, category, level, status, duration_ms) WHERE (task_id IS NOT NULL);


--
-- Name: idx_exlogs_task_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_task_category ON ONLY public.execution_logs USING btree (task_id, category, created_at) INCLUDE (source, level, status, duration_ms) WHERE (task_id IS NOT NULL);


--
-- Name: idx_exlogs_task_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_task_level ON ONLY public.execution_logs USING btree (task_id, level, created_at) INCLUDE (source, category, status, duration_ms) WHERE (task_id IS NOT NULL);


--
-- Name: idx_exlogs_tenant_actor_kind_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_tenant_actor_kind_time ON ONLY public.execution_logs USING btree (tenant_id, (
CASE
    WHEN ((actor_type = ANY (ARRAY['worker'::text, 'agent'::text])) AND ((lower(COALESCE(role, ''::text)) = 'orchestrator'::text) OR (COALESCE(is_orchestrator_task, false) = true))) THEN 'orchestrator_agent'::text
    WHEN (actor_type = 'worker'::text) THEN 'specialist_agent'::text
    WHEN (actor_type = 'agent'::text) THEN 'specialist_task_execution'::text
    WHEN (actor_type = ANY (ARRAY['operator'::text, 'user'::text, 'api_key'::text, 'admin'::text, 'service'::text])) THEN 'operator'::text
    WHEN (actor_type = 'system'::text) THEN 'platform_system'::text
    ELSE COALESCE(actor_type, 'platform_system'::text)
END), created_at DESC);


--
-- Name: idx_exlogs_tenant_task_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_tenant_task_time ON ONLY public.execution_logs USING btree (tenant_id, task_id, created_at DESC) WHERE (task_id IS NOT NULL);


--
-- Name: idx_exlogs_tenant_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_tenant_time ON ONLY public.execution_logs USING btree (tenant_id, created_at DESC) INCLUDE (source, category, level, status, duration_ms, workflow_id, task_id);


--
-- Name: idx_exlogs_tenant_trace_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_tenant_trace_time ON ONLY public.execution_logs USING btree (tenant_id, trace_id, created_at DESC);


--
-- Name: idx_exlogs_tenant_workflow_actor_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_tenant_workflow_actor_time ON ONLY public.execution_logs USING btree (tenant_id, workflow_id, actor_type, role, created_at DESC) WHERE ((workflow_id IS NOT NULL) AND (actor_type IS NOT NULL));


--
-- Name: idx_exlogs_tenant_workflow_operation_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_tenant_workflow_operation_time ON ONLY public.execution_logs USING btree (tenant_id, workflow_id, operation, created_at DESC) WHERE (workflow_id IS NOT NULL);


--
-- Name: idx_exlogs_tenant_workflow_role_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_tenant_workflow_role_time ON ONLY public.execution_logs USING btree (tenant_id, workflow_id, role, created_at DESC) WHERE ((workflow_id IS NOT NULL) AND (role IS NOT NULL));


--
-- Name: idx_exlogs_tenant_workflow_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_tenant_workflow_time ON ONLY public.execution_logs USING btree (tenant_id, workflow_id, created_at DESC) WHERE (workflow_id IS NOT NULL);


--
-- Name: idx_exlogs_tenant_workspace_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_tenant_workspace_time ON ONLY public.execution_logs USING btree (tenant_id, workspace_id, created_at DESC) WHERE (workspace_id IS NOT NULL);


--
-- Name: idx_exlogs_tool_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_tool_name ON ONLY public.execution_logs USING btree (((payload ->> 'tool_name'::text)), created_at DESC) WHERE (category = 'tool'::public.execution_log_category);


--
-- Name: idx_exlogs_tool_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_tool_owner ON ONLY public.execution_logs USING btree (tenant_id, tool_owner, created_at);


--
-- Name: idx_exlogs_trace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_trace ON ONLY public.execution_logs USING btree (trace_id, created_at) INCLUDE (span_id, parent_span_id, source, category, status, duration_ms);


--
-- Name: idx_exlogs_wf_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_wf_category ON ONLY public.execution_logs USING btree (workflow_id, category, created_at) INCLUDE (source, level, status, duration_ms, task_id) WHERE (workflow_id IS NOT NULL);


--
-- Name: idx_exlogs_wf_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_wf_level ON ONLY public.execution_logs USING btree (workflow_id, level, created_at) INCLUDE (source, category, status, duration_ms, task_id) WHERE (workflow_id IS NOT NULL);


--
-- Name: idx_exlogs_work_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_work_item ON ONLY public.execution_logs USING btree (tenant_id, work_item_id, created_at DESC) INCLUDE (source, category, level, status, duration_ms, workflow_id, task_id) WHERE (work_item_id IS NOT NULL);


--
-- Name: idx_exlogs_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_workflow ON ONLY public.execution_logs USING btree (workflow_id, created_at) INCLUDE (source, category, level, status, duration_ms, task_id) WHERE (workflow_id IS NOT NULL);


--
-- Name: idx_exlogs_workflow_name_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_workflow_name_time ON ONLY public.execution_logs USING btree (tenant_id, workflow_name, created_at DESC) WHERE (workflow_name IS NOT NULL);


--
-- Name: idx_exlogs_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_workspace ON ONLY public.execution_logs USING btree (workspace_id, created_at DESC) INCLUDE (source, category, level, status, workflow_id, task_id) WHERE (workspace_id IS NOT NULL);


--
-- Name: idx_exlogs_workspace_name_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exlogs_workspace_name_time ON ONLY public.execution_logs USING btree (tenant_id, workspace_name, created_at DESC) WHERE (workspace_name IS NOT NULL);


--
-- Name: idx_fleet_events_playbook; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fleet_events_playbook ON public.fleet_events USING btree (playbook_id, created_at DESC);


--
-- Name: idx_fleet_events_runtime; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fleet_events_runtime ON public.fleet_events USING btree (runtime_id, created_at DESC);


--
-- Name: idx_fleet_events_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fleet_events_task ON public.fleet_events USING btree (task_id, created_at) WHERE (task_id IS NOT NULL);


--
-- Name: idx_fleet_events_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fleet_events_tenant_created ON public.fleet_events USING btree (tenant_id, created_at DESC);


--
-- Name: idx_fleet_events_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fleet_events_type ON public.fleet_events USING btree (event_type);


--
-- Name: idx_fleet_events_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fleet_events_workflow ON public.fleet_events USING btree (workflow_id, created_at) WHERE (workflow_id IS NOT NULL);


--
-- Name: idx_integration_actions_adapter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_integration_actions_adapter ON public.integration_actions USING btree (tenant_id, adapter_id);


--
-- Name: idx_integration_actions_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_integration_actions_lookup ON public.integration_actions USING btree (token_hash, expires_at);


--
-- Name: idx_integration_actions_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_integration_actions_task ON public.integration_actions USING btree (tenant_id, task_id, action_type, created_at DESC);


--
-- Name: idx_integration_adapter_deliveries_adapter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_integration_adapter_deliveries_adapter ON public.integration_adapter_deliveries USING btree (adapter_id);


--
-- Name: idx_integration_adapter_deliveries_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_integration_adapter_deliveries_event ON public.integration_adapter_deliveries USING btree (event_id);


--
-- Name: idx_integration_adapter_deliveries_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_integration_adapter_deliveries_pending ON public.integration_adapter_deliveries USING btree (tenant_id, status, created_at DESC);


--
-- Name: idx_integration_adapters_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_integration_adapters_tenant ON public.integration_adapters USING btree (tenant_id, is_active);


--
-- Name: idx_integration_adapters_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_integration_adapters_workflow ON public.integration_adapters USING btree (tenant_id, workflow_id);


--
-- Name: idx_integration_resource_links_external; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_integration_resource_links_external ON public.integration_resource_links USING btree (tenant_id, adapter_id, external_id);


--
-- Name: idx_integration_resource_links_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_integration_resource_links_unique ON public.integration_resource_links USING btree (tenant_id, adapter_id, entity_type, entity_id);


--
-- Name: idx_live_container_inventory_execution_backend; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_live_container_inventory_execution_backend ON public.live_container_inventory USING btree (tenant_id, execution_backend, last_seen_at);


--
-- Name: idx_live_container_inventory_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_live_container_inventory_kind ON public.live_container_inventory USING btree (tenant_id, kind, last_seen_at);


--
-- Name: idx_live_container_inventory_runtime; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_live_container_inventory_runtime ON public.live_container_inventory USING btree (tenant_id, runtime_id);


--
-- Name: idx_live_container_inventory_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_live_container_inventory_task ON public.live_container_inventory USING btree (tenant_id, task_id);


--
-- Name: idx_live_container_inventory_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_live_container_inventory_tenant ON public.live_container_inventory USING btree (tenant_id, last_seen_at);


--
-- Name: idx_llm_models_model_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_llm_models_model_id ON public.llm_models USING btree (tenant_id, model_id);


--
-- Name: idx_llm_models_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_llm_models_provider ON public.llm_models USING btree (provider_id);


--
-- Name: idx_llm_models_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_llm_models_tenant ON public.llm_models USING btree (tenant_id);


--
-- Name: idx_llm_providers_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_llm_providers_tenant ON public.llm_providers USING btree (tenant_id);


--
-- Name: idx_metering_events_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_metering_events_created ON public.metering_events USING btree (created_at);


--
-- Name: idx_metering_events_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_metering_events_task ON public.metering_events USING btree (task_id);


--
-- Name: idx_metering_events_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_metering_events_tenant ON public.metering_events USING btree (tenant_id);


--
-- Name: idx_metering_events_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_metering_events_workflow ON public.metering_events USING btree (workflow_id);


--
-- Name: idx_oauth_states_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oauth_states_state ON public.oauth_states USING btree (state);


--
-- Name: idx_orchestrator_grants_agent_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_orchestrator_grants_agent_workflow ON public.orchestrator_grants USING btree (agent_id, workflow_id) WHERE (revoked_at IS NULL);


--
-- Name: idx_orchestrator_grants_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orchestrator_grants_tenant ON public.orchestrator_grants USING btree (tenant_id);


--
-- Name: idx_orchestrator_task_messages_orchestrator_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orchestrator_task_messages_orchestrator_task ON public.orchestrator_task_messages USING btree (tenant_id, orchestrator_task_id);


--
-- Name: idx_orchestrator_task_messages_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orchestrator_task_messages_pending ON public.orchestrator_task_messages USING btree (tenant_id, workflow_id, delivery_state) WHERE (delivery_state = ANY (ARRAY['pending_delivery'::text, 'delivery_in_progress'::text]));


--
-- Name: idx_orchestrator_task_messages_request; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_orchestrator_task_messages_request ON public.orchestrator_task_messages USING btree (tenant_id, workflow_id, request_id);


--
-- Name: idx_orchestrator_task_messages_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orchestrator_task_messages_task ON public.orchestrator_task_messages USING btree (tenant_id, task_id);


--
-- Name: idx_orchestrator_task_messages_worker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orchestrator_task_messages_worker ON public.orchestrator_task_messages USING btree (tenant_id, worker_id) WHERE (worker_id IS NOT NULL);


--
-- Name: idx_platform_instruction_versions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_platform_instruction_versions_tenant ON public.platform_instruction_versions USING btree (tenant_id, version DESC);


--
-- Name: idx_playbooks_tenant_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_playbooks_tenant_active ON public.playbooks USING btree (tenant_id, is_active, created_at DESC);


--
-- Name: idx_playbooks_tenant_active_runtime; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_playbooks_tenant_active_runtime ON public.playbooks USING btree (tenant_id) WHERE ((is_active = true) AND (definition ? 'runtime'::text));


--
-- Name: idx_refresh_token_sessions_tenant_api_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refresh_token_sessions_tenant_api_key ON public.refresh_token_sessions USING btree (tenant_id, api_key_id);


--
-- Name: idx_refresh_token_sessions_tenant_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refresh_token_sessions_tenant_token ON public.refresh_token_sessions USING btree (tenant_id, token_id);


--
-- Name: idx_remote_mcp_oauth_client_profiles_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_remote_mcp_oauth_client_profiles_tenant ON public.remote_mcp_oauth_client_profiles USING btree (tenant_id);


--
-- Name: idx_remote_mcp_registration_drafts_tenant_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_remote_mcp_registration_drafts_tenant_user ON public.remote_mcp_registration_drafts USING btree (tenant_id, user_id);


--
-- Name: idx_remote_mcp_server_parameters_server; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_remote_mcp_server_parameters_server ON public.remote_mcp_server_parameters USING btree (remote_mcp_server_id, placement, key);


--
-- Name: idx_remote_mcp_servers_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_remote_mcp_servers_tenant ON public.remote_mcp_servers USING btree (tenant_id, is_archived, verification_status);


--
-- Name: idx_role_definitions_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_definitions_active ON public.role_definitions USING btree (tenant_id, is_active);


--
-- Name: idx_role_definitions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_definitions_tenant ON public.role_definitions USING btree (tenant_id);


--
-- Name: idx_role_model_assignments_model; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_model_assignments_model ON public.role_model_assignments USING btree (primary_model_id) WHERE (primary_model_id IS NOT NULL);


--
-- Name: idx_role_model_assignments_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_model_assignments_role ON public.role_model_assignments USING btree (tenant_id, role_name);


--
-- Name: idx_role_model_assignments_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_model_assignments_tenant ON public.role_model_assignments USING btree (tenant_id);


--
-- Name: idx_runtime_defaults_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_runtime_defaults_tenant ON public.runtime_defaults USING btree (tenant_id);


--
-- Name: idx_runtime_heartbeats_playbook; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_runtime_heartbeats_playbook ON public.runtime_heartbeats USING btree (playbook_id);


--
-- Name: idx_runtime_heartbeats_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_runtime_heartbeats_state ON public.runtime_heartbeats USING btree (state);


--
-- Name: idx_runtime_heartbeats_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_runtime_heartbeats_tenant ON public.runtime_heartbeats USING btree (tenant_id);


--
-- Name: idx_runtime_heartbeats_tenant_pool; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_runtime_heartbeats_tenant_pool ON public.runtime_heartbeats USING btree (tenant_id, pool_kind);


--
-- Name: idx_scheduled_work_item_trigger_invocations_tenant_trigger; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scheduled_work_item_trigger_invocations_tenant_trigger ON public.scheduled_work_item_trigger_invocations USING btree (tenant_id, trigger_id, created_at DESC);


--
-- Name: idx_scheduled_work_item_trigger_invocations_work_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scheduled_work_item_trigger_invocations_work_item ON public.scheduled_work_item_trigger_invocations USING btree (work_item_id) WHERE (work_item_id IS NOT NULL);


--
-- Name: idx_scheduled_work_item_triggers_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scheduled_work_item_triggers_due ON public.scheduled_work_item_triggers USING btree (tenant_id, is_active, next_fire_at);


--
-- Name: idx_scheduled_work_item_triggers_lease; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scheduled_work_item_triggers_lease ON public.scheduled_work_item_triggers USING btree (tenant_id, lease_expires_at);


--
-- Name: idx_scheduled_work_item_triggers_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scheduled_work_item_triggers_workflow ON public.scheduled_work_item_triggers USING btree (workflow_id);


--
-- Name: idx_scheduled_work_item_triggers_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scheduled_work_item_triggers_workspace ON public.scheduled_work_item_triggers USING btree (workspace_id);


--
-- Name: idx_specialist_mcp_server_grants_server; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_specialist_mcp_server_grants_server ON public.specialist_mcp_server_grants USING btree (remote_mcp_server_id);


--
-- Name: idx_specialist_skill_assignments_skill; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_specialist_skill_assignments_skill ON public.specialist_skill_assignments USING btree (skill_id);


--
-- Name: idx_specialist_skills_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_specialist_skills_tenant ON public.specialist_skills USING btree (tenant_id, is_archived);


--
-- Name: idx_task_handoffs_request_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_task_handoffs_request_id ON public.task_handoffs USING btree (tenant_id, workflow_id, request_id) WHERE (request_id IS NOT NULL);


--
-- Name: idx_task_handoffs_task_attempt; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_task_handoffs_task_attempt ON public.task_handoffs USING btree (task_id, task_rework_count);


--
-- Name: idx_task_handoffs_work_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_handoffs_work_item ON public.task_handoffs USING btree (tenant_id, work_item_id, sequence);


--
-- Name: idx_task_handoffs_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_handoffs_workflow ON public.task_handoffs USING btree (tenant_id, workflow_id, created_at);


--
-- Name: idx_task_tool_results_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_tool_results_task ON public.task_tool_results USING btree (tenant_id, task_id, created_at DESC);


--
-- Name: idx_tasks_activation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_activation ON public.tasks USING btree (tenant_id, activation_id);


--
-- Name: idx_tasks_active_timeout; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_active_timeout ON public.tasks USING btree (state, started_at, claimed_at) WHERE (state = ANY (ARRAY['claimed'::public.task_state, 'in_progress'::public.task_state]));


--
-- Name: idx_tasks_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_agent ON public.tasks USING btree (assigned_agent_id) WHERE (assigned_agent_id IS NOT NULL);


--
-- Name: idx_tasks_assigned_worker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_assigned_worker ON public.tasks USING btree (assigned_worker_id) WHERE (assigned_worker_id IS NOT NULL);


--
-- Name: idx_tasks_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_branch ON public.tasks USING btree (tenant_id, workflow_id, branch_id) WHERE (branch_id IS NOT NULL);


--
-- Name: idx_tasks_cancel_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_cancel_pending ON public.tasks USING btree (state, ((metadata ->> 'workflow_cancel_force_at'::text))) WHERE ((state = ANY (ARRAY['claimed'::public.task_state, 'in_progress'::public.task_state])) AND ((metadata ->> 'workflow_cancel_force_at'::text) IS NOT NULL));


--
-- Name: idx_tasks_claimable; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_claimable ON public.tasks USING btree (tenant_id, priority DESC, created_at) WHERE (state = 'ready'::public.task_state);


--
-- Name: idx_tasks_completed_archive; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_completed_archive ON public.tasks USING btree (tenant_id, completed_at) WHERE ((completed_at IS NOT NULL) AND (archived_at IS NULL));


--
-- Name: idx_tasks_depends_on; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_depends_on ON public.tasks USING gin (depends_on);


--
-- Name: idx_tasks_execution_backend; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_execution_backend ON public.tasks USING btree (tenant_id, execution_backend);


--
-- Name: idx_tasks_execution_environment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_execution_environment ON public.tasks USING btree (tenant_id, execution_environment_id);


--
-- Name: idx_tasks_execution_environment_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_execution_environment_search ON public.tasks USING gin (lower(((((((((COALESCE((execution_environment_snapshot ->> 'name'::text), ''::text) || ' '::text) || COALESCE((execution_environment_snapshot ->> 'image'::text), ''::text)) || ' '::text) || COALESCE((execution_environment_snapshot ->> 'resolved_image'::text), ''::text)) || ' '::text) || COALESCE(((execution_environment_snapshot -> 'verified_metadata'::text) ->> 'distro'::text), ''::text)) || ' '::text) || COALESCE(((execution_environment_snapshot -> 'verified_metadata'::text) ->> 'package_manager'::text), ''::text))) public.gin_trgm_ops) WHERE (execution_environment_snapshot IS NOT NULL);


--
-- Name: idx_tasks_metadata_escalation_task_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_metadata_escalation_task_id ON public.tasks USING btree (tenant_id, ((metadata ->> 'escalation_task_id'::text))) WHERE ((metadata ->> 'escalation_task_id'::text) IS NOT NULL);


--
-- Name: idx_tasks_metadata_parent_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_metadata_parent_id ON public.tasks USING btree (tenant_id, ((metadata ->> 'parent_id'::text))) WHERE ((metadata ->> 'parent_id'::text) IS NOT NULL);


--
-- Name: idx_tasks_ready_workflow_orchestrator; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_ready_workflow_orchestrator ON public.tasks USING btree (tenant_id, workflow_id) WHERE ((state = 'ready'::public.task_state) AND (is_orchestrator_task = true));


--
-- Name: idx_tasks_ready_workflow_specialist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_ready_workflow_specialist ON public.tasks USING btree (tenant_id, workflow_id) WHERE ((state = 'ready'::public.task_state) AND (COALESCE(is_orchestrator_task, false) = false));


--
-- Name: idx_tasks_request_id_no_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_tasks_request_id_no_workflow ON public.tasks USING btree (tenant_id, request_id) WHERE ((request_id IS NOT NULL) AND (workflow_id IS NULL));


--
-- Name: idx_tasks_request_id_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_tasks_request_id_workflow ON public.tasks USING btree (tenant_id, workflow_id, request_id) WHERE ((request_id IS NOT NULL) AND (workflow_id IS NOT NULL));


--
-- Name: idx_tasks_running_timeout; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_running_timeout ON public.tasks USING btree (started_at) WHERE (state = 'in_progress'::public.task_state);


--
-- Name: idx_tasks_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_stage ON public.tasks USING btree (tenant_id, workflow_id, stage_name);


--
-- Name: idx_tasks_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_state ON public.tasks USING btree (tenant_id, state);


--
-- Name: idx_tasks_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_tenant ON public.tasks USING btree (tenant_id);


--
-- Name: idx_tasks_work_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_work_item ON public.tasks USING btree (tenant_id, work_item_id);


--
-- Name: idx_tasks_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_workflow ON public.tasks USING btree (workflow_id);


--
-- Name: idx_tasks_workflow_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_workflow_state ON public.tasks USING btree (tenant_id, workflow_id, state);


--
-- Name: idx_tasks_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_workspace ON public.tasks USING btree (workspace_id);


--
-- Name: idx_tool_tags_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tool_tags_tenant_created ON public.tool_tags USING btree (tenant_id, created_at DESC);


--
-- Name: idx_user_identities_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_identities_user ON public.user_identities USING btree (user_id);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_tenant ON public.users USING btree (tenant_id);


--
-- Name: idx_webhook_deliveries_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_deliveries_event ON public.webhook_deliveries USING btree (event_id);


--
-- Name: idx_webhook_deliveries_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_deliveries_pending ON public.webhook_deliveries USING btree (tenant_id, status, created_at DESC);


--
-- Name: idx_webhook_deliveries_webhook; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_deliveries_webhook ON public.webhook_deliveries USING btree (webhook_id);


--
-- Name: idx_webhook_work_item_trigger_invocations_tenant_trigger; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_work_item_trigger_invocations_tenant_trigger ON public.webhook_work_item_trigger_invocations USING btree (tenant_id, trigger_id, created_at DESC);


--
-- Name: idx_webhook_work_item_trigger_invocations_work_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_work_item_trigger_invocations_work_item ON public.webhook_work_item_trigger_invocations USING btree (work_item_id) WHERE (work_item_id IS NOT NULL);


--
-- Name: idx_webhook_work_item_triggers_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_work_item_triggers_tenant ON public.webhook_work_item_triggers USING btree (tenant_id, is_active, created_at DESC);


--
-- Name: idx_webhook_work_item_triggers_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_work_item_triggers_workflow ON public.webhook_work_item_triggers USING btree (workflow_id);


--
-- Name: idx_webhook_work_item_triggers_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_work_item_triggers_workspace ON public.webhook_work_item_triggers USING btree (workspace_id);


--
-- Name: idx_webhooks_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhooks_tenant ON public.webhooks USING btree (tenant_id, is_active);


--
-- Name: idx_worker_actual_state_desired_container; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_worker_actual_state_desired_container ON public.worker_actual_state USING btree (desired_state_id, container_id);


--
-- Name: idx_worker_actual_state_desired_last_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_worker_actual_state_desired_last_updated ON public.worker_actual_state USING btree (desired_state_id, last_updated DESC);


--
-- Name: idx_worker_desired_state_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_worker_desired_state_enabled ON public.worker_desired_state USING btree (tenant_id, enabled);


--
-- Name: idx_worker_desired_state_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_worker_desired_state_tenant ON public.worker_desired_state USING btree (tenant_id);


--
-- Name: idx_worker_desired_state_tenant_pool; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_worker_desired_state_tenant_pool ON public.worker_desired_state USING btree (tenant_id, pool_kind);


--
-- Name: idx_worker_signals_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_worker_signals_pending ON public.worker_signals USING btree (worker_id, delivered) WHERE (delivered = false);


--
-- Name: idx_worker_signals_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_worker_signals_task ON public.worker_signals USING btree (task_id) WHERE (task_id IS NOT NULL);


--
-- Name: idx_workers_heartbeat_timeout; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workers_heartbeat_timeout ON public.workers USING btree (status, last_heartbeat_at) WHERE (last_heartbeat_at IS NOT NULL);


--
-- Name: idx_workers_routing_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workers_routing_tags ON public.workers USING gin (routing_tags);


--
-- Name: idx_workers_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workers_status ON public.workers USING btree (tenant_id, status);


--
-- Name: idx_workers_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workers_tenant ON public.workers USING btree (tenant_id);


--
-- Name: idx_workflow_activations_activation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_activations_activation ON public.workflow_activations USING btree (tenant_id, workflow_id, activation_id);


--
-- Name: idx_workflow_activations_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_workflow_activations_active ON public.workflow_activations USING btree (workflow_id) WHERE (state = 'processing'::text);


--
-- Name: idx_workflow_activations_consumed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_activations_consumed ON public.workflow_activations USING btree (tenant_id, workflow_id, consumed_at, queued_at);


--
-- Name: idx_workflow_activations_dispatch_attempt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_activations_dispatch_attempt ON public.workflow_activations USING btree (tenant_id, workflow_id, dispatch_attempt);


--
-- Name: idx_workflow_activations_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_activations_queue ON public.workflow_activations USING btree (tenant_id, workflow_id, state, queued_at);


--
-- Name: idx_workflow_activations_request_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_workflow_activations_request_id ON public.workflow_activations USING btree (tenant_id, workflow_id, request_id) WHERE (request_id IS NOT NULL);


--
-- Name: idx_workflow_artifacts_retention_mode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_artifacts_retention_mode ON public.workflow_artifacts USING btree (tenant_id, workflow_id, ((retention_policy ->> 'mode'::text))) WHERE ((retention_policy ->> 'mode'::text) IS NOT NULL);


--
-- Name: idx_workflow_artifacts_tenant_path; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_artifacts_tenant_path ON public.workflow_artifacts USING btree (tenant_id, logical_path);


--
-- Name: idx_workflow_artifacts_tenant_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_artifacts_tenant_task ON public.workflow_artifacts USING btree (tenant_id, task_id);


--
-- Name: idx_workflow_artifacts_tenant_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_artifacts_tenant_workflow ON public.workflow_artifacts USING btree (tenant_id, workflow_id);


--
-- Name: idx_workflow_artifacts_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_artifacts_workspace ON public.workflow_artifacts USING btree (tenant_id, workspace_id);


--
-- Name: idx_workflow_branches_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_branches_key ON public.workflow_branches USING btree (tenant_id, workflow_id, branch_key);


--
-- Name: idx_workflow_branches_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_branches_parent ON public.workflow_branches USING btree (tenant_id, workflow_id, parent_branch_id) WHERE (parent_branch_id IS NOT NULL);


--
-- Name: idx_workflow_branches_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_branches_status ON public.workflow_branches USING btree (tenant_id, workflow_id, branch_status, created_at);


--
-- Name: idx_workflow_branches_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_branches_workflow ON public.workflow_branches USING btree (tenant_id, workflow_id, created_at);


--
-- Name: idx_workflow_documents_artifact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_documents_artifact ON public.workflow_documents USING btree (artifact_id) WHERE (artifact_id IS NOT NULL);


--
-- Name: idx_workflow_documents_tenant_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_documents_tenant_task ON public.workflow_documents USING btree (tenant_id, task_id);


--
-- Name: idx_workflow_documents_tenant_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_documents_tenant_workflow ON public.workflow_documents USING btree (tenant_id, workflow_id, created_at);


--
-- Name: idx_workflow_documents_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_documents_workspace ON public.workflow_documents USING btree (tenant_id, workspace_id);


--
-- Name: idx_workflow_input_packet_files_packet; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_input_packet_files_packet ON public.workflow_input_packet_files USING btree (tenant_id, packet_id, created_at DESC);


--
-- Name: idx_workflow_input_packet_files_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_input_packet_files_workflow ON public.workflow_input_packet_files USING btree (tenant_id, workflow_id);


--
-- Name: idx_workflow_input_packets_tenant_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_input_packets_tenant_workflow ON public.workflow_input_packets USING btree (tenant_id, workflow_id, created_at DESC);


--
-- Name: idx_workflow_input_packets_work_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_input_packets_work_item ON public.workflow_input_packets USING btree (tenant_id, work_item_id);


--
-- Name: idx_workflow_intervention_files_intervention; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_intervention_files_intervention ON public.workflow_intervention_files USING btree (tenant_id, intervention_id, created_at DESC);


--
-- Name: idx_workflow_intervention_files_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_intervention_files_workflow ON public.workflow_intervention_files USING btree (tenant_id, workflow_id);


--
-- Name: idx_workflow_interventions_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_interventions_task ON public.workflow_interventions USING btree (tenant_id, task_id);


--
-- Name: idx_workflow_interventions_tenant_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_interventions_tenant_workflow ON public.workflow_interventions USING btree (tenant_id, workflow_id, created_at DESC);


--
-- Name: idx_workflow_interventions_work_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_interventions_work_item ON public.workflow_interventions USING btree (tenant_id, work_item_id);


--
-- Name: idx_workflow_operator_briefs_work_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_operator_briefs_work_item ON public.workflow_operator_briefs USING btree (tenant_id, work_item_id);


--
-- Name: idx_workflow_operator_briefs_workflow_sequence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_operator_briefs_workflow_sequence ON public.workflow_operator_briefs USING btree (tenant_id, workflow_id, sequence_number DESC);


--
-- Name: idx_workflow_operator_updates_work_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_operator_updates_work_item ON public.workflow_operator_updates USING btree (tenant_id, work_item_id);


--
-- Name: idx_workflow_operator_updates_workflow_sequence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_operator_updates_workflow_sequence ON public.workflow_operator_updates USING btree (tenant_id, workflow_id, sequence_number DESC);


--
-- Name: idx_workflow_output_descriptors_work_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_output_descriptors_work_item ON public.workflow_output_descriptors USING btree (tenant_id, work_item_id);


--
-- Name: idx_workflow_output_descriptors_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_output_descriptors_workflow ON public.workflow_output_descriptors USING btree (tenant_id, workflow_id, updated_at DESC);


--
-- Name: idx_workflow_stage_gates_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_stage_gates_queue ON public.workflow_stage_gates USING btree (tenant_id, status, requested_at);


--
-- Name: idx_workflow_stage_gates_workflow_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_stage_gates_workflow_stage ON public.workflow_stage_gates USING btree (tenant_id, workflow_id, stage_id, requested_at DESC);


--
-- Name: idx_workflow_stages_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_stages_status ON public.workflow_stages USING btree (tenant_id, status);


--
-- Name: idx_workflow_stages_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_stages_workflow ON public.workflow_stages USING btree (tenant_id, workflow_id, "position");


--
-- Name: idx_workflow_stages_workflow_gate_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_stages_workflow_gate_status ON public.workflow_stages USING btree (tenant_id, workflow_id, gate_status, "position");


--
-- Name: idx_workflow_stages_workflow_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_stages_workflow_status ON public.workflow_stages USING btree (tenant_id, workflow_id, status, "position");


--
-- Name: idx_workflow_steering_messages_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_steering_messages_session ON public.workflow_steering_messages USING btree (tenant_id, steering_session_id, created_at);


--
-- Name: idx_workflow_steering_messages_work_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_steering_messages_work_item ON public.workflow_steering_messages USING btree (tenant_id, workflow_id, work_item_id, created_at) WHERE (work_item_id IS NOT NULL);


--
-- Name: idx_workflow_steering_messages_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_steering_messages_workflow ON public.workflow_steering_messages USING btree (tenant_id, workflow_id);


--
-- Name: idx_workflow_steering_sessions_tenant_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_steering_sessions_tenant_workflow ON public.workflow_steering_sessions USING btree (tenant_id, workflow_id, created_at DESC);


--
-- Name: idx_workflow_steering_sessions_work_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_steering_sessions_work_item ON public.workflow_steering_sessions USING btree (tenant_id, workflow_id, work_item_id) WHERE (work_item_id IS NOT NULL);


--
-- Name: idx_workflow_subject_escalations_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_subject_escalations_status ON public.workflow_subject_escalations USING btree (tenant_id, workflow_id, status, created_at);


--
-- Name: idx_workflow_subject_escalations_work_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_subject_escalations_work_item ON public.workflow_subject_escalations USING btree (tenant_id, workflow_id, work_item_id) WHERE (work_item_id IS NOT NULL);


--
-- Name: idx_workflow_subject_escalations_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_subject_escalations_workflow ON public.workflow_subject_escalations USING btree (tenant_id, workflow_id, created_at);


--
-- Name: idx_workflow_tool_results_mutation_outcome; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_tool_results_mutation_outcome ON public.workflow_tool_results USING btree (tenant_id, workflow_id, mutation_outcome, created_at) WHERE (mutation_outcome IS NOT NULL);


--
-- Name: idx_workflow_tool_results_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_tool_results_workflow ON public.workflow_tool_results USING btree (tenant_id, workflow_id, created_at DESC);


--
-- Name: idx_workflow_work_items_blocked_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_work_items_blocked_state ON public.workflow_work_items USING btree (tenant_id, workflow_id, blocked_state) WHERE (blocked_state IS NOT NULL);


--
-- Name: idx_workflow_work_items_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_work_items_branch ON public.workflow_work_items USING btree (tenant_id, workflow_id, branch_id) WHERE (branch_id IS NOT NULL);


--
-- Name: idx_workflow_work_items_column; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_work_items_column ON public.workflow_work_items USING btree (tenant_id, workflow_id, column_id);


--
-- Name: idx_workflow_work_items_escalation_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_work_items_escalation_status ON public.workflow_work_items USING btree (tenant_id, workflow_id, escalation_status) WHERE (escalation_status IS NOT NULL);


--
-- Name: idx_workflow_work_items_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_work_items_parent ON public.workflow_work_items USING btree (tenant_id, parent_work_item_id) WHERE (parent_work_item_id IS NOT NULL);


--
-- Name: idx_workflow_work_items_request_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_workflow_work_items_request_id ON public.workflow_work_items USING btree (tenant_id, workflow_id, request_id) WHERE (request_id IS NOT NULL);


--
-- Name: idx_workflow_work_items_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_work_items_stage ON public.workflow_work_items USING btree (tenant_id, workflow_id, stage_name);


--
-- Name: idx_workflow_work_items_tenant_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_work_items_tenant_workflow ON public.workflow_work_items USING btree (tenant_id, workflow_id, created_at DESC);


--
-- Name: idx_workflows_attempt_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflows_attempt_group ON public.workflows USING btree (tenant_id, attempt_group_id, attempt_number);


--
-- Name: idx_workflows_attempt_root; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflows_attempt_root ON public.workflows USING btree (tenant_id, root_workflow_id, attempt_number);


--
-- Name: idx_workflows_parent_create_request; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_workflows_parent_create_request ON public.workflows USING btree (tenant_id, ((metadata ->> 'parent_workflow_id'::text)), ((metadata ->> 'create_request_id'::text))) WHERE ((metadata ? 'parent_workflow_id'::text) AND (metadata ? 'create_request_id'::text) AND (NULLIF((metadata ->> 'parent_workflow_id'::text), ''::text) IS NOT NULL) AND (NULLIF((metadata ->> 'create_request_id'::text), ''::text) IS NOT NULL));


--
-- Name: idx_workflows_playbook; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflows_playbook ON public.workflows USING btree (playbook_id);


--
-- Name: idx_workflows_previous_attempt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflows_previous_attempt ON public.workflows USING btree (tenant_id, previous_attempt_workflow_id);


--
-- Name: idx_workflows_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflows_state ON public.workflows USING btree (tenant_id, state);


--
-- Name: idx_workflows_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflows_tenant ON public.workflows USING btree (tenant_id);


--
-- Name: idx_workflows_tenant_playbook_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflows_tenant_playbook_active ON public.workflows USING btree (tenant_id, playbook_id) WHERE (state <> ALL (ARRAY['cancelled'::public.workflow_state, 'failed'::public.workflow_state, 'completed'::public.workflow_state]));


--
-- Name: idx_workflows_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflows_workspace ON public.workflows USING btree (workspace_id);


--
-- Name: idx_workspace_artifact_files_tenant_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workspace_artifact_files_tenant_workspace ON public.workspace_artifact_files USING btree (tenant_id, workspace_id);


--
-- Name: idx_workspace_artifact_files_tenant_workspace_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workspace_artifact_files_tenant_workspace_key ON public.workspace_artifact_files USING btree (tenant_id, workspace_id, key);


--
-- Name: idx_workspace_spec_versions_tenant_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workspace_spec_versions_tenant_workspace ON public.workspace_spec_versions USING btree (tenant_id, workspace_id, version DESC);


--
-- Name: idx_workspaces_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workspaces_tenant ON public.workspaces USING btree (tenant_id);


--
-- Name: uq_catalog_import_links_local_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_catalog_import_links_local_entity ON public.catalog_import_links USING btree (tenant_id, artifact_type, local_entity_id);


--
-- Name: uq_execution_environments_tenant_default; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_execution_environments_tenant_default ON public.execution_environments USING btree (tenant_id) WHERE (is_default = true);


--
-- Name: uq_platform_instruction_versions_tenant_version; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_platform_instruction_versions_tenant_version ON public.platform_instruction_versions USING btree (tenant_id, version);


--
-- Name: uq_remote_mcp_oauth_client_profiles_tenant_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_remote_mcp_oauth_client_profiles_tenant_slug ON public.remote_mcp_oauth_client_profiles USING btree (tenant_id, slug);


--
-- Name: uq_scheduled_work_item_trigger_invocations_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_scheduled_work_item_trigger_invocations_dedupe ON public.scheduled_work_item_trigger_invocations USING btree (trigger_id, scheduled_for);


--
-- Name: uq_webhook_work_item_trigger_invocations_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_webhook_work_item_trigger_invocations_dedupe ON public.webhook_work_item_trigger_invocations USING btree (trigger_id, dedupe_key) WHERE (dedupe_key IS NOT NULL);


--
-- Name: uq_workflow_documents_workflow_logical_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_workflow_documents_workflow_logical_name ON public.workflow_documents USING btree (tenant_id, workflow_id, logical_name);


--
-- Name: uq_workflow_operator_briefs_request; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_workflow_operator_briefs_request ON public.workflow_operator_briefs USING btree (tenant_id, workflow_id, request_id);


--
-- Name: uq_workflow_operator_updates_request; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_workflow_operator_updates_request ON public.workflow_operator_updates USING btree (tenant_id, workflow_id, request_id);


--
-- Name: uq_workflow_stage_gates_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_workflow_stage_gates_active ON public.workflow_stage_gates USING btree (tenant_id, workflow_id, stage_id) WHERE (status = 'awaiting_approval'::text);


--
-- Name: uq_workspace_spec_versions_workspace_version; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_workspace_spec_versions_workspace_version ON public.workspace_spec_versions USING btree (workspace_id, version);


--
-- Name: agents trg_agents_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_agents_updated_at BEFORE UPDATE ON public.agents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: events trg_events_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_events_notify AFTER INSERT ON public.events FOR EACH ROW EXECUTE FUNCTION public.notify_event();


--
-- Name: execution_logs trg_execution_logs_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_execution_logs_notify AFTER INSERT ON public.execution_logs FOR EACH ROW EXECUTE FUNCTION public.notify_execution_log();


--
-- Name: integration_actions trg_integration_actions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_integration_actions_updated_at BEFORE UPDATE ON public.integration_actions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: integration_adapter_deliveries trg_integration_adapter_deliveries_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_integration_adapter_deliveries_updated_at BEFORE UPDATE ON public.integration_adapter_deliveries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: integration_adapters trg_integration_adapters_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_integration_adapters_updated_at BEFORE UPDATE ON public.integration_adapters FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: tasks trg_tasks_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: tenants trg_tenants_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tenants_updated_at BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: webhook_deliveries trg_webhook_deliveries_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_webhook_deliveries_updated_at BEFORE UPDATE ON public.webhook_deliveries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: workers trg_workers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_workers_updated_at BEFORE UPDATE ON public.workers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: workflows trg_workflows_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_workflows_updated_at BEFORE UPDATE ON public.workflows FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: workspaces trg_workspaces_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_workspaces_updated_at BEFORE UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: acp_sessions acp_sessions_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acp_sessions
    ADD CONSTRAINT acp_sessions_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: acp_sessions acp_sessions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acp_sessions
    ADD CONSTRAINT acp_sessions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: acp_sessions acp_sessions_worker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acp_sessions
    ADD CONSTRAINT acp_sessions_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES public.workers(id) ON DELETE SET NULL;


--
-- Name: acp_sessions acp_sessions_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acp_sessions
    ADD CONSTRAINT acp_sessions_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) ON DELETE CASCADE;


--
-- Name: agentic_settings agentic_settings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agentic_settings
    ADD CONSTRAINT agentic_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: agents agents_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: agents agents_worker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES public.workers(id);


--
-- Name: api_keys api_keys_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: audit_logs audit_logs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: catalog_import_batches catalog_import_batches_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_import_batches
    ADD CONSTRAINT catalog_import_batches_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: catalog_import_links catalog_import_links_import_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_import_links
    ADD CONSTRAINT catalog_import_links_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES public.catalog_import_batches(id) ON DELETE CASCADE;


--
-- Name: catalog_import_links catalog_import_links_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_import_links
    ADD CONSTRAINT catalog_import_links_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: circuit_breaker_events circuit_breaker_events_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circuit_breaker_events
    ADD CONSTRAINT circuit_breaker_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: events events_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: execution_container_leases execution_container_leases_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_container_leases
    ADD CONSTRAINT execution_container_leases_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: execution_container_leases execution_container_leases_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_container_leases
    ADD CONSTRAINT execution_container_leases_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: execution_environment_verifications execution_environment_verificatio_execution_environment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_environment_verifications
    ADD CONSTRAINT execution_environment_verificatio_execution_environment_id_fkey FOREIGN KEY (execution_environment_id) REFERENCES public.execution_environments(id) ON DELETE CASCADE;


--
-- Name: execution_environment_verifications execution_environment_verifications_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_environment_verifications
    ADD CONSTRAINT execution_environment_verifications_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: execution_environments execution_environments_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_environments
    ADD CONSTRAINT execution_environments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: execution_environments fk_execution_environments_catalog; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_environments
    ADD CONSTRAINT fk_execution_environments_catalog FOREIGN KEY (catalog_key, catalog_version) REFERENCES public.execution_environment_catalog(catalog_key, catalog_version);


--
-- Name: fleet_events fleet_events_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fleet_events
    ADD CONSTRAINT fleet_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: integration_actions integration_actions_adapter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_actions
    ADD CONSTRAINT integration_actions_adapter_id_fkey FOREIGN KEY (adapter_id) REFERENCES public.integration_adapters(id);


--
-- Name: integration_actions integration_actions_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_actions
    ADD CONSTRAINT integration_actions_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id);


--
-- Name: integration_actions integration_actions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_actions
    ADD CONSTRAINT integration_actions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: integration_adapter_deliveries integration_adapter_deliveries_adapter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_adapter_deliveries
    ADD CONSTRAINT integration_adapter_deliveries_adapter_id_fkey FOREIGN KEY (adapter_id) REFERENCES public.integration_adapters(id);


--
-- Name: integration_adapter_deliveries integration_adapter_deliveries_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_adapter_deliveries
    ADD CONSTRAINT integration_adapter_deliveries_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id);


--
-- Name: integration_adapter_deliveries integration_adapter_deliveries_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_adapter_deliveries
    ADD CONSTRAINT integration_adapter_deliveries_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: integration_adapters integration_adapters_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_adapters
    ADD CONSTRAINT integration_adapters_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: integration_adapters integration_adapters_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_adapters
    ADD CONSTRAINT integration_adapters_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id);


--
-- Name: integration_resource_links integration_resource_links_adapter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_resource_links
    ADD CONSTRAINT integration_resource_links_adapter_id_fkey FOREIGN KEY (adapter_id) REFERENCES public.integration_adapters(id) ON DELETE CASCADE;


--
-- Name: integration_resource_links integration_resource_links_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_resource_links
    ADD CONSTRAINT integration_resource_links_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: live_container_inventory live_container_inventory_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_container_inventory
    ADD CONSTRAINT live_container_inventory_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: llm_models llm_models_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_models
    ADD CONSTRAINT llm_models_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.llm_providers(id);


--
-- Name: llm_models llm_models_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_models
    ADD CONSTRAINT llm_models_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: llm_providers llm_providers_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_providers
    ADD CONSTRAINT llm_providers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: metering_events metering_events_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metering_events
    ADD CONSTRAINT metering_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: oauth_states oauth_states_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_states
    ADD CONSTRAINT oauth_states_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: orchestrator_config orchestrator_config_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orchestrator_config
    ADD CONSTRAINT orchestrator_config_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: orchestrator_grants orchestrator_grants_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orchestrator_grants
    ADD CONSTRAINT orchestrator_grants_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id);


--
-- Name: orchestrator_grants orchestrator_grants_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orchestrator_grants
    ADD CONSTRAINT orchestrator_grants_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: orchestrator_grants orchestrator_grants_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orchestrator_grants
    ADD CONSTRAINT orchestrator_grants_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id);


--
-- Name: orchestrator_task_messages orchestrator_task_messages_activation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orchestrator_task_messages
    ADD CONSTRAINT orchestrator_task_messages_activation_id_fkey FOREIGN KEY (activation_id) REFERENCES public.workflow_activations(id);


--
-- Name: orchestrator_task_messages orchestrator_task_messages_orchestrator_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orchestrator_task_messages
    ADD CONSTRAINT orchestrator_task_messages_orchestrator_task_id_fkey FOREIGN KEY (orchestrator_task_id) REFERENCES public.tasks(id);


--
-- Name: orchestrator_task_messages orchestrator_task_messages_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orchestrator_task_messages
    ADD CONSTRAINT orchestrator_task_messages_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id);


--
-- Name: orchestrator_task_messages orchestrator_task_messages_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orchestrator_task_messages
    ADD CONSTRAINT orchestrator_task_messages_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: orchestrator_task_messages orchestrator_task_messages_worker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orchestrator_task_messages
    ADD CONSTRAINT orchestrator_task_messages_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES public.workers(id);


--
-- Name: orchestrator_task_messages orchestrator_task_messages_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orchestrator_task_messages
    ADD CONSTRAINT orchestrator_task_messages_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id);


--
-- Name: platform_instruction_versions platform_instruction_versions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_instruction_versions
    ADD CONSTRAINT platform_instruction_versions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: platform_instructions platform_instructions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_instructions
    ADD CONSTRAINT platform_instructions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: playbooks playbooks_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playbooks
    ADD CONSTRAINT playbooks_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: refresh_token_sessions refresh_token_sessions_api_key_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_token_sessions
    ADD CONSTRAINT refresh_token_sessions_api_key_id_fkey FOREIGN KEY (api_key_id) REFERENCES public.api_keys(id) ON DELETE CASCADE;


--
-- Name: refresh_token_sessions refresh_token_sessions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_token_sessions
    ADD CONSTRAINT refresh_token_sessions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: remote_mcp_oauth_client_profiles remote_mcp_oauth_client_profiles_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_mcp_oauth_client_profiles
    ADD CONSTRAINT remote_mcp_oauth_client_profiles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: remote_mcp_registration_drafts remote_mcp_registration_drafts_oauth_client_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_mcp_registration_drafts
    ADD CONSTRAINT remote_mcp_registration_drafts_oauth_client_profile_id_fkey FOREIGN KEY (oauth_client_profile_id) REFERENCES public.remote_mcp_oauth_client_profiles(id);


--
-- Name: remote_mcp_registration_drafts remote_mcp_registration_drafts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_mcp_registration_drafts
    ADD CONSTRAINT remote_mcp_registration_drafts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: remote_mcp_server_parameters remote_mcp_server_parameters_remote_mcp_server_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_mcp_server_parameters
    ADD CONSTRAINT remote_mcp_server_parameters_remote_mcp_server_id_fkey FOREIGN KEY (remote_mcp_server_id) REFERENCES public.remote_mcp_servers(id) ON DELETE CASCADE;


--
-- Name: remote_mcp_servers remote_mcp_servers_oauth_client_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_mcp_servers
    ADD CONSTRAINT remote_mcp_servers_oauth_client_profile_id_fkey FOREIGN KEY (oauth_client_profile_id) REFERENCES public.remote_mcp_oauth_client_profiles(id);


--
-- Name: remote_mcp_servers remote_mcp_servers_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_mcp_servers
    ADD CONSTRAINT remote_mcp_servers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: role_definitions role_definitions_execution_environment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_definitions
    ADD CONSTRAINT role_definitions_execution_environment_id_fkey FOREIGN KEY (execution_environment_id) REFERENCES public.execution_environments(id);


--
-- Name: role_definitions role_definitions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_definitions
    ADD CONSTRAINT role_definitions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: role_model_assignments role_model_assignments_primary_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_model_assignments
    ADD CONSTRAINT role_model_assignments_primary_model_id_fkey FOREIGN KEY (primary_model_id) REFERENCES public.llm_models(id);


--
-- Name: role_model_assignments role_model_assignments_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_model_assignments
    ADD CONSTRAINT role_model_assignments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: runtime_defaults runtime_defaults_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_defaults
    ADD CONSTRAINT runtime_defaults_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: runtime_heartbeats runtime_heartbeats_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_heartbeats
    ADD CONSTRAINT runtime_heartbeats_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: scheduled_work_item_trigger_invocations scheduled_work_item_trigger_invocations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_work_item_trigger_invocations
    ADD CONSTRAINT scheduled_work_item_trigger_invocations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: scheduled_work_item_trigger_invocations scheduled_work_item_trigger_invocations_trigger_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_work_item_trigger_invocations
    ADD CONSTRAINT scheduled_work_item_trigger_invocations_trigger_id_fkey FOREIGN KEY (trigger_id) REFERENCES public.scheduled_work_item_triggers(id);


--
-- Name: scheduled_work_item_trigger_invocations scheduled_work_item_trigger_invocations_work_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_work_item_trigger_invocations
    ADD CONSTRAINT scheduled_work_item_trigger_invocations_work_item_id_fkey FOREIGN KEY (work_item_id) REFERENCES public.workflow_work_items(id);


--
-- Name: scheduled_work_item_triggers scheduled_work_item_triggers_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_work_item_triggers
    ADD CONSTRAINT scheduled_work_item_triggers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: scheduled_work_item_triggers scheduled_work_item_triggers_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_work_item_triggers
    ADD CONSTRAINT scheduled_work_item_triggers_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id);


--
-- Name: scheduled_work_item_triggers scheduled_work_item_triggers_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_work_item_triggers
    ADD CONSTRAINT scheduled_work_item_triggers_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: specialist_mcp_server_grants specialist_mcp_server_grants_remote_mcp_server_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.specialist_mcp_server_grants
    ADD CONSTRAINT specialist_mcp_server_grants_remote_mcp_server_id_fkey FOREIGN KEY (remote_mcp_server_id) REFERENCES public.remote_mcp_servers(id) ON DELETE CASCADE;


--
-- Name: specialist_mcp_server_grants specialist_mcp_server_grants_specialist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.specialist_mcp_server_grants
    ADD CONSTRAINT specialist_mcp_server_grants_specialist_id_fkey FOREIGN KEY (specialist_id) REFERENCES public.role_definitions(id) ON DELETE CASCADE;


--
-- Name: specialist_skill_assignments specialist_skill_assignments_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.specialist_skill_assignments
    ADD CONSTRAINT specialist_skill_assignments_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.specialist_skills(id) ON DELETE CASCADE;


--
-- Name: specialist_skill_assignments specialist_skill_assignments_specialist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.specialist_skill_assignments
    ADD CONSTRAINT specialist_skill_assignments_specialist_id_fkey FOREIGN KEY (specialist_id) REFERENCES public.role_definitions(id) ON DELETE CASCADE;


--
-- Name: specialist_skills specialist_skills_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.specialist_skills
    ADD CONSTRAINT specialist_skills_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: task_handoffs task_handoffs_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_handoffs
    ADD CONSTRAINT task_handoffs_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_handoffs task_handoffs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_handoffs
    ADD CONSTRAINT task_handoffs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: task_handoffs task_handoffs_work_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_handoffs
    ADD CONSTRAINT task_handoffs_work_item_id_fkey FOREIGN KEY (work_item_id) REFERENCES public.workflow_work_items(id) ON DELETE CASCADE;


--
-- Name: task_handoffs task_handoffs_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_handoffs
    ADD CONSTRAINT task_handoffs_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) ON DELETE CASCADE;


--
-- Name: task_tool_results task_tool_results_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_tool_results
    ADD CONSTRAINT task_tool_results_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_tool_results task_tool_results_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_tool_results
    ADD CONSTRAINT task_tool_results_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: tasks tasks_activation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_activation_id_fkey FOREIGN KEY (activation_id) REFERENCES public.workflow_activations(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_assigned_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_assigned_agent_id_fkey FOREIGN KEY (assigned_agent_id) REFERENCES public.agents(id);


--
-- Name: tasks tasks_assigned_worker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_assigned_worker_id_fkey FOREIGN KEY (assigned_worker_id) REFERENCES public.workers(id);


--
-- Name: tasks tasks_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.workflow_branches(id);


--
-- Name: tasks tasks_execution_environment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_execution_environment_id_fkey FOREIGN KEY (execution_environment_id) REFERENCES public.execution_environments(id);


--
-- Name: tasks tasks_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: tasks tasks_work_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_work_item_id_fkey FOREIGN KEY (work_item_id) REFERENCES public.workflow_work_items(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id);


--
-- Name: tasks tasks_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: tool_tags tool_tags_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_tags
    ADD CONSTRAINT tool_tags_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: user_identities user_identities_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_identities
    ADD CONSTRAINT user_identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: webhook_deliveries webhook_deliveries_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id);


--
-- Name: webhook_deliveries webhook_deliveries_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: webhook_deliveries webhook_deliveries_webhook_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_webhook_id_fkey FOREIGN KEY (webhook_id) REFERENCES public.webhooks(id);


--
-- Name: webhook_work_item_trigger_invocations webhook_work_item_trigger_invocations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_work_item_trigger_invocations
    ADD CONSTRAINT webhook_work_item_trigger_invocations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: webhook_work_item_trigger_invocations webhook_work_item_trigger_invocations_trigger_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_work_item_trigger_invocations
    ADD CONSTRAINT webhook_work_item_trigger_invocations_trigger_id_fkey FOREIGN KEY (trigger_id) REFERENCES public.webhook_work_item_triggers(id);


--
-- Name: webhook_work_item_trigger_invocations webhook_work_item_trigger_invocations_work_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_work_item_trigger_invocations
    ADD CONSTRAINT webhook_work_item_trigger_invocations_work_item_id_fkey FOREIGN KEY (work_item_id) REFERENCES public.workflow_work_items(id);


--
-- Name: webhook_work_item_triggers webhook_work_item_triggers_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_work_item_triggers
    ADD CONSTRAINT webhook_work_item_triggers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: webhook_work_item_triggers webhook_work_item_triggers_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_work_item_triggers
    ADD CONSTRAINT webhook_work_item_triggers_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id);


--
-- Name: webhook_work_item_triggers webhook_work_item_triggers_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_work_item_triggers
    ADD CONSTRAINT webhook_work_item_triggers_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: webhooks webhooks_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhooks
    ADD CONSTRAINT webhooks_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: worker_actual_state worker_actual_state_desired_state_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_actual_state
    ADD CONSTRAINT worker_actual_state_desired_state_id_fkey FOREIGN KEY (desired_state_id) REFERENCES public.worker_desired_state(id) ON DELETE CASCADE;


--
-- Name: worker_desired_state worker_desired_state_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_desired_state
    ADD CONSTRAINT worker_desired_state_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: worker_signals worker_signals_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_signals
    ADD CONSTRAINT worker_signals_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id);


--
-- Name: worker_signals worker_signals_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_signals
    ADD CONSTRAINT worker_signals_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: worker_signals worker_signals_worker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_signals
    ADD CONSTRAINT worker_signals_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES public.workers(id);


--
-- Name: workers workers_current_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workers
    ADD CONSTRAINT workers_current_task_id_fkey FOREIGN KEY (current_task_id) REFERENCES public.tasks(id);


--
-- Name: workers workers_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workers
    ADD CONSTRAINT workers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: workflow_activations workflow_activations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_activations
    ADD CONSTRAINT workflow_activations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: workflow_activations workflow_activations_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_activations
    ADD CONSTRAINT workflow_activations_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) ON DELETE CASCADE;


--
-- Name: workflow_artifacts workflow_artifacts_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_artifacts
    ADD CONSTRAINT workflow_artifacts_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: workflow_artifacts workflow_artifacts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_artifacts
    ADD CONSTRAINT workflow_artifacts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: workflow_artifacts workflow_artifacts_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_artifacts
    ADD CONSTRAINT workflow_artifacts_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id);


--
-- Name: workflow_artifacts workflow_artifacts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_artifacts
    ADD CONSTRAINT workflow_artifacts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: workflow_branches workflow_branches_created_by_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_branches
    ADD CONSTRAINT workflow_branches_created_by_task_id_fkey FOREIGN KEY (created_by_task_id) REFERENCES public.tasks(id);


--
-- Name: workflow_branches workflow_branches_parent_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_branches
    ADD CONSTRAINT workflow_branches_parent_branch_id_fkey FOREIGN KEY (parent_branch_id) REFERENCES public.workflow_branches(id);


--
-- Name: workflow_branches workflow_branches_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_branches
    ADD CONSTRAINT workflow_branches_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: workflow_branches workflow_branches_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_branches
    ADD CONSTRAINT workflow_branches_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id);


--
-- Name: workflow_documents workflow_documents_artifact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_documents
    ADD CONSTRAINT workflow_documents_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.workflow_artifacts(id);


--
-- Name: workflow_documents workflow_documents_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_documents
    ADD CONSTRAINT workflow_documents_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id);


--
-- Name: workflow_documents workflow_documents_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_documents
    ADD CONSTRAINT workflow_documents_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: workflow_documents workflow_documents_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_documents
    ADD CONSTRAINT workflow_documents_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id);


--
-- Name: workflow_documents workflow_documents_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_documents
    ADD CONSTRAINT workflow_documents_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: workflow_input_packet_files workflow_input_packet_files_packet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_input_packet_files
    ADD CONSTRAINT workflow_input_packet_files_packet_id_fkey FOREIGN KEY (packet_id) REFERENCES public.workflow_input_packets(id) ON DELETE CASCADE;


--
-- Name: workflow_input_packet_files workflow_input_packet_files_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_input_packet_files
    ADD CONSTRAINT workflow_input_packet_files_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: workflow_input_packet_files workflow_input_packet_files_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_input_packet_files
    ADD CONSTRAINT workflow_input_packet_files_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) ON DELETE CASCADE;


--
-- Name: workflow_input_packets workflow_input_packets_source_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_input_packets
    ADD CONSTRAINT workflow_input_packets_source_attempt_id_fkey FOREIGN KEY (source_attempt_id) REFERENCES public.workflows(id) ON DELETE SET NULL;


--
-- Name: workflow_input_packets workflow_input_packets_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_input_packets
    ADD CONSTRAINT workflow_input_packets_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: workflow_input_packets workflow_input_packets_work_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_input_packets
    ADD CONSTRAINT workflow_input_packets_work_item_id_fkey FOREIGN KEY (work_item_id) REFERENCES public.workflow_work_items(id) ON DELETE SET NULL;


--
-- Name: workflow_input_packets workflow_input_packets_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_input_packets
    ADD CONSTRAINT workflow_input_packets_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) ON DELETE CASCADE;


--
-- Name: workflow_intervention_files workflow_intervention_files_intervention_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_intervention_files
    ADD CONSTRAINT workflow_intervention_files_intervention_id_fkey FOREIGN KEY (intervention_id) REFERENCES public.workflow_interventions(id) ON DELETE CASCADE;


--
-- Name: workflow_intervention_files workflow_intervention_files_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_intervention_files
    ADD CONSTRAINT workflow_intervention_files_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: workflow_intervention_files workflow_intervention_files_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_intervention_files
    ADD CONSTRAINT workflow_intervention_files_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) ON DELETE CASCADE;


--
-- Name: workflow_interventions workflow_interventions_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_interventions
    ADD CONSTRAINT workflow_interventions_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;


--
-- Name: workflow_interventions workflow_interventions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_interventions
    ADD CONSTRAINT workflow_interventions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: workflow_interventions workflow_interventions_work_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_interventions
    ADD CONSTRAINT workflow_interventions_work_item_id_fkey FOREIGN KEY (work_item_id) REFERENCES public.workflow_work_items(id) ON DELETE SET NULL;


--
-- Name: workflow_interventions workflow_interventions_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_interventions
    ADD CONSTRAINT workflow_interventions_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) ON DELETE CASCADE;


--
-- Name: workflow_operator_briefs workflow_operator_briefs_canonical_workflow_brief_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_operator_briefs
    ADD CONSTRAINT workflow_operator_briefs_canonical_workflow_brief_id_fkey FOREIGN KEY (canonical_workflow_brief_id) REFERENCES public.workflow_operator_briefs(id) ON DELETE SET NULL;


--
-- Name: workflow_operator_briefs workflow_operator_briefs_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_operator_briefs
    ADD CONSTRAINT workflow_operator_briefs_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;


--
-- Name: workflow_operator_briefs workflow_operator_briefs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_operator_briefs
    ADD CONSTRAINT workflow_operator_briefs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: workflow_operator_briefs workflow_operator_briefs_work_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_operator_briefs
    ADD CONSTRAINT workflow_operator_briefs_work_item_id_fkey FOREIGN KEY (work_item_id) REFERENCES public.workflow_work_items(id) ON DELETE SET NULL;


--
-- Name: workflow_operator_briefs workflow_operator_briefs_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_operator_briefs
    ADD CONSTRAINT workflow_operator_briefs_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) ON DELETE CASCADE;


--
-- Name: workflow_operator_updates workflow_operator_updates_promoted_brief_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_operator_updates
    ADD CONSTRAINT workflow_operator_updates_promoted_brief_id_fkey FOREIGN KEY (promoted_brief_id) REFERENCES public.workflow_operator_briefs(id) ON DELETE SET NULL;


--
-- Name: workflow_operator_updates workflow_operator_updates_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_operator_updates
    ADD CONSTRAINT workflow_operator_updates_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;


--
-- Name: workflow_operator_updates workflow_operator_updates_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_operator_updates
    ADD CONSTRAINT workflow_operator_updates_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: workflow_operator_updates workflow_operator_updates_work_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_operator_updates
    ADD CONSTRAINT workflow_operator_updates_work_item_id_fkey FOREIGN KEY (work_item_id) REFERENCES public.workflow_work_items(id) ON DELETE SET NULL;


--
-- Name: workflow_operator_updates workflow_operator_updates_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_operator_updates
    ADD CONSTRAINT workflow_operator_updates_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) ON DELETE CASCADE;


--
-- Name: workflow_output_descriptors workflow_output_descriptors_source_brief_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_output_descriptors
    ADD CONSTRAINT workflow_output_descriptors_source_brief_id_fkey FOREIGN KEY (source_brief_id) REFERENCES public.workflow_operator_briefs(id) ON DELETE SET NULL;


--
-- Name: workflow_output_descriptors workflow_output_descriptors_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_output_descriptors
    ADD CONSTRAINT workflow_output_descriptors_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: workflow_output_descriptors workflow_output_descriptors_work_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_output_descriptors
    ADD CONSTRAINT workflow_output_descriptors_work_item_id_fkey FOREIGN KEY (work_item_id) REFERENCES public.workflow_work_items(id) ON DELETE SET NULL;


--
-- Name: workflow_output_descriptors workflow_output_descriptors_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_output_descriptors
    ADD CONSTRAINT workflow_output_descriptors_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) ON DELETE CASCADE;


--
-- Name: workflow_stage_gates workflow_stage_gates_requested_by_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_stage_gates
    ADD CONSTRAINT workflow_stage_gates_requested_by_task_id_fkey FOREIGN KEY (requested_by_task_id) REFERENCES public.tasks(id);


--
-- Name: workflow_stage_gates workflow_stage_gates_resolved_by_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_stage_gates
    ADD CONSTRAINT workflow_stage_gates_resolved_by_task_id_fkey FOREIGN KEY (resolved_by_task_id) REFERENCES public.tasks(id);


--
-- Name: workflow_stage_gates workflow_stage_gates_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_stage_gates
    ADD CONSTRAINT workflow_stage_gates_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES public.workflow_stages(id);


--
-- Name: workflow_stage_gates workflow_stage_gates_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_stage_gates
    ADD CONSTRAINT workflow_stage_gates_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: workflow_stage_gates workflow_stage_gates_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_stage_gates
    ADD CONSTRAINT workflow_stage_gates_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id);


--
-- Name: workflow_stages workflow_stages_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_stages
    ADD CONSTRAINT workflow_stages_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: workflow_stages workflow_stages_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_stages
    ADD CONSTRAINT workflow_stages_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) ON DELETE CASCADE;


--
-- Name: workflow_steering_messages workflow_steering_messages_linked_input_packet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_steering_messages
    ADD CONSTRAINT workflow_steering_messages_linked_input_packet_id_fkey FOREIGN KEY (linked_input_packet_id) REFERENCES public.workflow_input_packets(id) ON DELETE SET NULL;


--
-- Name: workflow_steering_messages workflow_steering_messages_linked_intervention_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_steering_messages
    ADD CONSTRAINT workflow_steering_messages_linked_intervention_id_fkey FOREIGN KEY (linked_intervention_id) REFERENCES public.workflow_interventions(id) ON DELETE SET NULL;


--
-- Name: workflow_steering_messages workflow_steering_messages_linked_operator_update_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_steering_messages
    ADD CONSTRAINT workflow_steering_messages_linked_operator_update_id_fkey FOREIGN KEY (linked_operator_update_id) REFERENCES public.workflow_operator_updates(id) ON DELETE SET NULL;


--
-- Name: workflow_steering_messages workflow_steering_messages_steering_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_steering_messages
    ADD CONSTRAINT workflow_steering_messages_steering_session_id_fkey FOREIGN KEY (steering_session_id) REFERENCES public.workflow_steering_sessions(id) ON DELETE CASCADE;


--
-- Name: workflow_steering_messages workflow_steering_messages_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_steering_messages
    ADD CONSTRAINT workflow_steering_messages_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: workflow_steering_messages workflow_steering_messages_work_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_steering_messages
    ADD CONSTRAINT workflow_steering_messages_work_item_id_fkey FOREIGN KEY (work_item_id) REFERENCES public.workflow_work_items(id) ON DELETE SET NULL;


--
-- Name: workflow_steering_messages workflow_steering_messages_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_steering_messages
    ADD CONSTRAINT workflow_steering_messages_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) ON DELETE CASCADE;


--
-- Name: workflow_steering_sessions workflow_steering_sessions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_steering_sessions
    ADD CONSTRAINT workflow_steering_sessions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: workflow_steering_sessions workflow_steering_sessions_work_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_steering_sessions
    ADD CONSTRAINT workflow_steering_sessions_work_item_id_fkey FOREIGN KEY (work_item_id) REFERENCES public.workflow_work_items(id) ON DELETE SET NULL;


--
-- Name: workflow_steering_sessions workflow_steering_sessions_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_steering_sessions
    ADD CONSTRAINT workflow_steering_sessions_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) ON DELETE CASCADE;


--
-- Name: workflow_subject_escalations workflow_subject_escalations_created_by_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_subject_escalations
    ADD CONSTRAINT workflow_subject_escalations_created_by_task_id_fkey FOREIGN KEY (created_by_task_id) REFERENCES public.tasks(id);


--
-- Name: workflow_subject_escalations workflow_subject_escalations_resolved_by_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_subject_escalations
    ADD CONSTRAINT workflow_subject_escalations_resolved_by_task_id_fkey FOREIGN KEY (resolved_by_task_id) REFERENCES public.tasks(id);


--
-- Name: workflow_subject_escalations workflow_subject_escalations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_subject_escalations
    ADD CONSTRAINT workflow_subject_escalations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: workflow_subject_escalations workflow_subject_escalations_work_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_subject_escalations
    ADD CONSTRAINT workflow_subject_escalations_work_item_id_fkey FOREIGN KEY (work_item_id) REFERENCES public.workflow_work_items(id);


--
-- Name: workflow_subject_escalations workflow_subject_escalations_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_subject_escalations
    ADD CONSTRAINT workflow_subject_escalations_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id);


--
-- Name: workflow_tool_results workflow_tool_results_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_tool_results
    ADD CONSTRAINT workflow_tool_results_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: workflow_tool_results workflow_tool_results_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_tool_results
    ADD CONSTRAINT workflow_tool_results_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) ON DELETE CASCADE;


--
-- Name: workflow_work_items workflow_work_items_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_work_items
    ADD CONSTRAINT workflow_work_items_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.workflow_branches(id);


--
-- Name: workflow_work_items workflow_work_items_parent_work_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_work_items
    ADD CONSTRAINT workflow_work_items_parent_work_item_id_fkey FOREIGN KEY (parent_work_item_id) REFERENCES public.workflow_work_items(id) ON DELETE CASCADE;


--
-- Name: workflow_work_items workflow_work_items_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_work_items
    ADD CONSTRAINT workflow_work_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: workflow_work_items workflow_work_items_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_work_items
    ADD CONSTRAINT workflow_work_items_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) ON DELETE CASCADE;


--
-- Name: workflows workflows_playbook_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflows
    ADD CONSTRAINT workflows_playbook_id_fkey FOREIGN KEY (playbook_id) REFERENCES public.playbooks(id);


--
-- Name: workflows workflows_previous_attempt_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflows
    ADD CONSTRAINT workflows_previous_attempt_workflow_id_fkey FOREIGN KEY (previous_attempt_workflow_id) REFERENCES public.workflows(id);


--
-- Name: workflows workflows_root_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflows
    ADD CONSTRAINT workflows_root_workflow_id_fkey FOREIGN KEY (root_workflow_id) REFERENCES public.workflows(id);


--
-- Name: workflows workflows_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflows
    ADD CONSTRAINT workflows_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: workflows workflows_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflows
    ADD CONSTRAINT workflows_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: workspace_artifact_files workspace_artifact_files_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_artifact_files
    ADD CONSTRAINT workspace_artifact_files_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: workspace_artifact_files workspace_artifact_files_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_artifact_files
    ADD CONSTRAINT workspace_artifact_files_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_spec_versions workspace_spec_versions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_spec_versions
    ADD CONSTRAINT workspace_spec_versions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: workspace_spec_versions workspace_spec_versions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_spec_versions
    ADD CONSTRAINT workspace_spec_versions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: workspaces workspaces_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
