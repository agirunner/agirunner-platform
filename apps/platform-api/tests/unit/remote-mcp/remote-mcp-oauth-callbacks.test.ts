import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureProviderSecretEncryptionKey } from '../../../src/lib/oauth-crypto.js';
import { RemoteMcpOAuthService } from '../../../src/services/remote-mcp/oauth/remote-mcp-oauth-service.js';
import { mockJsonResponse } from './remote-mcp-oauth-test-helpers.js';

describe('RemoteMcpOAuthService callback and connection flows', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    configureProviderSecretEncryptionKey('0123456789abcdef0123456789abcdef');
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
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
                resource_metadata: { resource: 'https://mcp.example.test/server' },
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
              transport_preference: 'auto',
              auth_mode: 'oauth',
              oauth_client_profile_id: null,
              oauth_definition: {},
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
      { platformPublicBaseUrl: 'https://platform.example.test' },
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
      { verify: vi.fn() } as never,
      { platformPublicBaseUrl: 'https://platform.example.test' },
    );

    await service.disconnectServer('tenant-1', 'server-1');

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE remote_mcp_servers'),
      ['tenant-1', 'server-1'],
    );
  });
});
