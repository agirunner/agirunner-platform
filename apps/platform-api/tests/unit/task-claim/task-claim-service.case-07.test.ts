import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { NativeSearchMode } from '../../../src/catalogs/model-catalog.js';
import {
  configureProviderSecretEncryptionKey,
  storeOAuthToken,
  storeProviderSecret,
} from '../../../src/lib/oauth-crypto.js';
import { TaskClaimService } from '../../../src/services/task-claim-service.js';

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
  it('clears stale agent current_task_id values before attempting the next claim', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT id, workflow_id, work_item_id, is_orchestrator_task, state')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT * FROM agents')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'agent-1',
              worker_id: null,
              current_task_id: 'task-stale',
              metadata: { execution_mode: 'specialist' },
            }],
          };
        }
        if (sql.includes('SELECT *') && sql.includes('FROM tasks') && sql.includes('LIMIT 1')) {
          expect(params).toEqual(['tenant-1', 'task-stale']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-stale',
              state: 'completed',
              assigned_agent_id: null,
              assigned_worker_id: null,
            }],
          };
        }
        if (sql.includes('UPDATE agents') && sql.includes('current_task_id = NULL')) {
          expect(params).toEqual(['tenant-1', 'agent-1']);
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT tasks.* FROM tasks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-ready-1',
              workflow_id: 'wf-1',
              work_item_id: 'wi-1',
              workspace_id: null,
              state: 'ready',
              role: 'developer',
              title: 'Ship the change',
              role_config: {},
              input: { description: 'Ship the change' },
              metadata: {},
              environment: {},
              resource_bindings: [],
              is_orchestrator_task: false,
              timeout_minutes: null,
              token_budget: null,
              cost_cap_usd: null,
              max_iterations: null,
              llm_max_retries: null,
            }],
          };
        }
        if (sql.includes("SET state = 'claimed'")) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-ready-1',
              workflow_id: 'wf-1',
              work_item_id: 'wi-1',
              workspace_id: null,
              state: 'claimed',
              role: 'developer',
              title: 'Ship the change',
              role_config: {},
              input: { description: 'Ship the change' },
              metadata: {},
              environment: {},
              resource_bindings: [],
              is_orchestrator_task: false,
              timeout_minutes: null,
              token_budget: null,
              cost_cap_usd: null,
              max_iterations: null,
              llm_max_retries: null,
            }],
          };
        }
        if (sql.includes('UPDATE agents SET current_task_id = $2')) {
          return { rowCount: 1, rows: [] };
        }
        if (
          sql.includes('SELECT')
          && sql.includes('w.name AS workflow_name')
          && sql.includes('p.name AS workspace_name')
        ) {
          return {
            rowCount: 1,
            rows: [{
              workflow_name: 'Workflow 1',
              workspace_name: null,
              workspace_repository_url: null,
              workspace_settings: null,
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
        throw new Error(`unexpected query: ${sql}`);
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
      routing_tags: ['coding', 'role:developer'],
    });

    expect(task?.id).toBe('task-ready-1');
    expect(
      client.query.mock.calls.some(([sql]) =>
        typeof sql === 'string' && sql.includes('current_task_id = NULL'),
      ),
    ).toBe(true);
  });

});
