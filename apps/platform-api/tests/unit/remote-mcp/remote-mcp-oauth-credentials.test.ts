import { beforeEach, describe, expect, it, vi } from 'vitest';

import { configureProviderSecretEncryptionKey } from '../../../src/lib/oauth-crypto.js';
import { decryptRemoteMcpSecret, encryptRemoteMcpSecret } from '../../../src/services/remote-mcp-secret-crypto.js';
import { RemoteMcpOAuthService } from '../../../src/services/remote-mcp-oauth-service.js';
import { mockJsonResponse } from './remote-mcp-oauth-test-helpers.js';

describe('RemoteMcpOAuthService stored credentials', () => {
  beforeEach(() => {
    configureProviderSecretEncryptionKey('0123456789abcdef0123456789abcdef');
    globalThis.fetch = vi.fn();
  });

  it('returns an encrypted authorization header secret for a valid stored access token', async () => {
    const service = new RemoteMcpOAuthService(
      { query: vi.fn() } as never,
      {
        getStoredServer: vi.fn(),
        createVerifiedServer: vi.fn(),
        updateVerifiedServer: vi.fn(),
      } as never,
      { verify: vi.fn() } as never,
      { platformPublicBaseUrl: 'https://platform.example.test' },
    );

    const storedAuthorization = await service.resolveStoredAuthorizationSecret({
      id: 'server-1',
      oauthConfig: {
        issuer: 'https://auth.example.test',
        authorizationEndpoint: 'https://auth.example.test/oauth/authorize',
        tokenEndpoint: 'https://auth.example.test/oauth/token',
        registrationEndpoint: null,
        clientId: 'client-id',
        clientSecret: null,
        tokenEndpointAuthMethod: 'none',
        clientIdMetadataDocumentUrl: null,
        redirectUri: 'http://localhost:1455/auth/callback',
        scopes: [],
        resource: 'https://mcp.example.test/server',
        resourceIndicators: [],
        audiences: [],
        deviceAuthorizationEndpoint: null,
      },
      oauthCredentials: {
        accessToken: encryptRemoteMcpSecret('access-token-1'),
        refreshToken: null,
        expiresAt: Date.now() + 10 * 60_000,
        tokenType: 'Bearer',
        scope: null,
        authorizedAt: '2026-03-26T00:00:00.000Z',
        authorizedByUserId: 'user-1',
        needsReauth: false,
      },
    });

    expect(decryptRemoteMcpSecret(storedAuthorization)).toBe('Bearer access-token-1');
  });

  it('refreshes expired oauth-backed MCP tokens before building the authorization header secret', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse({
        access_token: 'refreshed-token-1',
        refresh_token: 'refreshed-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    );

    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('UPDATE remote_mcp_servers')) {
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new RemoteMcpOAuthService(
      pool as never,
      {
        getStoredServer: vi.fn(),
        createVerifiedServer: vi.fn(),
        updateVerifiedServer: vi.fn(),
      } as never,
      { verify: vi.fn() } as never,
      { platformPublicBaseUrl: 'https://platform.example.test' },
    );

    const storedAuthorization = await service.resolveStoredAuthorizationSecret({
      id: 'server-1',
      oauthConfig: {
        issuer: 'https://auth.example.test',
        authorizationEndpoint: 'https://auth.example.test/oauth/authorize',
        tokenEndpoint: 'https://auth.example.test/oauth/token',
        registrationEndpoint: null,
        clientId: 'client-id',
        clientSecret: null,
        tokenEndpointAuthMethod: 'none',
        clientIdMetadataDocumentUrl: null,
        redirectUri: 'http://localhost:1455/auth/callback',
        scopes: [],
        resource: 'https://mcp.example.test/server',
        resourceIndicators: [],
        audiences: [],
        deviceAuthorizationEndpoint: null,
      },
      oauthCredentials: {
        accessToken: encryptRemoteMcpSecret('expired-access-token'),
        refreshToken: encryptRemoteMcpSecret('refresh-token-1'),
        expiresAt: Date.now() - 60_000,
        tokenType: 'Bearer',
        scope: null,
        authorizedAt: '2026-03-26T00:00:00.000Z',
        authorizedByUserId: 'user-1',
        needsReauth: false,
      },
    });

    expect(decryptRemoteMcpSecret(storedAuthorization)).toBe('Bearer refreshed-token-1');
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE remote_mcp_servers'),
      expect.any(Array),
    );
  });
});
