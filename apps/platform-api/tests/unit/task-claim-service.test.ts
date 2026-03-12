import { describe, expect, it, vi } from 'vitest';

import { storeOAuthToken, storeProviderSecret } from '../../src/lib/oauth-crypto.js';
import { TaskClaimService } from '../../src/services/task-claim-service.js';

const identity = {
  id: 'key-1',
  tenantId: 'tenant-1',
  scope: 'agent' as const,
  ownerType: 'agent' as const,
  ownerId: 'agent-1',
  keyPrefix: 'agent-key',
};

function createClient(executionMode: 'specialist' | 'orchestrator') {
  return {
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') {
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

function createService(client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }) {
  const pool = {
    connect: vi.fn(async () => client),
  };
  return new TaskClaimService({
    pool: pool as never,
    eventService: { emit: vi.fn() } as never,
    toTaskResponse: (task) => task,
    getTaskContext: vi.fn(async () => ({})),
  });
}

describe('TaskClaimService', () => {
  it('limits specialist agents to non-orchestrator tasks', async () => {
    const client = createClient('specialist');
    const service = createService(client);

    await service.claimTask(identity, {
      agent_id: 'agent-1',
      capabilities: ['llm-api'],
    });

    const taskSelectSql = String(client.query.mock.calls[3]?.[0] ?? '');
    expect(taskSelectSql).toContain('tasks.is_orchestrator_task = false');
  });

  it('limits orchestrator agents to orchestrator tasks', async () => {
    const client = createClient('orchestrator');
    const service = createService(client);

    await service.claimTask(identity, {
      agent_id: 'agent-1',
      capabilities: ['llm-api', 'orchestrator'],
    });

    const taskSelectSql = String(client.query.mock.calls[3]?.[0] ?? '');
    expect(taskSelectSql).toContain('tasks.is_orchestrator_task = true');
  });

  it('filters candidate tasks by playbook_id when provided', async () => {
    const client = createClient('specialist');
    const service = createService(client);

    await service.claimTask(identity, {
      agent_id: 'agent-1',
      capabilities: ['llm-api'],
      playbook_id: 'playbook-1',
    });

    const taskSelectSql = String(client.query.mock.calls[3]?.[0] ?? '');
    expect(taskSelectSql).toContain('workflows.playbook_id');
    const params = (client.query.mock.calls[3]?.[1] ?? []) as unknown[];
    expect(params).toContain('playbook-1');
  });

  it('skips ready tasks that are blocked by playbook parallelism caps', async () => {
    const client = {
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
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
            rowCount: 2,
            rows: [
              { id: 'task-blocked', workflow_id: 'wf-1', work_item_id: 'wi-1', state: 'ready', project_id: null },
              { id: 'task-open', workflow_id: 'wf-1', work_item_id: 'wi-2', state: 'ready', project_id: null },
            ],
          };
        }
        if (sql.includes("SET state = 'claimed'")) {
          return {
            rowCount: 1,
            rows: [{ id: 'task-open', workflow_id: 'wf-1', state: 'claimed', role_config: {}, metadata: {} }],
          };
        }
        if (sql.includes('UPDATE agents SET current_task_id')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT') && sql.includes('workflow_name')) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const pool = { connect: vi.fn(async () => client) };
    const parallelismService = {
      shouldQueueForCapacity: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
    };
    const service = new TaskClaimService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      toTaskResponse: (task) => task,
      getTaskContext: vi.fn(async () => ({ instructions: '', instruction_layers: {} })),
      parallelismService: parallelismService as never,
    });

    const task = await service.claimTask(identity, {
      agent_id: 'agent-1',
      capabilities: ['llm-api'],
    });

    expect(task?.id).toBe('task-open');
    expect(parallelismService.shouldQueueForCapacity).toHaveBeenCalledTimes(2);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("SET state = 'claimed'"),
      expect.arrayContaining(['tenant-1', 'task-open']),
    );
  });

  it('returns claim-time secret references without echoing secrets in role_config', async () => {
    const client = {
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
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
              id: 'task-claim',
              workflow_id: 'wf-1',
              state: 'ready',
              role: 'developer',
              project_id: null,
              role_config: {
                llm_api_key: 'persisted-plaintext-key',
                tools: ['shell'],
              },
              metadata: {},
            }],
          };
        }
        if (sql.includes("SET state = 'claimed'")) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-claim',
              workflow_id: 'wf-1',
              state: 'claimed',
              role: 'developer',
              role_config: {
                llm_api_key: 'persisted-plaintext-key',
                tools: ['shell'],
              },
              metadata: {},
            }],
          };
        }
        if (sql.includes('UPDATE agents SET current_task_id')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT') && sql.includes('workflow_name')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT escalation_target, allowed_tools')) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const pool = { connect: vi.fn(async () => client) };
    const service = new TaskClaimService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      toTaskResponse: (task) => task,
      getTaskContext: vi.fn(async () => ({ instructions: '', instruction_layers: {} })),
      resolveRoleConfig: vi.fn(async () => ({
        provider: {
          name: 'OpenAI',
          providerId: 'provider-1',
          providerType: 'openai',
          authMode: 'api_key',
          apiKeySecretRef: 'secret:OPENAI_API_KEY',
          baseUrl: 'https://api.openai.test/v1',
        },
        model: {
          modelId: 'gpt-5',
          contextWindow: null,
          endpointType: 'responses',
          reasoningConfig: null,
        },
        reasoningConfig: null,
      })),
    });

    const task = await service.claimTask(identity, {
      agent_id: 'agent-1',
      capabilities: ['llm-api'],
    });

    expect(task?.credentials).toEqual({
      llm_provider: 'openai',
      llm_model: 'gpt-5',
      llm_api_key_secret_ref: 'secret:OPENAI_API_KEY',
      llm_base_url: 'https://api.openai.test/v1',
      llm_endpoint_type: 'responses',
    });
    expect((task?.role_config as Record<string, unknown>).llm_api_key).toBeUndefined();
  });

  it('returns runtime-consumable oauth credentials instead of encrypted at-rest values', async () => {
    process.env.WEBHOOK_ENCRYPTION_KEY = 'test-encryption-key';
    const encryptedAccessToken = storeOAuthToken('oauth-access-token');
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
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
              id: 'task-oauth',
              workflow_id: 'wf-1',
              state: 'ready',
              role: 'developer',
              project_id: null,
              role_config: {},
              metadata: {},
            }],
          };
        }
        if (sql.includes("SET state = 'claimed'")) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-oauth',
              workflow_id: 'wf-1',
              state: 'claimed',
              role: 'developer',
              role_config: {},
              metadata: {},
            }],
          };
        }
        if (sql.includes('UPDATE agents SET current_task_id')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('workflow_name')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT escalation_target, allowed_tools')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT * FROM llm_providers WHERE id = $1 FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'provider-oauth',
              auth_mode: 'oauth',
              oauth_config: {
                profile_id: 'openai-codex',
                base_url: 'https://api.openai.test/v1',
                endpoint_type: 'responses',
                token_lifetime: 'permanent',
              },
              oauth_credentials: {
                access_token: encryptedAccessToken,
                refresh_token: null,
                expires_at: null,
                account_id: 'acct_123',
                email: 'mark@example.com',
                authorized_at: '2026-03-11T00:00:00.000Z',
                authorized_by_user_id: 'user-1',
                needs_reauth: false,
              },
            }],
          };
        }
        throw new Error(`unexpected query: ${sql} :: ${JSON.stringify(params ?? [])}`);
      }),
      release: vi.fn(),
    };

    const pool = { connect: vi.fn(async () => client) };
    const service = new TaskClaimService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      toTaskResponse: (task) => task,
      getTaskContext: vi.fn(async () => ({ instructions: '', instruction_layers: {} })),
      resolveRoleConfig: vi.fn(async () => ({
        provider: {
          name: 'OpenAI',
          providerId: 'provider-oauth',
          providerType: 'openai',
          authMode: 'oauth',
          apiKeySecretRef: null,
          baseUrl: 'https://api.openai.test/v1',
        },
        model: {
          modelId: 'gpt-5',
          contextWindow: null,
          endpointType: 'responses',
          reasoningConfig: null,
        },
        reasoningConfig: null,
      })),
    });

    const task = await service.claimTask(identity, {
      agent_id: 'agent-1',
      capabilities: ['llm-api'],
    });

    expect(task?.credentials).toEqual(expect.objectContaining({
      llm_provider: 'openai',
      llm_model: 'gpt-5',
      llm_api_key: 'oauth-access-token',
      llm_base_url: 'https://api.openai.test/v1',
      llm_endpoint_type: 'responses',
      llm_auth_mode: 'oauth',
      llm_extra_headers: {
        'chatgpt-account-id': 'acct_123',
        'OpenAI-Beta': 'responses=experimental',
      },
    }));
    expect(task?.credentials).not.toHaveProperty('llm_api_key_secret_ref');
    expect(task?.credentials).not.toHaveProperty('llm_extra_headers_secret_ref');
  });

  it('decrypts encrypted provider api keys before returning the claim payload', async () => {
    process.env.WEBHOOK_ENCRYPTION_KEY = 'test-encryption-key';
    const encryptedApiKey = storeProviderSecret('provider-api-key');
    const client = {
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
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
              id: 'task-encrypted-provider',
              workflow_id: 'wf-1',
              state: 'ready',
              role: 'developer',
              project_id: null,
              role_config: {},
              metadata: {},
            }],
          };
        }
        if (sql.includes("SET state = 'claimed'")) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-encrypted-provider',
              workflow_id: 'wf-1',
              state: 'claimed',
              role: 'developer',
              role_config: {},
              metadata: {},
            }],
          };
        }
        if (sql.includes('UPDATE agents SET current_task_id')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('workflow_name')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT escalation_target, allowed_tools')) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const pool = { connect: vi.fn(async () => client) };
    const service = new TaskClaimService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      toTaskResponse: (task) => task,
      getTaskContext: vi.fn(async () => ({ instructions: '', instruction_layers: {} })),
      resolveRoleConfig: vi.fn(async () => ({
        provider: {
          name: 'OpenAI',
          providerId: 'provider-1',
          providerType: 'openai',
          authMode: 'api_key',
          apiKeySecretRef: encryptedApiKey,
          baseUrl: 'https://api.openai.test/v1',
        },
        model: {
          modelId: 'gpt-5',
          contextWindow: null,
          endpointType: 'responses',
          reasoningConfig: null,
        },
        reasoningConfig: null,
      })),
    });

    const task = await service.claimTask(identity, {
      agent_id: 'agent-1',
      capabilities: ['llm-api'],
    });

    expect(task?.credentials).toEqual({
      llm_provider: 'openai',
      llm_model: 'gpt-5',
      llm_api_key: 'provider-api-key',
      llm_base_url: 'https://api.openai.test/v1',
      llm_endpoint_type: 'responses',
    });
    expect(task?.credentials).not.toHaveProperty('llm_api_key_secret_ref');
  });
});
