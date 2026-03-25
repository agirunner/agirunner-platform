import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { DEFAULT_TENANT_ID } from '../db/seed.js';
import { ValidationError } from '../errors/domain-errors.js';
import { readRuntimeDefaultValue } from './runtime-default-values.js';

export const WORKFLOW_ACTIVATION_DELAY_MS_RUNTIME_KEY = 'platform.workflow_activation_delay_ms';
export const WORKFLOW_ACTIVATION_HEARTBEAT_INTERVAL_MS_RUNTIME_KEY =
  'platform.workflow_activation_heartbeat_interval_ms';
export const WORKFLOW_ACTIVATION_STALE_AFTER_MS_RUNTIME_KEY =
  'platform.workflow_activation_stale_after_ms';
export const TASK_CANCEL_SIGNAL_GRACE_PERIOD_MS_RUNTIME_KEY =
  'platform.task_cancel_signal_grace_period_ms';
export const WORKER_DISPATCH_ACK_TIMEOUT_MS_RUNTIME_KEY = 'platform.worker_dispatch_ack_timeout_ms';
export const WORKER_KEY_EXPIRY_MS_RUNTIME_KEY = 'platform.worker_key_expiry_ms';
export const AGENT_DEFAULT_HEARTBEAT_INTERVAL_SECONDS_RUNTIME_KEY =
  'platform.agent_default_heartbeat_interval_seconds';
export const AGENT_HEARTBEAT_GRACE_PERIOD_MS_RUNTIME_KEY =
  'platform.agent_heartbeat_grace_period_ms';
export const AGENT_HEARTBEAT_THRESHOLD_MULTIPLIER_RUNTIME_KEY =
  'platform.agent_heartbeat_threshold_multiplier';
export const AGENT_KEY_EXPIRY_MS_RUNTIME_KEY = 'platform.agent_key_expiry_ms';
export const WORKER_DEFAULT_HEARTBEAT_INTERVAL_SECONDS_RUNTIME_KEY =
  'platform.worker_default_heartbeat_interval_seconds';
export const WORKER_OFFLINE_GRACE_PERIOD_MS_RUNTIME_KEY = 'platform.worker_offline_grace_period_ms';
export const WORKER_OFFLINE_THRESHOLD_MULTIPLIER_RUNTIME_KEY =
  'platform.worker_offline_threshold_multiplier';
export const WORKER_DEGRADED_THRESHOLD_MULTIPLIER_RUNTIME_KEY =
  'platform.worker_degraded_threshold_multiplier';
export const EVENT_STREAM_KEEPALIVE_INTERVAL_MS_RUNTIME_KEY =
  'platform.event_stream_keepalive_interval_ms';
export const WORKER_RECONNECT_MIN_MS_RUNTIME_KEY = 'platform.worker_reconnect_min_ms';
export const WORKER_RECONNECT_MAX_MS_RUNTIME_KEY = 'platform.worker_reconnect_max_ms';
export const WORKER_WEBSOCKET_PING_INTERVAL_MS_RUNTIME_KEY =
  'platform.worker_websocket_ping_interval_ms';
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
  keyExpiryMs: number;
}

export interface AgentSupervisionTimingDefaults {
  defaultHeartbeatIntervalSeconds: number;
  heartbeatGracePeriodMs: number;
  heartbeatThresholdMultiplier: number;
  keyExpiryMs: number;
}

export interface LifecycleMonitorTimingDefaults {
  agentHeartbeatIntervalMs: number;
  workerHeartbeatIntervalMs: number;
  taskTimeoutIntervalMs: number;
  dispatchLoopIntervalMs: number;
  heartbeatPruneIntervalMs: number;
  governanceRetentionIntervalMs: number;
}

export interface PlatformTransportTimingDefaults {
  EVENT_STREAM_KEEPALIVE_INTERVAL_MS: number;
  WORKER_RECONNECT_MIN_MS: number;
  WORKER_RECONNECT_MAX_MS: number;
  WORKER_WEBSOCKET_PING_INTERVAL_MS: number;
}

export async function readWorkflowActivationTimingDefaults(
  db: DatabaseClient | DatabasePool,
  tenantId = DEFAULT_TENANT_ID,
): Promise<WorkflowActivationTimingDefaults> {
  const [delayMs, heartbeatIntervalMs, staleAfterMs] = await Promise.all([
    readPositiveNumberDefault(
      db,
      tenantId,
      WORKFLOW_ACTIVATION_DELAY_MS_RUNTIME_KEY,
      0,
    ),
    readPositiveNumberDefault(
      db,
      tenantId,
      WORKFLOW_ACTIVATION_HEARTBEAT_INTERVAL_MS_RUNTIME_KEY,
      1,
    ),
    readPositiveNumberDefault(
      db,
      tenantId,
      WORKFLOW_ACTIVATION_STALE_AFTER_MS_RUNTIME_KEY,
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
): Promise<number> {
  return readPositiveNumberDefault(
    db,
    tenantId,
    TASK_CANCEL_SIGNAL_GRACE_PERIOD_MS_RUNTIME_KEY,
    1,
  );
}

export async function readWorkerDispatchAckTimeoutMs(
  db: DatabaseClient | DatabasePool,
  tenantId = DEFAULT_TENANT_ID,
): Promise<number> {
  return readPositiveNumberDefault(
    db,
    tenantId,
    WORKER_DISPATCH_ACK_TIMEOUT_MS_RUNTIME_KEY,
    1,
  );
}

export async function readAgentSupervisionTimingDefaults(
  db: DatabaseClient | DatabasePool,
  tenantId = DEFAULT_TENANT_ID,
): Promise<AgentSupervisionTimingDefaults> {
  const [
    defaultHeartbeatIntervalSeconds,
    heartbeatGracePeriodMs,
    heartbeatThresholdMultiplier,
    keyExpiryMs,
  ] = await Promise.all([
    readPositiveNumberDefault(
      db,
      tenantId,
      AGENT_DEFAULT_HEARTBEAT_INTERVAL_SECONDS_RUNTIME_KEY,
      1,
    ),
    readPositiveNumberDefault(
      db,
      tenantId,
      AGENT_HEARTBEAT_GRACE_PERIOD_MS_RUNTIME_KEY,
      0,
    ),
    readPositiveNumberDefault(
      db,
      tenantId,
      AGENT_HEARTBEAT_THRESHOLD_MULTIPLIER_RUNTIME_KEY,
      1,
    ),
    readPositiveNumberDefault(
      db,
      tenantId,
      AGENT_KEY_EXPIRY_MS_RUNTIME_KEY,
      1,
    ),
  ]);

  return {
    defaultHeartbeatIntervalSeconds,
    heartbeatGracePeriodMs,
    heartbeatThresholdMultiplier,
    keyExpiryMs,
  };
}

export async function readPlatformTransportTimingDefaults(
  db: DatabaseClient | DatabasePool,
  tenantId = DEFAULT_TENANT_ID,
): Promise<PlatformTransportTimingDefaults> {
  const [
    eventStreamKeepaliveIntervalMs,
    workerReconnectMinMs,
    workerReconnectMaxMs,
    workerWebsocketPingIntervalMs,
  ] = await Promise.all([
    readPositiveNumberDefault(db, tenantId, EVENT_STREAM_KEEPALIVE_INTERVAL_MS_RUNTIME_KEY, 1),
    readPositiveNumberDefault(db, tenantId, WORKER_RECONNECT_MIN_MS_RUNTIME_KEY, 1),
    readPositiveNumberDefault(db, tenantId, WORKER_RECONNECT_MAX_MS_RUNTIME_KEY, 1),
    readPositiveNumberDefault(db, tenantId, WORKER_WEBSOCKET_PING_INTERVAL_MS_RUNTIME_KEY, 1),
  ]);

  if (workerReconnectMinMs > workerReconnectMaxMs) {
    throw new ValidationError(
      'platform.worker_reconnect_min_ms must be less than or equal to platform.worker_reconnect_max_ms',
    );
  }

  return {
    EVENT_STREAM_KEEPALIVE_INTERVAL_MS: eventStreamKeepaliveIntervalMs,
    WORKER_RECONNECT_MIN_MS: workerReconnectMinMs,
    WORKER_RECONNECT_MAX_MS: workerReconnectMaxMs,
    WORKER_WEBSOCKET_PING_INTERVAL_MS: workerWebsocketPingIntervalMs,
  };
}

export async function readWorkerSupervisionTimingDefaults(
  db: DatabaseClient | DatabasePool,
  tenantId = DEFAULT_TENANT_ID,
): Promise<WorkerSupervisionTimingDefaults> {
  const [
    dispatchAckTimeoutMs,
    defaultHeartbeatIntervalSeconds,
    offlineGracePeriodMs,
    offlineThresholdMultiplier,
    degradedThresholdMultiplier,
    keyExpiryMs,
  ] = await Promise.all([
    readPositiveNumberDefault(
      db,
      tenantId,
      WORKER_DISPATCH_ACK_TIMEOUT_MS_RUNTIME_KEY,
      1,
    ),
    readPositiveNumberDefault(
      db,
      tenantId,
      WORKER_DEFAULT_HEARTBEAT_INTERVAL_SECONDS_RUNTIME_KEY,
      1,
    ),
    readPositiveNumberDefault(
      db,
      tenantId,
      WORKER_OFFLINE_GRACE_PERIOD_MS_RUNTIME_KEY,
      0,
    ),
    readPositiveNumberDefault(
      db,
      tenantId,
      WORKER_OFFLINE_THRESHOLD_MULTIPLIER_RUNTIME_KEY,
      1,
    ),
    readPositiveNumberDefault(
      db,
      tenantId,
      WORKER_DEGRADED_THRESHOLD_MULTIPLIER_RUNTIME_KEY,
      1,
    ),
    readPositiveNumberDefault(
      db,
      tenantId,
      WORKER_KEY_EXPIRY_MS_RUNTIME_KEY,
      1,
    ),
  ]);

  return {
    dispatchAckTimeoutMs,
    defaultHeartbeatIntervalSeconds,
    offlineGracePeriodMs,
    offlineThresholdMultiplier,
    degradedThresholdMultiplier,
    keyExpiryMs,
  };
}

export async function readLifecycleMonitorTimingDefaults(
  db: DatabaseClient | DatabasePool,
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
      1,
    ),
    readPositiveNumberDefault(
      db,
      tenantId,
      LIFECYCLE_WORKER_HEARTBEAT_CHECK_INTERVAL_MS_RUNTIME_KEY,
      1,
    ),
    readPositiveNumberDefault(
      db,
      tenantId,
      LIFECYCLE_TASK_TIMEOUT_CHECK_INTERVAL_MS_RUNTIME_KEY,
      1,
    ),
    readPositiveNumberDefault(
      db,
      tenantId,
      LIFECYCLE_DISPATCH_LOOP_INTERVAL_MS_RUNTIME_KEY,
      1,
    ),
    readPositiveNumberDefault(
      db,
      tenantId,
      HEARTBEAT_PRUNE_INTERVAL_MS_RUNTIME_KEY,
      1,
    ),
    readPositiveNumberDefault(
      db,
      tenantId,
      GOVERNANCE_RETENTION_JOB_INTERVAL_MS_RUNTIME_KEY,
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
  minValue: number,
): Promise<number> {
  const rawValue = await readRuntimeDefaultValue(db, tenantId, key);
  if (rawValue === null) {
    throw new ValidationError(`Missing runtime default "${key}"`);
  }
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < minValue) {
    throw new ValidationError(
      `Runtime default "${key}" must be a finite number greater than or equal to ${minValue}`,
    );
  }
  return parsed;
}
