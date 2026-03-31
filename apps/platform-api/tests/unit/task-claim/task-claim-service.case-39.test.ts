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
  it('allows worker identities to resolve claim credentials for their assigned tasks', async () => {
    process.env.WEBHOOK_ENCRYPTION_KEY = 'test-encryption-key';
    const encryptedApiKey = storeProviderSecret('provider-api-key');
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT assigned_agent_id, assigned_worker_id')) {
          return {
            rowCount: 1,
            rows: [{ assigned_agent_id: 'agent-1', assigned_worker_id: 'worker-1' }],
          };
        }
        throw new Error(`unexpected query: ${sql} :: ${JSON.stringify(params ?? [])}`);
      }),
      release: vi.fn(),
    };

    const service = new TaskClaimService({
      pool: { connect: vi.fn(async () => client), query: client.query } as never,
      eventService: { emit: vi.fn() } as never,
      toTaskResponse: (task) => task,
      getTaskContext: vi.fn(async () => ({})),
      claimHandleSecret: 'test-claim-handle-secret',
    });

    const credentials = await service.resolveClaimCredentials(
      {
        id: 'worker-key',
        tenantId: 'tenant-1',
        scope: 'worker',
        ownerType: 'worker',
        ownerId: 'worker-1',
        keyPrefix: 'worker-key',
      },
      'task-1',
      {
        llm_api_key_claim_handle: 'claim:v1:' + Buffer.from(JSON.stringify({
          task_id: 'task-1',
          kind: 'llm_api_key',
          stored_secret: encryptedApiKey,
        }), 'utf8').toString('base64url') + '.' + createSignature('test-claim-handle-secret', {
          task_id: 'task-1',
          kind: 'llm_api_key',
          stored_secret: encryptedApiKey,
        }),
      },
    );

    expect(credentials).toEqual({
      llm_api_key: 'provider-api-key',
    });
  });

});

function createSignature(
  secret: string,
  payload: { task_id: string; kind: string; stored_secret: string },
): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return createHmac('sha256', secret).update(encoded).digest('base64url');
}
