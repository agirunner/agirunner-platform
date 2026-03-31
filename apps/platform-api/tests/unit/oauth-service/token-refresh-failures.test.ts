import { describe, expect, it, vi } from 'vitest';

import { configureProviderSecretEncryptionKey, storeOAuthToken } from '../../../src/lib/oauth-crypto.js';
import { OAuthService } from '../../../src/services/oauth-service.js';

describe('OAuthService', () => {
  it('redacts secret-bearing token exchange error details from thrown validation messages', async () => {
    expect.assertions(4);
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: vi.fn().mockResolvedValue('invalid_client access_token=sk-secret-value refresh_token=abc'),
    }) as never;

    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('DELETE FROM oauth_states')) {
          return {
            rowCount: 1,
            rows: [{
              tenant_id: 'tenant-1',
              user_id: 'user-1',
              profile_id: 'openai-codex',
              code_verifier: 'verifier-1',
            }],
          };
        }
        if (sql.includes('SELECT id FROM llm_providers')) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new OAuthService(pool as never);

    try {
      await service.handleCallback('code-1', 'state-1');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('OAuth token exchange failed with status 401');
      expect((error as Error).message).not.toContain('sk-secret-value');
      expect((error as Error).message).not.toContain('refresh_token');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('returns encrypted oauth secret material instead of plaintext tokens', async () => {
    process.env.WEBHOOK_ENCRYPTION_KEY = 'test-encryption-key';
    configureProviderSecretEncryptionKey('test-encryption-key');

    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT * FROM llm_providers WHERE id = $1 FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'provider-1',
              auth_mode: 'oauth',
              oauth_config: {
                profile_id: 'openai-codex',
                base_url: 'https://api.openai.test/v1',
                endpoint_type: 'responses',
                token_lifetime: 'permanent',
              },
              oauth_credentials: {
                access_token: 'enc:v1:stored:token:tag',
                refresh_token: null,
                expires_at: null,
                account_id: 'acct_123',
                email: 'mark@example.com',
                authorized_at: '2026-03-11T00:00:00.000Z',
                authorized_by_user_id: 'user-1',
                needs_reauth: false,
              },
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const pool = {
      connect: vi.fn(async () => client),
    };
    const service = new OAuthService(pool as never);

    const resolved = await service.resolveValidToken('provider-1');

    expect(resolved).toEqual({
      accessTokenSecret: 'enc:v1:stored:token:tag',
      baseUrl: 'https://api.openai.test/v1',
      endpointType: 'responses',
      extraHeadersSecret: expect.stringMatching(/^enc:v1:/),
    });
  });

  it('marks providers for reauth and returns operator-action-required details when refresh fails', async () => {
    process.env.WEBHOOK_ENCRYPTION_KEY = 'test-encryption-key';
    configureProviderSecretEncryptionKey('test-encryption-key');

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn(),
      text: vi.fn().mockResolvedValue('invalid_grant'),
    }) as never;

    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT * FROM llm_providers WHERE id = $1 FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'provider-1',
              auth_mode: 'oauth',
              oauth_config: {
                profile_id: 'openai-codex',
                client_id: 'client-id',
                authorize_url: 'https://auth.example.test/oauth/authorize',
                token_url: 'https://auth.example.test/oauth/token',
                scopes: ['openid'],
                base_url: 'https://api.openai.test/v1',
                endpoint_type: 'responses',
                token_lifetime: 'expiring',
                cost_model: 'usage',
                extra_authorize_params: {},
              },
              oauth_credentials: {
                access_token: storeOAuthToken('access-token'),
                refresh_token: storeOAuthToken('refresh-token'),
                expires_at: Date.now() - 60_000,
                account_id: 'acct_123',
                email: 'mark@example.com',
                authorized_at: '2026-03-11T00:00:00.000Z',
                authorized_by_user_id: 'user-1',
                needs_reauth: false,
              },
            }],
          };
        }
        if (sql.includes('UPDATE llm_providers') && sql.includes("'{needs_reauth}'")) {
          expect(params).toEqual(['provider-1']);
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const pool = {
      connect: vi.fn(async () => client),
    };
    const service = new OAuthService(pool as never);

    await expect(service.resolveValidToken('provider-1')).rejects.toMatchObject({
      message: 'OAuth session expired. An admin must reconnect on the LLM Providers page.',
      details: expect.objectContaining({
        category: 'provider_reauth_required',
        recovery_hint: 'reconnect_oauth_provider',
        recovery: expect.objectContaining({
          status: 'operator_action_required',
          reason: 'provider_reauth_required',
          provider_id: 'provider-1',
        }),
      }),
    });

    global.fetch = originalFetch;
  });

  it('does not mark providers for reauth when token refresh is temporarily unavailable', async () => {
    process.env.WEBHOOK_ENCRYPTION_KEY = 'test-encryption-key';
    configureProviderSecretEncryptionKey('test-encryption-key');

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: vi.fn(),
      text: vi.fn().mockResolvedValue('temporarily unavailable'),
    }) as never;

    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT * FROM llm_providers WHERE id = $1 FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'provider-1',
              auth_mode: 'oauth',
              oauth_config: {
                profile_id: 'openai-codex',
                client_id: 'client-id',
                authorize_url: 'https://auth.example.test/oauth/authorize',
                token_url: 'https://auth.example.test/oauth/token',
                scopes: ['openid'],
                base_url: 'https://api.openai.test/v1',
                endpoint_type: 'responses',
                token_lifetime: 'expiring',
                cost_model: 'usage',
                extra_authorize_params: {},
              },
              oauth_credentials: {
                access_token: storeOAuthToken('access-token'),
                refresh_token: storeOAuthToken('refresh-token'),
                expires_at: Date.now() - 60_000,
                account_id: 'acct_123',
                email: 'mark@example.com',
                authorized_at: '2026-03-11T00:00:00.000Z',
                authorized_by_user_id: 'user-1',
                needs_reauth: false,
              },
            }],
          };
        }
        if (sql.includes('UPDATE llm_providers') && sql.includes("'{needs_reauth}'")) {
          throw new Error('transient refresh failures must not mark provider reauth');
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const pool = {
      connect: vi.fn(async () => client),
    };
    const service = new OAuthService(pool as never);

    await expect(service.resolveValidToken('provider-1')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      details: expect.objectContaining({
        category: 'provider_oauth_refresh_unavailable',
      }),
    });

    global.fetch = originalFetch;
  });

  it('does not mark providers for reauth on ambiguous 401 refresh failures', async () => {
    process.env.WEBHOOK_ENCRYPTION_KEY = 'test-encryption-key';
    configureProviderSecretEncryptionKey('test-encryption-key');

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn(),
      text: vi.fn().mockResolvedValue('upstream authorization temporarily unavailable'),
    }) as never;

    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT * FROM llm_providers WHERE id = $1 FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'provider-1',
              auth_mode: 'oauth',
              oauth_config: {
                profile_id: 'openai-codex',
                client_id: 'client-id',
                authorize_url: 'https://auth.example.test/oauth/authorize',
                token_url: 'https://auth.example.test/oauth/token',
                scopes: ['openid'],
                base_url: 'https://api.openai.test/v1',
                endpoint_type: 'responses',
                token_lifetime: 'expiring',
                cost_model: 'usage',
                extra_authorize_params: {},
              },
              oauth_credentials: {
                access_token: storeOAuthToken('access-token'),
                refresh_token: storeOAuthToken('refresh-token'),
                expires_at: Date.now() - 60_000,
                account_id: 'acct_123',
                email: 'mark@example.com',
                authorized_at: '2026-03-11T00:00:00.000Z',
                authorized_by_user_id: 'user-1',
                needs_reauth: false,
              },
            }],
          };
        }
        if (sql.includes('UPDATE llm_providers') && sql.includes("'{needs_reauth}'")) {
          throw new Error('ambiguous refresh failures must not mark provider reauth');
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const pool = {
      connect: vi.fn(async () => client),
    };
    const service = new OAuthService(pool as never);

    await expect(service.resolveValidToken('provider-1')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      details: expect.objectContaining({
        category: 'provider_oauth_refresh_unavailable',
      }),
    });

    global.fetch = originalFetch;
  });

  it('does not mark providers for reauth when refresh fails with a generic expired-session message', async () => {
    process.env.WEBHOOK_ENCRYPTION_KEY = 'test-encryption-key';
    configureProviderSecretEncryptionKey('test-encryption-key');

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn(),
      text: vi.fn().mockResolvedValue('access token expired for this session'),
    }) as never;

    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT * FROM llm_providers WHERE id = $1 FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'provider-1',
              auth_mode: 'oauth',
              oauth_config: {
                profile_id: 'openai-codex',
                client_id: 'client-id',
                authorize_url: 'https://auth.example.test/oauth/authorize',
                token_url: 'https://auth.example.test/oauth/token',
                scopes: ['openid'],
                base_url: 'https://api.openai.test/v1',
                endpoint_type: 'responses',
                token_lifetime: 'expiring',
                cost_model: 'usage',
                extra_authorize_params: {},
              },
              oauth_credentials: {
                access_token: storeOAuthToken('access-token'),
                refresh_token: storeOAuthToken('refresh-token'),
                expires_at: Date.now() - 60_000,
                account_id: 'acct_123',
                email: 'mark@example.com',
                authorized_at: '2026-03-11T00:00:00.000Z',
                authorized_by_user_id: 'user-1',
                needs_reauth: false,
              },
            }],
          };
        }
        if (sql.includes('UPDATE llm_providers') && sql.includes("'{needs_reauth}'")) {
          throw new Error('generic expired-session refresh failures must not force operator reauth');
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const pool = {
      connect: vi.fn(async () => client),
    };
    const service = new OAuthService(pool as never);

    await expect(service.resolveValidToken('provider-1')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      details: expect.objectContaining({
        category: 'provider_oauth_refresh_unavailable',
      }),
    });

    global.fetch = originalFetch;
  });

  it('does not mark providers for reauth when refresh fails with invalid_client', async () => {
    process.env.WEBHOOK_ENCRYPTION_KEY = 'test-encryption-key';
    configureProviderSecretEncryptionKey('test-encryption-key');

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: vi.fn(),
      text: vi.fn().mockResolvedValue('invalid_client'),
    }) as never;

    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT * FROM llm_providers WHERE id = $1 FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'provider-1',
              auth_mode: 'oauth',
              oauth_config: {
                profile_id: 'openai-codex',
                client_id: 'client-id',
                authorize_url: 'https://auth.example.test/oauth/authorize',
                token_url: 'https://auth.example.test/oauth/token',
                scopes: ['openid'],
                base_url: 'https://api.openai.test/v1',
                endpoint_type: 'responses',
                token_lifetime: 'expiring',
                cost_model: 'usage',
                extra_authorize_params: {},
              },
              oauth_credentials: {
                access_token: storeOAuthToken('access-token'),
                refresh_token: storeOAuthToken('refresh-token'),
                expires_at: Date.now() - 60_000,
                account_id: 'acct_123',
                email: 'mark@example.com',
                authorized_at: '2026-03-11T00:00:00.000Z',
                authorized_by_user_id: 'user-1',
                needs_reauth: false,
              },
            }],
          };
        }
        if (sql.includes('UPDATE llm_providers') && sql.includes("'{needs_reauth}'")) {
          throw new Error('invalid_client must not force operator reauth');
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const pool = {
      connect: vi.fn(async () => client),
    };
    const service = new OAuthService(pool as never);

    await expect(service.resolveValidToken('provider-1')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      details: expect.objectContaining({
        category: 'provider_oauth_refresh_unavailable',
      }),
    });

    global.fetch = originalFetch;
  });

});

function createJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = Buffer.from('fake-signature').toString('base64url');
  return `${header}.${body}.${signature}`;
}
