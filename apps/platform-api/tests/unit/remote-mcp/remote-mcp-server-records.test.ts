import { describe, expect, it } from 'vitest';

import { configureProviderSecretEncryptionKey } from '../../../src/lib/oauth-crypto.js';
import { toRemoteMcpServerRecord } from '../../../src/services/remote-mcp/remote-mcp-server-records.js';

describe('remote MCP server records', () => {
  it('masks secret parameter values in public record views', () => {
    configureProviderSecretEncryptionKey(
      'test-webhook-encryption-key-abcdefghijklmnopqrstuvwxyz',
    );

    const result = toRemoteMcpServerRecord(
      {
        id: 'server-1',
        tenant_id: 'tenant-1',
        name: 'Docs MCP',
        slug: 'docs-mcp',
        description: 'Docs tools',
        endpoint_url: 'https://mcp.example.test/server',
        transport_preference: 'auto',
        call_timeout_seconds: 300,
        auth_mode: 'parameterized',
        enabled_by_default_for_new_specialists: true,
        is_archived: false,
        verification_status: 'verified',
        verification_error: null,
        verified_transport: 'streamable_http',
        verified_discovery_strategy: 'direct_endpoint',
        verified_oauth_strategy: null,
        verified_at: new Date('2026-03-30T00:00:00.000Z'),
        verification_contract_version: 'remote-mcp-v1',
        verified_capability_summary: { tool_count: 1 },
        discovered_tools_snapshot: [{ original_name: 'search' }],
        discovered_resources_snapshot: [],
        discovered_prompts_snapshot: [],
        oauth_definition: null,
        oauth_client_profile_id: null,
        oauth_config: null,
        oauth_credentials: null,
        created_at: new Date('2026-03-30T00:00:00.000Z'),
        updated_at: new Date('2026-03-30T00:00:00.000Z'),
        parameter_rows: [
          {
            id: 'param-1',
            placement: 'query',
            key: 'apiKey',
            value_kind: 'secret',
            static_value: null,
            encrypted_secret_value: 'enc:v1:abc',
          },
        ],
        assigned_specialist_count: 2,
      },
      false,
    );

    expect(result.parameters[0]).toEqual(
      expect.objectContaining({
        key: 'apiKey',
        value_kind: 'secret',
        value: 'redacted://remote-mcp-secret',
      }),
    );
  });
});
