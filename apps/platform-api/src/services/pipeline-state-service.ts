import type { DatabaseClient, DatabasePool } from '../db/database.js';

import { NotFoundError } from '../errors/domain-errors.js';
import { derivePipelineState } from '../orchestration/pipeline-engine.js';
import { EventService } from './event-service.js';

export class PipelineStateService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly eventService: EventService,
  ) {}

  async recomputePipelineState(
    tenantId: string,
    pipelineId: string,
    client?: DatabaseClient,
    actor: { actorType: string; actorId?: string } = { actorType: 'system', actorId: 'pipeline_state_deriver' },
  ) {
    const db = client ?? this.pool;
    const [pipelineRes, taskStatesRes] = await Promise.all([
      db.query('SELECT id, state, started_at, completed_at FROM pipelines WHERE tenant_id = $1 AND id = $2', [tenantId, pipelineId]),
      db.query('SELECT state FROM tasks WHERE tenant_id = $1 AND pipeline_id = $2', [tenantId, pipelineId]),
    ]);

    if (!pipelineRes.rowCount) {
      throw new NotFoundError('Pipeline not found');
    }

    const previousState = pipelineRes.rows[0].state as string;
    const derivedState = derivePipelineState(taskStatesRes.rows.map((row) => row.state as string));

    const setStartedAt = derivedState === 'active';
    const setCompletedAt = ['completed', 'failed', 'cancelled'].includes(derivedState);

    await db.query(
      `UPDATE pipelines
       SET state = $3,
           started_at = CASE WHEN $4 AND started_at IS NULL THEN now() ELSE started_at END,
           completed_at = CASE WHEN $5 THEN COALESCE(completed_at, now()) ELSE completed_at END,
           updated_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, pipelineId, derivedState, setStartedAt, setCompletedAt],
    );

    if (previousState !== derivedState) {
      await this.eventService.emit(
        {
          tenantId,
          type: 'pipeline.state_changed',
          entityType: 'pipeline',
          entityId: pipelineId,
          actorType: actor.actorType,
          actorId: actor.actorId ?? null,
          data: { from_state: previousState, to_state: derivedState },
        },
        client,
      );
    }

    return derivedState;
  }
}
