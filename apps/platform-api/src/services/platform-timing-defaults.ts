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

const DEFAULT_WORKFLOW_ACTIVATION_DELAY_MS = 10_000;
const DEFAULT_WORKFLOW_ACTIVATION_HEARTBEAT_INTERVAL_MS = 900_000;
const DEFAULT_WORKFLOW_ACTIVATION_STALE_AFTER_MS = 300_000;
const DEFAULT_TASK_CANCEL_SIGNAL_GRACE_PERIOD_MS = 60_000;

export interface WorkflowActivationTimingDefaults {
  activationDelayMs: number;
  heartbeatIntervalMs: number;
  staleAfterMs: number;
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
