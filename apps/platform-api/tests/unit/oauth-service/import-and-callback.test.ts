import { describe, expect, it, vi } from 'vitest';

import { configureProviderSecretEncryptionKey } from '../../../src/lib/oauth-crypto.js';
import { OAuthService } from '../../../src/services/oauth/oauth-service.js';

describe('OAuthService', () => {
  it('imports an existing authorized oauth session and seeds static models', async () => {
    process.env.WEBHOOK_ENCRYPTION_KEY = 'test-encryption-key';
    configureProviderSecretEncryptionKey('test-encryption-key');

    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("SELECT id FROM llm_providers")) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes("INSERT INTO llm_providers")) {
          return { rowCount: 1, rows: [{ id: 'provider-1' }] };
        }
        if (sql.includes('UPDATE llm_providers')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('INSERT INTO llm_models')) {
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`unexpected query: ${sql} ${JSON.stringify(params ?? [])}`);
      }),
    };
    const service = new OAuthService(pool as never);

    const result = await service.importAuthorizedSession('tenant-1', 'user-1', {
      profileId: 'openai-codex',
      providerName: 'OpenAI (Subscription)',
      credentials: {
        accessToken: 'plain-access-token',
        refreshToken: 'plain-refresh-token',
        expiresAt: 1770000000000,
        accountId: 'acct_123',
        email: 'operator@example.com',
        authorizedAt: '2026-03-19T00:00:00.000Z',
      },
    });

    expect(result).toEqual({
      providerId: 'provider-1',
      email: 'operator@example.com',
    });

    const providerInsert = pool.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO llm_providers'));
    expect(providerInsert?.[1]).toEqual([
      'tenant-1',
      'OpenAI (Subscription)',
      'https://chatgpt.com/backend-api',
      expect.any(String),
      JSON.stringify({ providerType: 'openai' }),
    ]);

    const credentialsUpdate = pool.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE llm_providers'));
    const storedCredentials = JSON.parse(String(credentialsUpdate?.[1]?.[0] ?? '{}'));
    expect(storedCredentials.access_token).toMatch(/^enc:v1:/);
    expect(storedCredentials.refresh_token).toMatch(/^enc:v1:/);
    expect(storedCredentials.access_token).not.toBe('plain-access-token');
    expect(storedCredentials.authorized_by_user_id).toBe('user-1');

    const seededModels = pool.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO llm_models'));
    expect(seededModels.length).toBeGreaterThan(0);
  });

  it('normalizes imported oauth session expiry timestamps expressed in unix seconds', async () => {
    process.env.WEBHOOK_ENCRYPTION_KEY = 'test-encryption-key';
    configureProviderSecretEncryptionKey('test-encryption-key');

    let storedCredentials: Record<string, unknown> | null = null;
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT id FROM llm_providers')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO llm_providers')) {
          return { rowCount: 1, rows: [{ id: 'provider-1' }] };
        }
        if (sql.includes('UPDATE llm_providers')) {
          storedCredentials = JSON.parse(String(params?.[0] ?? '{}'));
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('INSERT INTO llm_models')) {
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`unexpected query: ${sql} ${JSON.stringify(params ?? [])}`);
      }),
    };
    const service = new OAuthService(pool as never);
    const expiresAtSeconds = Math.floor((Date.now() + 60 * 60_000) / 1000);

    await service.importAuthorizedSession('tenant-1', 'user-1', {
      profileId: 'openai-codex',
      providerName: 'OpenAI (Subscription)',
      credentials: {
        accessToken: 'plain-access-token',
        refreshToken: 'plain-refresh-token',
        expiresAt: expiresAtSeconds,
        accountId: 'acct_123',
        email: 'operator@example.com',
        authorizedAt: '2026-03-19T00:00:00.000Z',
      },
    });

    expect(storedCredentials).toMatchObject({
      expires_at: expiresAtSeconds * 1000,
      authorized_by_user_id: 'user-1',
      needs_reauth: false,
    });
  });

  it('reads the callback flow kind without consuming oauth state', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT flow_kind')) {
          expect(params).toEqual(['state-1']);
          return {
            rowCount: 1,
            rows: [{ flow_kind: 'remote_mcp' }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new OAuthService(pool as never);

    const flowKind = await service.peekFlowKind('state-1');

    expect(flowKind).toBe('remote_mcp');
  });
});
