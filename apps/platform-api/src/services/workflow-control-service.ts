import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { ConflictError, NotFoundError } from '../errors/domain-errors.js';
import { EventService } from './event/event-service.js';
import { enqueueWorkflowActivationRecord } from './workflow-activation/workflow-activation-record.js';
import { WorkflowStateService } from './workflow-state-service.js';
import {
  clearStoppedRuntimeHeartbeatTasks,
  readLifecycleMarker,
  readLifecycleTaskIds,
  reopenPauseCancelledSpecialistTasks,
} from './workflow-lifecycle-control-support.js';
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
          disposition: 'pause',
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
      await markWorkflowWorkItemsPaused(client, identity.tenantId, workflowId, pauseRequestedAt);

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
      const pauseRequestedAt = readLifecycleMarker(currentWorkflow.metadata, 'pause_requested_at');
      const pauseReopenTaskIds = readLifecycleTaskIds(currentWorkflow.metadata, 'pause_reopen_task_ids');
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
      await clearWorkflowWorkItemPauseMarkers(client, identity.tenantId, workflowId);

      await reopenPauseCancelledSpecialistTasks(
        client,
        this.eventService,
        identity.tenantId,
        workflowId,
        pauseReopenTaskIds,
        identity.scope,
        identity.keyPrefix,
        { reason: 'workflow_resumed' },
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
  return readLifecycleMarker(metadata, 'pause_requested_at') !== null;
}

function hasCancelRequest(metadata: unknown) {
  return readLifecycleMarker(metadata, 'cancel_requested_at') !== null;
}

async function markWorkflowWorkItemsPaused(
  client: { query: DatabasePool['query'] },
  tenantId: string,
  workflowId: string,
  pauseRequestedAt: string,
) {
  await client.query(
    `UPDATE workflow_work_items
        SET metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
            updated_at = now()
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND completed_at IS NULL`,
    [tenantId, workflowId, { pause_requested_at: pauseRequestedAt }],
  );
}

async function clearWorkflowWorkItemPauseMarkers(
  client: { query: DatabasePool['query'] },
  tenantId: string,
  workflowId: string,
) {
  await client.query(
    `UPDATE workflow_work_items
        SET metadata = COALESCE(metadata, '{}'::jsonb) - 'pause_requested_at',
            updated_at = now()
      WHERE tenant_id = $1
        AND workflow_id = $2`,
    [tenantId, workflowId],
  );
}
