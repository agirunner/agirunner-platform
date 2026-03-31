import { describe, expect, it, vi } from 'vitest';

import { TaskQueryService } from '../../../src/services/task/task-query-service.js';
import { createPool, taskId, tenantId } from './support.js';

describe('TaskQueryService task lookup behavior', () => {
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
          rowCount: 0,
          rows: [],
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
            focus_areas: ['Auth edge cases'],
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
            execution_backend: 'runtime_plus_task',
            metadata: {},
          }],
        })
        .mockResolvedValueOnce({
          rows: [{ task_id: taskId }],
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
    const leaseCall = pool.query.mock.calls[2] as [string, unknown[]];

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
    expect(leaseCall[0]).toContain('FROM execution_container_leases');
    expect(leaseCall[1]).toEqual([tenantId, [taskId]]);
  });

  it('marks task detail responses with task sandbox usage when a lease exists', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{
            id: taskId,
            tenant_id: tenantId,
            metadata: {},
          }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ task_id: taskId }],
        })
        .mockResolvedValueOnce({
          rowCount: 0,
          rows: [],
        }),
    };
    const service = new TaskQueryService(pool as never);

    const task = await service.getTask(tenantId, taskId);

    expect(task.used_task_sandbox).toBe(true);
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('FROM execution_container_leases'),
      [tenantId, [taskId]],
    );
  });

  it('exposes the immutable execution environment snapshot on task detail responses', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{
            id: taskId,
            tenant_id: tenantId,
            metadata: {},
            execution_environment_snapshot: {
              id: 'env-default',
              name: 'Debian Base',
              image: 'debian:trixie-slim',
              cpu: '1',
              memory: '1Gi',
              pull_policy: 'if-not-present',
              verified_metadata: {
                distro: 'debian',
                distro_version: 'trixie',
                package_manager: 'apt-get',
              },
              tool_capabilities: {
                verified_baseline_commands: ['sh', 'cat', 'grep'],
              },
            },
          }],
        })
        .mockResolvedValueOnce({
          rowCount: 0,
          rows: [],
        })
        .mockResolvedValueOnce({
          rowCount: 0,
          rows: [],
        }),
    };
    const service = new TaskQueryService(pool as never);

    const task = await service.getTask(tenantId, taskId);

    expect(task).toEqual(
      expect.objectContaining({
        execution_environment: expect.objectContaining({
          id: 'env-default',
          name: 'Debian Base',
          image: 'debian:trixie-slim',
          verified_metadata: expect.objectContaining({
            distro: 'debian',
            package_manager: 'apt-get',
          }),
        }),
      }),
    );
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
