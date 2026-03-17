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

const DEFAULT_WORKFLOW_ACTIVATION_DELAY_MS = 10_000;
const DEFAULT_WORKFLOW_ACTIVATION_HEARTBEAT_INTERVAL_MS = 900_000;
const DEFAULT_WORKFLOW_ACTIVATION_STALE_AFTER_MS = 300_000;
const DEFAULT_TASK_CANCEL_SIGNAL_GRACE_PERIOD_MS = 60_000;
const DEFAULT_WORKER_DISPATCH_ACK_TIMEOUT_MS = 15_000;
const DEFAULT_WORKER_DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 30;
const DEFAULT_WORKER_OFFLINE_GRACE_PERIOD_MS = 300_000;
const DEFAULT_WORKER_OFFLINE_THRESHOLD_MULTIPLIER = 2;
const DEFAULT_WORKER_DEGRADED_THRESHOLD_MULTIPLIER = 1;

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
