import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureProviderSecretEncryptionKey } from '../../../src/lib/oauth-crypto.js';
import { RemoteMcpOAuthService } from '../../../src/services/remote-mcp-oauth-service.js';
import {
  mockJsonResponse,
  mockTextResponse,
} from './remote-mcp-oauth-test-helpers.js';

describe('RemoteMcpOAuthService compatibility device and machine flows', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    configureProviderSecretEncryptionKey('0123456789abcdef0123456789abcdef');
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('creates and verifies a client-credentials remote MCP server without a browser callback', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(mockTextResponse(401))
      .mockResolvedValueOnce(mockJsonResponse({
        resource: 'https://mcp.example.test/server',
        authorization_servers: ['https://auth.example.test'],
      }))
      .mockResolvedValueOnce(mockJsonResponse({
        issuer: 'https://auth.example.test',
        authorization_endpoint: 'https://auth.example.test/oauth/authorize',
        token_endpoint: 'https://auth.example.test/oauth/token',
        response_types_supported: ['code'],
        grant_types_supported: ['client_credentials'],
        token_endpoint_auth_methods_supported: ['client_secret_post'],
        client_id_metadata_document_supported: false,
      }))
      .mockResolvedValueOnce(mockJsonResponse({
        access_token: 'machine-token-1',
        expires_in: 3600,
        token_type: 'Bearer',
      }));

    const pool = { query: vi.fn(async () => ({ rowCount: 0, rows: [] })) };
    const serverService = {
      getStoredServer: vi.fn(),
      createVerifiedServer: vi.fn().mockResolvedValue({
        id: 'server-1',
        name: 'Machine MCP',
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
        discovered_resources_snapshot: [],
        discovered_prompts_snapshot: [],
        verified_capability_summary: {
          tool_count: 1,
          resource_count: 0,
          prompt_count: 0,
        },
        verified_discovery_strategy: 'resource_metadata',
        verified_oauth_strategy: 'client_credentials',
      }),
    };
    const service = new RemoteMcpOAuthService(
      pool as never,
      serverService as never,
      verifier as never,
      { platformPublicBaseUrl: 'https://platform.example.test' },
    );

    const result = await service.initiateDraftAuthorization('tenant-1', 'user-1', {
      name: 'Machine MCP',
      description: '',
      endpointUrl: 'https://mcp.example.test/server',
      callTimeoutSeconds: 300,
      authMode: 'oauth',
      enabledByDefaultForNewSpecialists: false,
      grantToAllExistingSpecialists: false,
      oauthDefinition: {
        grantType: 'client_credentials',
        clientStrategy: 'manual_client',
        clientId: 'client-id-1',
        clientSecret: 'client-secret-1',
        tokenEndpointAuthMethod: 'client_secret_post',
      },
      parameters: [],
    });

    expect(result).toEqual({
      kind: 'completed',
      serverId: 'server-1',
      serverName: 'Machine MCP',
    });
    expect(verifier.verify).toHaveBeenCalledWith(
      expect.objectContaining({
        authMode: 'oauth',
        parameters: expect.arrayContaining([
          expect.objectContaining({
            placement: 'header',
            key: 'Authorization',
            value: 'Bearer machine-token-1',
          }),
        ]),
      }),
    );
    expect(serverService.createVerifiedServer).toHaveBeenCalled();
  });

  it('starts a device-authorization flow and returns the user code details instead of an authorize url', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(mockTextResponse(401))
      .mockResolvedValueOnce(mockJsonResponse({
        resource: 'https://mcp.example.test/server',
        authorization_servers: ['https://auth.example.test'],
      }))
      .mockResolvedValueOnce(mockJsonResponse({
        issuer: 'https://auth.example.test',
        authorization_endpoint: 'https://auth.example.test/oauth/authorize',
        token_endpoint: 'https://auth.example.test/oauth/token',
        device_authorization_endpoint: 'https://auth.example.test/oauth/device',
        response_types_supported: ['code'],
        grant_types_supported: ['urn:ietf:params:oauth:grant-type:device_code'],
        token_endpoint_auth_methods_supported: ['none'],
        client_id_metadata_document_supported: true,
      }))
      .mockResolvedValueOnce(mockJsonResponse({
        device_code: 'device-code-1',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://auth.example.test/activate',
        verification_uri_complete: 'https://auth.example.test/activate?user_code=ABCD-EFGH',
        expires_in: 900,
        interval: 5,
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
      name: 'Device MCP',
      description: '',
      endpointUrl: 'https://mcp.example.test/server',
      callTimeoutSeconds: 300,
      authMode: 'oauth',
      enabledByDefaultForNewSpecialists: false,
      grantToAllExistingSpecialists: false,
      oauthDefinition: { grantType: 'device_authorization' },
      parameters: [],
    });

    expect(result).toMatchObject({
      kind: 'device',
      draftId: 'draft-1',
      deviceFlowId: expect.any(String),
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://auth.example.test/activate',
      verificationUriComplete: 'https://auth.example.test/activate?user_code=ABCD-EFGH',
      intervalSeconds: 5,
      expiresInSeconds: 900,
    });
  });

  it('keeps a device-authorization flow pending until token exchange succeeds', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse({ error: 'authorization_pending' }, 400),
    );

    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'DELETE FROM oauth_states WHERE expires_at < NOW()') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT tenant_id, user_id, code_verifier, flow_kind, flow_payload')) {
          return {
            rowCount: 1,
            rows: [{
              tenant_id: 'tenant-1',
              user_id: 'user-1',
              code_verifier: '',
              flow_kind: 'remote_mcp',
              flow_payload: {
                mode: 'draft',
                draft_id: 'draft-1',
                discovery_strategy: 'resource_metadata+authorization_server_metadata',
                oauth_strategy: 'device_authorization',
                resource_metadata: { resource: 'https://mcp.example.test/server' },
                oauth_config: {
                  issuer: 'https://auth.example.test',
                  authorizationEndpoint: null,
                  tokenEndpoint: 'https://auth.example.test/oauth/token',
                  registrationEndpoint: null,
                  deviceAuthorizationEndpoint: 'https://auth.example.test/oauth/device',
                  clientId: 'device-client-1',
                  clientSecret: null,
                  tokenEndpointAuthMethod: 'none',
                  clientIdMetadataDocumentUrl: null,
                  redirectUri: 'http://localhost:1455/auth/callback',
                  scopes: [],
                  resource: 'https://mcp.example.test/server',
                  resourceIndicators: [],
                  audiences: [],
                },
                device_authorization: {
                  device_code: 'device-code-1',
                  user_code: 'ABCD-EFGH',
                  verification_uri: 'https://auth.example.test/activate',
                  verification_uri_complete: 'https://auth.example.test/activate?user_code=ABCD-EFGH',
                  expires_in_seconds: 900,
                  interval_seconds: 5,
                  requested_at: Date.now(),
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
              name: 'Device MCP',
              description: '',
              endpoint_url: 'https://mcp.example.test/server',
              transport_preference: 'auto',
              call_timeout_seconds: 300,
              auth_mode: 'oauth',
              enabled_by_default_for_new_specialists: false,
              grant_to_all_existing_specialists: false,
              oauth_definition: { grantType: 'device_authorization' },
              parameters: [],
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const serverService = {
      getStoredServer: vi.fn(),
      createVerifiedServer: vi.fn(),
      updateVerifiedServer: vi.fn(),
    };
    const service = new RemoteMcpOAuthService(
      pool as never,
      serverService as never,
      { verify: vi.fn() } as never,
      { platformPublicBaseUrl: 'https://platform.example.test' },
    );

    await expect(service.pollDeviceAuthorization('state-1')).resolves.toMatchObject({
      kind: 'device',
      draftId: 'draft-1',
      deviceFlowId: 'state-1',
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://auth.example.test/activate',
      verificationUriComplete: 'https://auth.example.test/activate?user_code=ABCD-EFGH',
      intervalSeconds: 5,
      expiresInSeconds: 900,
    });
    expect(serverService.createVerifiedServer).not.toHaveBeenCalled();
    expect(serverService.updateVerifiedServer).not.toHaveBeenCalled();
  });
});
