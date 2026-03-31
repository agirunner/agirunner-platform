import { describe, expect, it } from 'vitest';

import {
  buildRemoteMcpCreatePayload,
  buildRemoteMcpServerStats,
  buildRemoteMcpUpdatePayload,
  createRemoteMcpServerForm,
  summarizeDiscoveredToolNames,
} from './mcp-page.support.js';

describe('remote mcp page support', () => {
  it('starts new remote MCP forms without a forced blank parameter row', () => {
    const form = createRemoteMcpServerForm();

    expect(form.parameters).toEqual([]);
    expect(form.oauthClientProfileId).toBe('');
    expect(form.oauth.grantType).toBe('authorization_code');
    expect(form.oauth.clientStrategy).toBe('auto');
  });

  it('builds trimmed create payloads for parameterized servers', () => {
    expect(
      buildRemoteMcpCreatePayload({
        name: ' Tavily Search ',
        description: ' Public web search ',
        endpointUrl: ' https://mcp.example.test/search ',
        transportPreference: 'auto',
        callTimeoutSeconds: ' 300 ',
      authMode: 'parameterized',
      enabledByDefaultForNewSpecialists: true,
      grantToAllExistingSpecialists: true,
      oauthClientProfileId: '',
      oauth: createRemoteMcpServerForm().oauth,
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
      transportPreference: 'auto',
      callTimeoutSeconds: 300,
      authMode: 'parameterized',
      enabledByDefaultForNewSpecialists: true,
      grantToAllExistingSpecialists: true,
      oauthClientProfileId: null,
      oauthDefinition: null,
      parameters: [
        {
          id: 'param-1',
          placement: 'query',
          key: 'tavilyApiKey',
          valueKind: 'secret',
          value: 'top-secret',
        },
        {
          id: 'param-2',
          placement: 'header',
          key: 'X-Workspace',
          valueKind: 'static',
          value: 'docs',
        },
      ],
    });
  });

  it('preserves oauth-specific query and device placements in create payloads', () => {
    expect(
      buildRemoteMcpCreatePayload({
        name: ' Remote MCP ',
        description: '',
        endpointUrl: ' https://mcp.example.test/server ',
        transportPreference: 'auto',
        callTimeoutSeconds: ' 300 ',
      authMode: 'oauth',
      enabledByDefaultForNewSpecialists: false,
      grantToAllExistingSpecialists: false,
      oauthClientProfileId: 'profile-1',
      oauth: createRemoteMcpServerForm().oauth,
      parameters: [
          {
            id: 'param-1',
            placement: 'device_request_query',
            key: ' audience ',
            valueKind: 'static',
            value: ' docs ',
            hasStoredSecret: false,
          },
          {
            id: 'param-2',
            placement: 'token_request_query',
            key: ' resource ',
            valueKind: 'secret',
            value: ' secret-resource ',
            hasStoredSecret: false,
          },
          {
            id: 'param-3',
            placement: 'device_request_body_json',
            key: ' tenant ',
            valueKind: 'static',
            value: ' engineering ',
            hasStoredSecret: false,
          },
        ],
      }),
    ).toEqual({
      name: 'Remote MCP',
      description: '',
      endpointUrl: 'https://mcp.example.test/server',
      transportPreference: 'auto',
      callTimeoutSeconds: 300,
      authMode: 'oauth',
      enabledByDefaultForNewSpecialists: false,
      grantToAllExistingSpecialists: false,
      oauthClientProfileId: 'profile-1',
      oauthDefinition: expect.any(Object),
      parameters: [
        {
          id: 'param-1',
          placement: 'device_request_query',
          key: 'audience',
          valueKind: 'static',
          value: 'docs',
        },
        {
          id: 'param-2',
          placement: 'token_request_query',
          key: 'resource',
          valueKind: 'secret',
          value: 'secret-resource',
        },
        {
          id: 'param-3',
          placement: 'device_request_body_json',
          key: 'tenant',
          valueKind: 'static',
          value: 'engineering',
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
      transport_preference: 'auto',
      call_timeout_seconds: 300,
      auth_mode: 'parameterized',
      enabled_by_default_for_new_specialists: false,
      is_archived: false,
      verification_status: 'verified',
      verification_error: null,
      verified_transport: 'streamable_http',
      verified_at: '2026-03-26T00:00:00.000Z',
      verification_contract_version: 'remote-mcp-v1',
      verified_capability_summary: {
        tool_count: 0,
        resource_count: 0,
        prompt_count: 0,
      },
      discovered_tools_snapshot: [],
      discovered_resources_snapshot: [],
      discovered_prompts_snapshot: [],
      discovered_tool_count: 0,
      discovered_resource_count: 0,
      discovered_prompt_count: 0,
      assigned_specialist_count: 0,
      oauth_definition: null,
      oauth_client_profile_id: null,
      oauth_client_profile_name: null,
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
      transportPreference: 'auto',
      callTimeoutSeconds: 300,
      authMode: 'parameterized',
      enabledByDefaultForNewSpecialists: false,
      oauthClientProfileId: null,
      oauthDefinition: null,
      parameters: [
        {
          id: 'param-1',
          placement: 'header',
          key: 'Authorization',
          valueKind: 'secret',
          value: 'redacted://remote-mcp-secret',
        },
      ],
    });
  });

  it('keeps existing servers with no parameters empty instead of creating a synthetic row', () => {
    const form = createRemoteMcpServerForm({
      id: 'server-2',
      name: 'OAuth MCP',
      slug: 'oauth-mcp',
      description: 'Search docs',
      endpoint_url: 'https://mcp.example.test/oauth',
      transport_preference: 'auto',
      call_timeout_seconds: 300,
      auth_mode: 'oauth',
      enabled_by_default_for_new_specialists: false,
      is_archived: false,
      verification_status: 'verified',
      verification_error: null,
      verified_transport: 'streamable_http',
      verified_at: '2026-03-26T00:00:00.000Z',
      verification_contract_version: 'remote-mcp-v1',
      verified_capability_summary: {
        tool_count: 1,
        resource_count: 0,
        prompt_count: 0,
      },
      discovered_tools_snapshot: [{ original_name: 'search' }],
      discovered_resources_snapshot: [],
      discovered_prompts_snapshot: [],
      discovered_tool_count: 1,
      discovered_resource_count: 0,
      discovered_prompt_count: 0,
      assigned_specialist_count: 0,
      oauth_definition: {
        grantType: 'authorization_code',
        clientStrategy: 'auto',
        callbackMode: 'loopback',
        tokenEndpointAuthMethod: 'none',
        scopes: [],
        resourceIndicators: [],
        audiences: [],
        parMode: 'disabled',
        jarMode: 'disabled',
      },
      oauth_client_profile_id: 'profile-7',
      oauth_client_profile_name: 'Shared OAuth client',
      oauth_connected: true,
      oauth_authorized_at: '2026-03-26T00:00:00.000Z',
      oauth_needs_reauth: false,
      created_at: '2026-03-26T00:00:00.000Z',
      updated_at: '2026-03-26T00:00:00.000Z',
      parameters: [],
    });

    expect(form.parameters).toEqual([]);
    expect(form.oauthClientProfileId).toBe('profile-7');
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
          transport_preference: 'auto',
          call_timeout_seconds: 300,
          auth_mode: 'parameterized',
          enabled_by_default_for_new_specialists: true,
          is_archived: false,
          verification_status: 'verified',
          verification_error: null,
          verified_transport: 'streamable_http',
          verified_at: '2026-03-26T00:00:00.000Z',
          verification_contract_version: 'remote-mcp-v1',
          verified_capability_summary: {
            tool_count: 1,
            resource_count: 0,
            prompt_count: 0,
          },
          discovered_tools_snapshot: [{ original_name: 'search' }],
          discovered_resources_snapshot: [],
          discovered_prompts_snapshot: [],
          discovered_tool_count: 1,
          discovered_resource_count: 0,
          discovered_prompt_count: 0,
          assigned_specialist_count: 3,
          parameters: [],
          oauth_definition: null,
          oauth_client_profile_id: null,
          oauth_client_profile_name: null,
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
          transport_preference: 'auto',
          call_timeout_seconds: 420,
          auth_mode: 'oauth',
          enabled_by_default_for_new_specialists: false,
          is_archived: false,
          verification_status: 'verified',
          verification_error: null,
          verified_transport: 'http_sse_compat',
          verified_at: '2026-03-26T00:00:00.000Z',
          verification_contract_version: 'remote-mcp-v1',
          verified_capability_summary: {
            tool_count: 1,
            resource_count: 0,
            prompt_count: 0,
          },
          discovered_tools_snapshot: [{ original_name: 'search' }],
          discovered_resources_snapshot: [],
          discovered_prompts_snapshot: [],
          discovered_tool_count: 1,
          discovered_resource_count: 0,
          discovered_prompt_count: 0,
          assigned_specialist_count: 1,
          parameters: [],
          oauth_definition: null,
          oauth_client_profile_id: 'profile-2',
          oauth_client_profile_name: 'Shared profile',
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
