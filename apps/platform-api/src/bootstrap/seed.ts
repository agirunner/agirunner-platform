/**
 * Configuration seeding — idempotent first-run setup.
 *
 * Seeds global platform bootstrap state only.
 *
 * Runtime defaults, prompts, orchestrator worker state, and the admin user are
 * platform bootstrap. Role definitions and playbooks are workflow content and
 * MUST be created explicitly by operators or test fixtures, not by default seed.
 */
import type pg from 'pg';

import type { AppEnv } from '../config/schema.js';
import type { DatabaseQueryable } from '../db/database.js';
import { RuntimeDefaultsService } from '../services/runtime-defaults-service.js';
import { UserService } from '../services/user-service.js';
import { DEFAULT_ADMIN_KEY_PREFIX, DEFAULT_TENANT_ID } from '../db/seed.js';

const REDESIGN_RESET_PRESERVED_TABLES = new Set([
  'api_keys',
  'llm_providers',
  'llm_models',
  'role_model_assignments',
  'runtime_defaults',
  'schema_migrations',
  'tenants',
]);
const PRESERVED_LLM_RUNTIME_DEFAULT_KEYS = [
  'default_model_id',
  'default_reasoning_config',
] as const;

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function seedConfigTables(
  db: DatabaseQueryable,
  config?: Pick<AppEnv, 'AGIRUNNER_ADMIN_EMAIL'>,
): Promise<void> {
  await seedRuntimeDefaultsAndPrompts(db);
  await seedOrchestratorWorker(db);
  await seedAdminUser(db, config?.AGIRUNNER_ADMIN_EMAIL);
}

export async function resetPlaybookRedesignState(pool: pg.Pool): Promise<void> {
  await pool.query(
    `DELETE FROM api_keys
      WHERE tenant_id = $1
        AND key_prefix <> $2`,
    [DEFAULT_TENANT_ID, DEFAULT_ADMIN_KEY_PREFIX],
  );

  const result = await pool.query<{ tablename: string }>(
    `SELECT tablename
       FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename ASC`,
  );

  const tablesToReset = result.rows
    .map((row: { tablename: string }) => row.tablename)
    .filter((tableName: string) => !REDESIGN_RESET_PRESERVED_TABLES.has(tableName));

  if (tablesToReset.length === 0) {
    await deleteNonLlmRuntimeDefaults(pool);
    return;
  }

  const qualifiedTables = tablesToReset
    .map((tableName: string) => `"public"."${tableName}"`)
    .join(', ');
  await pool.query(`TRUNCATE TABLE ${qualifiedTables} RESTART IDENTITY CASCADE`);
  await deleteNonLlmRuntimeDefaults(pool);
}

// ---------------------------------------------------------------------------
// Runtime defaults + prompts
// ---------------------------------------------------------------------------

async function seedRuntimeDefaultsAndPrompts(db: DatabaseQueryable): Promise<void> {
  const defaultsService = new RuntimeDefaultsService(db);

  await seedRuntimeDefaults(defaultsService);
  await seedDefaultPrompts(db);
}

async function seedRuntimeDefaults(service: RuntimeDefaultsService): Promise<void> {
  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'global_max_specialists',
    configValue: '20',
    configType: 'number',
    description:
      'Hard ceiling on concurrently active specialists. Each active specialist consumes one runtime and one execution container',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'specialist_runtime_default_image',
    configValue: 'agirunner-runtime:local',
    configType: 'string',
    description: 'Default Docker image for generic specialist runtime containers',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'specialist_runtime_default_cpu',
    configValue: '2',
    configType: 'string',
    description: 'CPU allocation per specialist runtime container',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'specialist_runtime_default_memory',
    configValue: '256m',
    configType: 'string',
    description: 'Memory allocation per specialist runtime container',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'specialist_runtime_default_pull_policy',
    configValue: 'if-not-present',
    configType: 'string',
    description: 'Default image pull policy for specialist runtime containers',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'specialist_runtime_bootstrap_claim_timeout_seconds',
    configValue: '60',
    configType: 'number',
    description: 'How long a new specialist runtime waits for work before self-terminating',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'specialist_runtime_drain_grace_seconds',
    configValue: '120',
    configType: 'number',
    description: 'Grace period before a draining specialist runtime is forced down',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'lifecycle.destroy_stop_timeout_seconds',
    configValue: '1',
    configType: 'number',
    description: 'Grace period before a completed task or runtime container is force-removed',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'specialist_execution_default_image',
    configValue: 'agirunner-runtime-execution:local',
    configType: 'string',
    description: 'Default Docker image for specialist execution containers',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'specialist_execution_default_cpu',
    configValue: '2',
    configType: 'string',
    description: 'Default CPU allocation for specialist execution containers',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'specialist_execution_default_memory',
    configValue: '512m',
    configType: 'string',
    description: 'Default memory allocation for specialist execution containers',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'specialist_execution_default_pull_policy',
    configValue: 'if-not-present',
    configType: 'string',
    description: 'Default image pull policy for specialist execution containers',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'api.events_heartbeat_seconds',
    configValue: '10',
    configType: 'number',
    description: 'How often the runtime emits task-event heartbeats while a stream is open',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'platform.event_stream_keepalive_interval_ms',
    configValue: '15000',
    configType: 'number',
    description: 'How often the platform emits keepalive pings on open event streams',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'platform.worker_reconnect_min_ms',
    configValue: '1000',
    configType: 'number',
    description: 'Minimum reconnect backoff in milliseconds offered to workers',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'platform.worker_reconnect_max_ms',
    configValue: '60000',
    configType: 'number',
    description: 'Maximum reconnect backoff in milliseconds offered to workers',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'platform.worker_websocket_ping_interval_ms',
    configValue: '20000',
    configType: 'number',
    description: 'How often the platform pings worker websockets when connections are idle',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'workspace.clone_max_retries',
    configValue: '5',
    configType: 'number',
    description: 'How many times the runtime retries a workspace clone before failing the task',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'workspace.clone_backoff_base_seconds',
    configValue: '2',
    configType: 'number',
    description: 'Base backoff in seconds used between workspace clone retry attempts',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'workspace.snapshot_interval',
    configValue: '1',
    configType: 'number',
    description: 'Automatic workspace snapshot cadence in task steps; 0 disables snapshots',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'container.max_reuse_age_seconds',
    configValue: '1800',
    configType: 'number',
    description: 'Maximum age in seconds before a warm-reused container is retired',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'container.max_reuse_tasks',
    configValue: '10',
    configType: 'number',
    description: 'Maximum tasks a warm-reused container may serve before being retired',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'pool.refresh_interval_seconds',
    configValue: '300',
    configType: 'number',
    description: 'How often the runtime refreshes pool state from the platform',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'agent.max_iterations',
    configValue: '800',
    configType: 'number',
    description: 'Default maximum agent loop iterations for a single task',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'agent.llm_max_retries',
    configValue: '5',
    configType: 'number',
    description: 'Default maximum retries for failed model calls before the task errors',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'log.level',
    configValue: 'debug',
    configType: 'string',
    description: 'Runtime process log level applied to connected worker processes',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'tasks.default_timeout_minutes',
    configValue: '180',
    configType: 'number',
    description: 'Default timeout in minutes applied to new tasks when the task payload omits one',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'platform.claim_poll_seconds',
    configValue: '5',
    configType: 'number',
    description: 'How often connected runtimes poll the platform for claimable work',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'platform.api_request_timeout_seconds',
    configValue: '60',
    configType: 'number',
    description:
      'How long connected runtimes wait for platform API requests before treating them as failed',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'platform.log_ingest_timeout_seconds',
    configValue: '30',
    configType: 'number',
    description:
      'How long connected runtimes wait when flushing execution logs back to the platform ingest endpoint',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'platform.log_flush_interval_ms',
    configValue: '2000',
    configType: 'number',
    description:
      'How long connected runtimes buffer partial execution-log batches before flushing them to the platform ingest endpoint',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'platform.heartbeat_max_failures',
    configValue: '24',
    configType: 'number',
    description:
      'How many consecutive heartbeat failures connected runtimes tolerate before self-termination',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'platform.drain_timeout_seconds',
    configValue: '1800',
    configType: 'number',
    description:
      'How long connected runtimes wait for in-flight work while draining before forced shutdown',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'platform.cancellation_report_timeout_seconds',
    configValue: '10',
    configType: 'number',
    description:
      'How long connected runtimes wait when reporting cancellation or shutdown outcomes back to the platform',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'platform.self_terminate_cleanup_timeout_seconds',
    configValue: '60',
    configType: 'number',
    description:
      'How long connected runtimes wait while cleaning up managed task containers before self-termination',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'platform.workflow_activation_delay_ms',
    configValue: '10000',
    configType: 'number',
    description:
      'Delay in milliseconds before non-immediate workflow activations become eligible to dispatch',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'platform.workflow_activation_heartbeat_interval_ms',
    configValue: '1800000',
    configType: 'number',
    description:
      'Minimum interval in milliseconds between watchdog heartbeat activations for the same workflow',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'platform.workflow_activation_stale_after_ms',
    configValue: '900000',
    configType: 'number',
    description:
      'Threshold in milliseconds after which a processing workflow activation is considered stale',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'platform.task_cancel_signal_grace_period_ms',
    configValue: '180000',
    configType: 'number',
    description:
      'Grace period in milliseconds between sending a cancel signal and force-failing or force-cancelling work',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'platform.worker_dispatch_ack_timeout_ms',
    configValue: '45000',
    configType: 'number',
    description:
      'Maximum time in milliseconds a worker has to acknowledge a dispatch before it is released',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'platform.worker_key_expiry_ms',
    configValue: '31536000000',
    configType: 'number',
    description: 'Default API key lifetime in milliseconds for newly registered workers',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'platform.agent_default_heartbeat_interval_seconds',
    configValue: '60',
    configType: 'number',
    description:
      'Default heartbeat interval in seconds assigned to newly registered standalone agents',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'platform.agent_heartbeat_grace_period_ms',
    configValue: '300000',
    configType: 'number',
    description:
      'Additional grace period in milliseconds before stale standalone agents fail claimed work',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'platform.agent_heartbeat_threshold_multiplier',
    configValue: '2',
    configType: 'number',
    description:
      'Heartbeat interval multiplier used when determining when standalone agent heartbeats are stale',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'platform.agent_key_expiry_ms',
    configValue: '31536000000',
    configType: 'number',
    description: 'Default API key lifetime in milliseconds for newly registered standalone agents',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'platform.worker_default_heartbeat_interval_seconds',
    configValue: '30',
    configType: 'number',
    description: 'Default heartbeat interval in seconds assigned to newly registered workers',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'platform.worker_offline_grace_period_ms',
    configValue: '300000',
    configType: 'number',
    description:
      'Additional grace period in milliseconds before disconnected workers are marked fully offline',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'platform.worker_offline_threshold_multiplier',
    configValue: '2',
    configType: 'number',
    description:
      'Heartbeat interval multiplier used when determining the offline cutoff for workers',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'platform.worker_degraded_threshold_multiplier',
    configValue: '1',
    configType: 'number',
    description:
      'Heartbeat interval multiplier used when determining the degraded or disconnected cutoff for workers',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'platform.lifecycle_agent_heartbeat_check_interval_ms',
    configValue: '30000',
    configType: 'number',
    description: 'Interval in milliseconds between platform agent heartbeat enforcement sweeps',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'platform.lifecycle_worker_heartbeat_check_interval_ms',
    configValue: '30000',
    configType: 'number',
    description: 'Interval in milliseconds between platform worker heartbeat enforcement sweeps',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'platform.lifecycle_task_timeout_check_interval_ms',
    configValue: '60000',
    configType: 'number',
    description:
      'Interval in milliseconds between platform task-timeout and workflow-cancellation sweeps',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'platform.lifecycle_dispatch_loop_interval_ms',
    configValue: '2000',
    configType: 'number',
    description: 'Interval in milliseconds between platform dispatch loop executions',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'platform.heartbeat_prune_interval_ms',
    configValue: '300000',
    configType: 'number',
    description: 'Interval in milliseconds between stale-heartbeat prune sweeps',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'platform.governance_retention_job_interval_ms',
    configValue: '21600000',
    configType: 'number',
    description: 'Interval in milliseconds between governance retention and log partition sweeps',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'container_manager.reconcile_interval_seconds',
    configValue: '10',
    configType: 'number',
    description:
      'How often the container manager polls the fleet snapshot and reconciles runtime state',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'container_manager.stop_timeout_seconds',
    configValue: '60',
    configType: 'number',
    description:
      'Grace period in seconds used by the container manager when stopping runtime containers',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'container_manager.shutdown_task_stop_timeout_seconds',
    configValue: '10',
    configType: 'number',
    description: 'Grace period in seconds used for task containers during manager shutdown cleanup',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'container_manager.docker_action_buffer_seconds',
    configValue: '30',
    configType: 'number',
    description: 'Extra seconds the container manager adds around Docker stop/remove actions',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'container_manager.log_flush_interval_ms',
    configValue: '2000',
    configType: 'number',
    description:
      'How long the container manager buffers execution logs before flushing them to the platform ingest API',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'container_manager.docker_event_reconnect_backoff_ms',
    configValue: '5000',
    configType: 'number',
    description:
      'How long the container manager waits before reconnecting after the Docker event stream drops',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'container_manager.crash_log_capture_timeout_seconds',
    configValue: '5',
    configType: 'number',
    description:
      'How long the container manager waits when capturing crash logs from a dead container',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'container_manager.starvation_threshold_seconds',
    configValue: '180',
    configType: 'number',
    description:
      'How long a playbook may remain pending without a runtime before the container manager boosts it for starvation recovery',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'container_manager.runtime_orphan_grace_cycles',
    configValue: '6',
    configType: 'number',
    description:
      'How many reconcile cycles a managed runtime may remain orphaned before the container manager force-removes it',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'container_manager.hung_runtime_stale_after_seconds',
    configValue: '180',
    configType: 'number',
    description:
      'Maximum age in seconds before the container manager treats a runtime heartbeat as stale',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'container_manager.hung_runtime_stop_grace_period_seconds',
    configValue: '60',
    configType: 'number',
    description:
      'Grace period in seconds used when stopping runtime containers that are classified as hung',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'container_manager.runtime_log_max_size_mb',
    configValue: '10',
    configType: 'number',
    description:
      'Maximum size in megabytes for each runtime container Docker log file before the engine rotates it',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'container_manager.runtime_log_max_files',
    configValue: '3',
    configType: 'number',
    description:
      'Maximum number of rotated Docker log files retained for each runtime container',
  });

  await seedDashboardBackedRuntimeDefaults(service);
}

async function seedDashboardBackedRuntimeDefaults(service: RuntimeDefaultsService): Promise<void> {
  const defaults = [
    {
      configKey: 'server.shutdown_timeout_seconds',
      configValue: '5',
      configType: 'number',
      description: 'How long the runtime waits for graceful shutdown before forcing termination',
    },
    {
      configKey: 'server.read_header_timeout_seconds',
      configValue: '5',
      configType: 'number',
      description: 'Maximum time allowed to receive incoming HTTP request headers',
    },
    {
      configKey: 'llm.http_timeout_seconds',
      configValue: '120',
      configType: 'number',
      description: 'Upper bound for outbound LLM HTTP requests from runtime provider adapters',
    },
    {
      configKey: 'tools.file_read_timeout_seconds',
      configValue: '30',
      configType: 'number',
      description: 'Maximum duration in seconds for file read tool calls',
    },
    {
      configKey: 'tools.file_write_timeout_seconds',
      configValue: '30',
      configType: 'number',
      description: 'Maximum duration in seconds for file write tool calls',
    },
    {
      configKey: 'tools.file_edit_timeout_seconds',
      configValue: '30',
      configType: 'number',
      description: 'Maximum duration in seconds for file edit tool calls',
    },
    {
      configKey: 'tools.file_list_timeout_seconds',
      configValue: '30',
      configType: 'number',
      description: 'Maximum duration in seconds for file list tool calls',
    },
    {
      configKey: 'tools.git_status_timeout_seconds',
      configValue: '30',
      configType: 'number',
      description: 'Maximum duration in seconds for git status tool calls',
    },
    {
      configKey: 'tools.git_diff_timeout_seconds',
      configValue: '30',
      configType: 'number',
      description: 'Maximum duration in seconds for git diff tool calls',
    },
    {
      configKey: 'tools.git_log_timeout_seconds',
      configValue: '30',
      configType: 'number',
      description: 'Maximum duration in seconds for git log tool calls',
    },
    {
      configKey: 'tools.git_commit_timeout_seconds',
      configValue: '60',
      configType: 'number',
      description: 'Maximum duration in seconds for git commit tool calls',
    },
    {
      configKey: 'tools.git_push_timeout_seconds',
      configValue: '90',
      configType: 'number',
      description: 'Maximum duration in seconds for git push tool calls',
    },
    {
      configKey: 'tools.shell_exec_timeout_seconds',
      configValue: '300',
      configType: 'number',
      description: 'Maximum duration in seconds for shell exec tool calls before clamping',
    },
    {
      configKey: 'tools.shell_exec_timeout_min_seconds',
      configValue: '1',
      configType: 'number',
      description: 'Minimum allowed timeout in seconds for shell exec tool calls',
    },
    {
      configKey: 'tools.shell_exec_timeout_max_seconds',
      configValue: '900',
      configType: 'number',
      description: 'Maximum allowed timeout in seconds for shell exec tool calls',
    },
    {
      configKey: 'tools.helpers_exec_timeout_seconds',
      configValue: '10',
      configType: 'number',
      description: 'Maximum duration in seconds for helper process executions',
    },
    {
      configKey: 'tools.web_fetch_timeout_seconds',
      configValue: '30',
      configType: 'number',
      description: 'Maximum duration in seconds for web fetch tool calls',
    },
    {
      configKey: 'tools.mcp_timeout_seconds',
      configValue: '30',
      configType: 'number',
      description: 'Maximum duration in seconds for MCP tool calls',
    },
    {
      configKey: 'lifecycle.healthcheck_timeout_seconds',
      configValue: '5',
      configType: 'number',
      description: 'Timeout in seconds for runtime health checks against newly created containers',
    },
    {
      configKey: 'lifecycle.healthcheck_retry_delay_seconds',
      configValue: '2',
      configType: 'number',
      description: 'Delay in seconds between lifecycle health check retries',
    },
    {
      configKey: 'lifecycle.failed_start_stop_timeout_seconds',
      configValue: '2',
      configType: 'number',
      description: 'Grace period in seconds when stopping containers that failed during startup',
    },
    {
      configKey: 'queue.max_depth',
      configValue: '100',
      configType: 'number',
      description: 'Maximum queued tasks buffered inside one specialist runtime process',
    },
    {
      configKey: 'capture.push_retries',
      configValue: '5',
      configType: 'number',
      description: 'How many times capture retries result publication before failing the task',
    },
    {
      configKey: 'capture.push_timeout_seconds',
      configValue: '180',
      configType: 'number',
      description: 'Deadline in seconds for capture-side artifact upload and result publication',
    },
    {
      configKey: 'capture.exec_timeout_seconds',
      configValue: '10',
      configType: 'number',
      description: 'Maximum duration in seconds for capture-side shell execution while packaging task results',
    },
    {
      configKey: 'secrets.vault_timeout_seconds',
      configValue: '10',
      configType: 'number',
      description: 'Upper bound in seconds for Vault reads and revocation calls',
    },
    {
      configKey: 'subagent.max_concurrent',
      configValue: '3',
      configType: 'number',
      description: 'Maximum number of subagents that may run concurrently for one root task',
    },
    {
      configKey: 'subagent.max_total',
      configValue: '10',
      configType: 'number',
      description: 'Maximum total subagents a root task may spawn over its lifetime',
    },
    {
      configKey: 'subagent.max_depth',
      configValue: '1',
      configType: 'number',
      description: 'Maximum recursive delegation depth allowed for spawned subagents',
    },
    {
      configKey: 'subagent.default_timeout_seconds',
      configValue: '300',
      configType: 'number',
      description: 'Default timeout in seconds applied to spawned subagents when no override is provided',
    },
    {
      configKey: 'workspace.snapshot_max_per_task',
      configValue: '10',
      configType: 'number',
      description: 'Maximum automatic workspace snapshots retained per task',
    },
    {
      configKey: 'workspace.create_layout_timeout_seconds',
      configValue: '20',
      configType: 'number',
      description: 'Maximum duration in seconds for creating the initial task workspace layout',
    },
    {
      configKey: 'workspace.configure_git_timeout_seconds',
      configValue: '15',
      configType: 'number',
      description: 'Maximum duration in seconds for configuring git credentials and remote settings',
    },
    {
      configKey: 'workspace.cleanup_git_timeout_seconds',
      configValue: '10',
      configType: 'number',
      description: 'Maximum duration in seconds for post-task git credential cleanup',
    },
    {
      configKey: 'workspace.configure_identity_timeout_seconds',
      configValue: '10',
      configType: 'number',
      description: 'Maximum duration in seconds for applying git author identity in the workspace',
    },
    {
      configKey: 'workspace.clone_timeout_seconds',
      configValue: '600',
      configType: 'number',
      description: 'Maximum duration in seconds for cloning the workspace repository or host mapping bootstrap',
    },
    {
      configKey: 'agent.history_max_messages',
      configValue: '150',
      configType: 'number',
      description: 'Maximum message history kept before specialist task context is compacted',
    },
    {
      configKey: 'agent.history_preserve_recent',
      configValue: '30',
      configType: 'number',
      description: 'Fallback recent-message tail preserved during compaction when no role-specific override is set',
    },
    {
      configKey: 'agent.context_compaction_threshold',
      configValue: '0.8',
      configType: 'number',
      description: 'Base context-pressure threshold that triggers compaction when no role-specific override is set',
    },
    {
      configKey: 'agent.context_compaction_chars_per_token',
      configValue: '4',
      configType: 'number',
      description: 'Fallback character-per-token estimate used when model-side token accounting is unavailable',
    },
    {
      configKey: 'agent.specialist_context_strategy',
      configValue: 'auto',
      configType: 'string',
      description: 'Default continuity strategy for specialist tasks',
    },
    {
      configKey: 'agent.specialist_context_warning_threshold',
      configValue: '0.7',
      configType: 'number',
      description: 'Warn specialists about rising context pressure before compaction starts',
    },
    {
      configKey: 'agent.specialist_context_compaction_threshold',
      configValue: '0.8',
      configType: 'number',
      description: 'Role-specific compaction threshold override for specialists',
    },
    {
      configKey: 'agent.specialist_context_tail_messages',
      configValue: '30',
      configType: 'number',
      description: 'Role-specific preserved recent message count for specialists',
    },
    {
      configKey: 'agent.specialist_context_preserve_memory_ops',
      configValue: '3',
      configType: 'number',
      description: 'How many recent specialist memory breadcrumbs must survive compaction',
    },
    {
      configKey: 'agent.specialist_context_preserve_artifact_ops',
      configValue: '3',
      configType: 'number',
      description: 'How many recent specialist artifact breadcrumbs must survive compaction',
    },
    {
      configKey: 'agent.specialist_prepare_for_compaction_enabled',
      configValue: 'true',
      configType: 'boolean',
      description: 'Whether specialists proactively prepare continuity breadcrumbs before compaction',
    },
    {
      configKey: 'agent.orchestrator_history_preserve_recent',
      configValue: '30',
      configType: 'number',
      description: 'Preserved recent message tail for orchestrator activations',
    },
    {
      configKey: 'agent.orchestrator_context_compaction_threshold',
      configValue: '0.9',
      configType: 'number',
      description: 'Context-pressure threshold that triggers orchestrator activation compaction',
    },
    {
      configKey: 'agent.orchestrator_context_strategy',
      configValue: 'activation_checkpoint',
      configType: 'string',
      description: 'Continuity strategy for orchestrator activations',
    },
    {
      configKey: 'agent.orchestrator_finish_checkpoint_enabled',
      configValue: 'true',
      configType: 'boolean',
      description: 'Whether orchestrator activations persist a checkpoint at the end of a successful run',
    },
    {
      configKey: 'agent.orchestrator_finish_refresh_context_bundle',
      configValue: 'true',
      configType: 'boolean',
      description: 'Whether orchestrator finish-time checkpoints refresh the context bundle before persistence',
    },
    {
      configKey: 'agent.orchestrator_emergency_compaction_threshold',
      configValue: '0.95',
      configType: 'number',
      description: 'Emergency context-pressure threshold for orchestrator activations',
    },
    {
      configKey: 'agent.orchestrator_preserve_memory_ops',
      configValue: '2',
      configType: 'number',
      description: 'How many recent orchestrator memory breadcrumbs must survive compaction',
    },
    {
      configKey: 'agent.orchestrator_preserve_artifact_ops',
      configValue: '2',
      configType: 'number',
      description: 'How many recent orchestrator artifact breadcrumbs must survive compaction',
    },
    {
      configKey: 'agent.loop_detection_repeat',
      configValue: '3',
      configType: 'number',
      description: 'Flag repeated loop patterns after this many repeated turns',
    },
    {
      configKey: 'agent.response_repeat_threshold',
      configValue: '2',
      configType: 'number',
      description: 'Mark the agent as stuck after this many repeated near-identical replies',
    },
    {
      configKey: 'agent.no_file_change_threshold',
      configValue: '50',
      configType: 'number',
      description: 'Intervene only after this many turns with no meaningful progress toward task completion',
    },
    {
      configKey: 'agent.max_tool_steps_per_burst',
      configValue: '12',
      configType: 'number',
      description: 'Maximum tool steps the runtime executes inside one reactive burst before re-evaluating',
    },
    {
      configKey: 'agent.max_mutating_steps_per_burst',
      configValue: '5',
      configType: 'number',
      description: 'Maximum mutating tool steps the runtime executes inside one reactive burst before re-evaluating',
    },
    {
      configKey: 'agent.max_burst_elapsed_ms',
      configValue: '120000',
      configType: 'number',
      description: 'Maximum elapsed time in milliseconds allowed for one reactive burst before re-evaluating',
    },
    {
      configKey: 'agent.max_parallel_tool_calls_per_burst',
      configValue: '8',
      configType: 'number',
      description: 'Maximum read-only tool calls the runtime executes in parallel inside one reactive burst',
    },
    {
      configKey: 'agent.max_stuck_interventions',
      configValue: '2',
      configType: 'number',
      description: 'How many automatic recovery interventions the runtime attempts before failing the task',
    },
  ] as const;

  for (const item of defaults) {
    await service.upsertDefault(DEFAULT_TENANT_ID, item);
  }
}

async function deleteNonLlmRuntimeDefaults(db: DatabaseQueryable): Promise<void> {
  await db.query(
    `DELETE FROM runtime_defaults
      WHERE tenant_id = $1
        AND config_key <> ALL($2::text[])`,
    [DEFAULT_TENANT_ID, [...PRESERVED_LLM_RUNTIME_DEFAULT_KEYS]],
  );
}

// ---------------------------------------------------------------------------
// Default orchestrator worker
// ---------------------------------------------------------------------------

async function seedOrchestratorWorker(db: DatabaseQueryable): Promise<void> {
  const existing = await db.query(
    `SELECT id FROM worker_desired_state WHERE tenant_id = $1 AND pool_kind = 'orchestrator' LIMIT 1`,
    [DEFAULT_TENANT_ID],
  );
  if (existing.rowCount && existing.rowCount > 0) return;

  await db.query(
    `INSERT INTO worker_desired_state (
        tenant_id,
        worker_name,
        role,
        runtime_image,
        cpu_limit,
        memory_limit,
        replicas,
        enabled,
        pool_kind
      )
     VALUES ($1, 'orchestrator-primary', 'orchestrator', 'agirunner-runtime:local', '2', '256m', 1, true, 'orchestrator')
     ON CONFLICT DO NOTHING`,
    [DEFAULT_TENANT_ID],
  );
  console.info('[seed] Created default orchestrator worker (orchestrator-primary, 1 replica).');
}

// ---------------------------------------------------------------------------
// Default prompts
// ---------------------------------------------------------------------------

async function seedDefaultPrompts(db: DatabaseQueryable): Promise<void> {
  const { DEFAULT_PLATFORM_INSTRUCTIONS, DEFAULT_ORCHESTRATOR_PROMPT } = await import(
    '../catalogs/default-prompts.js'
  );

  // Platform instructions — only seed if empty
  const existing = await db.query(
    'SELECT content FROM platform_instructions WHERE tenant_id = $1',
    [DEFAULT_TENANT_ID],
  );
  if (!existing.rows[0]?.content?.trim()) {
    await db.query(
      `INSERT INTO platform_instructions (tenant_id, content, format, version)
       VALUES ($1, $2, 'markdown', 1)
       ON CONFLICT (tenant_id) DO UPDATE SET content = $2, version = platform_instructions.version + 1, updated_at = NOW()`,
      [DEFAULT_TENANT_ID, DEFAULT_PLATFORM_INSTRUCTIONS],
    );
    console.info('[seed] Seeded default platform instructions.');
  }

  // Orchestrator config — only seed if empty
  const existingOrch = await db.query(
    'SELECT prompt FROM orchestrator_config WHERE tenant_id = $1',
    [DEFAULT_TENANT_ID],
  );
  if (!existingOrch.rows[0]?.prompt?.trim()) {
    await db.query(
      `INSERT INTO orchestrator_config (tenant_id, prompt, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (tenant_id) DO UPDATE SET prompt = $2, updated_at = NOW()`,
      [DEFAULT_TENANT_ID, DEFAULT_ORCHESTRATOR_PROMPT],
    );
    console.info('[seed] Seeded default orchestrator prompt.');
  }
}

// ---------------------------------------------------------------------------
// Admin user
// ---------------------------------------------------------------------------

async function seedAdminUser(
  db: DatabaseQueryable,
  adminEmail = 'admin@agirunner.local',
): Promise<void> {
  const userService = new UserService(db);

  const existing = await userService.listUsers(DEFAULT_TENANT_ID);
  if (existing.length > 0) {
    return;
  }

  await userService.createUser(DEFAULT_TENANT_ID, {
    email: adminEmail,
    displayName: 'Admin',
    role: 'org_admin',
  });

  console.info(`[seed] Admin user created: ${adminEmail}`);
}
