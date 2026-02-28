import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import type { TaskState } from '../orchestration/task-state-machine.js';

interface ApplyTransition {
  (
    identity: ApiKeyIdentity,
    taskId: string,
    nextState: TaskState,
    options: {
      expectedStates: TaskState[];
      error?: unknown;
      retryIncrement?: boolean;
      clearAssignment?: boolean;
      clearExecutionData?: boolean;
      reason?: string;
    },
  ): Promise<unknown>;
}

export class TaskTimeoutService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly applyTransition: ApplyTransition,
  ) {}

  async failTimedOutTasks(now = new Date()): Promise<number> {
    const systemIdentity: ApiKeyIdentity = {
      id: 'system',
      tenantId: '00000000-0000-0000-0000-000000000001',
      scope: 'admin',
      ownerType: 'system',
      ownerId: null,
      keyPrefix: 'system',
    };

    const staleTasks = await this.pool.query(
      `SELECT id, tenant_id, auto_retry, retry_count, max_retries
       FROM tasks
       WHERE state IN ('claimed', 'running')
         AND COALESCE(started_at, claimed_at) IS NOT NULL
         AND COALESCE(started_at, claimed_at) + (timeout_minutes * INTERVAL '1 minute') < $1`,
      [now],
    );

    let affectedCount = 0;
    for (const staleTask of staleTasks.rows) {
      const scopedIdentity = { ...systemIdentity, tenantId: staleTask.tenant_id as string };
      const shouldRetry = Boolean(staleTask.auto_retry) && Number(staleTask.retry_count) < Number(staleTask.max_retries);

      if (shouldRetry) {
        await this.applyTransition(scopedIdentity, staleTask.id as string, 'ready', {
          expectedStates: ['claimed', 'running'],
          retryIncrement: true,
          clearAssignment: true,
          reason: 'timeout_auto_retry',
          clearExecutionData: true,
        });
      } else {
        await this.applyTransition(scopedIdentity, staleTask.id as string, 'failed', {
          expectedStates: ['claimed', 'running'],
          error: { category: 'timeout', message: 'Task timeout exceeded', recoverable: false },
          clearAssignment: true,
          reason: 'timeout_failed',
        });
      }

      affectedCount += 1;
    }

    return affectedCount;
  }
}
