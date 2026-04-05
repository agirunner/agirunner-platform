import { describe, expect, it, vi } from 'vitest';

import {
  flattenInstructionLayers,
  flattenInstructionLayersForSystemPrompt,
} from '../../../src/services/task-context-service/task-context-service.js';
import { TaskClaimService } from '../../../src/services/task-claim/task-claim-service.js';

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
    verified_metadata: { distro: 'debian' },
    tool_capabilities: { verified_baseline_commands: ['sh'] },
    bootstrap_commands: [],
    bootstrap_required_domains: [],
    support_status: 'active',
    ...overrides,
  };
}

describe('flattenInstructionLayers', () => {
  it('concatenates non-task layers in the authored order', () => {
    const layers = {
      platform: { content: 'Be helpful', format: 'text' },
      workflow: { content: 'Workflow context', format: 'text' },
      workspace: { content: 'Workspace rules', format: 'text' },
      role: { content: 'Role rules', format: 'text' },
      task: { content: 'Task instructions', format: 'text' },
    };

    const result = flattenInstructionLayers(layers);

    expect(result).toContain('Be helpful');
    expect(result).toContain('Role rules');
    expect(result).toContain('Workflow context');
    expect(result).toContain('Workspace rules');
    expect(result).not.toContain('Task instructions');
    expect(result.indexOf('Be helpful')).toBeLessThan(result.indexOf('Role rules'));
    expect(result.indexOf('Role rules')).toBeLessThan(result.indexOf('Workflow context'));
    expect(result.indexOf('Workflow context')).toBeLessThan(result.indexOf('Workspace rules'));
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
    expect(result).toContain('Platform only');
    expect(result.split('\n\n')).toHaveLength(1);
  });

  it('skips layers with empty content', () => {
    const layers = {
      platform: { content: 'Platform only', format: 'text' },
      workspace: { content: '', format: 'text' },
    };
    const result = flattenInstructionLayers(layers);
    expect(result).toContain('Platform only');
    expect(result.split('\n\n')).toHaveLength(1);
  });

  it('returns empty string when no layers present', () => {
    expect(flattenInstructionLayers({})).toBe('');
  });

  it('preserves layer order regardless of object key order', () => {
    const layers = {
      role: { content: 'role-content', format: 'text' },
      platform: { content: 'platform-content', format: 'text' },
      workflow: { content: 'workflow-content', format: 'text' },
      workspace: { content: 'workspace-content', format: 'text' },
    };
    const result = flattenInstructionLayers(layers);
    const platformIdx = result.indexOf('platform-content');
    const roleIdx = result.indexOf('role-content');
    const workflowIdx = result.indexOf('workflow-content');
    const workspaceIdx = result.indexOf('workspace-content');
    expect(platformIdx).toBeLessThan(roleIdx);
    expect(roleIdx).toBeLessThan(workflowIdx);
    expect(workflowIdx).toBeLessThan(workspaceIdx);
  });
});

describe('flattenInstructionLayersForSystemPrompt', () => {
  it('omits workflow context from orchestrator system prompts', () => {
    const layers = {
      platform: { content: 'Platform rules', format: 'text' },
      orchestrator: { content: 'Orchestrator rules', format: 'text' },
      workflow: { content: 'Dynamic workflow state', format: 'text' },
      workspace: { content: 'Workspace rules', format: 'text' },
    };

    const result = flattenInstructionLayersForSystemPrompt(layers);

    expect(result).toContain('Platform rules');
    expect(result).toContain('Orchestrator rules');
    expect(result).toContain('Workspace rules');
    expect(result).not.toContain('Dynamic workflow state');
  });

  it('omits workflow context from specialist system prompts', () => {
    const layers = {
      platform: { content: 'Platform rules', format: 'text' },
      role: { content: 'Role rules', format: 'text' },
      workflow: { content: 'Dynamic workflow state', format: 'text' },
      workspace: { content: 'Workspace rules', format: 'text' },
    };

    const result = flattenInstructionLayersForSystemPrompt(layers);

    expect(result).toContain('Platform rules');
    expect(result).toContain('Role rules');
    expect(result).toContain('Workspace rules');
    expect(result).not.toContain('Dynamic workflow state');
  });
});

describe('TaskClaimService merges instruction layers into role_config.system_prompt', () => {
  const defaultResolvedRole = {
    provider: {
      name: 'OpenAI',
      providerId: 'provider-default',
      providerType: 'openai',
      apiKeySecretRef: 'secret:OPENAI_API_KEY', // pragma: allowlist secret
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
    taskContext?: Record<string, unknown>;
    resolvedRole?: Record<string, unknown> | null;
  } = {}) {
    const taskRow = overrides.taskRow ?? {
      id: 'task-1',
      tenant_id: 'tenant-1',
      state: 'ready',
      workflow_id: null,
      workspace_id: null,
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
    const runtimeDefaultValues = new Map<string, string>([
      ['agent.max_iterations', '100'],
      ['agent.llm_max_retries', '5'],
      ['agent.orchestrator_loop_mode', 'reactive'],
      ['platform.agent_default_heartbeat_interval_seconds', '30'],
      ['platform.agent_heartbeat_grace_period_ms', '30000'],
      ['platform.agent_heartbeat_threshold_multiplier', '3'],
      ['platform.agent_key_expiry_ms', '3600000'],
    ]);

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
      if (sql.includes('SELECT id, routing_tags, last_claim_at, last_heartbeat_at, heartbeat_interval_seconds, metadata')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('SELECT tasks.* FROM tasks')) {
        return { rowCount: 1, rows: [taskRow] };
      }
      if (sql.includes('FROM runtime_defaults')) {
        const key = typeof params?.[1] === 'string' ? params[1] : null;
        const configValue = key ? runtimeDefaultValues.get(key) : undefined;
        if (configValue !== undefined) {
          return { rowCount: 1, rows: [{ config_value: configValue }] };
        }
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('SELECT execution_environment_id')) {
        return { rowCount: 1, rows: [{ execution_environment_id: null }] };
      }
      if (sql.includes('FROM execution_environments ee')) {
        return { rowCount: 1, rows: [buildExecutionEnvironmentRow()] };
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
      ...(overrides.taskContext ?? {}),
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
      claimHandleSecret: 'test-claim-handle-secret', // pragma: allowlist secret
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
      { agent_id: 'agent-1', routing_tags: ['role:coder'] },
    );

    expect(result).not.toBeNull();
    const roleConfig = (result as Record<string, unknown>).role_config as Record<string, unknown>;
    expect(roleConfig.system_prompt).toContain('Be safe');
    expect(roleConfig.system_prompt).toContain('Use TypeScript');
    expect(roleConfig.system_prompt).toContain('You are a coder');
  });

  it('keeps workflow context out of claimed system prompts while preserving it in context', async () => {
    const deps = buildMockDeps({
      taskRow: {
        id: 'task-orch-1',
        tenant_id: 'tenant-1',
        state: 'ready',
        workflow_id: 'workflow-1',
        workspace_id: null,
        depends_on: [],
        metadata: {},
        role: 'orchestrator',
        role_config: { system_prompt: 'original-role-prompt' },
        input: { description: 'orchestrate work' },
        priority: 'normal',
        assigned_agent_id: null,
        assigned_worker_id: null,
        is_orchestrator_task: true,
        created_at: new Date().toISOString(),
      },
      agentRow: {
        id: 'agent-1',
        tenant_id: 'tenant-1',
        worker_id: null,
        current_task_id: null,
        metadata: { execution_mode: 'hybrid' },
      },
      instructionLayers: {
        platform: { content: 'Platform rules', format: 'text' },
        orchestrator: { content: 'Orchestrator rules', format: 'text' },
        workflow: { content: 'Dynamic workflow state', format: 'text' },
        workspace: { content: 'Workspace rules', format: 'text' },
      },
      taskContext: {
        workflow: { id: 'workflow-1', current_stage: 'reproduce' },
      },
    });

    const service = new TaskClaimService(deps as never);
    const result = await service.claimTask(
      { tenantId: 'tenant-1', scope: 'agent', keyPrefix: 'ab_test' } as never,
      { agent_id: 'agent-1', routing_tags: ['orchestrator'] },
    );

    const roleConfig = (result as Record<string, unknown>).role_config as Record<string, unknown>;
    expect(roleConfig.system_prompt).toContain('Platform rules');
    expect(roleConfig.system_prompt).toContain('Orchestrator rules');
    expect(roleConfig.system_prompt).toContain('Workspace rules');
    expect(roleConfig.system_prompt).not.toContain('Dynamic workflow state');

    const context = (result as Record<string, unknown>).context as Record<string, unknown>;
    const instructionLayers = context.instruction_layers as Record<string, unknown>;
    expect((instructionLayers.workflow as Record<string, unknown>).content).toBe('Dynamic workflow state');
  });

  it('warns once at startup when the assembled prompt exceeds the tenant threshold', async () => {
    const logService = {
      insert: vi.fn().mockResolvedValue(undefined),
      insertWithExecutor: vi.fn().mockResolvedValue(undefined),
    };
    const deps = buildMockDeps({
      instructionLayers: {
        platform: { content: 'Platform prompt section', format: 'text' },
        role: { content: 'Role prompt section', format: 'text' },
      },
      taskContext: {
        agentic_settings: {
          assembled_prompt_warning_threshold_chars: 10,
        },
      },
    });

    const service = new TaskClaimService({
      ...deps,
      logService: logService as never,
    } as never);
    const result = await service.claimTask(
      { tenantId: 'tenant-1', scope: 'agent', keyPrefix: 'ab_test' } as never,
      { agent_id: 'agent-1', routing_tags: ['role:coder'] },
    );

    expect(result).not.toBeNull();
    expect((result as Record<string, unknown>).state).toBe('claimed');

    const warningEntries = logService.insertWithExecutor.mock.calls
      .map((call) => call[1] as Record<string, unknown>)
      .filter((entry) => entry.operation === 'task.execution_context_prompt_warning');
    expect(warningEntries).toHaveLength(1);
    expect(warningEntries[0]).toMatchObject({
      level: 'warn',
      payload: {
        warning_threshold_chars: 10,
      },
    });
  });

  it('preserves LLM credential metadata alongside system_prompt without serializing plaintext claim secrets', async () => {
    const deps = buildMockDeps({
      instructionLayers: {
        platform: { content: 'Be safe', format: 'text' },
      },
      resolvedRole: {
        provider: {
          providerType: 'openai',
          apiKeySecretRef: 'sk-test', // pragma: allowlist secret
          authMode: 'api_key',
          baseUrl: null,
        },
        model: { modelId: 'gpt-4', endpointType: null },
      },
    });

    const service = new TaskClaimService(deps as never);
    const result = await service.claimTask(
      { tenantId: 'tenant-1', scope: 'agent', keyPrefix: 'ab_test' } as never,
      { agent_id: 'agent-1', routing_tags: ['role:coder'] },
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
      { agent_id: 'agent-1', routing_tags: ['role:coder'] },
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
      { agent_id: 'agent-1', routing_tags: ['role:coder'] },
    );

    expect((result as Record<string, unknown>).instructions).toBe('flat instructions');
    const roleConfig = (result as Record<string, unknown>).role_config as Record<string, unknown>;
    expect(roleConfig.system_prompt).not.toContain('Task specific');
  });
});
