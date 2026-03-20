import { describe, expect, it, vi, beforeEach } from 'vitest';

import { RuntimeConfigService } from '../../src/services/runtime-config-service.js';

function createMockPool() {
  return { query: vi.fn() };
}

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

const sampleWorker = {
  id: 'worker-1',
  name: 'built-in-worker',
  capabilities: ['coding', 'testing', 'code-review'],
};

const sampleRole = {
  name: 'developer',
  description: 'Implements features',
  system_prompt: 'You are a developer.',
  allowed_tools: ['file_read', 'file_write'],
  capabilities: ['coding', 'testing'],
  verification_strategy: 'peer_review',
  updated_at: new Date(),
};

const sampleDefault = {
  config_key: 'max_rework_attempts',
  config_value: '3',
  config_type: 'number',
  updated_at: new Date(),
};

const loopSafeguardDefaults = [
  {
    config_key: 'agent.loop_detection_repeat',
    config_value: '3',
    config_type: 'number',
    updated_at: new Date(),
  },
  {
    config_key: 'agent.response_repeat_threshold',
    config_value: '2',
    config_type: 'number',
    updated_at: new Date(),
  },
  {
    config_key: 'agent.no_file_change_threshold',
    config_value: '50',
    config_type: 'number',
    updated_at: new Date(),
  },
  {
    config_key: 'agent.max_tool_steps_per_burst',
    config_value: '8',
    config_type: 'number',
    updated_at: new Date(),
  },
  {
    config_key: 'agent.max_mutating_steps_per_burst',
    config_value: '3',
    config_type: 'number',
    updated_at: new Date(),
  },
  {
    config_key: 'agent.max_burst_elapsed_ms',
    config_value: '45000',
    config_type: 'number',
    updated_at: new Date(),
  },
];

const sampleSecretDefault = {
  config_key: 'custom.api_key_secret_ref',
  config_value: 'secret:SERPER_API_KEY',
  config_type: 'string',
  updated_at: new Date(),
};

const sampleDesiredState = {
  id: 'desired-1',
  worker_name: 'orchestrator-primary',
  role: 'orchestrator',
};

describe('RuntimeConfigService', () => {
  let pool: ReturnType<typeof createMockPool>;
  let service: RuntimeConfigService;

  beforeEach(() => {
    pool = createMockPool();
    service = new RuntimeConfigService(pool as never);
  });

  it('returns merged config for a worker', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // findDesiredStateWorker
      .mockResolvedValueOnce({ rows: [sampleWorker], rowCount: 1 }) // findWorker
      .mockResolvedValueOnce({ rows: [sampleRole], rowCount: 1 }) // fetchRoles
      .mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 }); // fetchDefaults

    const result = await service.getConfigForWorker(TENANT_ID, 'built-in-worker');

    expect(result.workerName).toBe('built-in-worker');
    expect(result.roles).toHaveLength(1);
    expect(result.roles[0].name).toBe('developer');
    expect(result.defaults).toHaveLength(1);
    expect(result.defaults[0].key).toBe('max_rework_attempts');
    expect(result).not.toHaveProperty('primaryModel');
    expect(result.version).toBeDefined();
  });

  it('redacts secret-bearing runtime defaults in worker config responses', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [sampleWorker], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [sampleRole], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [sampleSecretDefault], rowCount: 1 });

    const result = await service.getConfigForWorker(TENANT_ID, 'built-in-worker');

    expect(result.defaults).toEqual([
      {
        key: 'custom.api_key_secret_ref',
        value: 'redacted://runtime-config-secret',
        type: 'string',
      },
    ]);
  });

  it('throws NotFoundError for missing worker', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(
      service.getConfigForWorker(TENANT_ID, 'nonexistent'),
    ).rejects.toThrow('not found');
  });

  it('does not expose role model assignments through worker runtime config', async () => {
    const workerWithRole = { ...sampleWorker, capabilities: ['role:developer', 'coding'] };

    pool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [workerWithRole], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [sampleRole], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 });

    const result = await service.getConfigForWorker(TENANT_ID, 'built-in-worker');

    expect(result).not.toHaveProperty('primaryModel');
    expect(result).not.toHaveProperty('fallbackModel');
  });

  it('returns all active roles when worker has no role capabilities', async () => {
    const workerNoRoles = { ...sampleWorker, capabilities: ['coding'] };

    pool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [workerNoRoles], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [sampleRole], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await service.getConfigForWorker(TENANT_ID, 'built-in-worker');
    expect(result.roles).toHaveLength(1);
  });

  it('returns runtime config for a desired-state worker before registration', async () => {
    pool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM worker_desired_state')) {
        return { rows: [sampleDesiredState], rowCount: 1 };
      }
      if (sql.includes('FROM role_definitions')) {
        return { rows: [{ ...sampleRole, name: 'orchestrator' }], rowCount: 1 };
      }
      if (sql.includes('FROM runtime_defaults')) {
        return { rows: [sampleDefault], rowCount: 1 };
      }
      if (sql.includes('FROM workers')) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const result = await service.getConfigForWorker(TENANT_ID, 'orchestrator-primary');

    expect(result.workerName).toBe('orchestrator-primary');
    expect(result.roles).toEqual([
      {
        name: 'orchestrator',
        description: 'Implements features',
        systemPrompt: 'You are a developer.',
        allowedTools: ['file_read', 'file_write'],
        capabilities: ['coding', 'testing'],
        verificationStrategy: 'peer_review',
      },
    ]);
    expect(result.defaults).toHaveLength(1);
  });

  it('propagates stuck-loop safeguard defaults from platform runtime defaults', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [sampleWorker], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [sampleRole], rowCount: 1 })
      .mockResolvedValueOnce({ rows: loopSafeguardDefaults, rowCount: loopSafeguardDefaults.length });

    const result = await service.getConfigForWorker(TENANT_ID, 'built-in-worker');

    expect(result.defaults).toEqual([
      { key: 'agent.loop_detection_repeat', value: '3', type: 'number' },
      { key: 'agent.response_repeat_threshold', value: '2', type: 'number' },
      { key: 'agent.no_file_change_threshold', value: '50', type: 'number' },
      { key: 'agent.max_tool_steps_per_burst', value: '8', type: 'number' },
      { key: 'agent.max_mutating_steps_per_burst', value: '3', type: 'number' },
      { key: 'agent.max_burst_elapsed_ms', value: '45000', type: 'number' },
    ]);
  });
});
