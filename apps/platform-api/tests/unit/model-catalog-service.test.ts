import { describe, expect, it, vi, beforeEach } from 'vitest';

import { configureProviderSecretEncryptionKey, storeProviderSecret } from '../../src/lib/oauth-crypto.js';
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
  auth_mode: 'api_key',
  is_enabled: true,
  rate_limit_rpm: null,
  metadata: { providerType: 'anthropic' },
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
    process.env.WEBHOOK_ENCRYPTION_KEY = 'test-encryption-key';
    configureProviderSecretEncryptionKey(process.env.WEBHOOK_ENCRYPTION_KEY);
    pool = createMockPool();
    service = new ModelCatalogService(pool as never);
  });

  describe('providers', () => {
    it('lists all providers for tenant', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleProvider], rowCount: 1 });
      const result = await service.listProviders(TENANT_ID);
      expect(result).toEqual([{
        id: sampleProvider.id,
        tenant_id: sampleProvider.tenant_id,
        name: sampleProvider.name,
        base_url: sampleProvider.base_url,
        auth_mode: sampleProvider.auth_mode,
        is_enabled: sampleProvider.is_enabled,
        rate_limit_rpm: sampleProvider.rate_limit_rpm,
        metadata: sampleProvider.metadata,
        credentials_configured: false,
        created_at: sampleProvider.created_at,
        updated_at: sampleProvider.updated_at,
      }]);
    });

    it('gets a provider by id', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleProvider], rowCount: 1 });
      const result = await service.getProvider(TENANT_ID, PROVIDER_ID);
      expect(result).toEqual({
        id: sampleProvider.id,
        tenant_id: sampleProvider.tenant_id,
        name: sampleProvider.name,
        base_url: sampleProvider.base_url,
        auth_mode: sampleProvider.auth_mode,
        is_enabled: sampleProvider.is_enabled,
        rate_limit_rpm: sampleProvider.rate_limit_rpm,
        metadata: sampleProvider.metadata,
        credentials_configured: false,
        created_at: sampleProvider.created_at,
        updated_at: sampleProvider.updated_at,
      });
    });

    it('strips oauth config and credential blobs from public provider reads', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          ...sampleProvider,
          auth_mode: 'oauth',
          oauth_config: { client_id: 'client-id', token_url: 'https://token.example.com' },
          oauth_credentials: { access_token: 'enc:v1:token', refresh_token: 'enc:v1:refresh' },
        }],
        rowCount: 1,
      });

      const result = await service.getProvider(TENANT_ID, PROVIDER_ID);

      expect(result.auth_mode).toBe('oauth');
      expect(result.credentials_configured).toBe(true);
      expect(result).not.toHaveProperty('oauth_config');
      expect(result).not.toHaveProperty('oauth_credentials');
    });

    it('redacts secret-bearing provider metadata on public reads', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          ...sampleProvider,
          metadata: {
            api_key: 'sk-live-secret',
            nested: {
              authorization: 'Bearer top-secret-token',
              secret_ref: 'secret:PROVIDER_METADATA_SECRET',
              safe: 'visible',
            },
          },
        }],
        rowCount: 1,
      });

      const result = await service.getProvider(TENANT_ID, PROVIDER_ID);

      expect(result.metadata).toEqual({
        api_key: 'redacted://provider-metadata-secret',
        nested: {
          authorization: 'redacted://provider-metadata-secret',
          secret_ref: 'redacted://provider-metadata-secret',
          safe: 'visible',
        },
      });
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
      expect(result).toEqual({
        id: sampleProvider.id,
        tenant_id: sampleProvider.tenant_id,
        name: sampleProvider.name,
        base_url: sampleProvider.base_url,
        auth_mode: sampleProvider.auth_mode,
        is_enabled: sampleProvider.is_enabled,
        rate_limit_rpm: sampleProvider.rate_limit_rpm,
        metadata: sampleProvider.metadata,
        credentials_configured: false,
        created_at: sampleProvider.created_at,
        updated_at: sampleProvider.updated_at,
      });
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
      const result = await service.updateProvider(TENANT_ID, PROVIDER_ID, {
        name: 'updated-anthropic',
      });
      expect(result.name).toBe('updated-anthropic');
      expect(result).not.toHaveProperty('api_key_secret_ref');
    });

    it('encrypts provider api keys at rest and returns only configuration state', async () => {
      const storedProvider = { ...sampleProvider, api_key_secret_ref: 'enc:v1:test:test:test' };
      pool.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [storedProvider], rowCount: 1 });

      const result = await service.createProvider(TENANT_ID, {
        name: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        apiKeySecretRef: 'sk-live-secret',
        isEnabled: true,
        metadata: {},
      });

      const params = pool.query.mock.calls[1][1] as unknown[];
      expect(params[3]).not.toBe('sk-live-secret');
      expect(result.credentials_configured).toBe(true);
      expect(result).not.toHaveProperty('api_key_secret_ref');
    });

    it('preserves external secret references without encrypting them again', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{ ...sampleProvider, api_key_secret_ref: 'secret:OPENAI_API_KEY' }],
          rowCount: 1,
        });

      await service.createProvider(TENANT_ID, {
        name: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        apiKeySecretRef: 'secret:OPENAI_API_KEY',
        isEnabled: true,
        metadata: {},
      });

      const params = pool.query.mock.calls[1][1] as unknown[];
      expect(params[3]).toBe('secret:OPENAI_API_KEY');
    });

    it('decrypts provider secrets in operations reads', async () => {
      const storedSecret = storeProviderSecret('sk-live-secret');
      pool.query.mockResolvedValueOnce({
        rows: [{ ...sampleProvider, api_key_secret_ref: storedSecret }],
        rowCount: 1,
      });

      const result = await service.getProviderForOperations(TENANT_ID, PROVIDER_ID);

      expect(result.api_key_secret_ref).toBe('sk-live-secret');
    });

    it('preserves external secret references in operations reads', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ ...sampleProvider, api_key_secret_ref: 'secret:OPENAI_API_KEY' }],
        rowCount: 1,
      });

      const result = await service.getProviderForOperations(TENANT_ID, PROVIDER_ID);

      expect(result.api_key_secret_ref).toBe('secret:OPENAI_API_KEY');
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
      expect(result?.role_name).toBe('developer');
      const sql = pool.query.mock.calls[0][0] as string;
      expect(sql).toContain('ON CONFLICT');
    });

    it('deletes an assignment when model and reasoning are both cleared', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const result = await service.upsertAssignment(TENANT_ID, 'developer', null, null);

      expect(result).toBeNull();
      expect(pool.query).toHaveBeenCalledWith(
        'DELETE FROM role_model_assignments WHERE tenant_id = $1 AND role_name = $2',
        [TENANT_ID, 'developer'],
      );
    });
  });

  describe('effective model resolution', () => {
    it('does not invent a reasoning config from model metadata when the llm page did not configure one', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{
            id: 'assignment-1',
            tenant_id: TENANT_ID,
            role_name: 'developer',
            primary_model_id: MODEL_ID,
            reasoning_config: null,
            created_at: new Date(),
            updated_at: new Date(),
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{
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
            endpoint_type: 'chat',
            reasoning_config: { type: 'effort', default: 'medium' },
            created_at: new Date(),
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [sampleProvider], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [{
            id: 'assignment-1',
            tenant_id: TENANT_ID,
            role_name: 'developer',
            primary_model_id: MODEL_ID,
            reasoning_config: null,
            created_at: new Date(),
            updated_at: new Date(),
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service.resolveRoleConfig(TENANT_ID, 'developer');

      expect(result).not.toBeNull();
      if (!result) {
        throw new Error('expected role config');
      }
      expect(result.reasoningConfig).toBeNull();
      expect(result.model.reasoningConfig).toEqual({ type: 'effort', default: 'medium' });
    });

    it('fails fast when default reasoning config is invalid JSON', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ config_value: MODEL_ID }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ config_value: '{"effort":' }], rowCount: 1 });

      await expect(service.getSystemDefault(TENANT_ID)).rejects.toThrow(
        'Runtime default "default_reasoning_config" must be valid JSON object',
      );
    });

    it('fails fast when default reasoning config is not a JSON object', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ config_value: MODEL_ID }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ config_value: '"medium"' }], rowCount: 1 });

      await expect(service.getSystemDefault(TENANT_ID)).rejects.toThrow(
        'Runtime default "default_reasoning_config" must be valid JSON object',
      );
    });

    it('fails when the resolved provider is missing explicit provider type metadata', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{
            id: 'assignment-1',
            tenant_id: TENANT_ID,
            role_name: 'developer',
            primary_model_id: MODEL_ID,
            reasoning_config: null,
            created_at: new Date(),
            updated_at: new Date(),
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{
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
            endpoint_type: 'chat',
            reasoning_config: null,
            created_at: new Date(),
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{ ...sampleProvider, metadata: {} }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 'assignment-1',
            tenant_id: TENANT_ID,
            role_name: 'developer',
            primary_model_id: MODEL_ID,
            reasoning_config: null,
            created_at: new Date(),
            updated_at: new Date(),
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(service.resolveRoleConfig(TENANT_ID, 'developer')).rejects.toThrow(
        /providerType/i,
      );
    });

    it('validates model override references against enabled models', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: MODEL_ID }], rowCount: 1 });

      await expect(
        service.validateModelOverride(TENANT_ID, { model_id: MODEL_ID }, 'workflow model_override'),
      ).resolves.toBeUndefined();
    });

    it('resolves effective model with workflow override precedence over project and tenant defaults', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ config_value: MODEL_ID }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ config_value: JSON.stringify({ effort: 'low' }) }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [{
            project_id: 'project-1',
            resolved_config: {
              model_override: {
                model_id: '00000000-0000-0000-0000-000000000030',
              },
            },
            config_layers: {
              run: {
                model_override: {
                  model_id: '00000000-0000-0000-0000-000000000030',
                  reasoning_config: { effort: 'high' },
                },
              },
            },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{ settings: {} }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{
            id: '00000000-0000-0000-0000-000000000030',
            tenant_id: TENANT_ID,
            provider_id: PROVIDER_ID,
            model_id: 'claude-opus-4-1',
            context_window: 200000,
            max_output_tokens: 8192,
            supports_tool_use: true,
            supports_vision: true,
            input_cost_per_million_usd: '15.00',
            output_cost_per_million_usd: '75.00',
            is_enabled: true,
            endpoint_type: 'chat',
            reasoning_config: { type: 'effort', default: 'medium' },
            created_at: new Date(),
            provider_name: 'anthropic',
            provider_base_url: 'https://api.anthropic.com',
          }],
          rowCount: 1,
        });

      const result = await service.resolveEffectiveModel(TENANT_ID, { workflowId: 'workflow-1' });

      expect(result).toEqual({
        modelId: '00000000-0000-0000-0000-000000000030',
        reasoningConfig: { effort: 'high' },
        modelSource: 'workflow',
        reasoningSource: 'workflow',
        model: {
          id: '00000000-0000-0000-0000-000000000030',
          modelId: 'claude-opus-4-1',
          providerId: PROVIDER_ID,
          providerName: 'anthropic',
          providerBaseUrl: 'https://api.anthropic.com',
          contextWindow: 200000,
          maxOutputTokens: 8192,
          supportsToolUse: true,
          supportsVision: true,
          inputCostPerMillionUsd: 15,
          outputCostPerMillionUsd: 75,
          endpointType: 'chat',
          reasoningConfig: { type: 'effort', default: 'medium' },
        },
      });
    });
  });
});
