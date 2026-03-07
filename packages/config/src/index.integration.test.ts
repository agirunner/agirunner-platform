import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadWorkerConfig } from './index.js';

describe('worker config end-to-end merge integration (FR-294, FR-295)', () => {
  it('merges defaults, file values, and env overrides in precedence order', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ab-config-integration-'));
    const filePath = join(dir, 'worker.json');

    writeFileSync(
      filePath,
      JSON.stringify({
        runtime: { adapter: 'custom-script', settings: { script: './worker.sh' } },
        connection: { mode: 'sse', heartbeatIntervalSeconds: 20, reconnect: { minMs: 1000, maxMs: 3000 } },
        logging: { level: 'debug' },
      }),
      'utf8',
    );

    const config = loadWorkerConfig({
      filePath,
      env: {
        AGIRUNNER_WORKER_SERVER_URL: 'https://env-platform.test',
        AGIRUNNER_WORKER_RUNTIME_ADAPTER: 'openclaw',
        AGIRUNNER_WORKER_CONNECTION_MODE: 'websocket',
        AGIRUNNER_WORKER_HEARTBEAT_INTERVAL_SECONDS: '10',
      },
    });

    expect(config.server.url).toBe('https://env-platform.test');
    expect(config.runtime.adapter).toBe('openclaw');
    expect(config.runtime.settings).toEqual({ script: './worker.sh' });
    expect(config.connection.mode).toBe('websocket');
    expect(config.connection.heartbeatIntervalSeconds).toBe(10);
    expect(config.connection.reconnect).toEqual({ minMs: 1000, maxMs: 3000 });
    expect(config.logging.level).toBe('debug');
  });
});
