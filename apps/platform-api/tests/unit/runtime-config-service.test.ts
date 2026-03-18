import { describe, expect, it, vi, beforeEach } from 'vitest';

import { RuntimeConfigService } from '../../src/services/runtime-config-service.js';

function createMockPool() {
  return { query: vi.fn() };
}

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

const sampleWorker = {
  id: 'worker-1',
  name: 'built-in-worker',
  capabilities: ['coding', 'testing', 'code-review'],
};

const sampleRole = {
  name: 'developer',
  description: 'Implements features',
  system_prompt: 'You are a developer.',
  allowed_tools: ['file_read', 'file_write'],
  capabilities: ['coding', 'testing'],
  verification_strategy: 'peer_review',
  updated_at: new Date(),
};

const sampleDefault = {
  config_key: 'max_rework_attempts',
  config_value: '3',
  config_type: 'number',
  updated_at: new Date(),
};

const sampleSecretDefault = {
  config_key: 'tools.web_search_api_key_secret_ref',
  config_value: 'secret:SERPER_API_KEY',
  config_type: 'string',
  updated_at: new Date(),
};

describe('RuntimeConfigService', () => {
  let pool: ReturnType<typeof createMockPool>;
  let service: RuntimeConfigService;

  beforeEach(() => {
    pool = createMockPool();
    service = new RuntimeConfigService(pool as never);
  });

  it('returns merged config for a worker', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [sampleWorker], rowCount: 1 }) // findWorker
      .mockResolvedValueOnce({ rows: [sampleRole], rowCount: 1 }) // fetchRoles
      .mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 }); // fetchDefaults

    const result = await service.getConfigForWorker(TENANT_ID, 'built-in-worker');

    expect(result.workerName).toBe('built-in-worker');
    expect(result.roles).toHaveLength(1);
    expect(result.roles[0].name).toBe('developer');
    expect(result.defaults).toHaveLength(1);
    expect(result.defaults[0].key).toBe('max_rework_attempts');
    expect(result).not.toHaveProperty('primaryModel');
    expect(result.version).toBeDefined();
  });

  it('redacts secret-bearing runtime defaults in worker config responses', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [sampleWorker], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [sampleRole], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [sampleSecretDefault], rowCount: 1 });

    const result = await service.getConfigForWorker(TENANT_ID, 'built-in-worker');

    expect(result.defaults).toEqual([
      {
        key: 'tools.web_search_api_key_secret_ref',
        value: 'redacted://runtime-config-secret',
        type: 'string',
      },
    ]);
  });

  it('throws NotFoundError for missing worker', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(
      service.getConfigForWorker(TENANT_ID, 'nonexistent'),
    ).rejects.toThrow('not found');
  });

  it('does not expose role model assignments through worker runtime config', async () => {
    const workerWithRole = { ...sampleWorker, capabilities: ['role:developer', 'coding'] };

    pool.query
      .mockResolvedValueOnce({ rows: [workerWithRole], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [sampleRole], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 });

    const result = await service.getConfigForWorker(TENANT_ID, 'built-in-worker');

    expect(result).not.toHaveProperty('primaryModel');
    expect(result).not.toHaveProperty('fallbackModel');
  });

  it('returns all active roles when worker has no role capabilities', async () => {
    const workerNoRoles = { ...sampleWorker, capabilities: ['coding'] };

    pool.query
      .mockResolvedValueOnce({ rows: [workerNoRoles], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [sampleRole], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await service.getConfigForWorker(TENANT_ID, 'built-in-worker');
    expect(result.roles).toHaveLength(1);
  });
});
