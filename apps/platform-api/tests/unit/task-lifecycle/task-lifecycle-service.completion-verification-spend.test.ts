import { describe, expect, it, vi } from 'vitest';
import { TaskLifecycleService } from '../../../src/services/task-lifecycle-service.js';
type TaskLifecycleDependencies = ConstructorParameters<typeof TaskLifecycleService>[0];
describe('TaskLifecycleService completion: verification and spend land in task rows', () => {
  it('propagates metrics, git_info, and verification into separate UPDATE columns', async () => {
    const capturedUpdates: { sql: string; values: unknown[] }[] = [];
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          capturedUpdates.push({ sql, values: (values ?? []) as unknown[] });
          return {
            rowCount: 1,
            rows: [{
              id: 'task-spend',
              state: 'completed',
              workflow_id: null,
              assigned_agent_id: null,
              assigned_worker_id: null,
              output: { result: 'ok' },
              metrics: { total_cost_usd: 2.50, total_tokens: 4096 },
              git_info: { git_commit: 'fa1afe1', git_push_ok: true },
              metadata: { verification: { passed: true, strategy: 'tests' } },
            }],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-spend',
        state: 'in_progress',
        workflow_id: null,
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        role_config: {},
      }),
      toTaskResponse: (task) => task,
    });

    const result = await service.completeTask(
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'ak',
      },
      'task-spend',
      {
        output: { result: 'ok' },
        metrics: { total_cost_usd: 2.50, total_tokens: 4096 },
        git_info: { git_commit: 'fa1afe1', git_push_ok: true },
        verification: { passed: true, strategy: 'tests' },
      },
    );

    expect(result.state).toBe('completed');

    // Verify SQL contains separate metrics and git_info column assignments
    expect(capturedUpdates).toHaveLength(1);
    const { sql, values } = capturedUpdates[0]!;
    expect(sql).toContain('metrics =');
    expect(sql).toContain('git_info =');
    // verification is merged into metadata via jsonb concatenation
    expect(sql).toContain('metadata =');

    // Verify bound values include the spend metrics and verification data
    const metricsValue = values.find(
      (v) => typeof v === 'object' && v !== null && 'total_cost_usd' in (v as Record<string, unknown>),
    );
    expect(metricsValue).toMatchObject({ total_cost_usd: 2.50, total_tokens: 4096 });

    const gitInfoValue = values.find(
      (v) => typeof v === 'object' && v !== null && 'git_commit' in (v as Record<string, unknown>),
    );
    expect(gitInfoValue).toMatchObject({ git_commit: 'fa1afe1', git_push_ok: true });

    // Verification is stored in metadata patch
    const verificationPatch = values.find(
      (v) => typeof v === 'object' && v !== null && 'verification' in (v as Record<string, unknown>),
    );
    expect(verificationPatch).toMatchObject({ verification: { passed: true, strategy: 'tests' } });
  });
});
