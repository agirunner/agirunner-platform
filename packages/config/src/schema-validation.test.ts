import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadWorkerConfig } from './index.js';

describe('worker config schema validation', () => {
  it('falls back to defaults when invalid numeric env overrides are provided', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ab-config-schema-'));
    const filePath = join(dir, 'worker.json');
    writeFileSync(filePath, JSON.stringify({}), 'utf8');

    const config = loadWorkerConfig({
      filePath,
      env: {
        AGENTBATON_WORKER_HEARTBEAT_INTERVAL_SECONDS: 'not-a-number',
        AGENTBATON_WORKER_RECONNECT_MIN_MS: '-1',
        AGENTBATON_WORKER_RECONNECT_MAX_MS: '0',
      },
    });

    expect(config.connection.heartbeatIntervalSeconds).toBe(30);
    expect(config.connection.reconnect).toEqual({ minMs: 500, maxMs: 10_000 });
  });
});
