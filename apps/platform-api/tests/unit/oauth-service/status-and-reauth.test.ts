import { describe, expect, it, vi } from 'vitest';

import { configureProviderSecretEncryptionKey, storeOAuthToken } from '../../../src/lib/oauth-crypto.js';
import { OAuthService } from '../../../src/services/oauth-service.js';

describe('OAuthService', () => {
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

  it('treats stale reauth flags as connected when the access token is still valid', async () => {
    const expiresAtSeconds = Math.floor((Date.now() + 60 * 60_000) / 1000);
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
            token_lifetime: 'expiring',
            cost_model: 'usage',
            extra_authorize_params: {},
          },
          oauth_credentials: {
            access_token: 'enc:v1:stored-access',
            refresh_token: 'enc:v1:stored-refresh',
            expires_at: expiresAtSeconds,
            account_id: 'acct_123',
            email: 'mark@example.com',
            authorized_at: '2026-03-11T00:00:00.000Z',
            authorized_by_user_id: 'user-1',
            needs_reauth: true,
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
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
      authorizedBy: 'user-1',
      needsReauth: false,
    });
  });

  it('heals stale reauth flags when stored oauth credentials still have a valid access token', async () => {
    process.env.WEBHOOK_ENCRYPTION_KEY = 'test-encryption-key';
    configureProviderSecretEncryptionKey('test-encryption-key');

    const expiresAtSeconds = Math.floor((Date.now() + 60 * 60_000) / 1000);
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
                access_token: 'enc:v1:stored:token:tag',
                refresh_token: storeOAuthToken('refresh-token'),
                expires_at: expiresAtSeconds,
                account_id: 'acct_123',
                email: 'mark@example.com',
                authorized_at: '2026-03-11T00:00:00.000Z',
                authorized_by_user_id: 'user-1',
                needs_reauth: true,
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
      accessTokenSecret: 'enc:v1:stored:token:tag',
      baseUrl: 'https://api.openai.test/v1',
      endpointType: 'responses',
      extraHeadersSecret: expect.stringMatching(/^enc:v1:/),
    });
    expect(storedCredentials).toMatchObject({
      access_token: 'enc:v1:stored:token:tag',
      refresh_token: expect.stringMatching(/^enc:v1:/),
      expires_at: expiresAtSeconds * 1000,
      account_id: 'acct_123',
      email: 'mark@example.com',
      authorized_at: '2026-03-11T00:00:00.000Z',
      authorized_by_user_id: 'user-1',
      needs_reauth: false,
    });
  });
});
