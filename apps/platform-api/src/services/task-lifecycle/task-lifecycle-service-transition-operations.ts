import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseClient } from '../../db/database.js';
import { ConflictError, ForbiddenError } from '../../errors/domain-errors.js';
import {
  assertValidTransition,
  normalizeTaskState,
  toStoredTaskState,
  type TaskState,
} from '../../orchestration/task-state-machine.js';
import { applyTaskCompletionSideEffects } from '../task-completion-side-effects.js';
import { enqueueAndDispatchImmediatePlaybookActivation } from '../workflow-immediate-activation.js';
import type {
  TaskLifecycleServiceOperationContext,
  TransitionOptions,
} from './task-lifecycle-service-types.js';
import {
  buildWorkflowActivationForTaskTransition,
  normalizeTaskRecord,
  releasesParallelismSlot,
} from './task-lifecycle-service-helpers.js';

export async function applyStateTransition(
  context: TaskLifecycleServiceOperationContext,
  identity: ApiKeyIdentity,
  taskId: string,
  nextState: TaskState,
  options: TransitionOptions,
  existingClient?: DatabaseClient,
): Promise<Record<string, unknown>> {
  const client = existingClient ?? await context.deps.pool.connect();
  const ownsClient = existingClient === undefined;
  try {
    if (ownsClient) {
      await client.query('BEGIN');
    }
    const task = normalizeTaskRecord(
      await context.deps.loadTaskOrThrow(identity.tenantId, taskId, client),
    );

    if (!options.expectedStates.includes(task.state as TaskState)) {
      assertValidTransition(task.id as string, task.state as TaskState, nextState);
    }

    if (
      options.requireAssignment?.agentId &&
      task.assigned_agent_id !== options.requireAssignment.agentId
    ) {
      throw new ForbiddenError('Task is assigned to a different agent');
    }
    if (
      options.requireAssignment?.workerId &&
      task.assigned_worker_id !== options.requireAssignment.workerId
    ) {
      throw new ConflictError('Task is assigned to a different Specialist Agent');
    }

    await context.lockWorkflowRowForTask(identity.tenantId, task, client);

    const resolvedNextState = await context.resolveNextState(
      identity.tenantId,
      task,
      nextState,
      client,
    );
    const updateFragments: string[] = ['state = $3', 'state_changed_at = now()'];
    const values: unknown[] = [identity.tenantId, taskId, toStoredTaskState(resolvedNextState)];

    if (resolvedNextState === 'in_progress') {
      if (options.startedAt) {
        values.push(options.startedAt);
        updateFragments.push(`started_at = $${values.length}`);
      } else {
        updateFragments.push('started_at = now()');
      }
    }

    if (resolvedNextState === 'completed') {
      updateFragments.push('completed_at = now()', 'error = NULL');
    } else if (resolvedNextState === 'escalated') {
      updateFragments.push('completed_at = NULL', 'error = NULL');
    } else {
      updateFragments.push('completed_at = NULL');
    }

    if (options.output !== undefined) {
      values.push(options.output);
      updateFragments.push(`output = $${values.length}`);
    }
    if (options.overrideInput !== undefined) {
      values.push(options.overrideInput);
      updateFragments.push(`input = $${values.length}`);
    }
    if (resolvedNextState === 'failed') {
      values.push(
        options.error ?? {
          category: 'unknown',
          message: options.reason ?? 'failed',
          recoverable: false,
        },
      );
      updateFragments.push(`error = $${values.length}`);
    }
    if (options.metrics !== undefined) {
      values.push(options.metrics);
      updateFragments.push(`metrics = $${values.length}`);
    }
    if (options.gitInfo !== undefined) {
      values.push(options.gitInfo);
      updateFragments.push(`git_info = $${values.length}`);
    }

    const metadataPatch =
      options.verification !== undefined || options.metadataPatch !== undefined
        ? {
            ...(options.verification !== undefined ? { verification: options.verification } : {}),
            ...(options.metadataPatch ?? {}),
          }
        : undefined;

    let metadataExpression = 'metadata';
    if (options.clearLifecycleControlMetadata) {
      metadataExpression =
        "(metadata - 'cancel_signal_requested_at' - 'cancel_force_fail_at' - 'cancel_signal_id' - 'cancel_reason' - 'timeout_cancel_requested_at' - 'timeout_force_fail_at' - 'timeout_signal_id' - 'workflow_cancel_requested_at' - 'workflow_cancel_force_at' - 'workflow_cancel_signal_id')";
    }
    if (options.clearEscalationMetadata) {
      metadataExpression = `${metadataExpression} - 'escalation_status' - 'escalation_task_id'`;
    }
    if (metadataPatch) {
      values.push(metadataPatch);
      metadataExpression = `${metadataExpression} || $${values.length}::jsonb`;
    }
    if (metadataExpression !== 'metadata') {
      updateFragments.push(`metadata = ${metadataExpression}`);
    }

    if (options.retryIncrement) updateFragments.push('retry_count = retry_count + 1');
    if (options.reworkIncrement) updateFragments.push('rework_count = rework_count + 1');
    if (options.clearAssignment) {
      updateFragments.push(
        'assigned_agent_id = NULL',
        'assigned_worker_id = NULL',
        'claimed_at = NULL',
        'started_at = NULL',
      );
    }
    if (options.clearExecutionData) {
      updateFragments.push('output = NULL', 'error = NULL', 'metrics = NULL', 'git_info = NULL');
    }

    const expectedStateParam = `$${values.length + 1}`;
    values.push(options.expectedStates.map(toStoredTaskState));

    const updatedResult = await client.query(
      `UPDATE tasks SET ${updateFragments.join(', ')}
        WHERE tenant_id = $1
          AND id = $2
          AND state = ANY(${expectedStateParam}::task_state[])
      RETURNING *`,
      values,
    );
    if (!updatedResult.rowCount) {
      const latestTask = normalizeTaskRecord(
        await context.deps.loadTaskOrThrow(identity.tenantId, taskId, client),
      );
      if (!options.expectedStates.includes(latestTask.state as TaskState)) {
        assertValidTransition(task.id as string, latestTask.state as TaskState, nextState);
      }
      throw new ConflictError('Task state changed concurrently');
    }

    const updatedTask = normalizeTaskRecord(updatedResult.rows[0] as Record<string, unknown>);

    if (options.clearAssignment && task.assigned_agent_id) {
      await client.query(
        `UPDATE agents
            SET current_task_id = NULL,
                status = (CASE WHEN status = 'inactive' THEN 'inactive' ELSE 'idle' END)::agent_status
          WHERE tenant_id = $1
            AND id = $2`,
        [identity.tenantId, task.assigned_agent_id],
      );
    }

    if (options.clearAssignment && !updatedTask.is_orchestrator_task) {
      await context.deps.executionContainerLeaseService?.releaseForTask(
        identity.tenantId,
        taskId,
        client,
      );
    }

    await context.deps.eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'task.state_changed',
        entityType: 'task',
        entityId: taskId,
        actorType: identity.scope,
        actorId: identity.keyPrefix,
        data: {
          from_state: normalizeTaskState(task.state as string | undefined) ?? task.state,
          to_state: resolvedNextState,
          reason: options.reason,
          feedback: options.metadataPatch?.assessment_feedback ?? undefined,
        },
      },
      client,
    );

    if (resolvedNextState === 'completed' && !updatedTask.is_orchestrator_task) {
      await applyTaskCompletionSideEffects(
        context.deps.eventService,
        context.deps.parallelismService,
        context.deps.workItemContinuityService,
        identity,
        updatedTask,
        client,
        context.deps.activationDispatchService,
        context.deps.logService,
        {
          requestTaskChanges: (nextIdentity, managedTaskId, payload, nextClient) =>
            context.requestTaskChanges(nextIdentity, managedTaskId, payload, nextClient),
          rejectTask: (nextIdentity, managedTaskId, payload, nextClient) =>
            context.rejectTask(nextIdentity, managedTaskId, payload, nextClient),
        },
      );
    }
    if (resolvedNextState === 'output_pending_assessment' && !updatedTask.is_orchestrator_task) {
      await context.deps.workItemContinuityService?.recordTaskCompleted(
        identity.tenantId,
        updatedTask,
        client,
      );
      await context.restoreOpenChildAssessmentWorkItemRouting(
        identity.tenantId,
        updatedTask,
        client,
      );
    }
    if (!updatedTask.is_orchestrator_task && task.workflow_id) {
      const activation = buildWorkflowActivationForTaskTransition(
        taskId,
        task,
        updatedTask,
        resolvedNextState,
        options.reason,
      );
      if (activation) {
        await enqueueAndDispatchImmediatePlaybookActivation(
          client,
          context.deps.eventService,
          context.deps.activationDispatchService,
          {
            tenantId: identity.tenantId,
            workflowId: task.workflow_id as string,
            requestId: activation.requestId,
            reason: activation.reason,
            eventType: activation.eventType,
            payload: activation.payload,
            actorType: 'system',
            actorId: 'task_lifecycle_service',
          },
        );
      }
    }
    if (
      context.deps.finalizeOrchestratorActivation &&
      updatedTask.is_orchestrator_task &&
      (
        resolvedNextState === 'completed' ||
        resolvedNextState === 'failed' ||
        resolvedNextState === 'cancelled' ||
        resolvedNextState === 'escalated'
      )
    ) {
      await context.deps.finalizeOrchestratorActivation(
        identity.tenantId,
        updatedTask,
        resolvedNextState === 'completed'
          ? 'completed'
          : resolvedNextState === 'escalated'
            ? 'escalated'
            : 'failed',
        client,
      );
    }
    if (
      context.deps.parallelismService &&
      !updatedTask.is_orchestrator_task &&
      typeof updatedTask.workflow_id === 'string' &&
      releasesParallelismSlot(task.state as TaskState, resolvedNextState)
    ) {
      await context.deps.parallelismService.releaseQueuedReadyTasks(
        context.deps.eventService,
        identity.tenantId,
        updatedTask.workflow_id,
        client,
      );
    }
    if (options.afterUpdate) {
      await options.afterUpdate(updatedTask, client);
    }
    if (!updatedTask.is_orchestrator_task) {
      await context.reconcileWorkItemExecutionColumn(identity, updatedTask, client);
    }

    if (task.workflow_id) {
      await context.deps.workflowStateService.recomputeWorkflowState(
        identity.tenantId,
        task.workflow_id as string,
        client,
        {
          actorType: 'system',
          actorId: 'task_state_transition',
        },
      );
      if (context.deps.evaluateWorkflowBudget) {
        await context.deps.evaluateWorkflowBudget(
          identity.tenantId,
          task.workflow_id as string,
          client,
        );
      }
    }

    if (ownsClient) {
      await client.query('COMMIT');
    }
    return context.deps.toTaskResponse(updatedTask);
  } catch (error) {
    if (ownsClient) {
      await client.query('ROLLBACK');
    }
    throw error;
  } finally {
    if (ownsClient) {
      client.release();
    }
  }
}

export async function resolveNextState(
  context: TaskLifecycleServiceOperationContext,
  tenantId: string,
  task: Record<string, unknown>,
  requestedState: TaskState,
  client: DatabaseClient,
): Promise<TaskState> {
  if (!context.deps.parallelismService || requestedState !== 'ready') {
    return requestedState;
  }

  const shouldQueue = await context.deps.parallelismService.shouldQueueForCapacity(
    tenantId,
    {
      taskId: String(task.id),
      workflowId: (task.workflow_id as string | null | undefined) ?? null,
      workItemId: (task.work_item_id as string | null | undefined) ?? null,
      isOrchestratorTask: Boolean(task.is_orchestrator_task),
      currentState: task.state as TaskState,
    },
    client,
  );
  if (!shouldQueue) {
    return 'ready';
  }

  if (
    task.state === 'failed' &&
    typeof task.workflow_id === 'string' &&
    typeof context.deps.parallelismService.reclaimReadySlotForTask === 'function' &&
    (await context.deps.parallelismService.reclaimReadySlotForTask(
      context.deps.eventService,
      tenantId,
      {
        taskId: String(task.id),
        workflowId: task.workflow_id,
        workItemId: (task.work_item_id as string | null | undefined) ?? null,
        isOrchestratorTask: Boolean(task.is_orchestrator_task),
        currentState: task.state as TaskState,
      },
      client,
    ))
  ) {
    return 'ready';
  }

  return 'pending';
}

export async function resolveCreatedSpecialistTaskState(
  context: TaskLifecycleServiceOperationContext,
  tenantId: string,
  task: {
    workflow_id?: string | null;
    work_item_id?: string | null;
    is_orchestrator_task?: boolean;
  },
  client: DatabaseClient,
): Promise<'ready' | 'pending'> {
  if (!context.deps.parallelismService) {
    return 'ready';
  }

  const shouldQueue = await context.deps.parallelismService.shouldQueueForCapacity(
    tenantId,
    {
      workflowId: task.workflow_id ?? null,
      workItemId: task.work_item_id ?? null,
      isOrchestratorTask: Boolean(task.is_orchestrator_task),
      currentState: null,
    },
    client,
  );
  return shouldQueue ? 'pending' : 'ready';
}
