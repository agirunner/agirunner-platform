import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { ConflictError, NotFoundError } from '../errors/domain-errors.js';
import { EventService } from './event-service.js';
import { PipelineStateService } from './pipeline-state-service.js';
import type { WorkerConnectionHub } from './worker-connection-hub.js';

interface PipelineCancellationDeps {
  pool: DatabasePool;
  eventService: EventService;
  stateService: PipelineStateService;
  cancelSignalGracePeriodMs: number;
  workerConnectionHub?: WorkerConnectionHub;
  getPipeline: (tenantId: string, pipelineId: string) => Promise<Record<string, unknown>>;
}

export class PipelineCancellationService {
  constructor(private readonly deps: PipelineCancellationDeps) {}

  async cancelPipeline(identity: ApiKeyIdentity, pipelineId: string) {
    const client = await this.deps.pool.connect();
    try {
      await client.query('BEGIN');

      const pipelineRes = await client.query('SELECT * FROM pipelines WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [
        identity.tenantId,
        pipelineId,
      ]);
      if (!pipelineRes.rowCount) throw new NotFoundError('Pipeline not found');

      const pipeline = pipelineRes.rows[0];
      if (pipeline.state === 'completed' || pipeline.state === 'failed' || pipeline.state === 'cancelled') {
        throw new ConflictError('Pipeline is already terminal');
      }

      const immediateCancellationStates = ['pending', 'ready', 'awaiting_approval', 'output_pending_review', 'failed'];
      const cancelledTasks = await client.query(
        `UPDATE tasks
         SET state = 'cancelled', state_changed_at = now(), assigned_agent_id = NULL,
             assigned_worker_id = NULL, claimed_at = NULL, started_at = NULL,
             metadata = metadata - 'pipeline_cancel_requested_at' - 'pipeline_cancel_force_at' - 'pipeline_cancel_signal_id'
         WHERE tenant_id = $1 AND pipeline_id = $2 AND state = ANY($3::task_state[])
         RETURNING id`,
        [identity.tenantId, pipelineId, immediateCancellationStates],
      );

      const activeTasks = await client.query(
        `SELECT id, assigned_worker_id
           FROM tasks
          WHERE tenant_id = $1
            AND pipeline_id = $2
            AND state IN ('claimed', 'running')
          FOR UPDATE`,
        [identity.tenantId, pipelineId],
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
              pipeline_cancel_requested_at: signalRequestedAt.toISOString(),
              pipeline_cancel_force_at: forceCancelAt.toISOString(),
              ...(signalId ? { pipeline_cancel_signal_id: signalId } : {}),
            },
          ],
        );
      }

      await client.query(
        `UPDATE pipelines
            SET metadata = metadata || $3::jsonb,
                updated_at = now()
          WHERE tenant_id = $1
            AND id = $2`,
        [
          identity.tenantId,
          pipelineId,
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

      const state = await this.deps.stateService.recomputePipelineState(identity.tenantId, pipelineId, client, {
        actorType: identity.scope,
        actorId: identity.keyPrefix,
      });

      await this.deps.eventService.emit(
        {
          tenantId: identity.tenantId,
          type: 'pipeline.cancellation_requested',
          entityType: 'pipeline',
          entityId: pipelineId,
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
      const pipelineResult = await this.deps.getPipeline(identity.tenantId, pipelineId);
      return { ...pipelineResult, state };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
