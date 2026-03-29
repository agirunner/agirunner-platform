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

interface ReopenedTaskRow {
  id: string;
  state: string;
  work_item_id: string | null;
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
      if (hasCancelRequest(currentWorkflow.metadata)) {
        throw new ConflictError('Workflow cancellation is already in progress and cannot be paused');
      }
      if (!isPausableWorkflowState(currentWorkflow.state)) {
        throw new ConflictError('Only active workflows can be paused');
      }

      const pauseRequestedAt = new Date().toISOString();
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
      const pauseMetadata: Record<string, unknown> = {
        pause_requested_at: pauseRequestedAt,
      };
      if (stopResult.cancelledSpecialistTaskIds.length > 0) {
        pauseMetadata.pause_reopen_task_ids = stopResult.cancelledSpecialistTaskIds;
      }

      const result = await client.query<WorkflowControlRow>(
        `UPDATE workflows
            SET state = 'paused',
                metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
                updated_at = now()
          WHERE tenant_id = $1
            AND id = $2
        RETURNING id, state, metadata`,
        [identity.tenantId, workflowId, pauseMetadata],
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
      const pauseReopenTaskIds = readWorkflowTaskIds(currentWorkflow.metadata, 'pause_reopen_task_ids');
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
            SET metadata = ((COALESCE(metadata, '{}'::jsonb) - 'pause_requested_at') - 'pause_reopen_task_ids'),
                updated_at = now()
          WHERE tenant_id = $1
            AND id = $2`,
        [identity.tenantId, workflowId],
      );

      await reopenPauseCancelledSpecialistTasks(
        client,
        this.eventService,
        identity.tenantId,
        workflowId,
        pauseReopenTaskIds,
        identity.scope,
        identity.keyPrefix,
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

function readWorkflowTaskIds(metadata: unknown, key: string): string[] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return [];
  }
  const value = (metadata as Record<string, unknown>)[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((taskId): taskId is string => typeof taskId === 'string' && taskId.trim().length > 0);
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

async function reopenPauseCancelledSpecialistTasks(
  client: { query: DatabasePool['query'] },
  eventService: EventService,
  tenantId: string,
  workflowId: string,
  taskIds: string[],
  actorType: string,
  actorId: string,
) {
  if (taskIds.length === 0) {
    return;
  }

  const reopenedTasks = await client.query<ReopenedTaskRow>(
    `UPDATE tasks t
        SET state = 'ready',
            state_changed_at = now(),
            completed_at = NULL,
            assigned_agent_id = NULL,
            assigned_worker_id = NULL,
            claimed_at = NULL,
            started_at = NULL
       FROM workflow_work_items wi
      WHERE t.tenant_id = $1
        AND t.workflow_id = $2
        AND t.tenant_id = wi.tenant_id
        AND t.workflow_id = wi.workflow_id
        AND t.work_item_id = wi.id
        AND t.id = ANY($3::uuid[])
        AND t.is_orchestrator_task = FALSE
        AND t.state = 'cancelled'
        AND t.completed_at IS NULL
        AND t.error IS NULL
        AND COALESCE(t.metadata->>'task_kind', 'delivery') = 'delivery'
        AND wi.completed_at IS NULL
        AND wi.blocked_state IS DISTINCT FROM 'blocked'
        AND wi.escalation_status IS DISTINCT FROM 'open'
    RETURNING t.id, t.state, t.work_item_id`,
    [tenantId, workflowId, taskIds],
  );

  for (const task of reopenedTasks.rows) {
    await eventService.emit(
      {
        tenantId,
        type: 'task.state_changed',
        entityType: 'task',
        entityId: task.id,
        actorType,
        actorId,
        data: {
          from_state: 'cancelled',
          to_state: task.state,
          reason: 'workflow_resumed',
          workflow_id: workflowId,
          work_item_id: task.work_item_id,
        },
      },
      client,
    );
  }
}
