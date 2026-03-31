import { beforeEach, describe, expect, it } from 'vitest';

import {
  createServiceHarness,
  MODEL_ID,
  PROVIDER_ID,
  sampleProvider,
  TENANT_ID,
} from './model-catalog-test-fixtures.js';

describe('ModelCatalogService resolved configuration', () => {
  let pool: ReturnType<typeof createServiceHarness>['pool'];
  let service: ReturnType<typeof createServiceHarness>['service'];

  beforeEach(() => {
    ({ pool, service } = createServiceHarness());
  });

  it('does not expose the retired workflow effective-model resolution surface', () => {
    expect('resolveEffectiveModel' in service).toBe(false);
    expect('validateModelOverride' in service).toBe(false);
  });

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

    await expect(service.resolveRoleConfig(TENANT_ID, 'developer')).rejects.toThrow(/providerType/i);
  });
});
