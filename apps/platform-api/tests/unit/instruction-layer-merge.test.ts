import { describe, expect, it, vi } from 'vitest';

import { flattenInstructionLayers } from '../../src/services/task-context-service.js';
import { TaskClaimService } from '../../src/services/task-claim-service.js';

describe('flattenInstructionLayers', () => {
  it('concatenates layers in order with headers', () => {
    const layers = {
      platform: { content: 'Be helpful', format: 'text' },
      project: { content: 'Project rules', format: 'text' },
      role: { content: 'Role rules', format: 'text' },
      task: { content: 'Task instructions', format: 'text' },
    };

    const result = flattenInstructionLayers(layers);

    expect(result).toContain('=== Platform Instructions ===\nBe helpful');
    expect(result).toContain('=== Project Instructions ===\nProject rules');
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
      project: { content: '', format: 'text' },
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
      project: { content: 'J', format: 'text' },
    };
    const result = flattenInstructionLayers(layers);
    const platformIdx = result.indexOf('Platform');
    const projectIdx = result.indexOf('Project');
    const roleIdx = result.indexOf('Role');
    expect(platformIdx).toBeLessThan(projectIdx);
    expect(projectIdx).toBeLessThan(roleIdx);
  });
});

describe('TaskClaimService merges instruction layers into role_config.system_prompt', () => {
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
      project_id: null,
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

    const queryMock = vi.fn()
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // retry_available_at update
      .mockResolvedValueOnce({ rowCount: 1, rows: [agentRow] }) // agent SELECT FOR UPDATE
      .mockResolvedValueOnce({ rowCount: 1, rows: [taskRow] }) // task SELECT FOR UPDATE
      // resolveProjectToolTags skipped when project_id is null
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ ...taskRow, state: 'claimed' }] }) // UPDATE tasks RETURNING
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // UPDATE agents
      .mockResolvedValueOnce(undefined) // COMMIT
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ workflow_name: null, project_name: null }] }); // names lookup

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
      ? vi.fn().mockResolvedValue(null)
      : vi.fn().mockResolvedValue(overrides.resolvedRole);

    return {
      pool,
      eventService,
      toTaskResponse,
      getTaskContext,
      resolveRoleConfig,
    };
  }

  it('merges flattened instruction layers into role_config.system_prompt', async () => {
    const deps = buildMockDeps({
      instructionLayers: {
        platform: { content: 'Be safe', format: 'text' },
        project: { content: 'Use TypeScript', format: 'text' },
        role: { content: 'You are a coder', format: 'text' },
      },
    });

    const service = new TaskClaimService(deps as never);
    const result = await service.claimTask(
      { tenantId: 'tenant-1', scope: 'agent', keyPrefix: 'ab_test' } as never,
      { agent_id: 'agent-1', capabilities: [] },
    );

    expect(result).not.toBeNull();
    const roleConfig = (result as Record<string, unknown>).role_config as Record<string, unknown>;
    expect(roleConfig.system_prompt).toContain('=== Platform Instructions ===');
    expect(roleConfig.system_prompt).toContain('Be safe');
    expect(roleConfig.system_prompt).toContain('=== Project Instructions ===');
    expect(roleConfig.system_prompt).toContain('Use TypeScript');
    expect(roleConfig.system_prompt).toContain('=== Role Instructions ===');
    expect(roleConfig.system_prompt).toContain('You are a coder');
  });

  it('preserves LLM credentials in role_config alongside system_prompt', async () => {
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
      { agent_id: 'agent-1', capabilities: [] },
    );

    const roleConfig = (result as Record<string, unknown>).role_config as Record<string, unknown>;
    expect(roleConfig.system_prompt).toContain('Be safe');
    expect(roleConfig.llm_provider).toBe('openai');
    expect(roleConfig.llm_model).toBe('gpt-4');
    expect(roleConfig.llm_api_key).toBe('sk-test');
  });

  it('does not set system_prompt when no instruction layers exist', async () => {
    const deps = buildMockDeps({
      instructionLayers: {},
    });

    const service = new TaskClaimService(deps as never);
    const result = await service.claimTask(
      { tenantId: 'tenant-1', scope: 'agent', keyPrefix: 'ab_test' } as never,
      { agent_id: 'agent-1', capabilities: [] },
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
      { agent_id: 'agent-1', capabilities: [] },
    );

    expect((result as Record<string, unknown>).instructions).toBe('flat instructions');
    const roleConfig = (result as Record<string, unknown>).role_config as Record<string, unknown>;
    expect(roleConfig.system_prompt).not.toContain('Task specific');
  });
});
