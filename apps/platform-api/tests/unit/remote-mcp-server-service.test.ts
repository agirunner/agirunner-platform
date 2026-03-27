import { beforeEach, describe, expect, it, vi } from 'vitest';

import { configureProviderSecretEncryptionKey } from '../../src/lib/oauth-crypto.js';
import { RemoteMcpServerService } from '../../src/services/remote-mcp-server-service.js';

function createMockPool() {
  return {
    query: vi.fn(),
  };
}

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const SERVER_ID = '00000000-0000-0000-0000-000000000201';
const ROLE_ID = '00000000-0000-0000-0000-000000000301';

function buildServerRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: SERVER_ID,
    tenant_id: TENANT_ID,
    name: 'Tavily Search',
    slug: 'tavily-search',
    description: 'Tenant search MCP',
    endpoint_url: 'https://mcp.tavily.com/mcp/{tenant}',
    call_timeout_seconds: 300,
    auth_mode: 'parameterized',
    enabled_by_default_for_new_specialists: true,
    is_archived: false,
    verification_status: 'verified',
    verification_error: null,
    verified_transport: 'streamable_http',
    verified_at: new Date(),
    verification_contract_version: 'remote-mcp-v1',
    discovered_tools_snapshot: [
      {
        original_name: 'search',
        runtime_tool_name_preview: 'mcp_tavily_search',
        description: 'Search the web',
      },
    ],
    created_at: new Date(),
    updated_at: new Date(),
    parameter_rows: [
      {
        id: 'param-1',
        placement: 'query',
        key: 'tavilyApiKey',
        value_kind: 'secret',
        static_value: null,
        encrypted_secret_value: 'enc:v1:abc',
      },
    ],
    assigned_specialist_count: 2,
    ...overrides,
  };
}

describe('RemoteMcpServerService', () => {
  let pool: ReturnType<typeof createMockPool>;
  let service: RemoteMcpServerService;

  beforeEach(() => {
    configureProviderSecretEncryptionKey(
      'test-webhook-encryption-key-abcdefghijklmnopqrstuvwxyz',
    );
    pool = createMockPool();
    service = new RemoteMcpServerService(pool as never);
  });

  it('lists masked remote MCP server records', async () => {
    pool.query.mockResolvedValueOnce({ rows: [buildServerRow()], rowCount: 1 });

    const result = await service.listServers(TENANT_ID);

    expect(result[0]).toEqual(
      expect.objectContaining({
        id: SERVER_ID,
        call_timeout_seconds: 300,
        verification_status: 'verified',
        discovered_tool_count: 1,
        assigned_specialist_count: 2,
      }),
    );
    expect(result[0]?.parameters[0]).toEqual(
      expect.objectContaining({
        key: 'tavilyApiKey',
        value_kind: 'secret',
        value: 'redacted://remote-mcp-secret',
      }),
    );
  });

  it('creates verified server records and grants them to all active specialists when requested', async () => {
    pool.query.mockImplementation(async (sql: unknown) => {
      if (typeof sql !== 'string') {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('SELECT id FROM remote_mcp_servers WHERE tenant_id')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('INSERT INTO remote_mcp_servers')) {
        return { rows: [{ id: SERVER_ID }], rowCount: 1 };
      }
      if (sql.includes('SELECT id\n         FROM role_definitions')) {
        return { rows: [{ id: ROLE_ID }, { id: 'role-2' }], rowCount: 2 };
      }
      if (sql.includes('FROM remote_mcp_servers s')) {
        return { rows: [buildServerRow()], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    const result = await service.createVerifiedServer(TENANT_ID, {
      name: 'Tavily Search',
      description: 'Tenant search MCP',
      endpointUrl: 'https://mcp.tavily.com/mcp/{tenant}',
      authMode: 'parameterized',
      enabledByDefaultForNewSpecialists: true,
      grantToAllExistingSpecialists: true,
      callTimeoutSeconds: 300,
      verificationStatus: 'verified',
      verificationError: null,
      verifiedTransport: 'streamable_http',
      verificationContractVersion: 'remote-mcp-v1',
      discoveredToolsSnapshot: [
        {
          original_name: 'search',
          runtime_tool_name_preview: 'mcp_tavily_search',
          description: 'Search the web',
        },
      ],
      parameters: [
        {
          placement: 'query',
          key: 'tavilyApiKey',
          valueKind: 'secret',
          value: 'plain-secret',
        },
      ],
    });

    expect(result.slug).toBe('tavily-search');
    expect(
      pool.query.mock.calls.some(
        ([sql]) =>
          typeof sql === 'string' && sql.includes('INSERT INTO specialist_mcp_server_grants'),
      ),
    ).toBe(true);
  });

  it('deletes remote MCP servers and relies on fk cleanup for assignments and parameters', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [buildServerRow()], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: SERVER_ID }], rowCount: 1 });

    await service.deleteServer(TENANT_ID, SERVER_ID);

    expect(
      pool.query.mock.calls.some(
        ([sql]) =>
          typeof sql === 'string'
          && sql.includes('DELETE FROM remote_mcp_servers')
          && sql.includes('WHERE tenant_id = $1')
          && sql.includes('AND id = $2'),
      ),
    ).toBe(true);
  });
});
