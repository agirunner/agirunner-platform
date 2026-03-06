import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { ConflictError, NotFoundError } from '../errors/domain-errors.js';
import { EventService } from './event-service.js';
import { PipelineStateService } from './pipeline-state-service.js';

export class PipelineControlService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly eventService: EventService,
    private readonly stateService: PipelineStateService,
  ) {}

  async pausePipeline(identity: ApiKeyIdentity, pipelineId: string) {
    const result = await this.pool.query(
      `UPDATE pipelines
       SET state = 'paused', updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND state IN ('pending', 'active')
       RETURNING *`,
      [identity.tenantId, pipelineId],
    );

    if (!result.rowCount) {
      throw new ConflictError('Pipeline is not pausable');
    }

    await this.eventService.emit({
      tenantId: identity.tenantId,
      type: 'pipeline.paused',
      entityType: 'pipeline',
      entityId: pipelineId,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: {},
    });

    return result.rows[0];
  }

  async resumePipeline(identity: ApiKeyIdentity, pipelineId: string) {
    const exists = await this.pool.query('SELECT id FROM pipelines WHERE tenant_id = $1 AND id = $2', [
      identity.tenantId,
      pipelineId,
    ]);
    if (!exists.rowCount) {
      throw new NotFoundError('Pipeline not found');
    }

    const state = await this.stateService.recomputePipelineState(identity.tenantId, pipelineId, undefined, {
      actorType: identity.scope,
      actorId: identity.keyPrefix,
    });

    await this.eventService.emit({
      tenantId: identity.tenantId,
      type: 'pipeline.resumed',
      entityType: 'pipeline',
      entityId: pipelineId,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: { state },
    });

    return { id: pipelineId, state };
  }

  async manualReworkPipeline(identity: ApiKeyIdentity, pipelineId: string, feedback: string) {
    const result = await this.pool.query(
      `UPDATE tasks
       SET state = 'ready',
           state_changed_at = now(),
           assigned_agent_id = NULL,
           assigned_worker_id = NULL,
           claimed_at = NULL,
           started_at = NULL,
           output = NULL,
           error = NULL,
           metrics = NULL,
           git_info = NULL,
           retry_count = retry_count + 1,
           metadata = metadata || $3::jsonb
       WHERE tenant_id = $1
         AND pipeline_id = $2
         AND state IN ('failed', 'completed', 'output_pending_review', 'cancelled')
       RETURNING id`,
      [
        identity.tenantId,
        pipelineId,
        {
          review_action: 'manual_rework',
          review_feedback: feedback,
          review_updated_at: new Date().toISOString(),
        },
      ],
    );

    const state = await this.stateService.recomputePipelineState(identity.tenantId, pipelineId, undefined, {
      actorType: identity.scope,
      actorId: identity.keyPrefix,
    });

    await this.eventService.emit({
      tenantId: identity.tenantId,
      type: 'pipeline.manual_rework',
      entityType: 'pipeline',
      entityId: pipelineId,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: { updated_tasks: result.rowCount, feedback },
    });

    return { id: pipelineId, updated_tasks: result.rowCount, state };
  }
}
