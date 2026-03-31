import type { DatabaseQueryable } from '../../db/database.js';
import { DEFAULT_TENANT_ID } from '../../db/seed.js';
import { RuntimeDefaultsService } from '../../services/runtime-defaults/runtime-defaults-service.js';
import { seedDefaultPrompts } from './default-prompts.js';
import { DASHBOARD_BACKED_RUNTIME_DEFAULTS } from './dashboard-backed-runtime-defaults.js';
import {
  DEFAULT_RUNTIME_IMAGE,
  resolveSeedRuntimeImage,
} from './runtime-image-default.js';

const SPECIALIST_RUNTIME_DEFAULT_IMAGE_KEY = 'specialist_runtime_default_image';

type RuntimeDefaultsSeedService = Pick<
  RuntimeDefaultsService,
  'createDefault' | 'getByKey' | 'upsertDefault'
>;

const BASE_RUNTIME_DEFAULTS = [
  {
    configKey: 'global_max_specialists',
    configValue: '20',
    configType: 'number',
    description:
      'Hard ceiling on concurrently active specialists. Each active specialist consumes one Specialist Agent and one Specialist Execution',
  },
  {
    configKey: SPECIALIST_RUNTIME_DEFAULT_IMAGE_KEY,
    configValue: DEFAULT_RUNTIME_IMAGE,
    configType: 'string',
    description: 'Default image for Specialist Agents',
  },
  {
    configKey: 'specialist_runtime_default_cpu',
    configValue: '2',
    configType: 'string',
    description: 'CPU allocation per Specialist Agent',
  },
  {
    configKey: 'specialist_runtime_default_memory',
    configValue: '256m',
    configType: 'string',
    description: 'Memory allocation per Specialist Agent',
  },
  {
    configKey: 'specialist_runtime_default_pull_policy',
    configValue: 'if-not-present',
    configType: 'string',
    description: 'Default image pull policy for Specialist Agents',
  },
  {
    configKey: 'specialist_runtime_bootstrap_claim_timeout_seconds',
    configValue: '60',
    configType: 'number',
    description: 'How long a new Specialist Agent waits for work before self-terminating',
  },
  {
    configKey: 'specialist_runtime_drain_grace_seconds',
    configValue: '120',
    configType: 'number',
    description: 'Grace period before a draining Specialist Agent is forced down',
  },
  {
    configKey: 'lifecycle.destroy_stop_timeout_seconds',
    configValue: '1',
    configType: 'number',
    description: 'Grace period before a completed task or Specialist Agent is force-removed',
  },
  {
    configKey: 'api.events_heartbeat_seconds',
    configValue: '10',
    configType: 'number',
    description: 'How often the Specialist Agent emits task-event heartbeats while a stream is open',
  },
  {
    configKey: 'platform.event_stream_keepalive_interval_ms',
    configValue: '15000',
    configType: 'number',
    description: 'How often the platform emits keepalive pings on open event streams',
  },
  {
    configKey: 'platform.worker_reconnect_min_ms',
    configValue: '1000',
    configType: 'number',
    description: 'Minimum reconnect backoff in milliseconds offered to Specialist Agents',
  },
  {
    configKey: 'platform.worker_reconnect_max_ms',
    configValue: '60000',
    configType: 'number',
    description: 'Maximum reconnect backoff in milliseconds offered to Specialist Agents',
  },
  {
    configKey: 'platform.worker_websocket_ping_interval_ms',
    configValue: '20000',
    configType: 'number',
    description: 'How often the platform pings agent websockets when connections are idle',
  },
  {
    configKey: 'workspace.clone_max_retries',
    configValue: '5',
    configType: 'number',
    description: 'How many times the Specialist Agent retries a workspace clone before failing the task',
  },
  {
    configKey: 'workspace.clone_backoff_base_seconds',
    configValue: '2',
    configType: 'number',
    description: 'Base backoff in seconds used between workspace clone retry attempts',
  },
  {
    configKey: 'workspace.snapshot_interval',
    configValue: '1',
    configType: 'number',
    description: 'Automatic workspace snapshot cadence in task steps; 0 disables snapshots',
  },
  {
    configKey: 'container.max_reuse_age_seconds',
    configValue: '1800',
    configType: 'number',
    description: 'Maximum age in seconds before a warm-reused container is retired',
  },
  {
    configKey: 'container.max_reuse_tasks',
    configValue: '10',
    configType: 'number',
    description: 'Maximum tasks a warm-reused container may serve before being retired',
  },
  {
    configKey: 'pool.refresh_interval_seconds',
    configValue: '300',
    configType: 'number',
    description: 'How often the Specialist Agent refreshes pool state from the platform',
  },
  {
    configKey: 'agent.max_iterations',
    configValue: '800',
    configType: 'number',
    description: 'Default maximum agent loop iterations for a single task',
  },
  {
    configKey: 'agent.llm_max_retries',
    configValue: '5',
    configType: 'number',
    description: 'Default maximum retries for failed model calls before the task errors',
  },
  {
    configKey: 'log.level',
    configValue: 'debug',
    configType: 'string',
    description: 'Specialist Agent process log level applied to connected Specialist Agent processes',
  },
  {
    configKey: 'tasks.default_timeout_minutes',
    configValue: '180',
    configType: 'number',
    description: 'Default timeout in minutes applied to new tasks when the task payload omits one',
  },
  {
    configKey: 'platform.claim_poll_seconds',
    configValue: '5',
    configType: 'number',
    description: 'How often connected Specialist Agents poll the platform for claimable work',
  },
  {
    configKey: 'platform.api_request_timeout_seconds',
    configValue: '60',
    configType: 'number',
    description:
      'How long connected Specialist Agents wait for platform API requests before treating them as failed',
  },
  {
    configKey: 'platform.log_ingest_timeout_seconds',
    configValue: '30',
    configType: 'number',
    description:
      'How long connected Specialist Agents wait when flushing execution logs back to the platform ingest endpoint',
  },
  {
    configKey: 'platform.log_flush_interval_ms',
    configValue: '2000',
    configType: 'number',
    description:
      'How long connected Specialist Agents buffer partial execution-log batches before flushing them to the platform ingest endpoint',
  },
  {
    configKey: 'platform.heartbeat_max_failures',
    configValue: '24',
    configType: 'number',
    description:
      'How many consecutive heartbeat failures connected Specialist Agents tolerate before self-termination',
  },
  {
    configKey: 'platform.drain_timeout_seconds',
    configValue: '1800',
    configType: 'number',
    description:
      'How long connected Specialist Agents wait for in-flight work while draining before forced shutdown',
  },
  {
    configKey: 'platform.cancellation_report_timeout_seconds',
    configValue: '10',
    configType: 'number',
    description:
      'How long connected Specialist Agents wait when reporting cancellation or shutdown outcomes back to the platform',
  },
  {
    configKey: 'platform.self_terminate_cleanup_timeout_seconds',
    configValue: '60',
    configType: 'number',
    description:
      'How long connected Specialist Agents wait while cleaning up managed Specialist Executions before self-termination',
  },
  {
    configKey: 'platform.workflow_activation_delay_ms',
    configValue: '10000',
    configType: 'number',
    description:
      'Delay in milliseconds before non-immediate workflow activations become eligible to dispatch',
  },
  {
    configKey: 'platform.workflow_activation_heartbeat_interval_ms',
    configValue: '1800000',
    configType: 'number',
    description:
      'Minimum interval in milliseconds between watchdog heartbeat activations for the same workflow',
  },
  {
    configKey: 'platform.workflow_activation_stale_after_ms',
    configValue: '900000',
    configType: 'number',
    description:
      'Threshold in milliseconds after which a processing workflow activation is considered stale',
  },
  {
    configKey: 'platform.task_cancel_signal_grace_period_ms',
    configValue: '180000',
    configType: 'number',
    description:
      'Grace period in milliseconds between sending a cancel signal and force-failing or force-cancelling work',
  },
  {
    configKey: 'platform.worker_dispatch_ack_timeout_ms',
    configValue: '45000',
    configType: 'number',
    description:
      'Maximum time in milliseconds a Specialist Agent has to acknowledge a dispatch before it is released',
  },
  {
    configKey: 'platform.worker_key_expiry_ms',
    configValue: '31536000000',
    configType: 'number',
    description: 'Default API key lifetime in milliseconds for newly registered Specialist Agents',
  },
  {
    configKey: 'platform.agent_default_heartbeat_interval_seconds',
    configValue: '60',
    configType: 'number',
    description:
      'Default heartbeat interval in seconds assigned to newly registered standalone agents',
  },
  {
    configKey: 'platform.agent_heartbeat_grace_period_ms',
    configValue: '300000',
    configType: 'number',
    description:
      'Additional grace period in milliseconds before stale standalone agents fail claimed work',
  },
  {
    configKey: 'platform.agent_heartbeat_threshold_multiplier',
    configValue: '2',
    configType: 'number',
    description:
      'Heartbeat interval multiplier used when determining when standalone agent heartbeats are stale',
  },
  {
    configKey: 'platform.agent_key_expiry_ms',
    configValue: '31536000000',
    configType: 'number',
    description: 'Default API key lifetime in milliseconds for newly registered standalone agents',
  },
  {
    configKey: 'platform.worker_default_heartbeat_interval_seconds',
    configValue: '30',
    configType: 'number',
    description: 'Default heartbeat interval in seconds assigned to newly registered Specialist Agents',
  },
  {
    configKey: 'platform.worker_offline_grace_period_ms',
    configValue: '300000',
    configType: 'number',
    description:
      'Additional grace period in milliseconds before disconnected Specialist Agents are marked fully offline',
  },
  {
    configKey: 'platform.worker_offline_threshold_multiplier',
    configValue: '2',
    configType: 'number',
    description:
      'Heartbeat interval multiplier used when determining the offline cutoff for Specialist Agents',
  },
  {
    configKey: 'platform.worker_degraded_threshold_multiplier',
    configValue: '1',
    configType: 'number',
    description:
      'Heartbeat interval multiplier used when determining the degraded or disconnected cutoff for Specialist Agents',
  },
  {
    configKey: 'platform.lifecycle_agent_heartbeat_check_interval_ms',
    configValue: '30000',
    configType: 'number',
    description: 'Interval in milliseconds between platform agent heartbeat enforcement sweeps',
  },
  {
    configKey: 'platform.lifecycle_worker_heartbeat_check_interval_ms',
    configValue: '30000',
    configType: 'number',
    description: 'Interval in milliseconds between platform Specialist Agent heartbeat enforcement sweeps',
  },
  {
    configKey: 'platform.lifecycle_task_timeout_check_interval_ms',
    configValue: '60000',
    configType: 'number',
    description:
      'Interval in milliseconds between platform task-timeout and workflow-cancellation sweeps',
  },
  {
    configKey: 'platform.lifecycle_dispatch_loop_interval_ms',
    configValue: '2000',
    configType: 'number',
    description: 'Interval in milliseconds between platform dispatch loop executions',
  },
  {
    configKey: 'platform.heartbeat_prune_interval_ms',
    configValue: '300000',
    configType: 'number',
    description: 'Interval in milliseconds between stale-heartbeat prune sweeps',
  },
  {
    configKey: 'platform.governance_retention_job_interval_ms',
    configValue: '21600000',
    configType: 'number',
    description: 'Interval in milliseconds between governance retention and log partition sweeps',
  },
  {
    configKey: 'container_manager.reconcile_interval_seconds',
    configValue: '10',
    configType: 'number',
    description:
      'How often the container manager polls the fleet snapshot and reconciles Specialist Agent state',
  },
  {
    configKey: 'container_manager.stop_timeout_seconds',
    configValue: '60',
    configType: 'number',
    description:
      'Grace period in seconds used by the container manager when stopping Specialist Agents',
  },
  {
    configKey: 'container_manager.shutdown_task_stop_timeout_seconds',
    configValue: '10',
    configType: 'number',
    description: 'Grace period in seconds used for Specialist Executions during manager shutdown cleanup',
  },
  {
    configKey: 'container_manager.docker_action_buffer_seconds',
    configValue: '30',
    configType: 'number',
    description: 'Extra seconds the container manager adds around Docker stop/remove actions',
  },
  {
    configKey: 'container_manager.log_flush_interval_ms',
    configValue: '2000',
    configType: 'number',
    description:
      'How long the container manager buffers execution logs before flushing them to the platform ingest API',
  },
  {
    configKey: 'container_manager.docker_event_reconnect_backoff_ms',
    configValue: '5000',
    configType: 'number',
    description:
      'How long the container manager waits before reconnecting after the Docker event stream drops',
  },
  {
    configKey: 'container_manager.crash_log_capture_timeout_seconds',
    configValue: '5',
    configType: 'number',
    description:
      'How long the container manager waits when capturing crash logs from a dead container',
  },
  {
    configKey: 'container_manager.starvation_threshold_seconds',
    configValue: '180',
    configType: 'number',
    description:
      'How long a playbook may remain pending without a Specialist Agent before the container manager boosts it for starvation recovery',
  },
  {
    configKey: 'container_manager.runtime_orphan_grace_cycles',
    configValue: '6',
    configType: 'number',
    description:
      'How many reconcile cycles a managed Specialist Agent may remain orphaned before the container manager force-removes it',
  },
  {
    configKey: 'container_manager.hung_runtime_stale_after_seconds',
    configValue: '180',
    configType: 'number',
    description:
      'Maximum age in seconds before the container manager treats a Specialist Agent heartbeat as stale',
  },
  {
    configKey: 'container_manager.hung_runtime_stop_grace_period_seconds',
    configValue: '60',
    configType: 'number',
    description:
      'Grace period in seconds used when stopping Specialist Agents that are classified as hung',
  },
  {
    configKey: 'container_manager.runtime_log_max_size_mb',
    configValue: '10',
    configType: 'number',
    description:
      'Maximum size in megabytes for each Specialist Agent Docker log file before the engine rotates it',
  },
  {
    configKey: 'container_manager.runtime_log_max_files',
    configValue: '3',
    configType: 'number',
    description:
      'Maximum number of rotated Docker log files retained for each Specialist Agent',
  },
] as const;

export async function seedRuntimeDefaultsAndPrompts(db: DatabaseQueryable): Promise<void> {
  const defaultsService = new RuntimeDefaultsService(db);
  const runtimeImage = resolveSeedRuntimeImage(process.env.RUNTIME_IMAGE);

  await seedRuntimeDefaults(defaultsService, runtimeImage);
  await seedDefaultPrompts(db);
}

export function buildRuntimeDefaults(runtimeImage: string = DEFAULT_RUNTIME_IMAGE) {
  return BASE_RUNTIME_DEFAULTS.map((item) =>
    item.configKey === SPECIALIST_RUNTIME_DEFAULT_IMAGE_KEY
      ? { ...item, configValue: runtimeImage }
      : item,
  );
}

export async function seedRuntimeDefaults(
  service: RuntimeDefaultsSeedService,
  runtimeImage: string = DEFAULT_RUNTIME_IMAGE,
): Promise<void> {
  for (const item of buildRuntimeDefaults(runtimeImage)) {
    if (item.configKey === SPECIALIST_RUNTIME_DEFAULT_IMAGE_KEY) {
      await seedBootstrapRuntimeImageDefault(service, item);
      continue;
    }

    await service.upsertDefault(DEFAULT_TENANT_ID, item);
  }

  await seedDashboardBackedRuntimeDefaults(service);
}

async function seedDashboardBackedRuntimeDefaults(
  service: RuntimeDefaultsSeedService,
): Promise<void> {
  for (const item of DASHBOARD_BACKED_RUNTIME_DEFAULTS) {
    await service.upsertDefault(DEFAULT_TENANT_ID, item);
  }
}

async function seedBootstrapRuntimeImageDefault(
  service: RuntimeDefaultsSeedService,
  item: ReturnType<typeof buildRuntimeDefaults>[number],
): Promise<void> {
  const existing = await service.getByKey(DEFAULT_TENANT_ID, item.configKey);
  if (existing) {
    return;
  }

  await service.createDefault(DEFAULT_TENANT_ID, item);
}
