import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureProviderSecretEncryptionKey } from '../../../src/lib/oauth-crypto.js';
import { RemoteMcpOAuthService } from '../../../src/services/remote-mcp/oauth/remote-mcp-oauth-service.js';
import {
  expectBrowserAuthorizationResult,
  mockJsonResponse,
} from './remote-mcp-oauth-test-helpers.js';

describe('RemoteMcpOAuthService discovery flows', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    configureProviderSecretEncryptionKey('0123456789abcdef0123456789abcdef');
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('starts a reconnect oauth flow for an existing remote MCP server', async () => {
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
      { verify: vi.fn() } as never,
      { platformPublicBaseUrl: 'https://platform.example.test' },
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
      { verify: vi.fn() } as never,
      { platformPublicBaseUrl: 'https://platform.example.test' },
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
        return mockJsonResponse({ resource: 'https://mcp.example.test/server' });
      }
      if (url === 'https://mcp.example.test/server/.well-known/oauth-protected-resource') {
        return mockJsonResponse({ resource: 'https://mcp.example.test/server' });
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
      { verify: vi.fn() } as never,
      { platformPublicBaseUrl: 'https://platform.example.test' },
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
});
