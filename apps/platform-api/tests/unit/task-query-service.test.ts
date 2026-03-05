import { describe, expect, it } from 'vitest';

import { TaskQueryService } from '../../src/services/task-query-service.js';

const tenantId = '00000000-0000-0000-0000-000000000001';
const taskId = '11111111-1111-1111-1111-111111111111';

function createPool(row: Record<string, unknown>) {
  return {
    query: async () => ({ rowCount: 1, rows: [row] }),
  };
}

describe('task query service git activity (FR-055)', () => {
  it('exposes verification payload from task metadata in normalized task response', () => {
    const service = new TaskQueryService(createPool({
      id: taskId,
      tenant_id: tenantId,
      metadata: {
        description: 'test task',
        verification: { passed: true, strategies_run: ['test_execution'] },
      },
    }) as never);

    const response = service.toTaskResponse({
      id: taskId,
      tenant_id: tenantId,
      metadata: {
        description: 'test task',
        verification: { passed: true, strategies_run: ['test_execution'] },
      },
    });

    expect(response.verification).toEqual({ passed: true, strategies_run: ['test_execution'] });
    expect(response.description).toBe('test task');
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
