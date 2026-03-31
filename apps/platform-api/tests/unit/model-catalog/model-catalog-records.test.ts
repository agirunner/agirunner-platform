import { describe, expect, it } from 'vitest';

import { readProviderTypeOrThrow, sanitizeProvider } from '../../../src/services/model-catalog/model-catalog-records.js';

describe('model-catalog-records', () => {
  it('redacts provider metadata secrets from public provider reads', () => {
    const now = new Date();

    expect(sanitizeProvider({
      id: 'provider-1',
      tenant_id: 'tenant-1',
      name: 'anthropic',
      base_url: 'https://api.anthropic.com',
      api_key_secret_ref: null,
      is_enabled: true,
      rate_limit_rpm: null,
      metadata: {
        api_key: 'sk-live-secret',
        nested: {
          authorization: 'Bearer secret-token',
          safe: 'visible',
        },
      },
      auth_mode: 'api_key',
      created_at: now,
      updated_at: now,
    }).metadata).toEqual({
      api_key: 'redacted://provider-metadata-secret',
      nested: {
        authorization: 'redacted://provider-metadata-secret',
        safe: 'visible',
      },
    });
  });

  it('rejects providers without explicit providerType metadata', () => {
    expect(() => readProviderTypeOrThrow({}, 'anthropic')).toThrow(/providerType/i);
  });
});
