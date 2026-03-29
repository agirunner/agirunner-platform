import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { ConflictError, NotFoundError } from '../errors/domain-errors.js';
import { EventService } from './event-service.js';
import { enqueueWorkflowActivationRecord } from './workflow-activation-record.js';
import { WorkflowStateService } from './workflow-state-service.js';
import { stopWorkflowBoundExecution, type StopWorkflowBoundExecutionDeps } from './workflow-execution-stop-service.js';

interface WorkflowControlRow {
  id: string;
  state: string;
  metadata?: Record<string, unknown> | null;
}

export class WorkflowControlService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly eventService: EventService,
    private readonly stateService: WorkflowStateService,
    private readonly stopDeps?: Omit<StopWorkflowBoundExecutionDeps, 'eventService'>,
  ) {}

  async pauseWorkflow(identity: ApiKeyIdentity, workflowId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const workflow = await client.query<WorkflowControlRow>(
        'SELECT id, state, metadata FROM workflows WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
        [identity.tenantId, workflowId],
      );
      if (!workflow.rowCount) {
        throw new NotFoundError('Workflow not found');
      }
      const currentWorkflow = workflow.rows[0];
      if (currentWorkflow.state === 'paused') {
        await client.query('COMMIT');
        return currentWorkflow;
      }
      if (!isPausableWorkflowState(currentWorkflow.state)) {
        throw new ConflictError('Only active workflows can be paused');
      }

      const stopResult = await stopWorkflowBoundExecution(
        client,
        {
          eventService: this.eventService,
          ...this.stopDeps,
        },
        {
          tenantId: identity.tenantId,
          workflowId,
          summary: 'Workflow paused by operator.',
          signalReason: 'manual_pause',
          actorType: identity.scope,
          actorId: identity.keyPrefix,
        },
      );
      await clearStoppedRuntimeHeartbeatTasks(client, identity.tenantId, stopResult.activeTaskIds);

      const result = await client.query<WorkflowControlRow>(
        `UPDATE workflows
            SET state = 'paused',
                metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
                updated_at = now()
          WHERE tenant_id = $1
            AND id = $2
        RETURNING id, state, metadata`,
        [identity.tenantId, workflowId, { pause_requested_at: new Date().toISOString() }],
      );

      await this.eventService.emit({
        tenantId: identity.tenantId,
        type: 'workflow.paused',
        entityType: 'workflow',
        entityId: workflowId,
        actorType: identity.scope,
        actorId: identity.keyPrefix,
        data: {},
      }, client);

      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async resumeWorkflow(identity: ApiKeyIdentity, workflowId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const workflow = await client.query<WorkflowControlRow>(
        'SELECT id, state, metadata FROM workflows WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
        [identity.tenantId, workflowId],
      );
      if (!workflow.rowCount) {
        throw new NotFoundError('Workflow not found');
      }
      const currentWorkflow = workflow.rows[0];
      const pauseRequestedAt = readWorkflowMarker(currentWorkflow.metadata, 'pause_requested_at');
      if (currentWorkflow.state === 'cancelled') {
        throw new ConflictError('Cancelled workflows cannot be resumed');
      }
      if (currentWorkflow.state === 'completed') {
        throw new ConflictError('Completed workflows cannot be resumed');
      }
      if (currentWorkflow.state === 'failed') {
        throw new ConflictError('Failed workflows cannot be resumed');
      }
      if (hasCancelRequest(currentWorkflow.metadata)) {
        throw new ConflictError('Workflow cancellation is already in progress and cannot be resumed');
      }
      if (currentWorkflow.state !== 'paused') {
        if (isResumedWorkflowState(currentWorkflow.state) && !hasPauseRequest(currentWorkflow.metadata)) {
          await client.query('COMMIT');
          return { id: workflowId, state: currentWorkflow.state };
        }
        throw new ConflictError('Workflow is not resumable');
      }

      await client.query(
        `UPDATE workflows
            SET metadata = COALESCE(metadata, '{}'::jsonb) - 'pause_requested_at',
                updated_at = now()
          WHERE tenant_id = $1
            AND id = $2`,
        [identity.tenantId, workflowId],
      );

      const state = await this.stateService.recomputeWorkflowState(identity.tenantId, workflowId, client, {
        actorType: identity.scope,
        actorId: identity.keyPrefix,
      });

      if (state === 'pending' || state === 'active') {
        const requestKey = pauseRequestedAt ?? 'manual';
        await enqueueWorkflowActivationRecord(client, this.eventService, {
          tenantId: identity.tenantId,
          workflowId,
          requestId: `workflow-resume:${workflowId}:${requestKey}`,
          reason: 'workflow.resumed',
          eventType: 'workflow.resumed',
          payload: {
            resumed_from_state: currentWorkflow.state,
            resumed_to_state: state,
          },
          actorType: identity.scope,
          actorId: identity.keyPrefix,
        });
      }

      await this.eventService.emit({
        tenantId: identity.tenantId,
        type: 'workflow.resumed',
        entityType: 'workflow',
        entityId: workflowId,
        actorType: identity.scope,
        actorId: identity.keyPrefix,
        data: { state },
      }, client);

      await client.query('COMMIT');
      return { id: workflowId, state };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

}

function isPausableWorkflowState(state: string) {
  return state === 'active';
}

function isResumedWorkflowState(state: string) {
  return state === 'pending' || state === 'active';
}

function hasPauseRequest(metadata: unknown) {
  return readWorkflowMarker(metadata, 'pause_requested_at') !== null;
}

function hasCancelRequest(metadata: unknown) {
  return readWorkflowMarker(metadata, 'cancel_requested_at') !== null;
}

function readWorkflowMarker(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

async function clearStoppedRuntimeHeartbeatTasks(
  client: { query: DatabasePool['query'] },
  tenantId: string,
  taskIds: string[],
) {
  if (taskIds.length === 0) {
    return;
  }
  await client.query(
    `UPDATE runtime_heartbeats
        SET task_id = NULL,
            state = CASE
              WHEN pool_kind = 'specialist' THEN 'draining'
              ELSE 'idle'
            END
      WHERE tenant_id = $1
        AND task_id = ANY($2::uuid[])`,
    [tenantId, taskIds],
  );
}
