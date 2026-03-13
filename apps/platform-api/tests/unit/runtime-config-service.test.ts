import { describe, expect, it, vi, beforeEach } from 'vitest';

import { RuntimeConfigService } from '../../src/services/runtime-config-service.js';

function createMockPool() {
  return { query: vi.fn() };
}

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

const sampleWorker = {
  id: 'worker-1',
  name: 'built-in-worker',
  capabilities: ['llm-api', 'role:developer', 'role:reviewer'],
};

const sampleRole = {
  name: 'developer',
  description: 'Implements features',
  system_prompt: 'You are a developer.',
  allowed_tools: ['file_read', 'file_write'],
  capabilities: ['llm-api', 'role:developer'],
  verification_strategy: 'unit_tests',
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
      .mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 }) // fetchDefaults
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // fetchModelAssignment (none)

    const result = await service.getConfigForWorker(TENANT_ID, 'built-in-worker');

    expect(result.workerName).toBe('built-in-worker');
    expect(result.roles).toHaveLength(1);
    expect(result.roles[0].name).toBe('developer');
    expect(result.defaults).toHaveLength(1);
    expect(result.defaults[0].key).toBe('max_rework_attempts');
    expect(result.primaryModel).toBeNull();
    expect(result.version).toBeDefined();
  });

  it('redacts secret-bearing runtime defaults in worker config responses', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [sampleWorker], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [sampleRole], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [sampleSecretDefault], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

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

  it('includes model assignment when available', async () => {
    const modelRow = {
      model_id: 'claude-sonnet-4-6',
      provider_id: 'p1',
      provider_name: 'anthropic',
      provider_base_url: 'https://api.anthropic.com',
      context_window: 200000,
      max_output_tokens: 8192,
      supports_tool_use: true,
      supports_vision: true,
    };

    pool.query
      .mockResolvedValueOnce({ rows: [sampleWorker], rowCount: 1 }) // findWorker
      .mockResolvedValueOnce({ rows: [sampleRole], rowCount: 1 }) // fetchRoles
      .mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 }) // fetchDefaults
      .mockResolvedValueOnce({ // fetchModelAssignment
        rows: [{ primary_model_id: 'model-1' }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [modelRow], rowCount: 1 }); // fetchModelWithProvider

    const result = await service.getConfigForWorker(TENANT_ID, 'built-in-worker');

    expect(result.primaryModel).not.toBeNull();
    expect(result.primaryModel!.modelId).toBe('claude-sonnet-4-6');
    expect(result.primaryModel!.providerName).toBe('anthropic');
    expect(result).not.toHaveProperty('fallbackModel');
  });

  it('returns all active roles when worker has no role capabilities', async () => {
    const workerNoRoles = { ...sampleWorker, capabilities: ['llm-api'] };

    pool.query
      .mockResolvedValueOnce({ rows: [workerNoRoles], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [sampleRole], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await service.getConfigForWorker(TENANT_ID, 'built-in-worker');
    expect(result.roles).toHaveLength(1);
  });
});
