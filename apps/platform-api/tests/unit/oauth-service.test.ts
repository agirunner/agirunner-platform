import { describe, expect, it, vi } from 'vitest';

import { configureProviderSecretEncryptionKey } from '../../src/lib/oauth-crypto.js';
import { OAuthService } from '../../src/services/oauth-service.js';

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
    }

    global.fetch = originalFetch;
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

  it('returns only status metadata from oauth status reads', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rowCount: 1,
        rows: [{
          id: 'provider-1',
          auth_mode: 'oauth',
          oauth_config: {
            profile_id: 'openai-codex',
            client_id: 'client-id',
            authorize_url: 'https://auth.example.com',
            token_url: 'https://token.example.com',
            scopes: ['openid'],
            base_url: 'https://api.openai.test/v1',
            endpoint_type: 'responses',
            token_lifetime: 'permanent',
            cost_model: 'usage',
            extra_authorize_params: {},
          },
          oauth_credentials: {
            access_token: 'enc:v1:stored-access',
            refresh_token: 'enc:v1:stored-refresh',
            expires_at: 1770000000000,
            account_id: 'acct_123',
            email: 'mark@example.com',
            authorized_at: '2026-03-11T00:00:00.000Z',
            authorized_by_user_id: 'user-1',
            needs_reauth: false,
          },
        }],
      })),
    };
    const service = new OAuthService(pool as never);

    const status = await service.getStatus('provider-1');

    expect(status).toEqual({
      connected: true,
      email: 'mark@example.com',
      authorizedAt: '2026-03-11T00:00:00.000Z',
      expiresAt: new Date(1770000000000).toISOString(),
      authorizedBy: 'user-1',
      needsReauth: false,
    });
    expect(status).not.toHaveProperty('access_token');
    expect(status).not.toHaveProperty('refresh_token');
    expect(status).not.toHaveProperty('oauth_credentials');
    expect(status).not.toHaveProperty('oauth_config');
  });
});
