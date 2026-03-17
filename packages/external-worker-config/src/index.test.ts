import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadWorkerConfig, parseWorkerConfigFile } from './index.js';

describe('worker config file support (FR-294)', () => {
  it('loads structured worker configuration from JSON file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ab-config-'));
    const filePath = join(dir, 'worker.json');

    writeFileSync(
      filePath,
      JSON.stringify({
        server: { url: 'https://platform.example.test', authToken: 'file-token' },
        runtime: { adapter: 'openclaw', settings: { model: 'gpt-5' } },
        capabilities: ['typescript', 'testing'],
        toolTags: { required: ['git'], optional: ['docker'] },
        connection: {
          mode: 'sse',
          heartbeatIntervalSeconds: 15,
          reconnect: { minMs: 1000, maxMs: 4000 },
        },
        taskFilter: { projectId: 'project-alpha',  },
        logging: { level: 'debug' },
      }),
      'utf8',
    );

    const config = loadWorkerConfig({ filePath, env: {} });

    expect(config).toMatchObject({
      server: { url: 'https://platform.example.test', authToken: 'file-token' },
      runtime: { adapter: 'openclaw', settings: { model: 'gpt-5' } },
      capabilities: ['typescript', 'testing'],
      toolTags: { required: ['git'], optional: ['docker'] },
      connection: {
        mode: 'sse',
        heartbeatIntervalSeconds: 15,
        reconnect: { minMs: 1000, maxMs: 4000 },
      },
      taskFilter: { projectId: 'project-alpha',  },
      logging: { level: 'debug' },
    });
  });

  it('rejects non-object config payloads', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ab-config-'));
    const filePath = join(dir, 'invalid.json');
    writeFileSync(filePath, JSON.stringify(['invalid']), 'utf8');

    expect(() => parseWorkerConfigFile(filePath)).toThrow('Worker config file must contain a JSON object');
  });
});

describe('environment override precedence (FR-295)', () => {
  it('applies environment values over file configuration', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ab-config-'));
    const filePath = join(dir, 'worker.json');

    writeFileSync(
      filePath,
      JSON.stringify({
        server: { url: 'https://file.example.test', authToken: 'file-token' },
        runtime: { adapter: 'claude-code', settings: {} },
        capabilities: ['file-capability'],
        toolTags: { required: ['file-required'], optional: ['file-optional'] },
        connection: { mode: 'polling', heartbeatIntervalSeconds: 30, reconnect: { minMs: 500, maxMs: 2000 } },
        taskFilter: { projectId: 'project-file',  },
        logging: { level: 'warn' },
      }),
      'utf8',
    );

    const config = loadWorkerConfig({
      filePath,
      env: {
        AGIRUNNER_WORKER_SERVER_URL: 'https://env.example.test',
        AGIRUNNER_WORKER_AUTH_TOKEN: 'env-token',
        AGIRUNNER_WORKER_RUNTIME_ADAPTER: 'openclaw',
        AGIRUNNER_WORKER_CAPABILITIES: 'env-a, env-b',
        AGIRUNNER_WORKER_TOOL_TAGS_REQUIRED: 'git, ci',
        AGIRUNNER_WORKER_TOOL_TAGS_OPTIONAL: 'docker',
        AGIRUNNER_WORKER_CONNECTION_MODE: 'websocket',
        AGIRUNNER_WORKER_HEARTBEAT_INTERVAL_SECONDS: '12',
        AGIRUNNER_WORKER_RECONNECT_MIN_MS: '1500',
        AGIRUNNER_WORKER_RECONNECT_MAX_MS: '3500',
        AGIRUNNER_WORKER_FILTER_PROJECT_ID: 'project-env',

      },
    });

    expect(config).toMatchObject({
      server: { url: 'https://env.example.test', authToken: 'env-token' },
      runtime: { adapter: 'openclaw' },
      capabilities: ['env-a', 'env-b'],
      toolTags: { required: ['git', 'ci'], optional: ['docker'] },
      connection: {
        mode: 'websocket',
        heartbeatIntervalSeconds: 12,
        reconnect: { minMs: 1500, maxMs: 3500 },
      },
      taskFilter: { projectId: 'project-env',  },
      logging: { level: 'warn' },
    });
  });

  it('does not allow environment log-level overrides to bypass file governance', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ab-config-'));
    const filePath = join(dir, 'worker.json');

    writeFileSync(
      filePath,
      JSON.stringify({
        logging: { level: 'warn' },
      }),
      'utf8',
    );

    const config = loadWorkerConfig({
      filePath,
      env: {
        AGIRUNNER_WORKER_LOG_LEVEL: 'error',
      },
    });

    expect(config.logging.level).toBe('warn');
  });
});
