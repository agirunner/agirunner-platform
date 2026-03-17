import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { DEFAULT_TENANT_ID } from '../db/seed.js';
import { readRuntimeDefaultValue } from './runtime-default-values.js';

export const WORKFLOW_ACTIVATION_DELAY_MS_RUNTIME_KEY = 'platform.workflow_activation_delay_ms';
export const WORKFLOW_ACTIVATION_HEARTBEAT_INTERVAL_MS_RUNTIME_KEY =
  'platform.workflow_activation_heartbeat_interval_ms';
export const WORKFLOW_ACTIVATION_STALE_AFTER_MS_RUNTIME_KEY =
  'platform.workflow_activation_stale_after_ms';
export const TASK_CANCEL_SIGNAL_GRACE_PERIOD_MS_RUNTIME_KEY =
  'platform.task_cancel_signal_grace_period_ms';
export const WORKER_DISPATCH_ACK_TIMEOUT_MS_RUNTIME_KEY = 'platform.worker_dispatch_ack_timeout_ms';
export const WORKER_DEFAULT_HEARTBEAT_INTERVAL_SECONDS_RUNTIME_KEY =
  'platform.worker_default_heartbeat_interval_seconds';
export const WORKER_OFFLINE_GRACE_PERIOD_MS_RUNTIME_KEY = 'platform.worker_offline_grace_period_ms';
export const WORKER_OFFLINE_THRESHOLD_MULTIPLIER_RUNTIME_KEY =
  'platform.worker_offline_threshold_multiplier';
export const WORKER_DEGRADED_THRESHOLD_MULTIPLIER_RUNTIME_KEY =
  'platform.worker_degraded_threshold_multiplier';
export const LIFECYCLE_AGENT_HEARTBEAT_CHECK_INTERVAL_MS_RUNTIME_KEY =
  'platform.lifecycle_agent_heartbeat_check_interval_ms';
export const LIFECYCLE_WORKER_HEARTBEAT_CHECK_INTERVAL_MS_RUNTIME_KEY =
  'platform.lifecycle_worker_heartbeat_check_interval_ms';
export const LIFECYCLE_TASK_TIMEOUT_CHECK_INTERVAL_MS_RUNTIME_KEY =
  'platform.lifecycle_task_timeout_check_interval_ms';
export const LIFECYCLE_DISPATCH_LOOP_INTERVAL_MS_RUNTIME_KEY =
  'platform.lifecycle_dispatch_loop_interval_ms';
export const HEARTBEAT_PRUNE_INTERVAL_MS_RUNTIME_KEY = 'platform.heartbeat_prune_interval_ms';
export const GOVERNANCE_RETENTION_JOB_INTERVAL_MS_RUNTIME_KEY =
  'platform.governance_retention_job_interval_ms';

const DEFAULT_WORKFLOW_ACTIVATION_DELAY_MS = 10_000;
const DEFAULT_WORKFLOW_ACTIVATION_HEARTBEAT_INTERVAL_MS = 900_000;
const DEFAULT_WORKFLOW_ACTIVATION_STALE_AFTER_MS = 300_000;
const DEFAULT_TASK_CANCEL_SIGNAL_GRACE_PERIOD_MS = 60_000;
const DEFAULT_WORKER_DISPATCH_ACK_TIMEOUT_MS = 15_000;
const DEFAULT_WORKER_DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 30;
const DEFAULT_WORKER_OFFLINE_GRACE_PERIOD_MS = 300_000;
const DEFAULT_WORKER_OFFLINE_THRESHOLD_MULTIPLIER = 2;
const DEFAULT_WORKER_DEGRADED_THRESHOLD_MULTIPLIER = 1;
const DEFAULT_LIFECYCLE_AGENT_HEARTBEAT_CHECK_INTERVAL_MS = 15_000;
const DEFAULT_LIFECYCLE_WORKER_HEARTBEAT_CHECK_INTERVAL_MS = 15_000;
const DEFAULT_LIFECYCLE_TASK_TIMEOUT_CHECK_INTERVAL_MS = 60_000;
const DEFAULT_LIFECYCLE_DISPATCH_LOOP_INTERVAL_MS = 2_000;
const DEFAULT_HEARTBEAT_PRUNE_INTERVAL_MS = 60_000;
const DEFAULT_GOVERNANCE_RETENTION_JOB_INTERVAL_MS = 3_600_000;

export interface WorkflowActivationTimingDefaults {
  activationDelayMs: number;
  heartbeatIntervalMs: number;
  staleAfterMs: number;
}

export interface WorkerSupervisionTimingDefaults {
  dispatchAckTimeoutMs: number;
  defaultHeartbeatIntervalSeconds: number;
  offlineGracePeriodMs: number;
  offlineThresholdMultiplier: number;
  degradedThresholdMultiplier: number;
}

export interface LifecycleMonitorTimingDefaults {
  agentHeartbeatIntervalMs: number;
  workerHeartbeatIntervalMs: number;
  taskTimeoutIntervalMs: number;
  dispatchLoopIntervalMs: number;
  heartbeatPruneIntervalMs: number;
  governanceRetentionIntervalMs: number;
}

export async function readWorkflowActivationTimingDefaults(
  db: DatabaseClient | DatabasePool,
  fallback: Partial<{
    delayMs: number;
    heartbeatIntervalMs: number;
    staleAfterMs: number;
  }> = {},
  tenantId = DEFAULT_TENANT_ID,
): Promise<WorkflowActivationTimingDefaults> {
  const [delayMs, heartbeatIntervalMs, staleAfterMs] = await Promise.all([
    readPositiveNumberDefault(
      db,
      tenantId,
      WORKFLOW_ACTIVATION_DELAY_MS_RUNTIME_KEY,
      fallback.delayMs ?? DEFAULT_WORKFLOW_ACTIVATION_DELAY_MS,
      0,
    ),
    readPositiveNumberDefault(
      db,
      tenantId,
      WORKFLOW_ACTIVATION_HEARTBEAT_INTERVAL_MS_RUNTIME_KEY,
      fallback.heartbeatIntervalMs ?? DEFAULT_WORKFLOW_ACTIVATION_HEARTBEAT_INTERVAL_MS,
      1,
    ),
    readPositiveNumberDefault(
      db,
      tenantId,
      WORKFLOW_ACTIVATION_STALE_AFTER_MS_RUNTIME_KEY,
      fallback.staleAfterMs ?? DEFAULT_WORKFLOW_ACTIVATION_STALE_AFTER_MS,
      1,
    ),
  ]);

  return {
    activationDelayMs: delayMs,
    heartbeatIntervalMs,
    staleAfterMs,
  };
}

export async function readTaskCancelSignalGracePeriodMs(
  db: DatabaseClient | DatabasePool,
  tenantId: string,
  fallbackValue = DEFAULT_TASK_CANCEL_SIGNAL_GRACE_PERIOD_MS,
): Promise<number> {
  return readPositiveNumberDefault(
    db,
    tenantId,
    TASK_CANCEL_SIGNAL_GRACE_PERIOD_MS_RUNTIME_KEY,
    fallbackValue,
    1,
  );
}

export async function readWorkerSupervisionTimingDefaults(
  db: DatabaseClient | DatabasePool,
  fallback: Partial<{
    dispatchAckTimeoutMs: number;
    defaultHeartbeatIntervalSeconds: number;
    offlineGracePeriodMs: number;
    offlineThresholdMultiplier: number;
    degradedThresholdMultiplier: number;
  }> = {},
  tenantId = DEFAULT_TENANT_ID,
): Promise<WorkerSupervisionTimingDefaults> {
  const [
    dispatchAckTimeoutMs,
    defaultHeartbeatIntervalSeconds,
    offlineGracePeriodMs,
    offlineThresholdMultiplier,
    degradedThresholdMultiplier,
  ] = await Promise.all([
    readPositiveNumberDefault(
      db,
      tenantId,
      WORKER_DISPATCH_ACK_TIMEOUT_MS_RUNTIME_KEY,
      fallback.dispatchAckTimeoutMs ?? DEFAULT_WORKER_DISPATCH_ACK_TIMEOUT_MS,
      1,
    ),
    readPositiveNumberDefault(
      db,
      tenantId,
      WORKER_DEFAULT_HEARTBEAT_INTERVAL_SECONDS_RUNTIME_KEY,
      fallback.defaultHeartbeatIntervalSeconds ?? DEFAULT_WORKER_DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
      1,
    ),
    readPositiveNumberDefault(
      db,
      tenantId,
      WORKER_OFFLINE_GRACE_PERIOD_MS_RUNTIME_KEY,
      fallback.offlineGracePeriodMs ?? DEFAULT_WORKER_OFFLINE_GRACE_PERIOD_MS,
      0,
    ),
    readPositiveNumberDefault(
      db,
      tenantId,
      WORKER_OFFLINE_THRESHOLD_MULTIPLIER_RUNTIME_KEY,
      fallback.offlineThresholdMultiplier ?? DEFAULT_WORKER_OFFLINE_THRESHOLD_MULTIPLIER,
      1,
    ),
    readPositiveNumberDefault(
      db,
      tenantId,
      WORKER_DEGRADED_THRESHOLD_MULTIPLIER_RUNTIME_KEY,
      fallback.degradedThresholdMultiplier ?? DEFAULT_WORKER_DEGRADED_THRESHOLD_MULTIPLIER,
      1,
    ),
  ]);

  return {
    dispatchAckTimeoutMs,
    defaultHeartbeatIntervalSeconds,
    offlineGracePeriodMs,
    offlineThresholdMultiplier,
    degradedThresholdMultiplier,
  };
}

export async function readLifecycleMonitorTimingDefaults(
  db: DatabaseClient | DatabasePool,
  fallback: Partial<{
    agentHeartbeatIntervalMs: number;
    workerHeartbeatIntervalMs: number;
    taskTimeoutIntervalMs: number;
    dispatchLoopIntervalMs: number;
    heartbeatPruneIntervalMs: number;
    governanceRetentionIntervalMs: number;
  }> = {},
  tenantId = DEFAULT_TENANT_ID,
): Promise<LifecycleMonitorTimingDefaults> {
  const [
    agentHeartbeatIntervalMs,
    workerHeartbeatIntervalMs,
    taskTimeoutIntervalMs,
    dispatchLoopIntervalMs,
    heartbeatPruneIntervalMs,
    governanceRetentionIntervalMs,
  ] = await Promise.all([
    readPositiveNumberDefault(
      db,
      tenantId,
      LIFECYCLE_AGENT_HEARTBEAT_CHECK_INTERVAL_MS_RUNTIME_KEY,
      fallback.agentHeartbeatIntervalMs ?? DEFAULT_LIFECYCLE_AGENT_HEARTBEAT_CHECK_INTERVAL_MS,
      1,
    ),
    readPositiveNumberDefault(
      db,
      tenantId,
      LIFECYCLE_WORKER_HEARTBEAT_CHECK_INTERVAL_MS_RUNTIME_KEY,
      fallback.workerHeartbeatIntervalMs ?? DEFAULT_LIFECYCLE_WORKER_HEARTBEAT_CHECK_INTERVAL_MS,
      1,
    ),
    readPositiveNumberDefault(
      db,
      tenantId,
      LIFECYCLE_TASK_TIMEOUT_CHECK_INTERVAL_MS_RUNTIME_KEY,
      fallback.taskTimeoutIntervalMs ?? DEFAULT_LIFECYCLE_TASK_TIMEOUT_CHECK_INTERVAL_MS,
      1,
    ),
    readPositiveNumberDefault(
      db,
      tenantId,
      LIFECYCLE_DISPATCH_LOOP_INTERVAL_MS_RUNTIME_KEY,
      fallback.dispatchLoopIntervalMs ?? DEFAULT_LIFECYCLE_DISPATCH_LOOP_INTERVAL_MS,
      1,
    ),
    readPositiveNumberDefault(
      db,
      tenantId,
      HEARTBEAT_PRUNE_INTERVAL_MS_RUNTIME_KEY,
      fallback.heartbeatPruneIntervalMs ?? DEFAULT_HEARTBEAT_PRUNE_INTERVAL_MS,
      1,
    ),
    readPositiveNumberDefault(
      db,
      tenantId,
      GOVERNANCE_RETENTION_JOB_INTERVAL_MS_RUNTIME_KEY,
      fallback.governanceRetentionIntervalMs ?? DEFAULT_GOVERNANCE_RETENTION_JOB_INTERVAL_MS,
      1000,
    ),
  ]);

  return {
    agentHeartbeatIntervalMs,
    workerHeartbeatIntervalMs,
    taskTimeoutIntervalMs,
    dispatchLoopIntervalMs,
    heartbeatPruneIntervalMs,
    governanceRetentionIntervalMs,
  };
}

async function readPositiveNumberDefault(
  db: DatabaseClient | DatabasePool,
  tenantId: string,
  key: string,
  fallbackValue: number,
  minValue: number,
): Promise<number> {
  const rawValue = await readRuntimeDefaultValue(db, tenantId, key);
  if (rawValue === null) {
    return fallbackValue;
  }
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed >= minValue ? parsed : fallbackValue;
}
