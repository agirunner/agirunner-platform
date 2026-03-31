import { beforeEach, describe, expect, it, vi } from 'vitest';

import { configureProviderSecretEncryptionKey, storeProviderSecret } from '../../../src/lib/oauth-crypto.js';
import { ConflictError, ValidationError } from '../../../src/errors/domain-errors.js';
import { RemoteMcpOAuthClientProfileService } from '../../../src/services/remote-mcp-oauth-client-profile-service.js';

function createMockPool() {
  return {
    query: vi.fn(),
  };
}

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const PROFILE_ID = '00000000-0000-0000-0000-000000000101';

function buildProfileRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: PROFILE_ID,
    tenant_id: TENANT_ID,
    name: 'Hosted OAuth Client',
    slug: 'hosted-oauth-client',
    description: 'Reusable MCP OAuth client profile',
    issuer: 'https://auth.example.test',
    authorization_endpoint: 'https://auth.example.test/oauth/authorize',
    token_endpoint: 'https://auth.example.test/oauth/token',
    registration_endpoint: null,
    device_authorization_endpoint: null,
    callback_mode: 'loopback',
    token_endpoint_auth_method: 'client_secret_post',
    client_id: 'client-123',
    encrypted_client_secret: storeProviderSecret('profile-secret'),
    default_scopes: ['openid', 'profile'],
    default_resource_indicators: ['https://mcp.example.test/server'],
    default_audiences: ['https://auth.example.test'],
    linked_server_count: 2,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe('RemoteMcpOAuthClientProfileService', () => {
  let pool: ReturnType<typeof createMockPool>;
  let service: RemoteMcpOAuthClientProfileService;

  beforeEach(() => {
    configureProviderSecretEncryptionKey(
      'test-webhook-encryption-key-abcdefghijklmnopqrstuvwxyz',
    );
    pool = createMockPool();
    service = new RemoteMcpOAuthClientProfileService(pool as never);
  });

  it('lists masked oauth client profiles', async () => {
    pool.query.mockResolvedValueOnce({ rows: [buildProfileRow()], rowCount: 1 });

    const result = await service.listProfiles(TENANT_ID);

    expect(result).toEqual([
      expect.objectContaining({
        id: PROFILE_ID,
        name: 'Hosted OAuth Client',
        token_endpoint_auth_method: 'client_secret_post',
        linked_server_count: 2,
        client_id: 'client-123',
        client_secret: 'redacted://remote-mcp-secret',
        has_stored_client_secret: true,
      }),
    ]);
  });

  it('disconnects linked remote MCP servers when connection details change', async () => {
    pool.query.mockImplementation(async (sql: unknown) => {
      if (typeof sql !== 'string') {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('FROM remote_mcp_oauth_client_profiles p')) {
        return { rows: [buildProfileRow()], rowCount: 1 };
      }
      if (sql.includes('SELECT id FROM remote_mcp_oauth_client_profiles WHERE tenant_id')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    });

    await service.updateProfile(TENANT_ID, PROFILE_ID, {
      tokenEndpoint: 'https://auth.example.test/oauth/token/v2',
    });

    expect(
      pool.query.mock.calls.some(
        ([sql]) =>
          typeof sql === 'string'
          && sql.includes('UPDATE remote_mcp_servers')
          && sql.includes("verification_error = 'OAuth client profile changed. Reconnect OAuth.'"),
      ),
    ).toBe(true);
  });

  it('rejects deleting an oauth client profile that is still referenced by servers', async () => {
    pool.query.mockResolvedValueOnce({ rows: [buildProfileRow()], rowCount: 1 });

    await expect(service.deleteProfile(TENANT_ID, PROFILE_ID)).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects storing a client secret with token auth method none', async () => {
    await expect(service.createProfile(TENANT_ID, {
      name: 'GitHub OAuth Client',
      description: '',
      tokenEndpoint: 'https://github.com/login/oauth/access_token',
      callbackMode: 'loopback',
      tokenEndpointAuthMethod: 'none',
      clientId: 'client-123',
      clientSecret: 'secret-123',
    })).rejects.toBeInstanceOf(ValidationError);
  });
});
