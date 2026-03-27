import { describe, expect, it } from 'vitest';

import {
  buildRemoteMcpCreatePayload,
  buildRemoteMcpServerStats,
  buildRemoteMcpUpdatePayload,
  createRemoteMcpServerForm,
  summarizeDiscoveredToolNames,
} from './mcp-page.support.js';

describe('remote mcp page support', () => {
  it('builds trimmed create payloads for parameterized servers', () => {
    expect(
      buildRemoteMcpCreatePayload({
        name: ' Tavily Search ',
        description: ' Public web search ',
        endpointUrl: ' https://mcp.example.test/search ',
        callTimeoutSeconds: ' 300 ',
        authMode: 'parameterized',
        enabledByDefaultForNewSpecialists: true,
        grantToAllExistingSpecialists: true,
        parameters: [
          {
            id: 'param-1',
            placement: 'query',
            key: ' tavilyApiKey ',
            valueKind: 'secret',
            value: ' top-secret ',
            hasStoredSecret: false,
          },
          {
            id: 'param-2',
            placement: 'header',
            key: ' X-Workspace ',
            valueKind: 'static',
            value: ' docs ',
            hasStoredSecret: false,
          },
        ],
      }),
    ).toEqual({
      name: 'Tavily Search',
      description: 'Public web search',
      endpointUrl: 'https://mcp.example.test/search',
      callTimeoutSeconds: 300,
      authMode: 'parameterized',
      enabledByDefaultForNewSpecialists: true,
      grantToAllExistingSpecialists: true,
      parameters: [
        {
          placement: 'query',
          key: 'tavilyApiKey',
          valueKind: 'secret',
          value: 'top-secret',
        },
        {
          placement: 'header',
          key: 'X-Workspace',
          valueKind: 'static',
          value: 'docs',
        },
      ],
    });
  });

  it('hydrates stored secret parameters without exposing their plaintext and preserves them on update', () => {
    const form = createRemoteMcpServerForm({
      id: 'server-1',
      name: 'Docs MCP',
      slug: 'docs-mcp',
      description: 'Search docs',
      endpoint_url: 'https://mcp.example.test/search',
      call_timeout_seconds: 300,
      auth_mode: 'parameterized',
      enabled_by_default_for_new_specialists: false,
      is_archived: false,
      verification_status: 'verified',
      verification_error: null,
      verified_transport: 'streamable_http',
      verified_at: '2026-03-26T00:00:00.000Z',
      verification_contract_version: 'remote-mcp-v1',
      discovered_tools_snapshot: [],
      discovered_tool_count: 0,
      assigned_specialist_count: 0,
      oauth_connected: false,
      oauth_authorized_at: null,
      oauth_needs_reauth: false,
      created_at: '2026-03-26T00:00:00.000Z',
      updated_at: '2026-03-26T00:00:00.000Z',
      parameters: [
        {
          id: 'param-1',
          placement: 'header',
          key: 'Authorization',
          value_kind: 'secret',
          value: 'redacted://remote-mcp-secret',
          has_stored_secret: true,
        },
      ],
    });

    expect(form.parameters).toEqual([
      {
        id: 'param-1',
        placement: 'header',
        key: 'Authorization',
        valueKind: 'secret',
        value: '',
        hasStoredSecret: true,
      },
    ]);

    expect(buildRemoteMcpUpdatePayload(form)).toEqual({
      name: 'Docs MCP',
      description: 'Search docs',
      endpointUrl: 'https://mcp.example.test/search',
      callTimeoutSeconds: 300,
      authMode: 'parameterized',
      enabledByDefaultForNewSpecialists: false,
      parameters: [
        {
          placement: 'header',
          key: 'Authorization',
          valueKind: 'secret',
          value: 'redacted://remote-mcp-secret',
        },
      ],
    });
  });

  it('summarizes discovered tools and page-level stats', () => {
    expect(
      summarizeDiscoveredToolNames([
        { original_name: 'search' },
        { original_name: 'research' },
        { name: 'fallback' },
      ]),
    ).toEqual(['search', 'research', 'fallback']);

    expect(
      buildRemoteMcpServerStats([
        {
          id: 'server-1',
          name: 'Search MCP',
          slug: 'search-mcp',
          description: 'Search docs',
          endpoint_url: 'https://mcp.example.test/search',
          call_timeout_seconds: 300,
          auth_mode: 'parameterized',
          enabled_by_default_for_new_specialists: true,
          is_archived: false,
          verification_status: 'verified',
          verification_error: null,
          verified_transport: 'streamable_http',
          verified_at: '2026-03-26T00:00:00.000Z',
          verification_contract_version: 'remote-mcp-v1',
          discovered_tools_snapshot: [{ original_name: 'search' }],
          discovered_tool_count: 1,
          assigned_specialist_count: 3,
          parameters: [],
          oauth_connected: false,
          oauth_authorized_at: null,
          oauth_needs_reauth: false,
          created_at: '2026-03-26T00:00:00.000Z',
          updated_at: '2026-03-26T00:00:00.000Z',
        },
        {
          id: 'server-2',
          name: 'Docs OAuth',
          slug: 'docs-oauth',
          description: 'Search docs',
          endpoint_url: 'https://mcp.example.test/docs',
          call_timeout_seconds: 420,
          auth_mode: 'oauth',
          enabled_by_default_for_new_specialists: false,
          is_archived: false,
          verification_status: 'verified',
          verification_error: null,
          verified_transport: 'http_sse_compat',
          verified_at: '2026-03-26T00:00:00.000Z',
          verification_contract_version: 'remote-mcp-v1',
          discovered_tools_snapshot: [{ original_name: 'search' }],
          discovered_tool_count: 1,
          assigned_specialist_count: 1,
          parameters: [],
          oauth_connected: true,
          oauth_authorized_at: '2026-03-26T00:00:00.000Z',
          oauth_needs_reauth: false,
          created_at: '2026-03-26T00:00:00.000Z',
          updated_at: '2026-03-26T00:00:00.000Z',
        },
      ]),
    ).toEqual({
      total: 2,
      oauthConnected: 1,
    });
  });
});
