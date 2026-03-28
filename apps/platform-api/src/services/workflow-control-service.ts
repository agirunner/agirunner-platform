import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { ConflictError, NotFoundError } from '../errors/domain-errors.js';
import { EventService } from './event-service.js';
import { WorkflowStateService } from './workflow-state-service.js';

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
  ) {}

  async pauseWorkflow(identity: ApiKeyIdentity, workflowId: string) {
    const workflow = await this.loadWorkflow(identity.tenantId, workflowId);
    if (workflow.state === 'paused') {
      return workflow;
    }
    if (!isPausableWorkflowState(workflow.state)) {
      throw new ConflictError('Workflow is not pausable');
    }
    const result = await this.pool.query<WorkflowControlRow>(
      `UPDATE workflows
          SET state = 'paused',
              metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
          AND state IN ('pending', 'active')
      RETURNING id, state, metadata`,
      [identity.tenantId, workflowId, { pause_requested_at: new Date().toISOString() }],
    );
    const pausedWorkflow = result.rows[0];
    if (!pausedWorkflow) {
      throw new ConflictError('Workflow is not pausable');
    }

    await this.eventService.emit({
      tenantId: identity.tenantId,
      type: 'workflow.paused',
      entityType: 'workflow',
      entityId: workflowId,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: {},
    });

    return pausedWorkflow;
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
            SET state = 'pending',
                metadata = COALESCE(metadata, '{}'::jsonb) - 'pause_requested_at',
                updated_at = now()
          WHERE tenant_id = $1
            AND id = $2`,
        [identity.tenantId, workflowId],
      );

      const state = await this.stateService.recomputeWorkflowState(identity.tenantId, workflowId, client, {
        actorType: identity.scope,
        actorId: identity.keyPrefix,
      });

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

  private async loadWorkflow(tenantId: string, workflowId: string) {
    const result = await this.pool.query<WorkflowControlRow>(
      'SELECT id, state, metadata FROM workflows WHERE tenant_id = $1 AND id = $2 LIMIT 1',
      [tenantId, workflowId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Workflow not found');
    }
    return result.rows[0];
  }
}

function isPausableWorkflowState(state: string) {
  return state === 'pending' || state === 'active';
}

function isResumedWorkflowState(state: string) {
  return state === 'pending' || state === 'active';
}

function hasPauseRequest(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return false;
  }
  const value = (metadata as Record<string, unknown>).pause_requested_at;
  return typeof value === 'string' && value.trim().length > 0;
}

function hasCancelRequest(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return false;
  }
  const value = (metadata as Record<string, unknown>).cancel_requested_at;
  return typeof value === 'string' && value.trim().length > 0;
}
