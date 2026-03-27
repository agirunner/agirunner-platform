import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureProviderSecretEncryptionKey } from '../../src/lib/oauth-crypto.js';
import { decryptRemoteMcpSecret, encryptRemoteMcpSecret } from '../../src/services/remote-mcp-secret-crypto.js';
import { RemoteMcpOAuthService } from '../../src/services/remote-mcp-oauth-service.js';
import type { RemoteMcpOAuthStartResult } from '../../src/services/remote-mcp-oauth-types.js';

function mockJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers({
      'content-type': 'application/json',
    }),
  } as Response;
}

function expectBrowserAuthorizationResult(
  result: RemoteMcpOAuthStartResult,
  draftId: string,
): Extract<RemoteMcpOAuthStartResult, { kind: 'browser' }> {
  expect(result.kind).toBe('browser');
  if (result.kind !== 'browser') {
    throw new Error(`Expected browser OAuth result, received ${result.kind}`);
  }
  expect(result.draftId).toBe(draftId);
  return result;
}

describe('RemoteMcpOAuthService', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    configureProviderSecretEncryptionKey('0123456789abcdef0123456789abcdef');
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('creates an unsaved oauth registration draft and returns an authorize url', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        mockJsonResponse({}, 401),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          authorization_servers: ['https://auth.example.test'],
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          issuer: 'https://auth.example.test',
          authorization_endpoint: 'https://auth.example.test/oauth/authorize',
          token_endpoint: 'https://auth.example.test/oauth/token',
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
          client_id_metadata_document_supported: true,
        }),
      );

    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO remote_mcp_registration_drafts')) {
          return { rowCount: 1, rows: [{ id: 'draft-1' }] };
        }
        if (sql.includes('INSERT INTO oauth_states')) {
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
      {
        verify: vi.fn(),
      } as never,
      {
        platformPublicBaseUrl: 'https://platform.example.test',
      },
    );

    const result = await service.initiateDraftAuthorization('tenant-1', 'user-1', {
      name: 'Docs MCP',
      description: '',
      endpointUrl: 'https://mcp.example.test/server',
      callTimeoutSeconds: 300,
      authMode: 'oauth',
      enabledByDefaultForNewSpecialists: false,
      grantToAllExistingSpecialists: true,
      parameters: [],
    });

    const browserResult = expectBrowserAuthorizationResult(result, 'draft-1');
    expect(browserResult.authorizeUrl).toContain(
      encodeURIComponent('https://platform.example.test/.well-known/oauth/mcp-client.json'),
    );
    expect(browserResult.authorizeUrl).toContain(
      encodeURIComponent('http://localhost:1455/auth/callback'),
    );
    expect(browserResult.authorizeUrl).toContain(encodeURIComponent('https://mcp.example.test/server'));
  });

  it('completes a draft callback by verifying first and only then creating the remote MCP server', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse({
        access_token: 'access-token-1',
        refresh_token: 'refresh-token-1',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    );

    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'DELETE FROM oauth_states WHERE expires_at < NOW()') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('DELETE FROM oauth_states')) {
          return {
            rowCount: 1,
            rows: [{
              tenant_id: 'tenant-1',
              user_id: 'user-1',
              state: 'state-1',
              code_verifier: 'verifier-1',
              flow_kind: 'remote_mcp',
              flow_payload: {
                mode: 'draft',
                draft_id: 'draft-1',
                discovery_strategy: 'resource_metadata+authorization_server_metadata',
                oauth_strategy: 'authorization_code',
                resource_metadata: {
                  resource: 'https://mcp.example.test/server',
                },
                oauth_config: {
                  authorizationEndpoint: 'https://auth.example.test/oauth/authorize',
                  tokenEndpoint: 'https://auth.example.test/oauth/token',
                  clientId: 'https://platform.example.test/.well-known/oauth/mcp-client.json',
                  clientSecret: null,
                  tokenEndpointAuthMethod: 'none',
                  redirectUri: 'http://localhost:1455/auth/callback',
                  clientIdMetadataDocumentUrl: 'https://platform.example.test/.well-known/oauth/mcp-client.json',
                  scopes: [],
                  resource: 'https://mcp.example.test/server',
                  resourceIndicators: [],
                  audiences: [],
                  deviceAuthorizationEndpoint: null,
                },
              },
            }],
          };
        }
        if (sql.includes('FROM remote_mcp_registration_drafts')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'draft-1',
              tenant_id: 'tenant-1',
              user_id: 'user-1',
              name: 'Docs MCP',
              description: '',
              endpoint_url: 'https://mcp.example.test/server',
              call_timeout_seconds: 300,
              auth_mode: 'oauth',
              enabled_by_default_for_new_specialists: false,
              grant_to_all_existing_specialists: true,
              parameters: [
                {
                  placement: 'query',
                  key: 'tenant',
                  valueKind: 'static',
                  value: 'docs',
                },
              ],
            }],
          };
        }
        if (sql.includes('DELETE FROM remote_mcp_registration_drafts')) {
          expect(params).toEqual(['draft-1']);
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const serverService = {
      getStoredServer: vi.fn(),
      createVerifiedServer: vi.fn().mockResolvedValue({
        id: 'server-1',
        name: 'Docs MCP',
      }),
      updateVerifiedServer: vi.fn(),
    };
    const verifier = {
      verify: vi.fn().mockResolvedValue({
        verification_status: 'verified',
        verification_error: null,
        verified_transport: 'streamable_http',
        verification_contract_version: 'remote-mcp-v1',
        discovered_tools_snapshot: [{ original_name: 'search' }],
      }),
    };
    const service = new RemoteMcpOAuthService(
      pool as never,
      serverService as never,
      verifier as never,
      {
        platformPublicBaseUrl: 'https://platform.example.test',
      },
    );

    const result = await service.handleCallback('code-1', 'state-1');

    expect(result).toEqual({
      serverId: 'server-1',
      serverName: 'Docs MCP',
    });
    expect(verifier.verify).toHaveBeenCalledWith({
      endpointUrl: 'https://mcp.example.test/server',
      callTimeoutSeconds: 300,
      transportPreference: 'auto',
      authMode: 'oauth',
      parameters: [
        {
          placement: 'query',
          key: 'tenant',
          valueKind: 'static',
          value: 'docs',
        },
        {
          placement: 'header',
          key: 'Authorization',
          valueKind: 'secret',
          value: 'Bearer access-token-1',
        },
      ],
    });
    expect(serverService.createVerifiedServer).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        name: 'Docs MCP',
        authMode: 'oauth',
        callTimeoutSeconds: 300,
        verificationStatus: 'verified',
        oauthConfig: expect.objectContaining({
          authorizationEndpoint: 'https://auth.example.test/oauth/authorize',
          tokenEndpoint: 'https://auth.example.test/oauth/token',
        }),
        oauthCredentials: expect.objectContaining({
          accessToken: expect.stringMatching(/^enc:v1:/),
          refreshToken: expect.stringMatching(/^enc:v1:/),
          authorizedByUserId: 'user-1',
        }),
      }),
    );
  });

  it('starts a reconnect oauth flow for an existing remote MCP server', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        mockJsonResponse({}, 401),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          authorization_servers: ['https://auth.example.test'],
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          issuer: 'https://auth.example.test',
          authorization_endpoint: 'https://auth.example.test/oauth/authorize',
          token_endpoint: 'https://auth.example.test/oauth/token',
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
          client_id_metadata_document_supported: true,
        }),
      );

    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO oauth_states')) {
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const serverService = {
      getStoredServer: vi.fn().mockResolvedValue({
        id: 'server-1',
        tenant_id: 'tenant-1',
        name: 'Docs MCP',
        description: '',
        endpoint_url: 'https://mcp.example.test/server',
        call_timeout_seconds: 300,
        auth_mode: 'oauth',
        enabled_by_default_for_new_specialists: false,
        parameters: [],
      }),
      createVerifiedServer: vi.fn(),
      updateVerifiedServer: vi.fn(),
    };
    const service = new RemoteMcpOAuthService(
      pool as never,
      serverService as never,
      {
        verify: vi.fn(),
      } as never,
      {
        platformPublicBaseUrl: 'https://platform.example.test',
      },
    );

    const result = await service.reconnectServer('tenant-1', 'user-1', 'server-1');

    const browserResult = expectBrowserAuthorizationResult(result, 'server-1');
    expect(browserResult.authorizeUrl).toContain('https://auth.example.test/oauth/authorize?');
  });

  it('preserves authorization-server paths when discovering oauth metadata', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'https://mcp.example.test/server') {
        return mockJsonResponse({}, 401);
      }
      if (url === 'https://mcp.example.test/.well-known/oauth-protected-resource/server') {
        return mockJsonResponse({
          authorization_servers: ['https://github.com/login/oauth'],
        });
      }
      if (url === 'https://github.com/login/oauth/.well-known/openid-configuration') {
        return mockJsonResponse({
          issuer: 'https://github.com',
          authorization_endpoint: 'https://github.com/login/oauth/authorize',
          token_endpoint: 'https://github.com/login/oauth/access_token',
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
          client_id_metadata_document_supported: true,
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO remote_mcp_registration_drafts')) {
          return { rowCount: 1, rows: [{ id: 'draft-1' }] };
        }
        if (sql.includes('INSERT INTO oauth_states')) {
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
      {
        verify: vi.fn(),
      } as never,
      {
        platformPublicBaseUrl: 'https://platform.example.test',
      },
    );

    const result = await service.initiateDraftAuthorization('tenant-1', 'user-1', {
      name: 'GitHub MCP',
      description: '',
      endpointUrl: 'https://mcp.example.test/server',
      callTimeoutSeconds: 300,
      authMode: 'oauth',
      enabledByDefaultForNewSpecialists: false,
      grantToAllExistingSpecialists: false,
      parameters: [],
    });

    const browserResult = expectBrowserAuthorizationResult(result, 'draft-1');
    expect(browserResult.authorizeUrl).toContain('https://github.com/login/oauth/authorize?');
    const requestedUrls = vi.mocked(globalThis.fetch).mock.calls.map(([input]) => String(input));
    expect(requestedUrls).toContain('https://github.com/login/oauth/.well-known/openid-configuration');
    expect(requestedUrls).not.toContain('https://github.com/.well-known/openid-configuration');
  });

  it('falls back to root authorization-server metadata when resource metadata does not advertise authorization servers', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'https://mcp.example.test/server') {
        return mockJsonResponse({}, 401);
      }
      if (url === 'https://mcp.example.test/.well-known/oauth-protected-resource/server') {
        return mockJsonResponse({
          resource: 'https://mcp.example.test/server',
        });
      }
      if (url === 'https://mcp.example.test/server/.well-known/oauth-protected-resource') {
        return mockJsonResponse({
          resource: 'https://mcp.example.test/server',
        });
      }
      if (url === 'https://mcp.example.test/server/.well-known/oauth-authorization-server') {
        return mockJsonResponse({}, 404);
      }
      if (url === 'https://mcp.example.test/.well-known/oauth-authorization-server') {
        return mockJsonResponse({
          issuer: 'https://auth.example.test',
          authorization_endpoint: 'https://auth.example.test/oauth/authorize',
          token_endpoint: 'https://auth.example.test/oauth/token',
          registration_endpoint: 'https://auth.example.test/oauth/register',
          token_endpoint_auth_methods_supported: ['none'],
          code_challenge_methods_supported: ['S256'],
          client_id_metadata_document_supported: true,
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO remote_mcp_registration_drafts')) {
          return { rowCount: 1, rows: [{ id: 'draft-1' }] };
        }
        if (sql.includes('INSERT INTO oauth_states')) {
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
      {
        verify: vi.fn(),
      } as never,
      {
        platformPublicBaseUrl: 'https://platform.example.test',
      },
    );

    const result = await service.initiateDraftAuthorization('tenant-1', 'user-1', {
      name: 'Root Metadata MCP',
      description: '',
      endpointUrl: 'https://mcp.example.test/server',
      callTimeoutSeconds: 300,
      authMode: 'oauth',
      enabledByDefaultForNewSpecialists: false,
      grantToAllExistingSpecialists: false,
      parameters: [],
    });

    const browserResult = expectBrowserAuthorizationResult(result, 'draft-1');
    expect(browserResult.authorizeUrl).toContain('https://auth.example.test/oauth/authorize?');
  });

  it('uses the configured hosted callback base when building oauth authorize urls', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        mockJsonResponse({}, 401),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          authorization_servers: ['https://auth.example.test'],
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          issuer: 'https://auth.example.test',
          authorization_endpoint: 'https://auth.example.test/oauth/authorize',
          token_endpoint: 'https://auth.example.test/oauth/token',
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
          client_id_metadata_document_supported: true,
        }),
      );

    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO remote_mcp_registration_drafts')) {
          return { rowCount: 1, rows: [{ id: 'draft-1' }] };
        }
        if (sql.includes('INSERT INTO oauth_states')) {
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
      {
        verify: vi.fn(),
      } as never,
      {
        platformPublicBaseUrl: 'https://platform.example.test',
        remoteMcpHostedCallbackBaseUrl: 'https://oauth.example.test',
      } as never,
    );

    const result = await service.initiateDraftAuthorization('tenant-1', 'user-1', {
      name: 'Hosted Callback MCP',
      description: '',
      endpointUrl: 'https://mcp.example.test/server',
      callTimeoutSeconds: 300,
      authMode: 'oauth',
      enabledByDefaultForNewSpecialists: false,
      grantToAllExistingSpecialists: false,
      parameters: [],
    });

    const browserResult = expectBrowserAuthorizationResult(result, 'draft-1');
    expect(browserResult.authorizeUrl).toContain(
      encodeURIComponent('https://oauth.example.test/api/v1/oauth/callback'),
    );
    expect(browserResult.authorizeUrl).not.toContain(
      encodeURIComponent('http://localhost:1455/auth/callback'),
    );
  });

  it('uses manual oauth client settings and extra authorize params for oauth drafts', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'https://api.githubcopilot.com/mcp/') {
        return mockJsonResponse({}, 401);
      }
      if (
        url === 'https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp/'
        || url === 'https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp'
      ) {
        return mockJsonResponse({
          resource: 'https://api.githubcopilot.com/mcp/',
          authorization_servers: ['https://github.com/login/oauth'],
        });
      }
      if (url === 'https://github.com/login/oauth/.well-known/openid-configuration') {
        return mockJsonResponse({
          issuer: 'https://github.com',
          authorization_endpoint: 'https://github.com/login/oauth/authorize',
          token_endpoint: 'https://github.com/login/oauth/access_token',
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['client_secret_basic'],
          client_id_metadata_document_supported: false,
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO remote_mcp_registration_drafts')) {
          return { rowCount: 1, rows: [{ id: 'draft-1' }] };
        }
        if (sql.includes('INSERT INTO oauth_states')) {
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
      {
        verify: vi.fn(),
      } as never,
      {
        platformPublicBaseUrl: 'https://platform.example.test',
        remoteMcpHostedCallbackBaseUrl: 'https://oauth.example.test',
      },
    );

    const result = await service.initiateDraftAuthorization('tenant-1', 'user-1', {
      name: 'GitHub Manual Client MCP',
      description: '',
      endpointUrl: 'https://api.githubcopilot.com/mcp/',
      callTimeoutSeconds: 300,
      authMode: 'oauth',
      transportPreference: 'streamable_http',
      enabledByDefaultForNewSpecialists: false,
      grantToAllExistingSpecialists: false,
      oauthDefinition: {
        grantType: 'authorization_code',
        clientStrategy: 'manual_client',
        callbackMode: 'hosted_https',
        clientId: 'github-client-id',
        clientSecret: 'github-client-secret',
        tokenEndpointAuthMethod: 'client_secret_basic',
        scopes: ['repo', 'read:org'],
        resourceIndicators: ['https://api.githubcopilot.com/mcp/'],
        audiences: ['https://github.com'],
      },
      parameters: [
        {
          placement: 'authorize_request_query',
          key: 'prompt',
          valueKind: 'static',
          value: 'consent',
        },
      ],
    });

    const browserResult = expectBrowserAuthorizationResult(result, 'draft-1');
    expect(browserResult.authorizeUrl).toContain('https://github.com/login/oauth/authorize?');
    expect(browserResult.authorizeUrl).toContain(encodeURIComponent('github-client-id'));
    expect(browserResult.authorizeUrl).toContain(
      encodeURIComponent('https://oauth.example.test/api/v1/oauth/callback'),
    );
    expect(browserResult.authorizeUrl).toContain('scope=repo+read%3Aorg');
    expect(browserResult.authorizeUrl).toContain(encodeURIComponent('https://api.githubcopilot.com/mcp/'));
    expect(browserResult.authorizeUrl).toContain(encodeURIComponent('https://github.com'));
    expect(browserResult.authorizeUrl).toContain('prompt=consent');
    expect(vi.mocked(globalThis.fetch).mock.calls).toHaveLength(3);
  });

  it('disconnects persisted oauth credentials and marks the server unverified', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('UPDATE remote_mcp_servers')) {
          expect(params).toEqual(['tenant-1', 'server-1']);
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
      {
        verify: vi.fn(),
      } as never,
      {
        platformPublicBaseUrl: 'https://platform.example.test',
      },
    );

    await service.disconnectServer('tenant-1', 'server-1');

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE remote_mcp_servers'),
      ['tenant-1', 'server-1'],
    );
  });

  it('returns an encrypted authorization header secret for a valid stored access token', async () => {
    const service = new RemoteMcpOAuthService(
      { query: vi.fn() } as never,
      {
        getStoredServer: vi.fn(),
        createVerifiedServer: vi.fn(),
        updateVerifiedServer: vi.fn(),
      } as never,
      {
        verify: vi.fn(),
      } as never,
      {
        platformPublicBaseUrl: 'https://platform.example.test',
      },
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
      {
        verify: vi.fn(),
      } as never,
      {
        platformPublicBaseUrl: 'https://platform.example.test',
      },
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
