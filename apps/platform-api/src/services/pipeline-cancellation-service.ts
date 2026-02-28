import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { ConflictError, NotFoundError } from '../errors/domain-errors.js';
import { EventService } from './event-service.js';
import { PipelineStateService } from './pipeline-state-service.js';

interface PipelineCancellationDeps {
  pool: DatabasePool;
  eventService: EventService;
  stateService: PipelineStateService;
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

      const cancellableStates = ['pending', 'ready', 'claimed', 'running', 'awaiting_approval', 'output_pending_review', 'failed'];
      const updatedTasks = await client.query(
        `UPDATE tasks
         SET state = 'cancelled', state_changed_at = now(), assigned_agent_id = NULL,
             assigned_worker_id = NULL, claimed_at = NULL, started_at = NULL
         WHERE tenant_id = $1 AND pipeline_id = $2 AND state = ANY($3::task_state[])
         RETURNING id`,
        [identity.tenantId, pipelineId, cancellableStates],
      );

      await client.query(
        `UPDATE agents
         SET current_task_id = NULL,
             status = (CASE WHEN status = 'inactive' THEN 'inactive' ELSE 'idle' END)::agent_status
         WHERE tenant_id = $1 AND current_task_id = ANY($2::uuid[])`,
        [
          identity.tenantId,
          updatedTasks.rows.length > 0 ? updatedTasks.rows.map((row) => row.id as string) : ['00000000-0000-0000-0000-000000000000'],
        ],
      );

      const state = await this.deps.stateService.recomputePipelineState(identity.tenantId, pipelineId, client, {
        actorType: identity.scope,
        actorId: identity.keyPrefix,
      });

      await this.deps.eventService.emit(
        {
          tenantId: identity.tenantId,
          type: 'pipeline.cancelled',
          entityType: 'pipeline',
          entityId: pipelineId,
          actorType: identity.scope,
          actorId: identity.keyPrefix,
          data: { cancelled_tasks: updatedTasks.rowCount },
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
