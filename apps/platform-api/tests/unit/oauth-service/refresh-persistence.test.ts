import { describe, expect, it, vi } from 'vitest';

import { configureProviderSecretEncryptionKey, storeOAuthToken } from '../../../src/lib/oauth-crypto.js';
import { OAuthService } from '../../../src/services/oauth/oauth-service.js';

describe('OAuthService', () => {
  it('persists refreshed oauth credentials when a valid refresh-backed session rotates tokens', async () => {
    process.env.WEBHOOK_ENCRYPTION_KEY = 'test-encryption-key';
    configureProviderSecretEncryptionKey('test-encryption-key');

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        access_token: createJwt({
          email: 'refreshed@example.com',
          'https://api.openai.com/auth': {
            chatgpt_account_id: 'acct_refreshed',
          },
        }),
        refresh_token: 'rotated-refresh-token',
        expires_in: 3600,
      }),
    }) as never;

    let storedCredentials: Record<string, unknown> | null = null;
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
        if (sql.includes('UPDATE llm_providers') && sql.includes('SET oauth_credentials = $1')) {
          storedCredentials = JSON.parse(String(params?.[0] ?? '{}'));
          expect(params?.[1]).toBe('provider-1');
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

    const resolved = await service.resolveValidToken('provider-1');

    expect(resolved).toEqual({
      accessTokenSecret: expect.stringMatching(/^enc:v1:/),
      baseUrl: 'https://api.openai.test/v1',
      endpointType: 'responses',
      extraHeadersSecret: expect.stringMatching(/^enc:v1:/),
    });
    expect(storedCredentials).toMatchObject({
      refresh_token: expect.stringMatching(/^enc:v1:/),
      account_id: 'acct_refreshed',
      email: 'refreshed@example.com',
      needs_reauth: false,
      authorized_at: '2026-03-11T00:00:00.000Z',
      authorized_by_user_id: 'user-1',
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
