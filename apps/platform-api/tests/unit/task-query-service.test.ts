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
  it('applies work item, stage, activation, and orchestrator filters when listing tasks', async () => {
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
      stage_name: 'implementation',
      activation_id: 'activation-1',
      is_orchestrator_task: true,
      page: 1,
      per_page: 25,
    });

    const countCall = pool.query.mock.calls[0] as [string, unknown[]];
    const listCall = pool.query.mock.calls[1] as [string, unknown[]];

    expect(countCall[0]).toContain('work_item_id = $3');
    expect(countCall[0]).toContain('stage_name = $4');
    expect(countCall[0]).toContain('activation_id = $5');
    expect(countCall[0]).toContain('is_orchestrator_task = $6');
    expect(countCall[1]).toEqual([
      tenantId,
      'workflow-1',
      'work-item-1',
      'implementation',
      'activation-1',
      true,
    ]);

    expect(listCall[1]).toEqual([
      tenantId,
      'workflow-1',
      'work-item-1',
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

  it('canonicalizes public task response states to in_progress and escalated', () => {
    const service = new TaskQueryService(createPool({
      id: taskId,
      tenant_id: tenantId,
      metadata: {},
    }) as never);

    expect(
      service.toTaskResponse({
        id: taskId,
        tenant_id: tenantId,
        state: 'running',
        metadata: {},
      }) as Record<string, unknown>,
    ).toEqual(expect.objectContaining({ state: 'in_progress' }));

    expect(
      service.toTaskResponse({
        id: taskId,
        tenant_id: tenantId,
        state: 'awaiting_escalation',
        metadata: {},
      }) as Record<string, unknown>,
    ).toEqual(expect.objectContaining({ state: 'escalated' }));
  });

  it('redacts plaintext secrets from task API responses while preserving secret refs', () => {
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
    expect(response.input.credentials.git_token_ref).toBe('secret:GIT_TOKEN');
    expect(response.role_config.llm_api_key).toBe('redacted://task-secret');
    expect(response.resource_bindings[0].credentials.ssh_private_key).toBe('redacted://task-secret');
    expect(response.resource_bindings[0].credentials.secret_ref).toBe('secret:GIT_SSH_KEY');
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
