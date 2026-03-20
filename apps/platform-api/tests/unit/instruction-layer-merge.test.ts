import { describe, expect, it, vi } from 'vitest';

import { flattenInstructionLayers } from '../../src/services/task-context-service.js';
import { TaskClaimService } from '../../src/services/task-claim-service.js';

describe('flattenInstructionLayers', () => {
  it('concatenates layers in order with headers', () => {
    const layers = {
      platform: { content: 'Be helpful', format: 'text' },
      workflow: { content: 'Workflow context', format: 'text' },
      workspace: { content: 'Workspace rules', format: 'text' },
      role: { content: 'Role rules', format: 'text' },
      task: { content: 'Task instructions', format: 'text' },
    };

    const result = flattenInstructionLayers(layers);

    expect(result).toContain('=== Platform Instructions ===\nBe helpful');
    expect(result).toContain('=== Workflow Context ===\nWorkflow context');
    expect(result).toContain('=== Workspace Instructions ===\nWorkspace rules');
    expect(result).toContain('=== Role Instructions ===\nRole rules');
    expect(result).not.toContain('Task instructions');
  });

  it('excludes the task layer', () => {
    const layers = {
      task: { content: 'Do something', format: 'text' },
    };
    expect(flattenInstructionLayers(layers)).toBe('');
  });

  it('skips missing layers', () => {
    const layers = {
      platform: { content: 'Platform only', format: 'text' },
    };
    const result = flattenInstructionLayers(layers);
    expect(result).toBe('=== Platform Instructions ===\nPlatform only');
    expect(result).not.toContain('Project');
    expect(result).not.toContain('Role');
  });

  it('skips layers with empty content', () => {
    const layers = {
      platform: { content: 'Platform only', format: 'text' },
      workspace: { content: '', format: 'text' },
    };
    const result = flattenInstructionLayers(layers);
    expect(result).not.toContain('Project');
  });

  it('returns empty string when no layers present', () => {
    expect(flattenInstructionLayers({})).toBe('');
  });

  it('preserves layer order regardless of object key order', () => {
    const layers = {
      role: { content: 'R', format: 'text' },
      platform: { content: 'P', format: 'text' },
      workflow: { content: 'W', format: 'text' },
      workspace: { content: 'J', format: 'text' },
    };
    const result = flattenInstructionLayers(layers);
    const platformIdx = result.indexOf('Platform');
    const roleIdx = result.indexOf('Role');
    const workflowIdx = result.indexOf('Workflow');
    const workspaceIdx = result.indexOf('Workspace');
    expect(platformIdx).toBeLessThan(roleIdx);
    expect(roleIdx).toBeLessThan(workflowIdx);
    expect(workflowIdx).toBeLessThan(workspaceIdx);
  });
});

describe('TaskClaimService merges instruction layers into role_config.system_prompt', () => {
  const defaultResolvedRole = {
    provider: {
      name: 'OpenAI',
      providerId: 'provider-default',
      providerType: 'openai',
      apiKeySecretRef: 'secret:OPENAI_API_KEY',
      authMode: 'api_key',
      baseUrl: 'https://api.openai.test/v1',
    },
    model: {
      modelId: 'gpt-5',
      contextWindow: null,
      endpointType: 'responses',
      reasoningConfig: null,
    },
    reasoningConfig: null,
  };

  function buildMockDeps(overrides: {
    taskRow?: Record<string, unknown>;
    agentRow?: Record<string, unknown>;
    instructionLayers?: Record<string, unknown>;
    resolvedRole?: Record<string, unknown> | null;
  } = {}) {
    const taskRow = overrides.taskRow ?? {
      id: 'task-1',
      tenant_id: 'tenant-1',
      state: 'ready',
      workflow_id: null,
      workspace_id: null,
      capabilities_required: [],
      depends_on: [],
      metadata: {},
      role: 'coder',
      role_config: { system_prompt: 'original-role-prompt' },
      input: { description: 'do something' },
      priority: 'normal',
      assigned_agent_id: null,
      assigned_worker_id: null,
      created_at: new Date().toISOString(),
    };

    const agentRow = overrides.agentRow ?? {
      id: 'agent-1',
      tenant_id: 'tenant-1',
      worker_id: null,
      current_task_id: null,
      metadata: {},
    };

    const instructionLayers = overrides.instructionLayers ?? {};

    const queryMock = vi.fn(async (sql: string, params?: unknown[]) => {
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
        return { rowCount: 1, rows: [agentRow] };
      }
      if (sql.includes('SELECT tasks.* FROM tasks')) {
        return { rowCount: 1, rows: [taskRow] };
      }
      if (sql.includes('FROM runtime_defaults')) {
        const key = params?.[1];
        if (key === 'agent.max_iterations') {
          return { rowCount: 1, rows: [{ config_value: '100' }] };
        }
        if (key === 'agent.llm_max_retries') {
          return { rowCount: 1, rows: [{ config_value: '5' }] };
        }
        if (key === 'specialist_execution_default_image') {
          return { rowCount: 1, rows: [{ config_value: 'agirunner-runtime-execution:local' }] };
        }
        if (key === 'specialist_execution_default_cpu') {
          return { rowCount: 1, rows: [{ config_value: '1' }] };
        }
        if (key === 'specialist_execution_default_memory') {
          return { rowCount: 1, rows: [{ config_value: '1Gi' }] };
        }
        if (key === 'specialist_execution_default_pull_policy') {
          return { rowCount: 1, rows: [{ config_value: 'if-not-present' }] };
        }
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("SET state = 'claimed'")) {
        return { rowCount: 1, rows: [{ ...taskRow, state: 'claimed' }] };
      }
      if (sql.includes('UPDATE agents SET current_task_id')) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('SELECT') && sql.includes('workflow_name')) {
        return { rowCount: 1, rows: [{ workflow_name: null, workspace_name: null }] };
      }
      if (sql.includes('SELECT escalation_target, allowed_tools')) {
        return { rowCount: 0, rows: [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const client = {
      query: queryMock,
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn().mockResolvedValue(client),
    };

    const eventService = {
      emit: vi.fn().mockResolvedValue(undefined),
    };

    const toTaskResponse = (row: Record<string, unknown>) => ({ ...row });

    const getTaskContext = vi.fn().mockResolvedValue({
      instructions: 'flat instructions',
      instruction_layers: instructionLayers,
    });

    const resolveRoleConfig = overrides.resolvedRole === undefined
      ? vi.fn().mockResolvedValue(defaultResolvedRole)
      : vi.fn().mockResolvedValue(overrides.resolvedRole);

    return {
      pool,
      eventService,
      toTaskResponse,
      getTaskContext,
      resolveRoleConfig,
      claimHandleSecret: 'test-claim-handle-secret',
    };
  }

  it('merges flattened instruction layers into role_config.system_prompt', async () => {
    const deps = buildMockDeps({
      instructionLayers: {
        platform: { content: 'Be safe', format: 'text' },
        workspace: { content: 'Use TypeScript', format: 'text' },
        role: { content: 'You are a coder', format: 'text' },
      },
    });

    const service = new TaskClaimService(deps as never);
    const result = await service.claimTask(
      { tenantId: 'tenant-1', scope: 'agent', keyPrefix: 'ab_test' } as never,
      { agent_id: 'agent-1', routing_tags: [] },
    );

    expect(result).not.toBeNull();
    const roleConfig = (result as Record<string, unknown>).role_config as Record<string, unknown>;
    expect(roleConfig.system_prompt).toContain('=== Platform Instructions ===');
    expect(roleConfig.system_prompt).toContain('Be safe');
    expect(roleConfig.system_prompt).toContain('=== Workspace Instructions ===');
    expect(roleConfig.system_prompt).toContain('Use TypeScript');
    expect(roleConfig.system_prompt).toContain('=== Role Instructions ===');
    expect(roleConfig.system_prompt).toContain('You are a coder');
  });

  it('preserves LLM credential metadata alongside system_prompt without serializing plaintext claim secrets', async () => {
    const deps = buildMockDeps({
      instructionLayers: {
        platform: { content: 'Be safe', format: 'text' },
      },
      resolvedRole: {
        provider: {
          providerType: 'openai',
          apiKeySecretRef: 'sk-test',
          authMode: 'api_key',
          baseUrl: null,
        },
        model: { modelId: 'gpt-4', endpointType: null },
      },
    });

    const service = new TaskClaimService(deps as never);
    const result = await service.claimTask(
      { tenantId: 'tenant-1', scope: 'agent', keyPrefix: 'ab_test' } as never,
      { agent_id: 'agent-1', routing_tags: [] },
    );

    const roleConfig = (result as Record<string, unknown>).role_config as Record<string, unknown>;
    const credentials = (result as Record<string, unknown>).credentials as Record<string, unknown>;
    expect(roleConfig.system_prompt).toContain('Be safe');
    expect(credentials.llm_provider).toBe('openai');
    expect(credentials.llm_model).toBe('gpt-4');
    expect(credentials.llm_api_key_claim_handle).toMatch(/^claim:v1:/);
    expect(credentials.llm_api_key).toBeUndefined();
  });

  it('does not set system_prompt when no instruction layers exist', async () => {
    const deps = buildMockDeps({
      instructionLayers: {},
    });

    const service = new TaskClaimService(deps as never);
    const result = await service.claimTask(
      { tenantId: 'tenant-1', scope: 'agent', keyPrefix: 'ab_test' } as never,
      { agent_id: 'agent-1', routing_tags: [] },
    );

    const roleConfig = (result as Record<string, unknown>).role_config as Record<string, unknown>;
    expect(roleConfig.system_prompt).toBe('original-role-prompt');
  });

  it('keeps task instructions in the instructions field', async () => {
    const deps = buildMockDeps({
      instructionLayers: {
        platform: { content: 'Platform', format: 'text' },
        task: { content: 'Task specific', format: 'text' },
      },
    });

    const service = new TaskClaimService(deps as never);
    const result = await service.claimTask(
      { tenantId: 'tenant-1', scope: 'agent', keyPrefix: 'ab_test' } as never,
      { agent_id: 'agent-1', routing_tags: [] },
    );

    expect((result as Record<string, unknown>).instructions).toBe('flat instructions');
    const roleConfig = (result as Record<string, unknown>).role_config as Record<string, unknown>;
    expect(roleConfig.system_prompt).not.toContain('Task specific');
  });
});
