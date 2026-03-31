import { ValidationError } from '../../errors/domain-errors.js';
import type { PlaybookRuntimePoolKind } from '../../orchestration/playbook-model.js';
import { GLOBAL_MAX_SPECIALISTS_RUNTIME_KEY, SPECIALIST_RUNTIME_DEFAULT_KEYS } from '../runtime-default-values.js';

const VALID_POOL_KINDS = new Set(['orchestrator', 'specialist']);
const GENERIC_SPECIALIST_TARGET_ID = 'specialist';
const GENERIC_SPECIALIST_TARGET_NAME = 'Specialist Agents';
const FLEET_EVENT_SECRET_REDACTION = 'redacted://fleet-event-secret';

const VALID_FLEET_EVENT_TYPES = new Set([
  'runtime.started',
  'runtime.task.claimed',
  'runtime.task.completed',
  'runtime.task.escalated',
  'runtime.task.failed',
  'runtime.idle',
  'runtime.draining',
  'runtime.shutdown',
  'runtime.hung_detected',
  'container.created',
  'container.destroyed',
  'orphan.cleaned',
  'runtime_created',
  'runtime_draining',
  'runtime_hung',
  'runtime_orphan_cleaned',
  'runtime_preempted',
  'image_drift_detected',
]);

const VALID_FLEET_EVENT_LEVELS = new Set(['debug', 'info', 'warn', 'error']);

const SPECIALIST_RUNTIME_TARGET_DEFAULT_KEYS = {
  image: SPECIALIST_RUNTIME_DEFAULT_KEYS.image,
  cpu: SPECIALIST_RUNTIME_DEFAULT_KEYS.cpu,
  memory: SPECIALIST_RUNTIME_DEFAULT_KEYS.memory,
  pullPolicy: SPECIALIST_RUNTIME_DEFAULT_KEYS.pullPolicy,
  bootstrapClaimTimeoutSeconds: SPECIALIST_RUNTIME_DEFAULT_KEYS.bootstrapClaimTimeoutSeconds,
  drainGraceSeconds: SPECIALIST_RUNTIME_DEFAULT_KEYS.drainGraceSeconds,
} as const;

const CONTAINER_MANAGER_RUNTIME_DEFAULTS = {
  platformApiRequestTimeoutSeconds: 'platform.api_request_timeout_seconds',
  platformLogIngestTimeoutSeconds: 'platform.log_ingest_timeout_seconds',
  reconcileIntervalSeconds: 'container_manager.reconcile_interval_seconds',
  stopTimeoutSeconds: 'container_manager.stop_timeout_seconds',
  shutdownTaskStopTimeoutSeconds: 'container_manager.shutdown_task_stop_timeout_seconds',
  dockerActionBufferSeconds: 'container_manager.docker_action_buffer_seconds',
  logFlushIntervalMs: 'container_manager.log_flush_interval_ms',
  dockerEventReconnectBackoffMs: 'container_manager.docker_event_reconnect_backoff_ms',
  crashLogCaptureTimeoutSeconds: 'container_manager.crash_log_capture_timeout_seconds',
  starvationThresholdSeconds: 'container_manager.starvation_threshold_seconds',
  runtimeOrphanGraceCycles: 'container_manager.runtime_orphan_grace_cycles',
  hungRuntimeStaleAfterSeconds: 'container_manager.hung_runtime_stale_after_seconds',
  hungRuntimeStopGracePeriodSeconds: 'container_manager.hung_runtime_stop_grace_period_seconds',
  globalMaxSpecialists: GLOBAL_MAX_SPECIALISTS_RUNTIME_KEY,
  runtimeLogMaxSizeMB: 'container_manager.runtime_log_max_size_mb',
  runtimeLogMaxFiles: 'container_manager.runtime_log_max_files',
} as const;

export interface QueueDepthResult {
  total_pending: number;
  by_playbook: Record<string, number>;
}

export interface RuntimeTarget {
  playbook_id: string;
  playbook_name: string;
  pool_kind: PlaybookRuntimePoolKind;
  routing_tags: string[];
  pool_mode: string;
  max_runtimes: number;
  priority: number;
  idle_timeout_seconds: number;
  grace_period_seconds: number;
  image: string;
  pull_policy: string;
  cpu: string;
  memory: string;
  pending_tasks: number;
  active_workflows: number;
  active_execution_containers?: number;
  available_execution_slots?: number;
}

export interface HeartbeatPayload {
  runtime_id: string;
  playbook_id?: string | null;
  pool_kind: PlaybookRuntimePoolKind;
  state: string;
  task_id?: string | null;
  uptime_seconds?: number;
  last_claim_at?: string | null;
  image?: string;
}

export interface HeartbeatAck {
  runtime_id: string;
  playbook_id: string | null;
  pool_kind: PlaybookRuntimePoolKind;
  state: string;
  task_id: string | null;
  should_drain: boolean;
}

export interface HeartbeatListRow {
  runtime_id: string;
  playbook_id: string | null;
  pool_kind: PlaybookRuntimePoolKind;
  state: string;
  last_heartbeat_at: string;
  active_task_id: string | null;
}

export interface RecordFleetEventInput {
  event_type: string;
  level?: string;
  runtime_id?: string;
  playbook_id?: string;
  task_id?: string;
  workflow_id?: string;
  container_id?: string;
  payload?: Record<string, unknown>;
}

export interface FleetEventFilters {
  playbook_id?: string;
  runtime_id?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

export interface FleetEventRow {
  [key: string]: unknown;
  id: string;
  tenant_id: string;
  event_type: string;
  level: string;
  runtime_id: string | null;
  playbook_id: string | null;
  task_id: string | null;
  workflow_id: string | null;
  container_id: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
}

export interface PlaybookFleetSummary {
  playbook_id: string;
  playbook_name: string;
  max_runtimes: number;
  running: number;
  idle: number;
  executing: number;
  pending_tasks: number;
  active_workflows: number;
}

export interface PlaybookPoolFleetSummary extends PlaybookFleetSummary {
  pool_kind: PlaybookRuntimePoolKind;
  draining: number;
}

export interface WorkerPoolSummary {
  pool_kind: PlaybookRuntimePoolKind;
  desired_workers: number;
  desired_replicas: number;
  enabled_workers: number;
  draining_workers: number;
  running_containers: number;
}

export interface ContainerManagerConfig {
  platform_api_request_timeout_seconds: number;
  platform_log_ingest_timeout_seconds: number;
  reconcile_interval_seconds: number;
  stop_timeout_seconds: number;
  shutdown_task_stop_timeout_seconds: number;
  docker_action_buffer_seconds: number;
  log_flush_interval_ms: number;
  docker_event_reconnect_backoff_ms: number;
  crash_log_capture_timeout_seconds: number;
  starvation_threshold_seconds: number;
  runtime_orphan_grace_cycles: number;
  hung_runtime_stale_after_seconds: number;
  hung_runtime_stop_grace_period_seconds: number;
  global_max_runtimes: number;
  runtime_log_max_size_mb: number;
  runtime_log_max_files: number;
}

export interface FleetStatus {
  global_max_runtimes: number;
  total_running: number;
  total_idle: number;
  total_executing: number;
  total_draining: number;
  worker_pools: WorkerPoolSummary[];
  by_playbook: PlaybookFleetSummary[];
  by_playbook_pool: PlaybookPoolFleetSummary[];
  recent_events: FleetEventRow[];
}

interface SpecialistRuntimeTargetDefaults {
  image: string;
  cpu: string;
  memory: string;
  pullPolicy: string;
  bootstrapClaimTimeoutSeconds: number;
  drainGraceSeconds: number;
}

interface SpecialistRuntimeStatsRow {
  pending_tasks: number;
  active_runtimes: number;
  active_execution_containers: number;
}

interface RoleCatalogRow {
  name: string;
}

interface HeartbeatRow {
  [key: string]: unknown;
  runtime_id: string;
  tenant_id: string;
  playbook_id: string | null;
  playbook_name: string;
  pool_kind: string;
  state: string;
  task_id: string | null;
}

interface WorkerPoolSummaryRow {
  pool_kind: string;
  desired_workers: number;
  desired_replicas: number;
  enabled_workers: number;
  draining_workers: number;
  running_containers: number;
}

export function isPoolKind(value: string): value is PlaybookRuntimePoolKind {
  return VALID_POOL_KINDS.has(value);
}

export function heartbeatPlaybookKey(playbookID: string | null, poolKind: string): string {
  if ((isPoolKind(poolKind) ? poolKind : 'specialist') === 'specialist' && (!playbookID || playbookID.trim().length === 0)) {
    return GENERIC_SPECIALIST_TARGET_ID;
  }
  return playbookID?.trim() || GENERIC_SPECIALIST_TARGET_ID;
}

export function normalizeRuntimeHeartbeatPlaybookID(playbookID: string | null | undefined): string | null {
  if (!playbookID) {
    return null;
  }
  const normalized = playbookID.trim();
  if (normalized === GENERIC_SPECIALIST_TARGET_ID) {
    return null;
  }
  return normalized.length > 0 ? normalized : null;
}

export function sanitizeFleetEventRows<T extends { payload?: Record<string, unknown> | null }>(rows: T[]): T[] {
  return rows.map((row) => sanitizeFleetEventRow(row));
}

function sanitizeFleetEventRow<T extends { payload?: Record<string, unknown> | null }>(row: T): T {
  return {
    ...row,
    payload: sanitizeFleetEventPayload(row.payload),
  };
}

export function sanitizeFleetEventPayload(payload: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!payload) {
    return {};
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    sanitized[key] = sanitizeFleetEventValue(value, isSecretLikeKey(key));
  }
  return sanitized;
}

function sanitizeFleetEventValue(value: unknown, inheritedSecret: boolean): unknown {
  if (typeof value === 'string') {
    return inheritedSecret || isSecretLikeValue(value) ? FLEET_EVENT_SECRET_REDACTION : value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeFleetEventValue(entry, inheritedSecret));
  }

  if (value && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      sanitized[key] = sanitizeFleetEventValue(nestedValue, inheritedSecret || isSecretLikeKey(key));
    }
    return sanitized;
  }

  return value;
}

function isSecretLikeKey(key: string): boolean {
  return /(secret|token|password|api[_-]?key|credential|authorization|private[_-]?key|known_hosts)/i.test(key);
}

function isSecretLikeValue(value: string): boolean {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return false;
  }
  return /(?:^enc:v\d+:|^secret:|^redacted:\/\/|^Bearer\s+\S+|^sk-[A-Za-z0-9_-]+|^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/i.test(
    normalized,
  );
}

export function buildContainerManagerConfig(defaults: Map<string, string>): ContainerManagerConfig {
  return {
    platform_api_request_timeout_seconds: readRequiredIntegerDefault(
      defaults,
      CONTAINER_MANAGER_RUNTIME_DEFAULTS.platformApiRequestTimeoutSeconds,
    ),
    platform_log_ingest_timeout_seconds: readRequiredIntegerDefault(
      defaults,
      CONTAINER_MANAGER_RUNTIME_DEFAULTS.platformLogIngestTimeoutSeconds,
    ),
    reconcile_interval_seconds: readRequiredIntegerDefault(
      defaults,
      CONTAINER_MANAGER_RUNTIME_DEFAULTS.reconcileIntervalSeconds,
    ),
    stop_timeout_seconds: readRequiredIntegerDefault(defaults, CONTAINER_MANAGER_RUNTIME_DEFAULTS.stopTimeoutSeconds),
    shutdown_task_stop_timeout_seconds: readRequiredIntegerDefault(
      defaults,
      CONTAINER_MANAGER_RUNTIME_DEFAULTS.shutdownTaskStopTimeoutSeconds,
    ),
    docker_action_buffer_seconds: readRequiredIntegerDefault(
      defaults,
      CONTAINER_MANAGER_RUNTIME_DEFAULTS.dockerActionBufferSeconds,
    ),
    log_flush_interval_ms: readRequiredIntegerDefault(defaults, CONTAINER_MANAGER_RUNTIME_DEFAULTS.logFlushIntervalMs),
    docker_event_reconnect_backoff_ms: readRequiredIntegerDefault(
      defaults,
      CONTAINER_MANAGER_RUNTIME_DEFAULTS.dockerEventReconnectBackoffMs,
    ),
    crash_log_capture_timeout_seconds: readRequiredIntegerDefault(
      defaults,
      CONTAINER_MANAGER_RUNTIME_DEFAULTS.crashLogCaptureTimeoutSeconds,
    ),
    starvation_threshold_seconds: readRequiredIntegerDefault(
      defaults,
      CONTAINER_MANAGER_RUNTIME_DEFAULTS.starvationThresholdSeconds,
    ),
    runtime_orphan_grace_cycles: readRequiredIntegerDefault(
      defaults,
      CONTAINER_MANAGER_RUNTIME_DEFAULTS.runtimeOrphanGraceCycles,
    ),
    hung_runtime_stale_after_seconds: readRequiredIntegerDefault(
      defaults,
      CONTAINER_MANAGER_RUNTIME_DEFAULTS.hungRuntimeStaleAfterSeconds,
    ),
    hung_runtime_stop_grace_period_seconds: readRequiredIntegerDefault(
      defaults,
      CONTAINER_MANAGER_RUNTIME_DEFAULTS.hungRuntimeStopGracePeriodSeconds,
    ),
    global_max_runtimes: readRequiredIntegerDefault(defaults, CONTAINER_MANAGER_RUNTIME_DEFAULTS.globalMaxSpecialists),
    runtime_log_max_size_mb: readRequiredIntegerDefault(
      defaults,
      CONTAINER_MANAGER_RUNTIME_DEFAULTS.runtimeLogMaxSizeMB,
    ),
    runtime_log_max_files: readRequiredIntegerDefault(defaults, CONTAINER_MANAGER_RUNTIME_DEFAULTS.runtimeLogMaxFiles),
  };
}

export function readRuntimeHeartbeatFreshnessSeconds(defaults: Map<string, string>): number {
  return readRequiredIntegerDefault(defaults, CONTAINER_MANAGER_RUNTIME_DEFAULTS.hungRuntimeStaleAfterSeconds);
}

export function readSpecialistRuntimeTargetDefaults(
  defaults: Map<string, string>,
): SpecialistRuntimeTargetDefaults {
  return {
    image: readRequiredStringDefault(defaults, SPECIALIST_RUNTIME_TARGET_DEFAULT_KEYS.image),
    cpu: readRequiredStringDefault(defaults, SPECIALIST_RUNTIME_TARGET_DEFAULT_KEYS.cpu),
    memory: readRequiredStringDefault(defaults, SPECIALIST_RUNTIME_TARGET_DEFAULT_KEYS.memory),
    pullPolicy: readRequiredStringDefault(defaults, SPECIALIST_RUNTIME_TARGET_DEFAULT_KEYS.pullPolicy),
    bootstrapClaimTimeoutSeconds: readRequiredIntegerDefault(
      defaults,
      SPECIALIST_RUNTIME_TARGET_DEFAULT_KEYS.bootstrapClaimTimeoutSeconds,
    ),
    drainGraceSeconds: readRequiredIntegerDefault(defaults, SPECIALIST_RUNTIME_TARGET_DEFAULT_KEYS.drainGraceSeconds),
  };
}

export function readRequiredIntegerDefault(defaults: Map<string, string>, key: string): number {
  const parsed = Number(defaults.get(key) ?? '');
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError(`Missing runtime default "${key}"`);
  }
  return parsed;
}

function readRequiredStringDefault(defaults: Map<string, string>, key: string): string {
  const value = defaults.get(key)?.trim();
  if (!value) {
    throw new ValidationError(`Missing runtime default "${key}"`);
  }
  return value;
}

export interface FleetRuntimeStatsRow {
  pending_tasks: number;
  active_runtimes: number;
  active_execution_containers: number;
}

