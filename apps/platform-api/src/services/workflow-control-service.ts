import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { ConflictError, NotFoundError } from '../errors/domain-errors.js';
import {
  activateNextWorkflowPhase,
  assertManualPhaseGateReady,
  assertPhaseCancelable,
  deriveWorkflowView,
  getWorkflowPhaseOrThrow,
  readStoredWorkflow,
  readWorkflowRuntimeState,
  type WorkflowGateDecision,
} from '../orchestration/workflow-runtime.js';
import { EventService } from './event-service.js';
import { WorkflowStateService } from './workflow-state-service.js';

export class WorkflowControlService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly eventService: EventService,
    private readonly stateService: WorkflowStateService,
  ) {}

  async pauseWorkflow(identity: ApiKeyIdentity, workflowId: string) {
    const result = await this.pool.query(
      `UPDATE workflows
       SET state = 'paused', updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND state IN ('pending', 'active')
       RETURNING *`,
      [identity.tenantId, workflowId],
    );

    if (!result.rowCount) {
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

    return result.rows[0];
  }

  async resumeWorkflow(identity: ApiKeyIdentity, workflowId: string) {
    const exists = await this.pool.query('SELECT id FROM workflows WHERE tenant_id = $1 AND id = $2', [
      identity.tenantId,
      workflowId,
    ]);
    if (!exists.rowCount) {
      throw new NotFoundError('Workflow not found');
    }

    const state = await this.stateService.recomputeWorkflowState(identity.tenantId, workflowId, undefined, {
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
    });

    return { id: workflowId, state };
  }

  async manualReworkWorkflow(identity: ApiKeyIdentity, workflowId: string, feedback: string) {
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
         AND workflow_id = $2
         AND state IN ('failed', 'completed', 'output_pending_review', 'cancelled')
       RETURNING id`,
      [
        identity.tenantId,
        workflowId,
        {
          review_action: 'manual_rework',
          review_feedback: feedback,
          review_updated_at: new Date().toISOString(),
        },
      ],
    );

    const state = await this.stateService.recomputeWorkflowState(identity.tenantId, workflowId, undefined, {
      actorType: identity.scope,
      actorId: identity.keyPrefix,
    });

    await this.eventService.emit({
      tenantId: identity.tenantId,
      type: 'workflow.manual_rework',
      entityType: 'workflow',
      entityId: workflowId,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: { updated_tasks: result.rowCount, feedback },
    });

    return { id: workflowId, updated_tasks: result.rowCount, state };
  }

  async actOnPhaseGate(
    identity: ApiKeyIdentity,
    workflowId: string,
    phaseName: string,
    payload: {
      action: 'approve' | 'reject' | 'request_changes';
      feedback?: string;
      override_input?: Record<string, unknown>;
    },
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const workflowResult = await client.query(
        'SELECT * FROM workflows WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
        [identity.tenantId, workflowId],
      );
      if (!workflowResult.rowCount) {
        throw new NotFoundError('Workflow not found');
      }

      const workflowRow = workflowResult.rows[0] as Record<string, unknown>;
      const metadata = asRecord(workflowRow.metadata);
      const workflowDef = readStoredWorkflow(metadata.workflow);
      if (!workflowDef) {
        throw new ConflictError('Workflow does not define workflow phases');
      }
      const runtimeState = readWorkflowRuntimeState(metadata.workflow_runtime);
      const tasksResult = await client.query(
        'SELECT * FROM tasks WHERE tenant_id = $1 AND workflow_id = $2 ORDER BY created_at ASC',
        [identity.tenantId, workflowId],
      );
      const tasks = tasksResult.rows.map((row) => row as Record<string, unknown>);

      assertManualPhaseGateReady({ workflow: workflowDef, phaseName, tasks, runtimeState });
      const phase = getWorkflowPhaseOrThrow(workflowDef, phaseName);
      const gateDecision: WorkflowGateDecision = {
        status: payload.action === 'approve' ? 'approved' : 'rejected',
        action: payload.action,
        ...(payload.feedback ? { feedback: payload.feedback } : {}),
        acted_at: new Date().toISOString(),
        acted_by: identity.keyPrefix,
      };
      let nextRuntimeState = runtimeState;

      if (payload.action === 'approve') {
        nextRuntimeState = {
          ...runtimeState,
          phase_gates: {
            ...(runtimeState.phase_gates ?? {}),
            [phase.name]: gateDecision,
          },
        };
        await client.query(
          `UPDATE workflows
              SET metadata = metadata || $3::jsonb,
                  updated_at = now()
            WHERE tenant_id = $1
              AND id = $2`,
          [identity.tenantId, workflowId, { workflow_runtime: nextRuntimeState }],
        );

        const activation = await activateNextWorkflowPhase({
          tenantId: identity.tenantId,
          workflowId,
          workflow: workflowDef,
          currentPhaseName: phase.name,
          tasks,
          client,
        });
        for (const task of tasks) {
          if (task.state !== 'ready' && task.state !== 'awaiting_approval') {
            continue;
          }
          await this.eventService.emit(
            {
              tenantId: identity.tenantId,
              type: 'task.state_changed',
              entityType: 'task',
              entityId: String(task.id),
              actorType: 'system',
              actorId: 'phase_gate',
              data: { from_state: 'pending', to_state: String(task.state) },
            },
            client,
          );
        }
        if (activation.activated && activation.phaseName) {
          await this.eventService.emit(
            {
              tenantId: identity.tenantId,
              type: 'phase.started',
              entityType: 'workflow',
              entityId: workflowId,
              actorType: identity.scope,
              actorId: identity.keyPrefix,
              data: {
                workflow_id: workflowId,
                phase_name: activation.phaseName,
                timestamp: new Date().toISOString(),
              },
            },
            client,
          );
        }
      }
      if (payload.action === 'request_changes') {
        const phaseTasks = tasks.filter((task) => phase.task_ids.includes(String(task.id)));
        for (const task of phaseTasks) {
          const currentInput = asRecord(task.input);
          const clarificationHistory = Array.isArray(currentInput.clarification_history)
            ? [...(currentInput.clarification_history as unknown[])]
            : [];
          const overrideInput = payload.override_input ?? {};
          const overrideClarificationAnswers = asRecord(overrideInput.clarification_answers);
          clarificationHistory.push({
            feedback: payload.feedback ?? 'Clarification requested',
            answers: overrideInput,
            answered_at: new Date().toISOString(),
            answered_by: identity.keyPrefix,
          });
          const nextInput = {
            ...currentInput,
            ...overrideInput,
            clarification_answers: {
              ...(asRecord(currentInput.clarification_answers)),
              ...overrideClarificationAnswers,
            },
            clarification_history: clarificationHistory,
          };

          await client.query(
            `UPDATE tasks
                SET state = 'ready',
                    state_changed_at = now(),
                    assigned_agent_id = NULL,
                    assigned_worker_id = NULL,
                    claimed_at = NULL,
                    started_at = NULL,
                    completed_at = NULL,
                    output = NULL,
                    error = NULL,
                    metrics = NULL,
                    git_info = NULL,
                    retry_count = retry_count + 1,
                    rework_count = rework_count + 1,
                    input = $3::jsonb,
                    metadata = (metadata - 'escalation_status' - 'escalation_task_id') || $4::jsonb
              WHERE tenant_id = $1
                AND id = $2`,
            [
              identity.tenantId,
              task.id,
              nextInput,
              {
                review_action: 'request_changes',
                review_feedback: payload.feedback ?? 'Clarification requested',
                review_updated_at: new Date().toISOString(),
                clarification_requested: true,
              },
            ],
          );
          task.state = 'ready';
          task.input = nextInput;

          await this.eventService.emit(
            {
              tenantId: identity.tenantId,
              type: 'task.state_changed',
              entityType: 'task',
              entityId: String(task.id),
              actorType: identity.scope,
              actorId: identity.keyPrefix,
              data: { from_state: 'completed', to_state: 'ready' },
            },
            client,
          );
        }
      }
      if (payload.action === 'reject') {
        nextRuntimeState = {
          ...runtimeState,
          phase_gates: {
            ...(runtimeState.phase_gates ?? {}),
            [phase.name]: gateDecision,
          },
        };
        await client.query(
          `UPDATE workflows
              SET metadata = metadata || $3::jsonb,
                  updated_at = now()
            WHERE tenant_id = $1
              AND id = $2`,
          [identity.tenantId, workflowId, { workflow_runtime: nextRuntimeState }],
        );
      }

      await this.eventService.emit(
        {
          tenantId: identity.tenantId,
          type:
            payload.action === 'approve'
              ? 'phase.gate.approved'
              : payload.action === 'reject'
                ? 'phase.gate.rejected'
                : 'phase.gate.request_changes',
          entityType: 'workflow',
          entityId: workflowId,
          actorType: identity.scope,
          actorId: identity.keyPrefix,
          data: {
            workflow_id: workflowId,
            phase_name: phase.name,
            action: payload.action,
            ...(payload.feedback ? { feedback: payload.feedback } : {}),
            timestamp: new Date().toISOString(),
          },
        },
        client,
      );

      const state = await this.stateService.recomputeWorkflowState(identity.tenantId, workflowId, client, {
        actorType: identity.scope,
        actorId: identity.keyPrefix,
      });
      await client.query('COMMIT');
      return {
        id: workflowId,
        state,
        ...deriveWorkflowView(workflowDef, tasks, nextRuntimeState),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async cancelPhase(identity: ApiKeyIdentity, workflowId: string, phaseName: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const workflowResult = await client.query(
        'SELECT * FROM workflows WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
        [identity.tenantId, workflowId],
      );
      if (!workflowResult.rowCount) {
        throw new NotFoundError('Workflow not found');
      }
      const workflowRow = workflowResult.rows[0] as Record<string, unknown>;
      const metadata = asRecord(workflowRow.metadata);
      const workflowDef = readStoredWorkflow(metadata.workflow);
      if (!workflowDef) {
        throw new ConflictError('Workflow does not define workflow phases');
      }

      const phasesToCancel = assertPhaseCancelable(workflowDef, phaseName);
      const taskIds = phasesToCancel.flatMap((phase) => phase.task_ids);
      if (taskIds.length > 0) {
        await client.query(
          `UPDATE tasks
              SET state = 'cancelled',
                  state_changed_at = now(),
                  assigned_agent_id = NULL,
                  assigned_worker_id = NULL,
                  claimed_at = NULL,
                  started_at = NULL
            WHERE tenant_id = $1
              AND id = ANY($2::uuid[])
              AND state NOT IN ('completed', 'failed', 'cancelled')`,
          [identity.tenantId, taskIds],
        );
      }

      for (const phase of phasesToCancel) {
        await this.eventService.emit(
          {
            tenantId: identity.tenantId,
            type: 'phase.cancelled',
            entityType: 'workflow',
            entityId: workflowId,
            actorType: identity.scope,
            actorId: identity.keyPrefix,
            data: {
              workflow_id: workflowId,
              phase_name: phase.name,
              timestamp: new Date().toISOString(),
            },
          },
          client,
        );
      }

      const state = await this.stateService.recomputeWorkflowState(identity.tenantId, workflowId, client, {
        actorType: identity.scope,
        actorId: identity.keyPrefix,
      });
      const refreshedTasksResult = await client.query(
        'SELECT * FROM tasks WHERE tenant_id = $1 AND workflow_id = $2 ORDER BY created_at ASC',
        [identity.tenantId, workflowId],
      );
      const refreshedTasks = refreshedTasksResult.rows.map((row) => row as Record<string, unknown>);
      await client.query('COMMIT');
      return {
        id: workflowId,
        state,
        ...deriveWorkflowView(workflowDef, refreshedTasks, readWorkflowRuntimeState(metadata.workflow_runtime)),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
