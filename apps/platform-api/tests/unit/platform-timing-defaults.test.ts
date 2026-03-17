import { describe, expect, it, vi } from 'vitest';

import {
  readLifecycleMonitorTimingDefaults,
  readTaskCancelSignalGracePeriodMs,
  readWorkerSupervisionTimingDefaults,
  readWorkflowActivationTimingDefaults,
} from '../../src/services/platform-timing-defaults.js';

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
