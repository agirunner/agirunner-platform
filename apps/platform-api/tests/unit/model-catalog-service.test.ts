import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ModelCatalogService } from '../../src/services/model-catalog-service.js';

function createMockPool() {
  return { query: vi.fn() };
}

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const PROVIDER_ID = '00000000-0000-0000-0000-000000000010';
const MODEL_ID = '00000000-0000-0000-0000-000000000020';

const sampleProvider = {
  id: PROVIDER_ID,
  tenant_id: TENANT_ID,
  name: 'anthropic',
  base_url: 'https://api.anthropic.com',
  api_key_secret_ref: null,
  is_enabled: true,
  rate_limit_rpm: null,
  metadata: {},
  created_at: new Date(),
  updated_at: new Date(),
};

const sampleModel = {
  id: MODEL_ID,
  tenant_id: TENANT_ID,
  provider_id: PROVIDER_ID,
  model_id: 'claude-sonnet-4-6',
  context_window: 200000,
  max_output_tokens: 8192,
  supports_tool_use: true,
  supports_vision: true,
  input_cost_per_million_usd: '3.00',
  output_cost_per_million_usd: '15.00',
  is_enabled: true,
  created_at: new Date(),
};

describe('ModelCatalogService', () => {
  let pool: ReturnType<typeof createMockPool>;
  let service: ModelCatalogService;

  beforeEach(() => {
    pool = createMockPool();
    service = new ModelCatalogService(pool as never);
  });

  describe('providers', () => {
    it('lists all providers for tenant', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleProvider], rowCount: 1 });
      const result = await service.listProviders(TENANT_ID);
      expect(result).toEqual([sampleProvider]);
    });

    it('gets a provider by id', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleProvider], rowCount: 1 });
      const result = await service.getProvider(TENANT_ID, PROVIDER_ID);
      expect(result).toEqual(sampleProvider);
    });

    it('throws NotFoundError for missing provider', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      await expect(service.getProvider(TENANT_ID, PROVIDER_ID)).rejects.toThrow('LLM provider not found');
    });

    it('creates a provider', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [sampleProvider], rowCount: 1 });
      const result = await service.createProvider(TENANT_ID, {
        name: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        isEnabled: true,
        metadata: {},
      });
      expect(result).toEqual(sampleProvider);
    });

    it('rejects invalid provider input', async () => {
      await expect(
        service.createProvider(TENANT_ID, {
          name: '',
          baseUrl: 'not-a-url',
          isEnabled: true,
          metadata: {},
        }),
      ).rejects.toThrow();
    });

    it('updates a provider', async () => {
      const updated = { ...sampleProvider, name: 'updated-anthropic' };
      pool.query.mockResolvedValueOnce({ rows: [updated], rowCount: 1 });
      const result = await service.updateProvider(TENANT_ID, PROVIDER_ID, { name: 'updated-anthropic' });
      expect(result.name).toBe('updated-anthropic');
    });

    it('deletes a provider and cascades to models and assignments', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // clear assignments
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // delete models
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // delete provider

      await expect(service.deleteProvider(TENANT_ID, PROVIDER_ID)).resolves.toBeUndefined();
      expect(pool.query).toHaveBeenCalledTimes(3);
    });
  });

  describe('models', () => {
    it('lists all models for tenant', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleModel], rowCount: 1 });
      const result = await service.listModels(TENANT_ID);
      expect(result).toEqual([sampleModel]);
    });

    it('lists models filtered by provider', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleModel], rowCount: 1 });
      const result = await service.listModels(TENANT_ID, PROVIDER_ID);
      expect(result).toEqual([sampleModel]);
      const sql = pool.query.mock.calls[0][0] as string;
      expect(sql).toContain('provider_id');
    });

    it('gets a model by id', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleModel], rowCount: 1 });
      const result = await service.getModel(TENANT_ID, MODEL_ID);
      expect(result).toEqual(sampleModel);
    });

    it('throws NotFoundError for missing model', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      await expect(service.getModel(TENANT_ID, MODEL_ID)).rejects.toThrow('LLM model not found');
    });

    it('creates a model after verifying provider exists', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [sampleProvider], rowCount: 1 }) // getProvider
        .mockResolvedValueOnce({ rows: [sampleModel], rowCount: 1 }); // INSERT

      const result = await service.createModel(TENANT_ID, {
        providerId: PROVIDER_ID,
        modelId: 'claude-sonnet-4-6',
        contextWindow: 200000,
        maxOutputTokens: 8192,
        supportsToolUse: true,
        supportsVision: true,
        inputCostPerMillionUsd: 3.0,
        outputCostPerMillionUsd: 15.0,
        isEnabled: true,
        reasoningConfig: null,
      });
      expect(result).toEqual(sampleModel);
    });

    it('deletes a model', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      await expect(service.deleteModel(TENANT_ID, MODEL_ID)).resolves.toBeUndefined();
    });
  });

  describe('assignments', () => {
    it('lists assignments for tenant', async () => {
      const assignment = {
        id: 'a1',
        tenant_id: TENANT_ID,
        role_name: 'developer',
        primary_model_id: MODEL_ID,
        created_at: new Date(),
        updated_at: new Date(),
      };
      pool.query.mockResolvedValueOnce({ rows: [assignment], rowCount: 1 });
      const result = await service.listAssignments(TENANT_ID);
      expect(result).toEqual([assignment]);
    });

    it('upserts an assignment', async () => {
      const assignment = {
        id: 'a1',
        tenant_id: TENANT_ID,
        role_name: 'developer',
        primary_model_id: MODEL_ID,
        created_at: new Date(),
        updated_at: new Date(),
      };
      pool.query.mockResolvedValueOnce({ rows: [assignment], rowCount: 1 });

      const result = await service.upsertAssignment(TENANT_ID, 'developer', MODEL_ID, null);
      expect(result.role_name).toBe('developer');
      const sql = pool.query.mock.calls[0][0] as string;
      expect(sql).toContain('ON CONFLICT');
    });
  });
});
