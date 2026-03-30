import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { ConflictError, NotFoundError } from '../errors/domain-errors.js';
import { EventService } from './event-service.js';
import { WorkflowStateService } from './workflow-state-service.js';
import type { WorkerConnectionHub } from './worker-connection-hub.js';
import { stopWorkflowBoundExecution } from './workflow-execution-stop-service.js';

interface WorkflowCancellationDeps {
  pool: DatabasePool;
  eventService: EventService;
  stateService: WorkflowStateService;
  resolveCancelSignalGracePeriodMs: (tenantId: string) => Promise<number>;
  workerConnectionHub?: WorkerConnectionHub;
  getWorkflow: (tenantId: string, workflowId: string) => Promise<Record<string, unknown>>;
}

export class WorkflowCancellationService {
  constructor(private readonly deps: WorkflowCancellationDeps) {}

  async cancelWorkflow(identity: ApiKeyIdentity, workflowId: string) {
    const client = await this.deps.pool.connect();
    try {
      await client.query('BEGIN');

      const workflowRes = await client.query(
        'SELECT id, state, metadata, lifecycle FROM workflows WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
        [identity.tenantId, workflowId],
      );
      if (!workflowRes.rowCount) throw new NotFoundError('Workflow not found');

      const workflow = workflowRes.rows[0];
      if (workflow.state === 'completed' || workflow.state === 'failed' || workflow.state === 'cancelled') {
        throw new ConflictError('Workflow is already terminal');
      }
      if (hasCancellationRequest(workflow.metadata)) {
        await client.query('COMMIT');
        return this.deps.getWorkflow(identity.tenantId, workflowId);
      }
      if (!isCancellableWorkflowState(workflow.state)) {
        throw new ConflictError('Only active or paused workflows can be cancelled');
      }

      await client.query(
        `UPDATE workflow_stage_gates
            SET status = 'rejected',
                decision_feedback = COALESCE(decision_feedback, 'Workflow cancelled by operator.'),
                decided_by_type = COALESCE(decided_by_type, $3),
                decided_by_id = COALESCE(decided_by_id, $4),
                decided_at = COALESCE(decided_at, now()),
                updated_at = now()
          WHERE tenant_id = $1
            AND workflow_id = $2
            AND status = 'awaiting_approval'`,
        [identity.tenantId, workflowId, identity.scope, identity.keyPrefix],
      );

      await this.updateWorkflowStageCancellationPosture(client, workflow, identity.tenantId, workflowId);

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
          summary: 'Workflow cancelled by operator.',
          signalReason: 'manual_cancel',
          disposition: 'cancel',
          actorType: identity.scope,
          actorId: identity.keyPrefix,
        },
      );
      await clearStoppedRuntimeHeartbeatTasks(client, identity.tenantId, stopResult.activeTaskIds);

      await client.query(
        `UPDATE workflows
            SET metadata = (COALESCE(metadata, '{}'::jsonb) - 'pause_requested_at') || $3::jsonb,
                updated_at = now()
          WHERE tenant_id = $1
            AND id = $2`,
        [
          identity.tenantId,
          workflowId,
          {
            cancel_requested_at: new Date().toISOString(),
          },
        ],
      );

      const state = await this.deps.stateService.recomputeWorkflowState(identity.tenantId, workflowId, client, {
        actorType: identity.scope,
        actorId: identity.keyPrefix,
      });

      await this.deps.eventService.emit(
        {
          tenantId: identity.tenantId,
          type: 'workflow.cancellation_requested',
          entityType: 'workflow',
          entityId: workflowId,
          actorType: identity.scope,
          actorId: identity.keyPrefix,
          data: {
            cancelled_tasks: stopResult.cancelledTaskIds.length,
            signalled_tasks: stopResult.signalledTaskCount,
            cancelled_activations: stopResult.cancelledActivationCount,
          },
        },
        client,
      );

      await client.query('COMMIT');
      const workflowResult = await this.deps.getWorkflow(identity.tenantId, workflowId);
      return { ...workflowResult, state };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async updateWorkflowStageCancellationPosture(
    client: { query: DatabasePool['query'] },
    workflow: Record<string, unknown>,
    tenantId: string,
    workflowId: string,
  ) {
    if (workflow.lifecycle === 'ongoing') {
      await client.query(
        `UPDATE workflow_stages
            SET gate_status = CASE
                  WHEN gate_status = 'awaiting_approval' THEN 'rejected'
                  ELSE gate_status
                END,
                updated_at = now()
          WHERE tenant_id = $1
            AND workflow_id = $2
            AND gate_status = 'awaiting_approval'`,
        [tenantId, workflowId],
      );
      return;
    }

    await client.query(
      `UPDATE workflow_stages
          SET gate_status = CASE
                WHEN gate_status = 'awaiting_approval' THEN 'rejected'
                ELSE gate_status
              END,
              status = CASE
                WHEN status = 'awaiting_gate' THEN 'blocked'
                ELSE status
              END,
              updated_at = now()
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND gate_status = 'awaiting_approval'`,
      [tenantId, workflowId],
    );
  }
}

function hasCancellationRequest(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return false;
  }
  const value = (metadata as Record<string, unknown>).cancel_requested_at;
  return typeof value === 'string' && value.trim().length > 0;
}

function isCancellableWorkflowState(state: unknown) {
  return state === 'pending' || state === 'active' || state === 'paused';
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
