import { describe, expect, it, vi } from 'vitest';

import {
  readTaskCancelSignalGracePeriodMs,
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

    const defaults = await readWorkflowActivationTimingDefaults(
      pool as never,
      { delayMs: 10_000, heartbeatIntervalMs: 90_000, staleAfterMs: 300_000 },
      'tenant-1',
    );

    expect(defaults).toEqual({
      activationDelayMs: 15_000,
      heartbeatIntervalMs: 120_000,
      staleAfterMs: 450_000,
    });
  });

  it('falls back to provided values when runtime defaults are absent', async () => {
    const pool = {
      query: vi.fn(async () => ({ rowCount: 0, rows: [] })),
    };

    const defaults = await readWorkflowActivationTimingDefaults(
      pool as never,
      { delayMs: 11_000, heartbeatIntervalMs: 91_000, staleAfterMs: 301_000 },
      'tenant-1',
    );
    const cancelGraceMs = await readTaskCancelSignalGracePeriodMs(pool as never, 'tenant-1', 75_000);

    expect(defaults).toEqual({
      activationDelayMs: 11_000,
      heartbeatIntervalMs: 91_000,
      staleAfterMs: 301_000,
    });
    expect(cancelGraceMs).toBe(75_000);
  });
});
