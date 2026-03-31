import { beforeEach, describe, expect, it } from 'vitest';

import { storeProviderSecret } from '../../../src/lib/oauth-crypto.js';
import {
  createServiceHarness,
  MODEL_ID,
  PROVIDER_ID,
  sampleProvider,
  TENANT_ID,
} from './model-catalog-test-fixtures.js';

describe('ModelCatalogService providers', () => {
  let pool: ReturnType<typeof createServiceHarness>['pool'];
  let service: ReturnType<typeof createServiceHarness>['service'];

  beforeEach(() => {
    ({ pool, service } = createServiceHarness());
  });

  it('lists all providers for tenant', async () => {
    pool.query.mockResolvedValueOnce({ rows: [sampleProvider], rowCount: 1 });

    await expect(service.listProviders(TENANT_ID)).resolves.toEqual([{
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

    await expect(service.getProvider(TENANT_ID, PROVIDER_ID)).resolves.toEqual({
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

  it('throws NotFoundError for missing provider', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(service.getProvider(TENANT_ID, PROVIDER_ID)).rejects.toThrow('LLM provider not found');
  });

  it('creates a provider', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [sampleProvider], rowCount: 1 });

    await expect(service.createProvider(TENANT_ID, {
      name: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      isEnabled: true,
      metadata: {},
    })).resolves.toEqual({
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
    await expect(service.createProvider(TENANT_ID, {
      name: '',
      baseUrl: 'not-a-url',
      isEnabled: true,
      metadata: {},
    })).rejects.toThrow();
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

    await expect(service.getProviderForOperations(TENANT_ID, PROVIDER_ID)).resolves.toMatchObject({
      api_key_secret_ref: 'sk-live-secret',
    });
  });

  it('preserves external secret references in operations reads', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ ...sampleProvider, api_key_secret_ref: 'secret:OPENAI_API_KEY' }],
      rowCount: 1,
    });

    await expect(service.getProviderForOperations(TENANT_ID, PROVIDER_ID)).resolves.toMatchObject({
      api_key_secret_ref: 'secret:OPENAI_API_KEY',
    });
  });

  it('deletes a provider and clears dependent assignments and system defaults', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: MODEL_ID }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await expect(service.deleteProvider(TENANT_ID, PROVIDER_ID)).resolves.toBeUndefined();
    expect(pool.query).toHaveBeenCalledTimes(6);
    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      'DELETE FROM runtime_defaults WHERE tenant_id = $1 AND config_key = $2 AND config_value = ANY($3::text[])',
      [TENANT_ID, 'default_model_id', [MODEL_ID]],
    );
    expect(pool.query).toHaveBeenNthCalledWith(
      4,
      'DELETE FROM runtime_defaults WHERE tenant_id = $1 AND config_key = $2',
      [TENANT_ID, 'default_reasoning_config'],
    );
  });
});
