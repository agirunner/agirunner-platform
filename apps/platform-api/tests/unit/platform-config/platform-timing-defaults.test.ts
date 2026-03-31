import { describe, expect, it, vi } from 'vitest';

import {
  readAgentSupervisionTimingDefaults,
  readPlatformTransportTimingDefaults,
  readWorkerDispatchAckTimeoutMs,
  readLifecycleMonitorTimingDefaults,
  readTaskCancelSignalGracePeriodMs,
  readWorkerSupervisionTimingDefaults,
  readWorkflowActivationTimingDefaults,
} from '../../../src/services/platform-timing-defaults.js';

describe('platform timing defaults', () => {
  it('reads workflow activation timings from runtime defaults storage', async () => {
    const pool = {
      query: vi.fn(async (_sql: string, params?: unknown[]) => {
        const key = params?.[1];
        if (key === 'platform.workflow_activation_delay_ms') {
          return { rowCount: 1, rows: [{ config_value: '15000' }] };
        }
        if (key === 'platform.workflow_activation_heartbeat_interval_ms') {
          return { rowCount: 1, rows: [{ config_value: '120000' }] };
        }
        if (key === 'platform.workflow_activation_stale_after_ms') {
          return { rowCount: 1, rows: [{ config_value: '450000' }] };
        }
        throw new Error(`Unexpected runtime-default key: ${String(key)}`);
      }),
    };

    const defaults = await readWorkflowActivationTimingDefaults(pool as never, 'tenant-1');

    expect(defaults).toEqual({
      activationDelayMs: 15_000,
      heartbeatIntervalMs: 120_000,
      staleAfterMs: 450_000,
    });
  });

  it('fails when required runtime defaults are absent', async () => {
    const pool = {
      query: vi.fn(async () => ({ rowCount: 0, rows: [] })),
    };

    await expect(readWorkflowActivationTimingDefaults(pool as never, 'tenant-1')).rejects.toThrow(
      'Missing runtime default "platform.workflow_activation_delay_ms"',
    );
    await expect(readTaskCancelSignalGracePeriodMs(pool as never, 'tenant-1')).rejects.toThrow(
      'Missing runtime default "platform.task_cancel_signal_grace_period_ms"',
    );
    await expect(readWorkerDispatchAckTimeoutMs(pool as never, 'tenant-1')).rejects.toThrow(
      'Missing runtime default "platform.worker_dispatch_ack_timeout_ms"',
    );
    await expect(readAgentSupervisionTimingDefaults(pool as never, 'tenant-1')).rejects.toThrow(
      'Missing runtime default "platform.agent_default_heartbeat_interval_seconds"',
    );
    await expect(readWorkerSupervisionTimingDefaults(pool as never, 'tenant-1')).rejects.toThrow(
      'Missing runtime default "platform.worker_dispatch_ack_timeout_ms"',
    );
  });

  it('reads worker dispatch-ack timeout from runtime defaults storage', async () => {
    const pool = {
      query: vi.fn(async (_sql: string, params?: unknown[]) => {
        const key = params?.[1];
        if (key === 'platform.worker_dispatch_ack_timeout_ms') {
          return { rowCount: 1, rows: [{ config_value: '17000' }] };
        }
        if (key === 'platform.worker_default_heartbeat_interval_seconds') {
          return { rowCount: 1, rows: [{ config_value: '30' }] };
        }
        if (key === 'platform.worker_offline_grace_period_ms') {
          return { rowCount: 1, rows: [{ config_value: '300000' }] };
        }
        if (key === 'platform.worker_offline_threshold_multiplier') {
          return { rowCount: 1, rows: [{ config_value: '2' }] };
        }
        if (key === 'platform.worker_degraded_threshold_multiplier') {
          return { rowCount: 1, rows: [{ config_value: '1.5' }] };
        }
        if (key === 'platform.worker_key_expiry_ms') {
          return { rowCount: 1, rows: [{ config_value: '86400000' }] };
        }
        throw new Error(`Unexpected runtime-default key: ${String(key)}`);
      }),
    };

    await expect(readWorkerDispatchAckTimeoutMs(pool as never, 'tenant-1')).resolves.toBe(17_000);
    await expect(readWorkerSupervisionTimingDefaults(pool as never, 'tenant-1')).resolves.toEqual({
      dispatchAckTimeoutMs: 17_000,
      defaultHeartbeatIntervalSeconds: 30,
      offlineGracePeriodMs: 300_000,
      offlineThresholdMultiplier: 2,
      degradedThresholdMultiplier: 1.5,
      keyExpiryMs: 86_400_000,
    });
  });

  it('reads agent supervision timings from runtime defaults storage', async () => {
    const pool = {
      query: vi.fn(async (_sql: string, params?: unknown[]) => {
        const key = params?.[1];
        if (key === 'platform.agent_default_heartbeat_interval_seconds') {
          return { rowCount: 1, rows: [{ config_value: '45' }] };
        }
        if (key === 'platform.agent_heartbeat_grace_period_ms') {
          return { rowCount: 1, rows: [{ config_value: '90000' }] };
        }
        if (key === 'platform.agent_heartbeat_threshold_multiplier') {
          return { rowCount: 1, rows: [{ config_value: '2.5' }] };
        }
        if (key === 'platform.agent_key_expiry_ms') {
          return { rowCount: 1, rows: [{ config_value: '86400000' }] };
        }
        throw new Error(`Unexpected runtime-default key: ${String(key)}`);
      }),
    };

    await expect(readAgentSupervisionTimingDefaults(pool as never, 'tenant-1')).resolves.toEqual({
      defaultHeartbeatIntervalSeconds: 45,
      heartbeatGracePeriodMs: 90_000,
      heartbeatThresholdMultiplier: 2.5,
      keyExpiryMs: 86_400_000,
    });
  });

  it('reads lifecycle monitor timings from runtime defaults storage', async () => {
    const pool = {
      query: vi.fn(async (_sql: string, params?: unknown[]) => {
        const key = params?.[1];
        if (key === 'platform.lifecycle_agent_heartbeat_check_interval_ms') {
          return { rowCount: 1, rows: [{ config_value: '21000' }] };
        }
        if (key === 'platform.lifecycle_worker_heartbeat_check_interval_ms') {
          return { rowCount: 1, rows: [{ config_value: '22000' }] };
        }
        if (key === 'platform.lifecycle_task_timeout_check_interval_ms') {
          return { rowCount: 1, rows: [{ config_value: '61000' }] };
        }
        if (key === 'platform.lifecycle_dispatch_loop_interval_ms') {
          return { rowCount: 1, rows: [{ config_value: '2500' }] };
        }
        if (key === 'platform.heartbeat_prune_interval_ms') {
          return { rowCount: 1, rows: [{ config_value: '45000' }] };
        }
        if (key === 'platform.governance_retention_job_interval_ms') {
          return { rowCount: 1, rows: [{ config_value: '5400000' }] };
        }
        throw new Error(`Unexpected runtime-default key: ${String(key)}`);
      }),
    };

    const defaults = await readLifecycleMonitorTimingDefaults(pool as never, 'tenant-1');

    expect(defaults).toEqual({
      agentHeartbeatIntervalMs: 21_000,
      workerHeartbeatIntervalMs: 22_000,
      taskTimeoutIntervalMs: 61_000,
      dispatchLoopIntervalMs: 2_500,
      heartbeatPruneIntervalMs: 45_000,
      governanceRetentionIntervalMs: 5_400_000,
    });
  });

  it('reads platform transport timings from runtime defaults storage', async () => {
    const pool = {
      query: vi.fn(async (_sql: string, params?: unknown[]) => {
        const key = params?.[1];
        if (key === 'platform.event_stream_keepalive_interval_ms') {
          return { rowCount: 1, rows: [{ config_value: '30000' }] };
        }
        if (key === 'platform.worker_reconnect_min_ms') {
          return { rowCount: 1, rows: [{ config_value: '1000' }] };
        }
        if (key === 'platform.worker_reconnect_max_ms') {
          return { rowCount: 1, rows: [{ config_value: '60000' }] };
        }
        if (key === 'platform.worker_websocket_ping_interval_ms') {
          return { rowCount: 1, rows: [{ config_value: '20000' }] };
        }
        throw new Error(`Unexpected runtime-default key: ${String(key)}`);
      }),
    };

    const defaults = await readPlatformTransportTimingDefaults(pool as never, 'tenant-1');

    expect(defaults).toEqual({
      EVENT_STREAM_KEEPALIVE_INTERVAL_MS: 30_000,
      WORKER_RECONNECT_MIN_MS: 1_000,
      WORKER_RECONNECT_MAX_MS: 60_000,
      WORKER_WEBSOCKET_PING_INTERVAL_MS: 20_000,
    });
  });

  it('rejects worker reconnect ranges where the minimum exceeds the maximum', async () => {
    const pool = {
      query: vi.fn(async (_sql: string, params?: unknown[]) => {
        const key = params?.[1];
        if (key === 'platform.event_stream_keepalive_interval_ms') {
          return { rowCount: 1, rows: [{ config_value: '30000' }] };
        }
        if (key === 'platform.worker_reconnect_min_ms') {
          return { rowCount: 1, rows: [{ config_value: '60000' }] };
        }
        if (key === 'platform.worker_reconnect_max_ms') {
          return { rowCount: 1, rows: [{ config_value: '1000' }] };
        }
        if (key === 'platform.worker_websocket_ping_interval_ms') {
          return { rowCount: 1, rows: [{ config_value: '20000' }] };
        }
        throw new Error(`Unexpected runtime-default key: ${String(key)}`);
      }),
    };

    await expect(
      readPlatformTransportTimingDefaults(pool as never, 'tenant-1'),
    ).rejects.toThrow('platform.worker_reconnect_min_ms must be less than or equal to platform.worker_reconnect_max_ms');
  });

  it('fails when runtime defaults contain invalid values', async () => {
    const pool = {
      query: vi.fn(async (_sql: string, params?: unknown[]) => {
        const key = params?.[1];
        if (key === 'platform.worker_offline_threshold_multiplier') {
          return { rowCount: 1, rows: [{ config_value: '0' }] };
        }
        return { rowCount: 1, rows: [{ config_value: '1' }] };
      }),
    };

    await expect(readWorkerSupervisionTimingDefaults(pool as never, 'tenant-1')).rejects.toThrow(
      'Runtime default "platform.worker_offline_threshold_multiplier" must be a finite number greater than or equal to 1',
    );
  });
});
