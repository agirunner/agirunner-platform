import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabaseClient, DatabasePool } from '../db/database.js';
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

interface WorkflowWorkItemControlRow {
  id: string;
  workflow_id: string;
  completed_at: Date | null;
  metadata: Record<string, unknown> | null;
  workflow_state: string;
  workflow_metadata: Record<string, unknown> | null;
}

interface WorkflowWorkItemControlDeps {
  pool: DatabasePool;
  eventService: EventService;
  stateService: WorkflowStateService;
  resolveCancelSignalGracePeriodMs: (tenantId: string) => Promise<number>;
  workerConnectionHub?: StopWorkflowBoundExecutionDeps['workerConnectionHub'];
  getWorkflowWorkItem: (
    tenantId: string,
    workflowId: string,
    workItemId: string,
  ) => Promise<Record<string, unknown>>;
}

export class WorkflowWorkItemControlService {
  constructor(private readonly deps: WorkflowWorkItemControlDeps) {}

  async pauseWorkflowWorkItem(identity: ApiKeyIdentity, workflowId: string, workItemId: string) {
    const client = await this.deps.pool.connect();
    try {
      await client.query('BEGIN');
      const workItem = await this.loadWorkItem(client, identity.tenantId, workflowId, workItemId);
      assertWorkflowAllowsScopedLifecycle(workItem);
      if (hasWorkItemCancelRequest(workItem.metadata) || workItem.completed_at) {
        throw new ConflictError('Completed workflow work items cannot be paused');
      }
      if (hasWorkItemPauseRequest(workItem.metadata)) {
        await client.query('COMMIT');
        return this.deps.getWorkflowWorkItem(identity.tenantId, workflowId, workItemId);
      }

      const pauseRequestedAt = new Date().toISOString();
      const stopResult = await stopWorkflowBoundExecution(
        client,
        {
          eventService: this.deps.eventService,
          resolveCancelSignalGracePeriodMs: this.deps.resolveCancelSignalGracePeriodMs,
          workerConnectionHub: this.deps.workerConnectionHub,
        },
        {
          tenantId: identity.tenantId,
          workflowId,
          workItemId,
          summary: 'Workflow work item paused by operator.',
          signalReason: 'manual_work_item_pause',
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
      await client.query(
        `UPDATE workflow_work_items
            SET metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb,
                updated_at = now()
          WHERE tenant_id = $1
            AND workflow_id = $2
            AND id = $3`,
        [identity.tenantId, workflowId, workItemId, pauseMetadata],
      );

      const workflowState = await this.deps.stateService.recomputeWorkflowState(identity.tenantId, workflowId, client, {
        actorType: identity.scope,
        actorId: identity.keyPrefix,
      });
      await enqueueScopedActivationIfRunnable(
        client,
        this.deps.eventService,
        identity,
        workflowId,
        `work-item-pause:${workItemId}:${pauseRequestedAt}`,
        'work_item.paused',
        {
          work_item_id: workItemId,
          workflow_state: workflowState,
        },
        workflowState,
      );
      await this.deps.eventService.emit({
        tenantId: identity.tenantId,
        type: 'work_item.paused',
        entityType: 'work_item',
        entityId: workItemId,
        actorType: identity.scope,
        actorId: identity.keyPrefix,
        data: {},
      }, client);

      await client.query('COMMIT');
      return this.deps.getWorkflowWorkItem(identity.tenantId, workflowId, workItemId);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async resumeWorkflowWorkItem(identity: ApiKeyIdentity, workflowId: string, workItemId: string) {
    const client = await this.deps.pool.connect();
    try {
      await client.query('BEGIN');
      const workItem = await this.loadWorkItem(client, identity.tenantId, workflowId, workItemId);
      assertWorkflowAllowsScopedLifecycle(workItem);
      if (hasWorkItemCancelRequest(workItem.metadata) || workItem.completed_at) {
        throw new ConflictError('Cancelled workflow work items cannot be resumed');
      }

      const pauseRequestedAt = readLifecycleMarker(workItem.metadata, 'pause_requested_at');
      const pauseReopenTaskIds = readLifecycleTaskIds(workItem.metadata, 'pause_reopen_task_ids');
      if (!pauseRequestedAt) {
        await client.query('COMMIT');
        return this.deps.getWorkflowWorkItem(identity.tenantId, workflowId, workItemId);
      }

      await client.query(
        `UPDATE workflow_work_items
            SET metadata = ((COALESCE(metadata, '{}'::jsonb) - 'pause_requested_at') - 'pause_reopen_task_ids'),
                updated_at = now()
          WHERE tenant_id = $1
            AND workflow_id = $2
            AND id = $3`,
        [identity.tenantId, workflowId, workItemId],
      );
      await reopenPauseCancelledSpecialistTasks(
        client,
        this.deps.eventService,
        identity.tenantId,
        workflowId,
        pauseReopenTaskIds,
        identity.scope,
        identity.keyPrefix,
        {
          reason: 'work_item_resumed',
          workItemId,
        },
      );

      const workflowState = await this.deps.stateService.recomputeWorkflowState(identity.tenantId, workflowId, client, {
        actorType: identity.scope,
        actorId: identity.keyPrefix,
      });
      await enqueueScopedActivationIfRunnable(
        client,
        this.deps.eventService,
        identity,
        workflowId,
        `work-item-resume:${workItemId}:${pauseRequestedAt}`,
        'work_item.resumed',
        {
          work_item_id: workItemId,
          workflow_state: workflowState,
        },
        workflowState,
      );
      await this.deps.eventService.emit({
        tenantId: identity.tenantId,
        type: 'work_item.resumed',
        entityType: 'work_item',
        entityId: workItemId,
        actorType: identity.scope,
        actorId: identity.keyPrefix,
        data: {},
      }, client);

      await client.query('COMMIT');
      return this.deps.getWorkflowWorkItem(identity.tenantId, workflowId, workItemId);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async cancelWorkflowWorkItem(identity: ApiKeyIdentity, workflowId: string, workItemId: string) {
    const client = await this.deps.pool.connect();
    try {
      await client.query('BEGIN');
      const workItem = await this.loadWorkItem(client, identity.tenantId, workflowId, workItemId);
      assertWorkflowAllowsScopedLifecycle(workItem);
      if (hasWorkItemCancelRequest(workItem.metadata)) {
        await client.query('COMMIT');
        return this.deps.getWorkflowWorkItem(identity.tenantId, workflowId, workItemId);
      }
      if (workItem.completed_at) {
        throw new ConflictError('Completed workflow work items cannot be cancelled');
      }

      const cancelRequestedAt = new Date().toISOString();
      const stopResult = await stopWorkflowBoundExecution(
        client,
        {
          eventService: this.deps.eventService,
          resolveCancelSignalGracePeriodMs: this.deps.resolveCancelSignalGracePeriodMs,
          workerConnectionHub: this.deps.workerConnectionHub,
        },
        {
          tenantId: identity.tenantId,
          workflowId,
          workItemId,
          summary: 'Workflow work item cancelled by operator.',
          signalReason: 'manual_work_item_cancel',
          disposition: 'cancel',
          actorType: identity.scope,
          actorId: identity.keyPrefix,
        },
      );
      await clearStoppedRuntimeHeartbeatTasks(client, identity.tenantId, stopResult.activeTaskIds);

      await client.query(
        `UPDATE workflow_work_items
            SET completed_at = COALESCE(completed_at, now()),
                metadata = ((COALESCE(metadata, '{}'::jsonb) - 'pause_requested_at') - 'pause_reopen_task_ids') || $4::jsonb,
                updated_at = now()
          WHERE tenant_id = $1
            AND workflow_id = $2
            AND id = $3`,
        [
          identity.tenantId,
          workflowId,
          workItemId,
          { cancel_requested_at: cancelRequestedAt },
        ],
      );

      const workflowState = await this.deps.stateService.recomputeWorkflowState(identity.tenantId, workflowId, client, {
        actorType: identity.scope,
        actorId: identity.keyPrefix,
      });
      await enqueueScopedActivationIfRunnable(
        client,
        this.deps.eventService,
        identity,
        workflowId,
        `work-item-cancel:${workItemId}:${cancelRequestedAt}`,
        'work_item.cancelled',
        {
          work_item_id: workItemId,
          workflow_state: workflowState,
        },
        workflowState,
      );
      await this.deps.eventService.emit({
        tenantId: identity.tenantId,
        type: 'work_item.cancelled',
        entityType: 'work_item',
        entityId: workItemId,
        actorType: identity.scope,
        actorId: identity.keyPrefix,
        data: {},
      }, client);

      await client.query('COMMIT');
      return this.deps.getWorkflowWorkItem(identity.tenantId, workflowId, workItemId);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async loadWorkItem(client: { query: DatabasePool['query'] }, tenantId: string, workflowId: string, workItemId: string) {
    const result = await client.query<WorkflowWorkItemControlRow>(
      `SELECT wi.id,
              wi.workflow_id,
              wi.completed_at,
              wi.metadata,
              w.state AS workflow_state,
              w.metadata AS workflow_metadata
         FROM workflow_work_items wi
         JOIN workflows w
           ON w.tenant_id = wi.tenant_id
          AND w.id = wi.workflow_id
        WHERE wi.tenant_id = $1
          AND wi.workflow_id = $2
          AND wi.id = $3
        FOR UPDATE OF wi, w`,
      [tenantId, workflowId, workItemId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Workflow work item not found');
    }
    return result.rows[0];
  }
}

function assertWorkflowAllowsScopedLifecycle(workItem: WorkflowWorkItemControlRow) {
  if (readLifecycleMarker(workItem.workflow_metadata, 'cancel_requested_at')) {
    throw new ConflictError('Workflow cancellation is already in progress');
  }
  if (
    workItem.workflow_state === 'paused'
    || readLifecycleMarker(workItem.workflow_metadata, 'pause_requested_at')
  ) {
    throw new ConflictError('Workflow is paused');
  }
  if (workItem.workflow_state === 'cancelled') {
    throw new ConflictError('Cancelled workflows cannot accept work-item lifecycle changes');
  }
  if (workItem.workflow_state === 'completed') {
    throw new ConflictError('Completed workflows cannot accept work-item lifecycle changes');
  }
  if (workItem.workflow_state === 'failed') {
    throw new ConflictError('Failed workflows cannot accept work-item lifecycle changes');
  }
}

function hasWorkItemPauseRequest(metadata: unknown) {
  return readLifecycleMarker(metadata, 'pause_requested_at') !== null;
}

function hasWorkItemCancelRequest(metadata: unknown) {
  return readLifecycleMarker(metadata, 'cancel_requested_at') !== null;
}

async function enqueueScopedActivationIfRunnable(
  client: DatabaseClient | DatabasePool,
  eventService: EventService,
  identity: ApiKeyIdentity,
  workflowId: string,
  requestId: string,
  eventType: string,
  payload: Record<string, unknown>,
  workflowState: string,
) {
  if (workflowState !== 'pending' && workflowState !== 'active') {
    return;
  }
  await enqueueWorkflowActivationRecord(client, eventService, {
    tenantId: identity.tenantId,
    workflowId,
    requestId,
    reason: eventType,
    eventType,
    payload,
    actorType: identity.scope,
    actorId: identity.keyPrefix,
  });
}
