import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { NativeSearchMode } from '../../../src/catalogs/model-catalog.js';
import {
  configureProviderSecretEncryptionKey,
  storeOAuthToken,
  storeProviderSecret,
} from '../../../src/lib/oauth-crypto.js';
import { TaskClaimService } from '../../../src/services/task-claim/task-claim-service.js';

configureProviderSecretEncryptionKey('test-encryption-key');

const identity = {
  id: 'key-1',
  tenantId: 'tenant-1',
  scope: 'agent' as const,
  ownerType: 'agent' as const,
  ownerId: 'agent-1',
  keyPrefix: 'agent-key',
};

const defaultResolvedRoleConfig = {
  provider: {
    name: 'OpenAI',
    providerId: 'provider-default',
    providerType: 'openai',
    authMode: 'api_key',
    apiKeySecretRef: 'secret:OPENAI_API_KEY',
    baseUrl: 'https://api.openai.test/v1',
  },
  model: {
    modelId: 'gpt-5',
    contextWindow: null,
    maxOutputTokens: 128000,
    endpointType: 'responses',
    reasoningConfig: null,
  },
  reasoningConfig: { reasoning_effort: 'low' },
};

const hostWorkspacePath = resolve('host/workspace');

function buildExecutionEnvironmentRow(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: 'env-default',
    name: 'Debian Base',
    source_kind: 'catalog',
    catalog_key: 'debian-base',
    catalog_version: 1,
    image: 'debian:trixie-slim',
    cpu: '1',
    memory: '1Gi',
    pull_policy: 'if-not-present',
    compatibility_status: 'compatible',
    verification_contract_version: 'v1',
    verified_metadata: { distro: 'debian', package_manager: 'apt-get' },
    tool_capabilities: { verified_baseline_commands: ['sh', 'mkdir', 'grep'] },
    bootstrap_commands: [],
    bootstrap_required_domains: [],
    support_status: 'active',
    ...overrides,
  };
}

function createClient(executionMode: 'specialist' | 'orchestrator') {
  return {
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('SELECT id, workflow_id, work_item_id, is_orchestrator_task, state')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('UPDATE tasks')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('SELECT * FROM agents')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'agent-1',
            worker_id: null,
            current_task_id: null,
            metadata: { execution_mode: executionMode },
          }],
        };
      }
      if (sql.includes('SELECT tasks.* FROM tasks')) {
        return { rowCount: 0, rows: [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    }),
    release: vi.fn(),
  };
}

function createService(
  client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> },
  overrides: Partial<ConstructorParameters<typeof TaskClaimService>[0]> = {},
) {
  const pool = {
    connect: vi.fn(async () => client),
  };
  return new TaskClaimService({
    pool: pool as never,
    eventService: { emit: vi.fn() } as never,
    toTaskResponse: (task) => task,
    getTaskContext: vi.fn(async () => ({})),
    resolveRoleConfig: vi.fn(async () => defaultResolvedRoleConfig),
    claimHandleSecret: 'test-claim-handle-secret',
    ...overrides,
  });
}

function runtimeDefaultQueryResult(sql: string, params?: unknown[]) {
  if (sql.includes('SELECT execution_environment_id')) {
    return { rowCount: 1, rows: [{ execution_environment_id: null }] };
  }
  if (sql.includes('FROM execution_environments ee')) {
    return { rowCount: 1, rows: [buildExecutionEnvironmentRow()] };
  }
  if (!sql.includes('FROM runtime_defaults')) {
    return null;
  }
  const key = params?.[1];
  if (key === 'platform.agent_default_heartbeat_interval_seconds') {
    return { rowCount: 1, rows: [{ config_value: '30' }] };
  }
  if (key === 'platform.agent_heartbeat_grace_period_ms') {
    return { rowCount: 1, rows: [{ config_value: '60000' }] };
  }
  if (key === 'platform.agent_heartbeat_threshold_multiplier') {
    return { rowCount: 1, rows: [{ config_value: '2' }] };
  }
  if (key === 'platform.agent_key_expiry_ms') {
    return { rowCount: 1, rows: [{ config_value: '60000' }] };
  }
  if (key === 'agent.max_iterations') {
    return { rowCount: 1, rows: [{ config_value: '100' }] };
  }
  if (key === 'agent.llm_max_retries') {
    return { rowCount: 1, rows: [{ config_value: '5' }] };
  }
  return { rowCount: 0, rows: [] };
}

describe('TaskClaimService', () => {
  it('emits oauth-backed remote MCP server contracts with opaque authorization claim handles', async () => {
    const encryptedAccessToken = storeProviderSecret('mcp-oauth-access-token');
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT id, workflow_id, work_item_id, is_orchestrator_task, state')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('UPDATE tasks') && sql.includes("SET state = 'ready'")) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT * FROM agents')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'agent-1',
              worker_id: null,
              current_task_id: null,
              metadata: { execution_mode: 'specialist' },
            }],
          };
        }
        if (sql.includes('SELECT tasks.* FROM tasks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-mcp-oauth',
              workflow_id: 'wf-1',
              state: 'ready',
              role: 'researcher',
              workspace_id: null,
              role_config: {},
              metadata: {},
              input: { description: 'Research the latest issue.' },
            }],
          };
        }
        if (sql.includes("SET state = 'claimed'")) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-mcp-oauth',
              workflow_id: 'wf-1',
              state: 'claimed',
              role: 'researcher',
              workspace_id: null,
              role_config: {},
              metadata: {},
              input: { description: 'Research the latest issue.' },
            }],
          };
        }
        if (sql.includes('UPDATE agents SET current_task_id')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('workflow_name')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT assigned_agent_id, assigned_worker_id')) {
          return {
            rowCount: 1,
            rows: [{ assigned_agent_id: 'agent-1', assigned_worker_id: null }],
          };
        }
        if (sql.includes('FROM role_definitions rd')) {
          return {
            rowCount: 1,
            rows: [{
              name: 'researcher',
              description: 'Researches external sources.',
              escalation_target: 'human',
              allowed_tools: ['web_fetch'],
              skills: [],
              remote_mcp_servers: [
                {
                  id: 'mcp-oauth-1',
                  name: 'Remote Research',
                  slug: 'remote-research',
                  description: 'OAuth-backed research MCP.',
                  endpoint_url: 'https://mcp.example.test/server',
                  call_timeout_seconds: 300,
                  auth_mode: 'oauth',
                  verified_transport: 'streamable_http',
                  verification_contract_version: 'remote-mcp-v1',
                  discovered_tools_snapshot: [
                    { original_name: 'search', description: 'Search the web' },
                  ],
                  parameters: [],
                  oauth_config: {
                    authorizationEndpoint: 'https://auth.example.test/oauth/authorize',
                    tokenEndpoint: 'https://auth.example.test/oauth/token',
                    clientId: 'https://platform.example.test/.well-known/oauth/mcp-client.json',
                    clientSecret: null,
                    tokenEndpointAuthMethod: 'none',
                    clientIdMetadataDocumentUrl: 'https://platform.example.test/.well-known/oauth/mcp-client.json',
                    redirectUri: 'http://localhost:1455/auth/callback',
                    scopes: [],
                    resource: 'https://mcp.example.test/server',
                  },
                  oauth_credentials: {
                    accessToken: encryptedAccessToken,
                    refreshToken: null,
                    expiresAt: null,
                    tokenType: 'Bearer',
                    scope: null,
                    authorizedAt: '2026-03-26T00:00:00.000Z',
                    authorizedByUserId: 'user-1',
                    needsReauth: false,
                  },
                },
              ],
            }],
          };
        }
        if (sql.includes('SELECT escalation_target, allowed_tools')) {
          return { rowCount: 0, rows: [] };
        }
        const runtimeDefault = runtimeDefaultQueryResult(sql, params);
        if (runtimeDefault) {
          return runtimeDefault;
        }
        throw new Error(`unexpected query: ${sql} :: ${JSON.stringify(params ?? [])}`);
      }),
      release: vi.fn(),
    };

    const pool = { connect: vi.fn(async () => client), query: client.query };
    const service = new TaskClaimService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      toTaskResponse: (task) => task,
      getTaskContext: vi.fn(async () => ({ instructions: '', instruction_layers: {} })),
      resolveRoleConfig: vi.fn(async () => defaultResolvedRoleConfig),
      claimHandleSecret: 'test-claim-handle-secret',
    });

    const task = await service.claimTask(identity, {
      agent_id: 'agent-1',
      routing_tags: ['research', 'role:researcher'],
    });

    const mcpServers = (task?.role_config as Record<string, any>).mcp_servers;
    expect(mcpServers).toHaveLength(1);
    expect(mcpServers[0].parameters).toEqual([
      expect.objectContaining({
        placement: 'header',
        key: 'Authorization',
        value_kind: 'secret',
        claim_handle: expect.stringMatching(/^claim:v1:/),
      }),
    ]);
    expect(mcpServers[0].timeout_seconds).toBe(300);
    expect(JSON.stringify(task)).not.toContain('mcp-oauth-access-token');

    const resolved = await service.resolveClaimCredentials(identity, 'task-mcp-oauth', {
      mcp_claim_handles: [mcpServers[0].parameters[0].claim_handle],
    });
    expect(resolved.mcp_claim_values).toEqual({
      [mcpServers[0].parameters[0].claim_handle]: 'Bearer mcp-oauth-access-token',
    });
  });

});
