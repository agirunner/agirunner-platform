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
      requireAssignment?: { agentId?: string; workerId?: string };
      error?: unknown;
      retryIncrement?: boolean;
      clearAssignment?: boolean;
      clearExecutionData?: boolean;
      clearLifecycleControlMetadata?: boolean;
      reason?: string;
    },
  ): Promise<unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export class TaskTimeoutService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly applyTransition: ApplyTransition,
    private readonly queueWorkerCancelSignal: (
      identity: ApiKeyIdentity,
      workerId: string,
      taskId: string,
      reason: 'manual_cancel' | 'task_timeout',
      requestedAt: Date,
    ) => Promise<string | null>,
    private readonly cancelSignalGracePeriodMs: number,
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

    let affectedCount = 0;

    const timedOutTasks = await this.pool.query(
      `SELECT id, tenant_id, state, assigned_worker_id, metadata
       FROM tasks
       WHERE state IN ('claimed', 'running')
         AND COALESCE(started_at, claimed_at) IS NOT NULL
         AND COALESCE(started_at, claimed_at) + (timeout_minutes * INTERVAL '1 minute') < $1`,
      [now],
    );

    for (const staleTask of timedOutTasks.rows) {
      const taskId = staleTask.id as string;
      const tenantId = staleTask.tenant_id as string;
      const workerId = staleTask.assigned_worker_id as string | null;
      const metadata = asRecord(staleTask.metadata);

      const timeoutForceFailAt = parseIsoDate(metadata.timeout_force_fail_at);
      if (timeoutForceFailAt) {
        if (now.getTime() < timeoutForceFailAt.getTime()) {
          continue;
        }

        const scopedIdentity = { ...systemIdentity, tenantId };
        await this.applyTransition(scopedIdentity, taskId, 'failed', {
          expectedStates: ['claimed', 'running'],
          error: {
            category: 'timeout',
            message: 'Task timeout exceeded after cancel grace period',
            recoverable: false,
          },
          clearAssignment: true,
          clearLifecycleControlMetadata: true,
          reason: 'timeout_force_failed',
        });
        affectedCount += 1;
        continue;
      }

      if (!workerId) {
        const scopedIdentity = { ...systemIdentity, tenantId };
        await this.applyTransition(scopedIdentity, taskId, 'failed', {
          expectedStates: ['claimed', 'running'],
          error: {
            category: 'timeout',
            message: 'Task timeout exceeded',
            recoverable: false,
          },
          clearAssignment: true,
          clearLifecycleControlMetadata: true,
          reason: 'timeout_failed_no_worker',
        });
        affectedCount += 1;
        continue;
      }

      const scopedIdentity = { ...systemIdentity, tenantId };
      const signalRequestedAt = new Date();
      const signalId = await this.queueWorkerCancelSignal(
        scopedIdentity,
        workerId,
        taskId,
        'task_timeout',
        signalRequestedAt,
      );

      const forceFailAt = new Date(signalRequestedAt.getTime() + this.cancelSignalGracePeriodMs);
      const marked = await this.pool.query(
        `UPDATE tasks
         SET metadata = metadata || $3::jsonb
         WHERE tenant_id = $1
           AND id = $2
           AND state IN ('claimed', 'running')
         RETURNING id`,
        [
          tenantId,
          taskId,
          {
            timeout_cancel_requested_at: signalRequestedAt.toISOString(),
            timeout_force_fail_at: forceFailAt.toISOString(),
            ...(signalId ? { timeout_signal_id: signalId } : {}),
          },
        ],
      );

      if (marked.rowCount) {
        affectedCount += 1;
      }
    }

    return affectedCount;
  }

  async finalizeGracefulPipelineCancellations(now = new Date()): Promise<number> {
    const systemIdentity: ApiKeyIdentity = {
      id: 'system',
      tenantId: '00000000-0000-0000-0000-000000000001',
      scope: 'admin',
      ownerType: 'system',
      ownerId: null,
      keyPrefix: 'system',
    };

    let affectedCount = 0;
    const pendingCancellationTasks = await this.pool.query(
      `SELECT id, tenant_id, metadata
         FROM tasks
        WHERE state IN ('claimed', 'running')
          AND metadata ? 'pipeline_cancel_force_at'`,
    );

    for (const row of pendingCancellationTasks.rows) {
      const metadata = asRecord(row.metadata);
      const forceCancelAt = parseIsoDate(metadata.pipeline_cancel_force_at);
      if (!forceCancelAt || now.getTime() < forceCancelAt.getTime()) {
        continue;
      }

      const scopedIdentity = { ...systemIdentity, tenantId: row.tenant_id as string };
      await this.applyTransition(scopedIdentity, row.id as string, 'cancelled', {
        expectedStates: ['claimed', 'running'],
        clearAssignment: true,
        clearLifecycleControlMetadata: true,
        reason: 'pipeline_cancelled_after_grace',
      });
      affectedCount += 1;
    }

    return affectedCount;
  }
}
