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

const sampleReasoningConfig = {
  type: 'effort' as const,
  options: ['low', 'medium', 'high'],
  default: 'high',
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
  endpoint_type: 'messages',
  reasoning_config: sampleReasoningConfig,
  created_at: new Date(),
};

describe('ModelCatalogService — LLM config enhancements', () => {
  let pool: ReturnType<typeof createMockPool>;
  let service: ModelCatalogService;

  beforeEach(() => {
    pool = createMockPool();
    service = new ModelCatalogService(pool as never);
  });

  describe('createProvider stores metadata', () => {
    it('includes metadata in INSERT query', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [sampleProvider], rowCount: 1 });

      await service.createProvider(TENANT_ID, {
        name: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        isEnabled: true,
        metadata: { providerType: 'anthropic' },
      });

      const sql = pool.query.mock.calls[1][0] as string;
      expect(sql).toContain('metadata');
      const params = pool.query.mock.calls[1][1] as unknown[];
      expect(params).toContain('anthropic');
    });

    it('rejects duplicate provider names', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleProvider], rowCount: 1 });

      await expect(
        service.createProvider(TENANT_ID, {
          name: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          isEnabled: true,
          metadata: {},
        }),
      ).rejects.toThrow(/already exists/);
    });
  });

  describe('createModel accepts reasoningConfig', () => {
    it('includes reasoning_config as JSONB in INSERT query', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [sampleProvider], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [sampleModel], rowCount: 1 });

      const reasoningConfig = {
        type: 'reasoning_effort' as const,
        options: ['low', 'medium', 'high'],
        default: 'medium',
      };

      await service.createModel(TENANT_ID, {
        providerId: PROVIDER_ID,
        modelId: 'o3',
        reasoningConfig,
        supportsToolUse: true,
        supportsVision: false,
        isEnabled: true,
      });

      const sql = pool.query.mock.calls[1][0] as string;
      expect(sql).toContain('reasoning_config');
      const params = pool.query.mock.calls[1][1] as unknown[];
      expect(params).toContain(JSON.stringify(reasoningConfig));
    });

    it('defaults reasoningConfig to null', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [sampleProvider], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [sampleModel], rowCount: 1 });

      await service.createModel(TENANT_ID, {
        providerId: PROVIDER_ID,
        modelId: 'gpt-4o',
        supportsToolUse: true,
        supportsVision: false,
        isEnabled: true,
        reasoningConfig: null,
      });

      const params = pool.query.mock.calls[1][1] as unknown[];
      expect(params[params.length - 1]).toBeNull();
    });

    it('stores endpoint_type per model', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [sampleProvider], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [sampleModel], rowCount: 1 });

      await service.createModel(TENANT_ID, {
        providerId: PROVIDER_ID,
        modelId: 'gpt-5.4',
        endpointType: 'responses',
        supportsToolUse: true,
        supportsVision: false,
        isEnabled: true,
        reasoningConfig: null,
      });

      const sql = pool.query.mock.calls[1][0] as string;
      expect(sql).toContain('endpoint_type');
      const params = pool.query.mock.calls[1][1] as unknown[];
      expect(params).toContain('responses');
    });
  });

  describe('upsertAssignment handles reasoningConfig', () => {
    it('includes reasoning_config as JSONB in upsert query', async () => {
      const reasoningConfig = { effort: 'max' };
      const assignment = {
        id: 'a1',
        tenant_id: TENANT_ID,
        role_name: 'developer',
        primary_model_id: MODEL_ID,
        reasoning_config: reasoningConfig,
        created_at: new Date(),
        updated_at: new Date(),
      };
      pool.query.mockResolvedValueOnce({ rows: [assignment], rowCount: 1 });

      const result = await service.upsertAssignment(
        TENANT_ID,
        'developer',
        MODEL_ID,
        reasoningConfig,
      );

      expect(result.reasoning_config).toEqual(reasoningConfig);
      const sql = pool.query.mock.calls[0][0] as string;
      expect(sql).toContain('reasoning_config');
      const params = pool.query.mock.calls[0][1] as unknown[];
      expect(params).toContain(JSON.stringify(reasoningConfig));
    });

    it('accepts null reasoning_config', async () => {
      const assignment = {
        id: 'a1',
        tenant_id: TENANT_ID,
        role_name: 'developer',
        primary_model_id: MODEL_ID,
        reasoning_config: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      pool.query.mockResolvedValueOnce({ rows: [assignment], rowCount: 1 });

      const result = await service.upsertAssignment(
        TENANT_ID,
        'developer',
        MODEL_ID,
        null,
      );

      expect(result.reasoning_config).toBeNull();
    });

    it('defaults reasoning_config to null when not provided', async () => {
      const assignment = {
        id: 'a1',
        tenant_id: TENANT_ID,
        role_name: 'developer',
        primary_model_id: MODEL_ID,
        reasoning_config: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      pool.query.mockResolvedValueOnce({ rows: [assignment], rowCount: 1 });

      await service.upsertAssignment(TENANT_ID, 'developer', MODEL_ID);

      const params = pool.query.mock.calls[0][1] as unknown[];
      expect(params[3]).toBeNull();
    });
  });

  describe('bulkCreateModels', () => {
    it('upserts discovered models with reasoning_config and endpoint_type', async () => {
      pool.query.mockResolvedValue({ rows: [sampleModel], rowCount: 1 });

      const models = [
        {
          modelId: 'claude-sonnet-4-6',
          displayName: 'Claude Sonnet',
          contextWindow: 200000,
          maxOutputTokens: 8192,
          endpointType: 'messages',
          supportsToolUse: true,
          supportsVision: true,
          inputCostPerMillionUsd: 3,
          outputCostPerMillionUsd: 15,
          reasoningConfig: sampleReasoningConfig,
        },
      ];

      const result = await service.bulkCreateModels(TENANT_ID, PROVIDER_ID, models);

      expect(result).toHaveLength(1);
      const sql = pool.query.mock.calls[0][0] as string;
      expect(sql).toContain('ON CONFLICT');
      expect(sql).toContain('DO UPDATE');
      expect(sql).toContain('endpoint_type');
      expect(sql).toContain('reasoning_config');
      expect(sql).toContain('supports_tool_use');
      expect(sql).toContain('input_cost_per_million_usd');
      const params = pool.query.mock.calls[0][1] as unknown[];
      expect(params).toHaveLength(12);
      expect(params[11]).toBe(true); // claude-sonnet-4-6 is default-enabled
    });

    it('returns upserted rows on re-discovery', async () => {
      const updatedModel = { ...sampleModel, endpoint_type: 'messages' };
      pool.query.mockResolvedValueOnce({ rows: [updatedModel], rowCount: 1 });

      const models = [
        {
          modelId: 'claude-sonnet-4-6',
          displayName: 'Claude Sonnet',
          contextWindow: 200000,
          maxOutputTokens: 8192,
          endpointType: 'messages',
          supportsToolUse: true,
          supportsVision: true,
          inputCostPerMillionUsd: 3,
          outputCostPerMillionUsd: 15,
          reasoningConfig: sampleReasoningConfig,
        },
      ];

      const result = await service.bulkCreateModels(TENANT_ID, PROVIDER_ID, models);
      expect(result).toHaveLength(1);
      expect(result[0].endpoint_type).toBe('messages');
    });

    it('enables all models when enableAll is true', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleModel], rowCount: 1 });

      const models = [
        {
          modelId: 'some-unknown-model',
          displayName: 'Unknown',
          contextWindow: 100000,
          maxOutputTokens: null,
          endpointType: 'chat-completions',
          supportsToolUse: true,
          supportsVision: false,
          inputCostPerMillionUsd: null,
          outputCostPerMillionUsd: null,
          reasoningConfig: null,
        },
      ];

      await service.bulkCreateModels(TENANT_ID, PROVIDER_ID, models, true);

      const params = pool.query.mock.calls[0][1] as unknown[];
      expect(params[11]).toBe(true); // enableAll overrides default policy
    });
  });
});
