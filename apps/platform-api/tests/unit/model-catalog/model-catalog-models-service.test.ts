import { beforeEach, describe, expect, it } from 'vitest';

import {
  createServiceHarness,
  MODEL_ID,
  PROVIDER_ID,
  sampleModel,
  sampleNativeSearch,
  sampleProvider,
  TENANT_ID,
} from './model-catalog-test-fixtures.js';

describe('ModelCatalogService models and assignments', () => {
  let pool: ReturnType<typeof createServiceHarness>['pool'];
  let service: ReturnType<typeof createServiceHarness>['service'];

  beforeEach(() => {
    ({ pool, service } = createServiceHarness());
  });

  it('lists all models for tenant', async () => {
    pool.query.mockResolvedValueOnce({ rows: [sampleModel], rowCount: 1 });

    await expect(service.listModels(TENANT_ID)).resolves.toEqual([
      { ...sampleModel, native_search: sampleNativeSearch },
    ]);
  });

  it('lists models filtered by provider', async () => {
    pool.query.mockResolvedValueOnce({ rows: [sampleModel], rowCount: 1 });

    const result = await service.listModels(TENANT_ID, PROVIDER_ID);

    expect(result).toEqual([{ ...sampleModel, native_search: sampleNativeSearch }]);
    expect(pool.query.mock.calls[0][0]).toContain('provider_id');
  });

  it('gets a model by id', async () => {
    pool.query.mockResolvedValueOnce({ rows: [sampleModel], rowCount: 1 });
    await expect(service.getModel(TENANT_ID, MODEL_ID)).resolves.toEqual(sampleModel);
  });

  it('throws NotFoundError for missing model', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(service.getModel(TENANT_ID, MODEL_ID)).rejects.toThrow('LLM model not found');
  });

  it('creates a model after verifying provider exists', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [sampleProvider], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [sampleModel], rowCount: 1 });

    await expect(service.createModel(TENANT_ID, {
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
    })).resolves.toEqual(sampleModel);
  });

  it('deletes a model and clears dependent assignments and system defaults', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await expect(service.deleteModel(TENANT_ID, MODEL_ID)).resolves.toBeUndefined();
    expect(pool.query).toHaveBeenNthCalledWith(
      1,
      'UPDATE role_model_assignments SET primary_model_id = NULL WHERE tenant_id = $1 AND primary_model_id = ANY($2::uuid[])',
      [TENANT_ID, [MODEL_ID]],
    );
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      'DELETE FROM runtime_defaults WHERE tenant_id = $1 AND config_key = $2 AND config_value = ANY($3::text[])',
      [TENANT_ID, 'default_model_id', [MODEL_ID]],
    );
    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      'DELETE FROM runtime_defaults WHERE tenant_id = $1 AND config_key = $2',
      [TENANT_ID, 'default_reasoning_config'],
    );
  });

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

    await expect(service.listAssignments(TENANT_ID)).resolves.toEqual([assignment]);
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
    expect(pool.query.mock.calls[0][0]).toContain('ON CONFLICT');
  });

  it('deletes an assignment when model and reasoning are both cleared', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await expect(service.upsertAssignment(TENANT_ID, 'developer', null, null)).resolves.toBeNull();
    expect(pool.query).toHaveBeenCalledWith(
      'DELETE FROM role_model_assignments WHERE tenant_id = $1 AND role_name = $2',
      [TENANT_ID, 'developer'],
    );
  });
});
