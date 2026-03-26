import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SpecialistCapabilityService } from '../../src/services/specialist-capability-service.js';

function createMockPool() {
  return {
    query: vi.fn(),
  };
}

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

describe('SpecialistCapabilityService', () => {
  let pool: ReturnType<typeof createMockPool>;
  let service: SpecialistCapabilityService;

  beforeEach(() => {
    pool = createMockPool();
    service = new SpecialistCapabilityService(pool as never);
  });

  it('returns ordered active skills and verified remote MCP server contracts for a specialist', async () => {
    pool.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        name: 'researcher',
        description: 'Researches external sources.',
        escalation_target: 'human',
        allowed_tools: ['shell', 'web_fetch'],
        skills: [
          {
            id: 'skill-1',
            name: 'Structured Search',
            slug: 'structured-search',
            summary: 'Search deliberately.',
            content: 'Always open with a search plan.',
            sort_order: 0,
          },
        ],
        remote_mcp_servers: [
          {
            id: 'mcp-1',
            name: 'Tavily Search',
            slug: 'tavily-search',
            description: 'Web search and research.',
            endpoint_url: 'https://mcp.tavily.com/mcp/{tenant}',
            auth_mode: 'parameterized',
            verified_transport: 'streamable_http',
            verification_contract_version: 'remote-mcp-v1',
            discovered_tools_snapshot: [
              {
                original_name: 'search',
                description: 'Search the web',
              },
              {
                original_name: 'research',
                description: 'Research deeply',
              },
            ],
            parameters: [
              {
                id: 'param-1',
                placement: 'query',
                key: 'tavilyApiKey',
                value_kind: 'secret',
                static_value: null,
                encrypted_secret_value: 'enc:v1:test',
              },
            ],
          },
        ],
      }],
    });

    const result = await service.getRoleCapabilities(TENANT_ID, 'researcher');

    expect(result).toEqual({
      name: 'researcher',
      description: 'Researches external sources.',
      escalationTarget: 'human',
      allowedTools: ['shell', 'web_fetch'],
      skills: [
        {
          id: 'skill-1',
          name: 'Structured Search',
          slug: 'structured-search',
          summary: 'Search deliberately.',
          content: 'Always open with a search plan.',
          sortOrder: 0,
        },
      ],
      remoteMcpServers: [
        {
          id: 'mcp-1',
          name: 'Tavily Search',
          slug: 'tavily-search',
          description: 'Web search and research.',
          endpointUrl: 'https://mcp.tavily.com/mcp/{tenant}',
          authMode: 'parameterized',
          verifiedTransport: 'streamable_http',
          verificationContractVersion: 'remote-mcp-v1',
          discoveredToolsSnapshot: [
            {
              original_name: 'search',
              description: 'Search the web',
            },
            {
              original_name: 'research',
              description: 'Research deeply',
            },
          ],
          oauthConfig: null,
          oauthCredentials: null,
          parameters: [
            {
              id: 'param-1',
              placement: 'query',
              key: 'tavilyApiKey',
              valueKind: 'secret',
              staticValue: null,
              encryptedSecretValue: 'enc:v1:test',
            },
          ],
        },
      ],
    });
  });

  it('returns null when the specialist does not exist', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    await expect(service.getRoleCapabilities(TENANT_ID, 'missing')).resolves.toBeNull();
  });
});
