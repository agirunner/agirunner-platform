import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';

import { TaskQueryService } from '../../src/services/task-query-service.js';

const tenantId = '00000000-0000-0000-0000-000000000001';
const taskId = '11111111-1111-1111-1111-111111111111';

function createPool(row: Record<string, unknown>) {
  return {
    query: async () => ({ rowCount: 1, rows: [row] }),
  };
}

describe('task query service git activity (FR-055)', () => {
  it('includes the latest structured handoff on task detail responses', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{
            id: taskId,
            tenant_id: tenantId,
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'developer',
            metadata: {},
          }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{
            id: 'handoff-1',
            task_id: taskId,
            role: 'developer',
            summary: 'Implementation is ready for review.',
            completion: 'partial',
            changes: [{ path: 'src/auth.ts', summary: 'Refined token refresh handling' }],
            decisions: ['Keep refresh token rotation server-side'],
            remaining_items: ['Validate refresh expiry edge case'],
            blockers: ['Waiting on production token sample'],
            review_focus: ['Auth edge cases'],
            known_risks: ['Refresh token expiry handling'],
            successor_context: 'Focus on auth edge cases.',
            role_data: { module: 'auth' },
            artifact_ids: ['artifact-1'],
            created_at: new Date('2026-03-15T12:00:00Z'),
          }],
        }),
    };
    const service = new TaskQueryService(pool as never);

    const task = await service.getTask(tenantId, taskId);

    expect(task).toEqual(
      expect.objectContaining({
        id: taskId,
        latest_handoff: expect.objectContaining({
          id: 'handoff-1',
          completion: 'partial',
          summary: 'Implementation is ready for review.',
          changes: [{ path: 'src/auth.ts', summary: 'Refined token refresh handling' }],
          remaining_items: ['Validate refresh expiry edge case'],
          created_at: '2026-03-15T12:00:00.000Z',
        }),
      }),
    );
  });

  it('applies work item, escalation, stage, activation, and orchestrator filters when listing tasks', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ total: '1' }] })
        .mockResolvedValueOnce({
          rows: [{
            id: taskId,
            tenant_id: tenantId,
            metadata: {},
          }],
        }),
    };
    const service = new TaskQueryService(pool as never);

    await service.listTasks(tenantId, {
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      escalation_task_id: 'task-esc-1',
      stage_name: 'implementation',
      activation_id: 'activation-1',
      is_orchestrator_task: true,
      page: 1,
      per_page: 25,
    });

    const countCall = pool.query.mock.calls[0] as [string, unknown[]];
    const listCall = pool.query.mock.calls[1] as [string, unknown[]];

    expect(countCall[0]).toContain('work_item_id = $3');
    expect(countCall[0]).toContain("metadata->>'escalation_task_id' = $4");
    expect(countCall[0]).toContain('stage_name = $5');
    expect(countCall[0]).toContain('activation_id = $6');
    expect(countCall[0]).toContain('is_orchestrator_task = $7');
    expect(countCall[1]).toEqual([
      tenantId,
      'workflow-1',
      'work-item-1',
      'task-esc-1',
      'implementation',
      'activation-1',
      true,
    ]);

    expect(listCall[1]).toEqual([
      tenantId,
      'workflow-1',
      'work-item-1',
      'task-esc-1',
      'implementation',
      'activation-1',
      true,
      25,
      0,
    ]);
  });

  it('exposes verification payload from task metadata in normalized task response', () => {
    const service = new TaskQueryService(createPool({
      id: taskId,
      tenant_id: tenantId,
      work_item_id: 'work-item-1',
      stage_name: 'implementation',
      activation_id: 'activation-1',
      request_id: 'request-1',
      is_orchestrator_task: true,
      metadata: {
        description: 'test task',
        verification: { passed: true, strategies_run: ['test_execution'] },
      },
    }) as never);

    const response = service.toTaskResponse({
      id: taskId,
      tenant_id: tenantId,
      work_item_id: 'work-item-1',
      stage_name: 'implementation',
      activation_id: 'activation-1',
      request_id: 'request-1',
      is_orchestrator_task: true,
      metadata: {
        description: 'test task',
        verification: { passed: true, strategies_run: ['test_execution'] },
      },
    }) as any;

    expect(response.verification).toEqual({ passed: true, strategies_run: ['test_execution'] });
    expect(response.description).toBe('test task');
    expect(response.work_item_id).toBe('work-item-1');
    expect(response.stage_name).toBe('implementation');
    expect(response.activation_id).toBe('activation-1');
    expect(response.request_id).toBe('request-1');
    expect(response.is_orchestrator_task).toBe(true);
  });

  it('keeps canonical persisted task states unchanged in the public response', () => {
    const service = new TaskQueryService(createPool({
      id: taskId,
      tenant_id: tenantId,
      metadata: {},
    }) as never);

    expect(
      service.toTaskResponse({
        id: taskId,
        tenant_id: tenantId,
        state: 'in_progress',
        metadata: {},
      }) as Record<string, unknown>,
    ).toEqual(expect.objectContaining({ state: 'in_progress' }));
  });

  it('rejects stale persisted task aliases instead of rewriting them in the public response', () => {
    const service = new TaskQueryService(createPool({
      id: taskId,
      tenant_id: tenantId,
      metadata: {},
    }) as never);

    expect(() =>
      service.toTaskResponse({
        id: taskId,
        tenant_id: tenantId,
        state: 'running',
        metadata: {},
      }),
    ).toThrow("Persisted task state must be canonical. Found 'running'.");

    expect(() =>
      service.toTaskResponse({
        id: taskId,
        tenant_id: tenantId,
        state: 'awaiting_escalation',
        metadata: {},
      }),
    ).toThrow("Persisted task state must be canonical. Found 'awaiting_escalation'.");
  });

  it('keeps canonical escalated task state unchanged in the public response', () => {
    const service = new TaskQueryService(createPool({
      id: taskId,
      tenant_id: tenantId,
      metadata: {},
    }) as never);

    expect(
      service.toTaskResponse({
        id: taskId,
        tenant_id: tenantId,
        state: 'escalated',
        metadata: {},
      }) as Record<string, unknown>,
    ).toEqual(expect.objectContaining({ state: 'escalated' }));
  });

  it('redacts plaintext secrets and secret refs from task API responses', () => {
    const service = new TaskQueryService(createPool({
      id: taskId,
      tenant_id: tenantId,
      input: {
        credentials: {
          git_token: 'plaintext-token',
          git_token_ref: 'secret:GIT_TOKEN',
        },
      },
      role_config: {
        llm_api_key: 'plaintext-api-key',
        llm_model: 'gpt-5',
      },
      resource_bindings: [
        {
          type: 'git_repository',
          credentials: {
            ssh_private_key: '-----BEGIN OPENSSH PRIVATE KEY-----\nkey\n',
            secret_ref: 'secret:GIT_SSH_KEY',
          },
        },
      ],
      metadata: {},
    }) as never);

    const response = service.toTaskResponse({
      id: taskId,
      tenant_id: tenantId,
      input: {
        credentials: {
          git_token: 'plaintext-token',
          git_token_ref: 'secret:GIT_TOKEN',
        },
      },
      role_config: {
        llm_api_key: 'plaintext-api-key',
        llm_model: 'gpt-5',
      },
      resource_bindings: [
        {
          type: 'git_repository',
          credentials: {
            ssh_private_key: '-----BEGIN OPENSSH PRIVATE KEY-----\nkey\n',
            secret_ref: 'secret:GIT_SSH_KEY',
          },
        },
      ],
      metadata: {},
    }) as Record<string, any>;

    expect(response.input.credentials.git_token).toBe('redacted://task-secret');
    expect(response.input.credentials.git_token_ref).toBe('redacted://task-secret');
    expect(response.role_config.llm_api_key).toBe('redacted://task-secret');
    expect(response.resource_bindings[0].credentials.ssh_private_key).toBe('redacted://task-secret');
    expect(response.resource_bindings[0].credentials.secret_ref).toBe('redacted://task-secret');
  });

  it('returns normalized git activity payload from task.git_info', async () => {
    const service = new TaskQueryService(
      createPool({
        id: taskId,
        tenant_id: tenantId,
        git_info: {
          linked_prs: [{ id: 7, url: 'https://example.test/pr/7' }],
          branches: ['feature/one'],
          ci_status: { state: 'success' },
          merge_history: [{ sha: 'abc123' }],
          extra: { preserved: true },
        },
      }) as never,
    );

    const git = await service.getTaskGitActivity(tenantId, taskId);

    expect(git).toEqual({
      linked_prs: [{ id: 7, url: 'https://example.test/pr/7' }],
      branches: ['feature/one'],
      ci_status: { state: 'success' },
      merge_history: [{ sha: 'abc123' }],
      raw: {
        linked_prs: [{ id: 7, url: 'https://example.test/pr/7' }],
        branches: ['feature/one'],
        ci_status: { state: 'success' },
        merge_history: [{ sha: 'abc123' }],
        extra: { preserved: true },
      },
    });
  });

  it('redacts plaintext secrets and secret refs from git activity and task context responses', async () => {
    const queries = vi.fn(async (sql: string) => {
      if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1 AND id = $2')) {
        return {
          rowCount: 1,
          rows: [{
            id: taskId,
            tenant_id: tenantId,
            workflow_id: 'workflow-1',
            project_id: 'project-1',
            work_item_id: 'wi-1',
            depends_on: [],
            input: {
              credentials: { api_key: 'sk-top-secret', secret_ref: 'secret:API_KEY' },
              instructions: 'Use secret:TASK_PROMPT_TOKEN when contacting the service.',
            },
            role_config: {
              llm_api_key: 'plaintext-key',
              instructions: 'Role instructions reference secret:ROLE_API_KEY for auth.',
            },
            context: { oauth: { access_token: 'plaintext-access-token' } },
            git_info: {
              linked_prs: [{ id: 7 }],
              extra_headers: { Authorization: 'Bearer header.payload.signature' },
              nested: { token_ref: 'secret:GIT_TOKEN' },
            },
          }],
        };
      }
      if (sql.includes('FROM projects')) {
        return {
          rows: [{
            id: 'project-1',
            name: 'Project',
            description: 'Desc',
            memory: { deployment_token: 'deploy-secret' },
          }],
        };
      }
      if (sql.includes('FROM workflows p')) {
        return {
          rows: [{
            id: 'workflow-1',
            name: 'Workflow',
            lifecycle: 'ongoing',
            context: { auth: { password: 'workflow-password' } },
            git_branch: 'main',
            parameters: { secret_ref: 'secret:SAFE' },
            resolved_config: { provider_token: 'provider-secret' },
            instruction_config: {},
            metadata: {},
            playbook_id: 'pb-1',
            project_spec_version: null,
            playbook_name: 'Playbook',
            playbook_outcome: 'Done',
            playbook_definition: {},
          }],
        };
      }
      if (sql.includes('SELECT project_id, project_spec_version') && sql.includes('FROM workflows')) {
        return {
          rowCount: 1,
          rows: [{ project_id: 'project-1', project_spec_version: 1 }],
        };
      }
      if (sql.includes('FROM project_spec_versions')) {
        return {
          rowCount: 1,
          rows: [{ spec: {} }],
        };
      }
      if (sql.includes('FROM workflow_documents')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('SELECT DISTINCT stage_name')) return { rows: [] };
      if (sql.includes('FROM workflow_work_items')) {
        return {
          rows: [{
            id: 'wi-1',
            stage_name: 'build',
            column_id: 'todo',
            title: 'Item',
            metadata: { webhook_url: 'https://hooks.slack.com/services/secret' },
          }],
        };
      }
      return { rows: [] };
    });
    const service = new TaskQueryService({ query: queries } as never);

    const git = await service.getTaskGitActivity(tenantId, taskId);
    const context = await service.getTaskContext(tenantId, taskId);

    expect((git.raw as Record<string, any>).extra_headers.Authorization).toBe('redacted://task-secret');
    expect((git.raw as Record<string, any>).nested.token_ref).toBe('redacted://task-secret');
    expect((context.project as Record<string, any>).memory.deployment_token).toBe('redacted://task-context-secret');
    expect((context.workflow as Record<string, any>).resolved_config.provider_token).toBe('redacted://task-context-secret');
    expect((context.workflow as Record<string, any>).variables.secret_ref).toBe('redacted://task-context-secret');
    expect((context.task as Record<string, any>).input.credentials.api_key).toBe('redacted://task-context-secret');
    expect((context.task as Record<string, any>).input.credentials.secret_ref).toBe('redacted://task-context-secret');
    expect((context.task as Record<string, any>).context.oauth.access_token).toBe('redacted://task-context-secret');
    expect(context.instructions).toBe('redacted://task-context-secret');
    expect(((context.instruction_layers as Record<string, any>).role as Record<string, any>).content).toBe(
      'redacted://task-context-secret',
    );
    expect(((context.instruction_layers as Record<string, any>).task as Record<string, any>).content).toBe(
      'redacted://task-context-secret',
    );
  });

  it('returns defaults when git_info is absent', async () => {
    const service = new TaskQueryService(createPool({ id: taskId, tenant_id: tenantId, git_info: null }) as never);

    const git = await service.getTaskGitActivity(tenantId, taskId);

    expect(git).toEqual({
      linked_prs: [],
      branches: [],
      ci_status: null,
      merge_history: [],
      raw: {},
    });
  });
});
