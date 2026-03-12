import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { ConflictError, NotFoundError } from '../errors/domain-errors.js';
import { EventService } from './event-service.js';
import { WorkflowStateService } from './workflow-state-service.js';
import type { WorkerConnectionHub } from './worker-connection-hub.js';

interface WorkflowCancellationDeps {
  pool: DatabasePool;
  eventService: EventService;
  stateService: WorkflowStateService;
  cancelSignalGracePeriodMs: number;
  workerConnectionHub?: WorkerConnectionHub;
  getWorkflow: (tenantId: string, workflowId: string) => Promise<Record<string, unknown>>;
}

export class WorkflowCancellationService {
  constructor(private readonly deps: WorkflowCancellationDeps) {}

  async cancelWorkflow(identity: ApiKeyIdentity, workflowId: string) {
    const client = await this.deps.pool.connect();
    try {
      await client.query('BEGIN');

      const workflowRes = await client.query('SELECT * FROM workflows WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [
        identity.tenantId,
        workflowId,
      ]);
      if (!workflowRes.rowCount) throw new NotFoundError('Workflow not found');

      const workflow = workflowRes.rows[0];
      if (workflow.state === 'completed' || workflow.state === 'failed' || workflow.state === 'cancelled') {
        throw new ConflictError('Workflow is already terminal');
      }
      if (hasCancellationRequest(workflow.metadata)) {
        await client.query('COMMIT');
        return this.deps.getWorkflow(identity.tenantId, workflowId);
      }

      const immediateCancellationStates = ['pending', 'ready', 'awaiting_approval', 'output_pending_review', 'failed'];
      const cancelledTasks = await client.query(
        `UPDATE tasks
         SET state = 'cancelled', state_changed_at = now(), assigned_agent_id = NULL,
             assigned_worker_id = NULL, claimed_at = NULL, started_at = NULL,
             metadata = metadata - 'workflow_cancel_requested_at' - 'workflow_cancel_force_at' - 'workflow_cancel_signal_id'
         WHERE tenant_id = $1 AND workflow_id = $2 AND state = ANY($3::task_state[])
         RETURNING id`,
        [identity.tenantId, workflowId, immediateCancellationStates],
      );

      await client.query(
        `UPDATE workflow_stage_gates
            SET status = 'rejected',
                decision_feedback = COALESCE(decision_feedback, 'Workflow cancelled by operator.'),
                decided_by_type = COALESCE(decided_by_type, $3),
                decided_by_id = COALESCE(decided_by_id, $4),
                decided_at = COALESCE(decided_at, now()),
                updated_at = now()
          WHERE tenant_id = $1
            AND workflow_id = $2
            AND status = 'awaiting_approval'`,
        [identity.tenantId, workflowId, identity.scope, identity.keyPrefix],
      );

      await client.query(
        `UPDATE workflow_stages
            SET gate_status = CASE
                  WHEN gate_status = 'awaiting_approval' THEN 'rejected'
                  ELSE gate_status
                END,
                status = CASE
                  WHEN status = 'awaiting_gate' THEN 'blocked'
                  ELSE status
                END,
                updated_at = now()
          WHERE tenant_id = $1
            AND workflow_id = $2
            AND gate_status = 'awaiting_approval'`,
        [identity.tenantId, workflowId],
      );

      const activeTasks = await client.query(
        `SELECT id, assigned_worker_id
           FROM tasks
          WHERE tenant_id = $1
            AND workflow_id = $2
            AND state IN ('claimed', 'in_progress')
          FOR UPDATE`,
        [identity.tenantId, workflowId],
      );

      const signalRequestedAt = new Date();
      const forceCancelAt = new Date(
        signalRequestedAt.getTime() + this.deps.cancelSignalGracePeriodMs,
      );
      let signalledTasks = 0;
      for (const task of activeTasks.rows) {
        let signalId: string | null = null;
        if (
          typeof task.assigned_worker_id === 'string' &&
          this.deps.workerConnectionHub !== undefined
        ) {
          const signalPayload = {
            reason: 'manual_cancel',
            requested_at: signalRequestedAt.toISOString(),
            grace_period_ms: this.deps.cancelSignalGracePeriodMs,
          };
          const signalResult = await client.query<{ id: string; created_at: Date }>(
            `INSERT INTO worker_signals (tenant_id, worker_id, signal_type, task_id, data)
             VALUES ($1, $2, 'cancel_task', $3, $4)
             RETURNING id, created_at`,
            [identity.tenantId, task.assigned_worker_id, task.id, signalPayload],
          );
          const signal = signalResult.rows[0];
          signalId = signal.id;
          this.deps.workerConnectionHub.sendToWorker(task.assigned_worker_id as string, {
            type: 'worker.signal',
            signal_id: signal.id,
            signal_type: 'cancel_task',
            task_id: task.id as string,
            data: signalPayload,
            issued_at: signal.created_at,
          });
          await this.deps.eventService.emit(
            {
              tenantId: identity.tenantId,
              type: 'worker.signaled',
              entityType: 'worker',
              entityId: task.assigned_worker_id as string,
              actorType: identity.scope,
              actorId: identity.keyPrefix,
              data: { signal_type: 'cancel_task', task_id: task.id as string },
            },
            client,
          );
          signalledTasks += 1;
        } else if (typeof task.assigned_worker_id === 'string') {
          const signalPayload = {
            reason: 'manual_cancel',
            requested_at: signalRequestedAt.toISOString(),
            grace_period_ms: this.deps.cancelSignalGracePeriodMs,
          };
          const signalResult = await client.query<{ id: string }>(
            `INSERT INTO worker_signals (tenant_id, worker_id, signal_type, task_id, data)
             VALUES ($1, $2, 'cancel_task', $3, $4)
             RETURNING id`,
            [identity.tenantId, task.assigned_worker_id, task.id, signalPayload],
          );
          signalId = signalResult.rows[0].id;
          signalledTasks += 1;
        }

        await client.query(
          `UPDATE tasks
              SET metadata = metadata || $3::jsonb
            WHERE tenant_id = $1
              AND id = $2`,
          [
            identity.tenantId,
            task.id,
            {
              workflow_cancel_requested_at: signalRequestedAt.toISOString(),
              workflow_cancel_force_at: forceCancelAt.toISOString(),
              ...(signalId ? { workflow_cancel_signal_id: signalId } : {}),
            },
          ],
        );
      }

      await client.query(
        `UPDATE workflows
            SET metadata = metadata || $3::jsonb,
                updated_at = now()
          WHERE tenant_id = $1
            AND id = $2`,
        [
          identity.tenantId,
          workflowId,
          {
            cancel_requested_at: signalRequestedAt.toISOString(),
            cancel_force_at: forceCancelAt.toISOString(),
          },
        ],
      );

      await client.query(
        `UPDATE agents
         SET current_task_id = NULL,
             status = (CASE WHEN status = 'inactive' THEN 'inactive' ELSE 'idle' END)::agent_status
         WHERE tenant_id = $1 AND current_task_id = ANY($2::uuid[])`,
        [
          identity.tenantId,
          cancelledTasks.rows.length > 0 ? cancelledTasks.rows.map((row) => row.id as string) : ['00000000-0000-0000-0000-000000000000'],
        ],
      );

      const state = await this.deps.stateService.recomputeWorkflowState(identity.tenantId, workflowId, client, {
        actorType: identity.scope,
        actorId: identity.keyPrefix,
      });

      await this.deps.eventService.emit(
        {
          tenantId: identity.tenantId,
          type: 'workflow.cancellation_requested',
          entityType: 'workflow',
          entityId: workflowId,
          actorType: identity.scope,
          actorId: identity.keyPrefix,
          data: {
            cancelled_tasks: cancelledTasks.rowCount,
            signalled_tasks: signalledTasks,
            force_cancel_at: forceCancelAt.toISOString(),
          },
        },
        client,
      );

      await client.query('COMMIT');
      const workflowResult = await this.deps.getWorkflow(identity.tenantId, workflowId);
      return { ...workflowResult, state };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function hasCancellationRequest(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return false;
  }
  const value = (metadata as Record<string, unknown>).cancel_requested_at;
  return typeof value === 'string' && value.trim().length > 0;
}
