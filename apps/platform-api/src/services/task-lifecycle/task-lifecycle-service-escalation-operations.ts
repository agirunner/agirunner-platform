import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseClient } from '../../db/database.js';
import { ConflictError } from '../../errors/domain-errors.js';
import type { TaskLifecycleServiceOperationContext } from './task-lifecycle-service-types.js';
import {
  asRecord,
  DEFAULT_ORCHESTRATOR_ESCALATION_TARGET,
  DEFAULT_ORCHESTRATOR_MAX_ESCALATION_DEPTH,
  hasMatchingAgentEscalation,
  hasMatchingAgentEscalationDepthFailure,
  hasMatchingManualEscalation,
  isCancelledOrCompletedTask,
  normalizeTaskRecord,
} from './task-lifecycle-service-helpers.js';

export async function escalateTask(
  context: TaskLifecycleServiceOperationContext,
  identity: ApiKeyIdentity,
  taskId: string,
  payload: {
    reason: string;
    escalation_target?: string;
    context?: Record<string, unknown>;
    recommendation?: string;
    blocking_task_id?: string;
    urgency?: 'info' | 'important' | 'critical';
  },
  client?: DatabaseClient,
): Promise<Record<string, unknown>> {
  const task = normalizeTaskRecord(
    await context.deps.loadTaskOrThrow(identity.tenantId, taskId, client),
  );
  if (isCancelledOrCompletedTask(task)) {
    return context.deps.toTaskResponse(task);
  }
  if (task.state === 'escalated' && hasMatchingManualEscalation(task, payload)) {
    return context.deps.toTaskResponse(task);
  }

  const existingEscalations = Array.isArray(asRecord(task.metadata).escalations)
    ? (asRecord(task.metadata).escalations as unknown[])
    : [];
  return context.applyStateTransition(identity, taskId, 'escalated', {
    expectedStates: ['claimed', 'in_progress'],
    clearAssignment: true,
    clearLifecycleControlMetadata: true,
    metadataPatch: {
      escalations: [
        ...existingEscalations,
        {
          reason: payload.reason,
          target: payload.escalation_target ?? null,
          context: payload.context ?? null,
          recommendation: payload.recommendation ?? null,
          blocking_task_id: payload.blocking_task_id ?? null,
          urgency: payload.urgency ?? null,
          escalated_at: new Date().toISOString(),
        },
      ],
      escalation_reason: payload.reason,
      escalation_target: payload.escalation_target ?? 'human',
      escalation_context_packet: payload.context ?? null,
      escalation_recommendation: payload.recommendation ?? null,
      escalation_blocking_task_id: payload.blocking_task_id ?? null,
      escalation_urgency: payload.urgency ?? null,
      escalation_awaiting_human: true,
      assessment_action: 'escalate',
      assessment_feedback: payload.reason,
      assessment_updated_at: new Date().toISOString(),
    },
    afterUpdate: async (_updatedTask, db) => {
      await context.maybeOpenTaskWorkItemEscalation(identity.tenantId, task, payload.reason, db);
      await context.enqueuePlaybookActivationIfNeeded(identity, task, 'task.escalated', {
        task_id: taskId,
        task_role: task.role ?? null,
        task_title: task.title ?? null,
        work_item_id: task.work_item_id ?? null,
        stage_name: task.stage_name ?? null,
        escalation_target: payload.escalation_target ?? 'human',
        escalation_reason: payload.reason,
        escalation_context_packet: payload.context ?? null,
        escalation_recommendation: payload.recommendation ?? null,
        escalation_blocking_task_id: payload.blocking_task_id ?? null,
        escalation_urgency: payload.urgency ?? null,
      }, db);
      await context.deps.eventService.emit(
        {
          tenantId: identity.tenantId,
          type: 'task.escalated',
          entityType: 'task',
          entityId: taskId,
          actorType: identity.scope,
          actorId: identity.keyPrefix,
          data: {
            reason: payload.reason,
            escalation_target: payload.escalation_target ?? 'human',
            context: payload.context ?? null,
            recommendation: payload.recommendation ?? null,
            blocking_task_id: payload.blocking_task_id ?? null,
            urgency: payload.urgency ?? null,
          },
        },
        db,
      );
      await context.logGovernanceTransition(
        identity.tenantId,
        'task.escalation.manual',
        task,
        {
          event_type: 'task.escalated',
          escalation_target: payload.escalation_target ?? 'human',
          escalation_reason: payload.reason,
          context: payload.context ?? null,
          recommendation: payload.recommendation ?? null,
          blocking_task_id: payload.blocking_task_id ?? null,
          urgency: payload.urgency ?? null,
        },
        db,
      );
    },
    reason: 'task_escalated',
  }, client);
}

export async function agentEscalate(
  context: TaskLifecycleServiceOperationContext,
  identity: ApiKeyIdentity,
  taskId: string,
  payload: {
    reason: string;
    context_summary?: string;
    work_so_far?: string;
  },
): Promise<Record<string, unknown>> {
  const task = normalizeTaskRecord(await context.deps.loadTaskOrThrow(identity.tenantId, taskId));
  if (isCancelledOrCompletedTask(task)) {
    return context.deps.toTaskResponse(task);
  }

  const roleName = typeof task.role === 'string' ? task.role : '';
  if (!context.deps.getRoleByName) {
    throw new ConflictError('Escalation is not configured: role lookup unavailable');
  }

  const roleDef = await context.deps.getRoleByName(identity.tenantId, roleName);
  const escalationTarget = roleDef?.escalation_target
    ?? (task.is_orchestrator_task === true ? DEFAULT_ORCHESTRATOR_ESCALATION_TARGET : null);
  if (!escalationTarget) {
    throw new ConflictError(`Escalation not configured for role '${roleName}'`);
  }
  if (hasMatchingAgentEscalation(task, escalationTarget, payload)) {
    return context.deps.toTaskResponse(task);
  }

  const metadata = asRecord(task.metadata);
  const currentDepth = typeof metadata.escalation_depth === 'number' ? metadata.escalation_depth : 0;
  const maxDepth = roleDef?.max_escalation_depth ?? DEFAULT_ORCHESTRATOR_MAX_ESCALATION_DEPTH;
  if (hasMatchingAgentEscalationDepthFailure(task, currentDepth, maxDepth)) {
    return context.deps.toTaskResponse(task);
  }
  if (currentDepth >= maxDepth) {
    return context.applyStateTransition(identity, taskId, 'failed', {
      expectedStates: ['in_progress'],
      clearAssignment: true,
      clearLifecycleControlMetadata: true,
      error: {
        category: 'escalation_depth_exceeded',
        message: `Escalation depth ${currentDepth} exceeds maximum ${maxDepth}`,
        recoverable: false,
      },
      metadataPatch: { escalation_depth: currentDepth, escalation_max_depth: maxDepth },
      afterUpdate: async (_updatedTask, db) => {
        await context.deps.eventService.emit(
          {
            tenantId: identity.tenantId,
            type: 'task.escalation_depth_exceeded',
            entityType: 'task',
            entityId: taskId,
            actorType: identity.scope,
            actorId: identity.keyPrefix,
            data: { depth: currentDepth, max_depth: maxDepth },
          },
          db,
        );
      },
      reason: 'escalation_depth_exceeded',
    });
  }

  if (escalationTarget === 'human') {
    return context.applyStateTransition(identity, taskId, 'escalated', {
      expectedStates: ['in_progress'],
      clearAssignment: true,
      clearLifecycleControlMetadata: true,
      metadataPatch: {
        escalation_reason: payload.reason,
        escalation_context: payload.context_summary ?? null,
        escalation_work_so_far: payload.work_so_far ?? null,
        escalation_target: 'human',
        escalation_depth: currentDepth + 1,
        escalation_awaiting_human: true,
      },
      afterUpdate: async (_updatedTask, db) => {
        await emitAgentEscalationSideEffects(
          context,
          identity,
          taskId,
          task,
          roleName,
          payload,
          'human',
          currentDepth + 1,
          db,
        );
      },
      reason: 'agent_escalated',
    });
  }

  return context.applyStateTransition(identity, taskId, 'escalated', {
    expectedStates: ['in_progress'],
    clearAssignment: true,
    clearLifecycleControlMetadata: true,
    metadataPatch: {
      escalation_reason: payload.reason,
      escalation_context: payload.context_summary ?? null,
      escalation_work_so_far: payload.work_so_far ?? null,
      escalation_target: escalationTarget,
      escalation_depth: currentDepth + 1,
    },
    afterUpdate: async (updatedTask, db) => {
      await emitAgentEscalationSideEffects(
        context,
        identity,
        taskId,
        task,
        roleName,
        payload,
        escalationTarget,
        currentDepth + 1,
        db,
      );
      const escalationTask = await context.createEscalationTaskForRole(
        identity,
        updatedTask,
        escalationTarget,
        payload,
        currentDepth + 1,
        db,
      );
      await db.query(
        `UPDATE tasks SET metadata = metadata || $3::jsonb WHERE tenant_id = $1 AND id = $2`,
        [identity.tenantId, taskId, { escalation_task_id: escalationTask.id }],
      );
      await context.deps.eventService.emit(
        {
          tenantId: identity.tenantId,
          type: 'task.escalation_task_created',
          entityType: 'task',
          entityId: taskId,
          actorType: identity.scope,
          actorId: identity.keyPrefix,
          data: {
            escalation_task_id: escalationTask.id,
            target_role: escalationTarget,
            source_task_id: taskId,
            depth: currentDepth + 1,
          },
        },
        db,
      );
      await context.logGovernanceTransition(
        identity.tenantId,
        'task.escalation.task_created',
        task,
        {
          event_type: 'task.escalation_task_created',
          escalation_task_id: escalationTask.id,
          target_role: escalationTarget,
          source_task_id: taskId,
          depth: currentDepth + 1,
        },
        db,
      );
    },
    reason: 'agent_escalated',
  });
}

async function emitAgentEscalationSideEffects(
  context: TaskLifecycleServiceOperationContext,
  identity: ApiKeyIdentity,
  taskId: string,
  task: Record<string, unknown>,
  roleName: string,
  payload: {
    reason: string;
    context_summary?: string;
    work_so_far?: string;
  },
  escalationTarget: string,
  depth: number,
  db: DatabaseClient,
): Promise<void> {
  await context.maybeOpenTaskWorkItemEscalation(identity.tenantId, task, payload.reason, db);
  await context.enqueuePlaybookActivationIfNeeded(identity, task, 'task.agent_escalated', {
    task_id: taskId,
    task_role: task.role ?? null,
    task_title: task.title ?? null,
    work_item_id: task.work_item_id ?? null,
    stage_name: task.stage_name ?? null,
    escalation_target: escalationTarget,
    escalation_reason: payload.reason,
    escalation_context: payload.context_summary ?? null,
  }, db);
  await context.deps.eventService.emit(
    {
      tenantId: identity.tenantId,
      type: 'task.agent_escalated',
      entityType: 'task',
      entityId: taskId,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: {
        reason: payload.reason,
        context_summary: payload.context_summary ?? null,
        source_role: roleName,
        escalation_target: escalationTarget,
        escalation_depth: depth,
      },
    },
    db,
  );
  await context.logGovernanceTransition(
    identity.tenantId,
    'task.escalation.agent',
    task,
    {
      event_type: 'task.agent_escalated',
      escalation_target: escalationTarget,
      escalation_reason: payload.reason,
      context_summary: payload.context_summary ?? null,
      source_role: roleName,
      escalation_depth: depth,
    },
    db,
  );
}
