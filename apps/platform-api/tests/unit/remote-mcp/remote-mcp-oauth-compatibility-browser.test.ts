import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureProviderSecretEncryptionKey } from '../../../src/lib/oauth-crypto.js';
import { RemoteMcpOAuthService } from '../../../src/services/remote-mcp-oauth-service.js';
import {
  mockJsonResponse,
  mockTextResponse,
} from './remote-mcp-oauth-test-helpers.js';

describe('RemoteMcpOAuthService compatibility browser flows', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    configureProviderSecretEncryptionKey('0123456789abcdef0123456789abcdef');
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('prefers challenge-provided resource metadata before well-known fallbacks', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        mockTextResponse(401, {
          'www-authenticate': 'Bearer realm="mcp", resource_metadata="https://mcp.example.test/challenge-metadata"',
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          resource: 'https://mcp.example.test/server',
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
      grantToAllExistingSpecialists: false,
      oauthDefinition: { grantType: 'authorization_code' },
      parameters: [],
    });

    expect(result).toMatchObject({ kind: 'browser', draftId: 'draft-1' });
    expect(vi.mocked(globalThis.fetch).mock.calls[0]?.[0]).toBe('https://mcp.example.test/server');
    expect(vi.mocked(globalThis.fetch).mock.calls[1]?.[0]).toBe('https://mcp.example.test/challenge-metadata');
  });

  it('allows manual client browser oauth when discovered authorization metadata is partial', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        mockTextResponse(401, {
          'www-authenticate': 'Bearer realm="mcp", resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/server"',
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          resource: 'https://mcp.example.test/server',
          authorization_servers: ['https://auth.example.test/oauth'],
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          issuer: 'https://auth.example.test',
          scopes_supported: ['docs.read'],
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
      { verify: vi.fn() } as never,
      { platformPublicBaseUrl: 'https://platform.example.test' },
    );

    const result = await service.initiateDraftAuthorization('tenant-1', 'user-1', {
      name: 'Manual Docs MCP',
      description: '',
      endpointUrl: 'https://mcp.example.test/server',
      callTimeoutSeconds: 300,
      authMode: 'oauth',
      enabledByDefaultForNewSpecialists: false,
      grantToAllExistingSpecialists: false,
      oauthDefinition: {
        grantType: 'authorization_code',
        clientStrategy: 'manual_client',
        clientId: 'client-id-1',
        clientSecret: 'client-secret-1',
        tokenEndpointAuthMethod: 'client_secret_basic',
        authorizationEndpointOverride: 'https://auth.example.test/oauth/authorize',
        tokenEndpointOverride: 'https://auth.example.test/oauth/token',
      },
      parameters: [],
    });

    expect(result).toMatchObject({ kind: 'browser', draftId: 'draft-1' });
  });

  it('rejects manual client browser oauth when a stored client secret has no token auth method', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(mockJsonResponse({}, 401))
      .mockResolvedValueOnce(mockJsonResponse({
        authorization_servers: ['https://github.com/login/oauth'],
      }))
      .mockResolvedValueOnce(mockJsonResponse({
        issuer: 'https://github.com/login/oauth',
        authorization_endpoint: 'https://github.com/login/oauth/authorize',
        token_endpoint: 'https://github.com/login/oauth/access_token',
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_post'],
        client_id_metadata_document_supported: false,
      }));

    const service = new RemoteMcpOAuthService(
      {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('INSERT INTO remote_mcp_registration_drafts')) {
            return { rowCount: 1, rows: [{ id: 'draft-1' }] };
          }
          if (sql.includes('INSERT INTO oauth_states')) {
            return { rowCount: 1, rows: [] };
          }
          throw new Error(`unexpected query: ${sql}`);
        }),
      } as never,
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
          client_id: 'client-id',
          client_secret: 'secret-123',
          token_endpoint_auth_method: 'none',
          callback_mode: 'loopback',
          authorization_endpoint: 'https://github.com/login/oauth/authorize',
          token_endpoint: 'https://github.com/login/oauth/access_token',
          registration_endpoint: null,
          device_authorization_endpoint: null,
          default_scopes: [],
          default_resource_indicators: [],
          default_audiences: [],
          has_stored_client_secret: true,
          linked_server_count: 0,
          created_at: new Date('2026-03-30T00:00:00.000Z'),
          updated_at: new Date('2026-03-30T00:00:00.000Z'),
        }),
      } as never,
    );

    await expect(service.initiateDraftAuthorization('tenant-1', 'user-1', {
      name: 'GitHub MCP',
      description: '',
      endpointUrl: 'https://api.githubcopilot.com/mcp/',
      callTimeoutSeconds: 300,
      authMode: 'oauth',
      enabledByDefaultForNewSpecialists: false,
      grantToAllExistingSpecialists: false,
      oauthClientProfileId: '00000000-0000-0000-0000-000000000901',
      oauthDefinition: {},
      parameters: [],
    })).rejects.toThrow('client secret must use client_secret_post, client_secret_basic, or private_key_jwt');
  });

  it('returns an actionable error when automatic oauth discovery does not expose usable endpoints', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        mockTextResponse(401, {
          'www-authenticate': 'Bearer realm="mcp", resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/server"',
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          resource: 'https://mcp.example.test/server',
          authorization_servers: ['https://auth.example.test/oauth'],
        }),
      )
      .mockResolvedValueOnce(mockJsonResponse({ issuer: 'https://auth.example.test' }));

    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO remote_mcp_registration_drafts')) {
          return { rowCount: 1, rows: [{ id: 'draft-1' }] };
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

    await expect(
      service.initiateDraftAuthorization('tenant-1', 'user-1', {
        name: 'Auto Docs MCP',
        description: '',
        endpointUrl: 'https://mcp.example.test/server',
        callTimeoutSeconds: 300,
        authMode: 'oauth',
        enabledByDefaultForNewSpecialists: false,
        grantToAllExistingSpecialists: false,
        oauthDefinition: {
          grantType: 'authorization_code',
          clientStrategy: 'auto',
        },
        parameters: [],
      }),
    ).rejects.toThrow(
      'Automatic OAuth discovery did not provide usable authorization and token endpoints. Configure a manual OAuth client and endpoint overrides for this server.',
    );
  });
});
