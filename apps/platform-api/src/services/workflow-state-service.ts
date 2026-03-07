import type { DatabaseClient, DatabasePool } from '../db/database.js';

import { NotFoundError } from '../errors/domain-errors.js';
import { deriveWorkflowState } from '../orchestration/workflow-engine.js';
import { ArtifactRetentionService } from './artifact-retention-service.js';
import { EventService } from './event-service.js';
import { ProjectTimelineService } from './project-timeline-service.js';

export class WorkflowStateService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly eventService: EventService,
    private readonly artifactRetentionService?: ArtifactRetentionService,
    private readonly projectTimelineService?: ProjectTimelineService,
  ) {}

  async recomputeWorkflowState(
    tenantId: string,
    workflowId: string,
    client?: DatabaseClient,
    actor: { actorType: string; actorId?: string } = {
      actorType: 'system',
      actorId: 'workflow_state_deriver',
    },
  ) {
    const db = client ?? this.pool;
    const [workflowRes, taskStatesRes] = await Promise.all([
      db.query(
        'SELECT id, state, started_at, completed_at, metadata FROM workflows WHERE tenant_id = $1 AND id = $2',
        [tenantId, workflowId],
      ),
      db.query('SELECT state, metadata FROM tasks WHERE tenant_id = $1 AND workflow_id = $2', [
        tenantId,
        workflowId,
      ]),
    ]);

    if (!workflowRes.rowCount) {
      throw new NotFoundError('Workflow not found');
    }

    const previousState = workflowRes.rows[0].state as string;
    const workflowMetadata = asRecord(workflowRes.rows[0].metadata);
    let derivedState = deriveWorkflowState(
      taskStatesRes.rows.map((row) => normalizeWorkflowTaskState(row as Record<string, unknown>)),
    );
    if (workflowMetadata.cancel_requested_at) {
      const hasActiveCancellationTasks = taskStatesRes.rows.some((row) => {
        const state = String(row.state);
        return state === 'claimed' || state === 'running';
      });
      derivedState = hasActiveCancellationTasks ? 'paused' : 'cancelled';
    }

    const setStartedAt = derivedState === 'active';
    const setCompletedAt = ['completed', 'failed', 'cancelled'].includes(derivedState);

    await db.query(
      `UPDATE workflows
       SET state = $3,
           started_at = CASE WHEN $4 AND started_at IS NULL THEN now() ELSE started_at END,
           completed_at = CASE WHEN $5 THEN COALESCE(completed_at, now()) ELSE completed_at END,
           updated_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, workflowId, derivedState, setStartedAt, setCompletedAt],
    );

    if (
      previousState !== derivedState &&
      ['completed', 'failed', 'cancelled'].includes(derivedState)
    ) {
      await this.artifactRetentionService?.purgeWorkflowArtifactsOnTerminalState(
        tenantId,
        workflowId,
        client,
      );
      await this.projectTimelineService?.recordWorkflowTerminalState(
        tenantId,
        workflowId,
        client,
      );
    }

    if (previousState !== derivedState) {
      await this.eventService.emit(
        {
          tenantId,
          type: 'workflow.state_changed',
          entityType: 'workflow',
          entityId: workflowId,
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

function normalizeWorkflowTaskState(row: Record<string, unknown>): string {
  if (
    row.state === 'failed' &&
    row.metadata &&
    typeof row.metadata === 'object' &&
    !Array.isArray(row.metadata) &&
    (row.metadata as Record<string, unknown>).escalation_status === 'pending'
  ) {
    return 'output_pending_review';
  }
  return String(row.state);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
