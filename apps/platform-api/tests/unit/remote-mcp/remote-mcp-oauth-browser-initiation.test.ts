import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureProviderSecretEncryptionKey } from '../../../src/lib/oauth-crypto.js';
import { RemoteMcpOAuthService } from '../../../src/services/remote-mcp-oauth-service.js';
import {
  expectBrowserAuthorizationResult,
  mockJsonResponse,
} from './remote-mcp-oauth-test-helpers.js';

describe('RemoteMcpOAuthService browser initiation', () => {
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
      .mockResolvedValueOnce(mockJsonResponse({}, 401))
      .mockResolvedValueOnce(mockJsonResponse({
        authorization_servers: ['https://auth.example.test'],
      }))
      .mockResolvedValueOnce(mockJsonResponse({
        issuer: 'https://auth.example.test',
        authorization_endpoint: 'https://auth.example.test/oauth/authorize',
        token_endpoint: 'https://auth.example.test/oauth/token',
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        client_id_metadata_document_supported: true,
      }));

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
      { verify: vi.fn() } as never,
      { platformPublicBaseUrl: 'https://platform.example.test' },
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
    expect(browserResult.authorizeUrl).toContain(
      encodeURIComponent('https://mcp.example.test/server'),
    );
  });

  it('uses the selected oauth client profile for browser authorization', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(mockJsonResponse({}, 401))
      .mockResolvedValueOnce(mockJsonResponse({
        authorization_servers: ['https://auth.example.test'],
      }))
      .mockResolvedValueOnce(mockJsonResponse({
        issuer: 'https://auth.example.test',
        authorization_endpoint: 'https://auth.example.test/oauth/authorize',
        token_endpoint: 'https://auth.example.test/oauth/token',
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_post'],
        client_id_metadata_document_supported: false,
      }));

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
      { verify: vi.fn() } as never,
      { platformPublicBaseUrl: 'https://platform.example.test' },
      {
        getStoredProfile: vi.fn().mockResolvedValue({
          id: '00000000-0000-0000-0000-000000000901',
          tenant_id: 'tenant-1',
          name: 'Profile',
          slug: 'profile',
          description: '',
          issuer: null,
          client_id: 'profile-client-id',
          client_secret: 'profile-client-secret',
          token_endpoint_auth_method: 'client_secret_post',
          callback_mode: 'loopback',
          authorization_endpoint: 'https://auth.example.test/oauth/authorize',
          token_endpoint: 'https://auth.example.test/oauth/token',
          registration_endpoint: null,
          device_authorization_endpoint: null,
          default_scopes: ['openid', 'profile'],
          default_resource_indicators: [],
          default_audiences: [],
          has_stored_client_secret: true,
          linked_server_count: 0,
          created_at: new Date('2026-03-30T00:00:00.000Z'),
          updated_at: new Date('2026-03-30T00:00:00.000Z'),
        }),
      } as never,
    );

    const result = await service.initiateDraftAuthorization('tenant-1', 'user-1', {
      name: 'Docs MCP',
      description: '',
      endpointUrl: 'https://mcp.example.test/server',
      callTimeoutSeconds: 300,
      authMode: 'oauth',
      enabledByDefaultForNewSpecialists: false,
      grantToAllExistingSpecialists: false,
      oauthClientProfileId: '00000000-0000-0000-0000-000000000901',
      oauthDefinition: {},
      parameters: [],
    });

    const browserResult = expectBrowserAuthorizationResult(result, 'draft-1');
    expect(browserResult.authorizeUrl).toContain('client_id=profile-client-id');
    expect(browserResult.authorizeUrl).toContain('scope=openid+profile');
    expect(browserResult.authorizeUrl).not.toContain(
      encodeURIComponent('https://platform.example.test/.well-known/oauth/mcp-client.json'),
    );
  });

  it('uses the configured hosted callback base when building oauth authorize urls', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(mockJsonResponse({}, 401))
      .mockResolvedValueOnce(mockJsonResponse({
        authorization_servers: ['https://auth.example.test'],
      }))
      .mockResolvedValueOnce(mockJsonResponse({
        issuer: 'https://auth.example.test',
        authorization_endpoint: 'https://auth.example.test/oauth/authorize',
        token_endpoint: 'https://auth.example.test/oauth/token',
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        client_id_metadata_document_supported: true,
      }));

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
      { verify: vi.fn() } as never,
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
      { verify: vi.fn() } as never,
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
});
