import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseClient } from '../../db/database.js';
import { toStoredTaskState } from '../../orchestration/task-state-machine.js';
import {
  TASK_DEFAULT_TIMEOUT_MINUTES_RUNTIME_KEY,
} from '../runtime-default-values.js';
import type { LifecyclePolicy } from '../task-lifecycle-policy.js';
import type { TaskLifecycleServiceOperationContext } from './task-lifecycle-service-types.js';
import {
  asRecord,
  buildEscalationTaskInput,
  normalizeTaskRecord,
  type FailureClassification,
} from './task-lifecycle-service-helpers.js';
import { resolveInheritedTaskTimeoutMinutes as resolveInheritedTimeout } from './task-lifecycle-escalation-helpers.js';

export async function maybeResolveEscalationSource(
  context: TaskLifecycleServiceOperationContext,
  identity: ApiKeyIdentity,
  completedTask: Record<string, unknown>,
  client: DatabaseClient,
): Promise<void> {
  const metadata = asRecord(completedTask.metadata);
  const sourceTaskId = metadata.escalation_source_task_id;
  if (typeof sourceTaskId !== 'string') {
    return;
  }

  const sourceTaskRes = await client.query(
    'SELECT * FROM tasks WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
    [identity.tenantId, sourceTaskId],
  );
  if (!sourceTaskRes.rowCount) {
    return;
  }

  const sourceTask = normalizeTaskRecord(sourceTaskRes.rows[0] as Record<string, unknown>);
  if (sourceTask.state !== 'escalated') {
    return;
  }

  const nextInput = {
    ...asRecord(sourceTask.input),
    escalation_resolution: {
      resolved_by_role: completedTask.role,
      resolved_by_task_id: completedTask.id,
      instructions: completedTask.output,
      resolved_at: new Date().toISOString(),
    },
  };
  const reopenedState = await context.resolveNextState(
    identity.tenantId,
    sourceTask,
    'ready',
    client,
  );

  await client.query(
    `UPDATE tasks
        SET state = $4::task_state,
            state_changed_at = now(),
            input = $3::jsonb,
            assigned_agent_id = NULL,
            assigned_worker_id = NULL,
            claimed_at = NULL,
            started_at = NULL,
            output = NULL,
            error = NULL,
            metrics = NULL,
            git_info = NULL
      WHERE tenant_id = $1
        AND id = $2`,
    [identity.tenantId, sourceTaskId, nextInput, toStoredTaskState(reopenedState)],
  );
  await context.maybeResolveTaskWorkItemEscalation(
    identity.tenantId,
    sourceTask,
    'unblock_subject',
    null,
    'task',
    String(completedTask.id),
    client,
  );

  await context.deps.eventService.emit(
    {
      tenantId: identity.tenantId,
      type: 'task.state_changed',
      entityType: 'task',
      entityId: sourceTaskId,
      actorType: 'system',
      actorId: 'smart_escalation',
      data: {
        from_state: 'escalated',
        to_state: reopenedState,
        reason: 'escalation_resolved',
      },
    },
    client,
  );
  await context.deps.eventService.emit(
    {
      tenantId: identity.tenantId,
      type: 'task.escalation_resolved',
      entityType: 'task',
      entityId: sourceTaskId,
      actorType: 'system',
      actorId: 'smart_escalation',
      data: {
        resolved_by: completedTask.role,
        escalation_task_id: completedTask.id,
        resolution_preview: typeof completedTask.output === 'string'
          ? completedTask.output.slice(0, 200)
          : JSON.stringify(completedTask.output).slice(0, 200),
      },
    },
    client,
  );
}

export async function createEscalationTaskForRole(
  context: TaskLifecycleServiceOperationContext,
  identity: ApiKeyIdentity,
  sourceTask: Record<string, unknown>,
  targetRole: string,
  escalationContext: {
    reason: string;
    context_summary?: string;
    work_so_far?: string;
  },
  depth: number,
  client: DatabaseClient,
): Promise<Record<string, unknown>> {
  const initialState = await context.resolveCreatedSpecialistTaskState(
    identity.tenantId,
    {
      workflow_id: (sourceTask.workflow_id as string | null | undefined) ?? null,
      work_item_id: (sourceTask.work_item_id as string | null | undefined) ?? null,
      is_orchestrator_task: false,
    },
    client,
  );
  const escalationInsert = await client.query(
    `INSERT INTO tasks (
       tenant_id, workflow_id, work_item_id, workspace_id, title, role, stage_name, priority, state, depends_on,
       input, context, role_config, environment,
       resource_bindings, timeout_minutes, token_budget, cost_cap_usd, auto_retry, max_retries, metadata
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,'high',$8::task_state,$9::uuid[],$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
     )
     RETURNING *`,
    [
      identity.tenantId,
      sourceTask.workflow_id ?? null,
      sourceTask.work_item_id ?? null,
      sourceTask.workspace_id ?? null,
      `Escalation: ${String(sourceTask.title ?? 'task')}`,
      targetRole,
      sourceTask.stage_name ?? null,
      initialState,
      [],
      {
        escalation: true,
        source_task_id: sourceTask.id,
        source_task_title: sourceTask.title,
        source_task_role: sourceTask.role,
        reason: escalationContext.reason,
        context_summary: escalationContext.context_summary ?? null,
        work_so_far: escalationContext.work_so_far ?? null,
        original_instructions: asRecord(sourceTask.input).instructions ?? null,
      },
      { escalation: true },
      null,
      null,
      [],
      await context.resolveInheritedTaskTimeoutMinutes(
        identity.tenantId,
        sourceTask.timeout_minutes,
        client,
      ),
      null,
      null,
      false,
      0,
      {
        escalation_source_task_id: sourceTask.id,
        escalation_depth: depth,
      },
    ],
  );
  const escalationTask = escalationInsert.rows[0] as Record<string, unknown>;

  await context.deps.eventService.emit(
    {
      tenantId: identity.tenantId,
      type: 'task.created',
      entityType: 'task',
      entityId: String(escalationTask.id),
      actorType: 'system',
      actorId: 'smart_escalation',
      data: { state: initialState },
    },
    client,
  );

  return escalationTask;
}

export async function maybeCreateEscalationTask(
  context: TaskLifecycleServiceOperationContext,
  identity: ApiKeyIdentity,
  task: Record<string, unknown>,
  lifecyclePolicy: LifecyclePolicy | undefined,
  failure: FailureClassification,
  client: DatabaseClient,
): Promise<void> {
  const escalation = lifecyclePolicy?.escalation;
  if (!escalation?.enabled) {
    return;
  }
  if (asRecord(task.metadata).escalation_source_task_id) {
    return;
  }
  if (asRecord(task.metadata).escalation_status === 'pending') {
    return;
  }

  const escalationTaskInput = buildEscalationTaskInput(task, escalation, failure);
  const initialState = await context.resolveCreatedSpecialistTaskState(
    identity.tenantId,
    {
      workflow_id: (escalationTaskInput.workflow_id as string | null | undefined) ?? null,
      work_item_id: (escalationTaskInput.work_item_id as string | null | undefined) ?? null,
      is_orchestrator_task: false,
    },
    client,
  );
  const escalationInsert = await client.query(
    `INSERT INTO tasks (
       tenant_id, workflow_id, work_item_id, workspace_id, title, role, stage_name, priority, state, depends_on,
       input, context, role_config, environment,
       resource_bindings, timeout_minutes, token_budget, cost_cap_usd, auto_retry, max_retries, metadata
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9::task_state,$10::uuid[],$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
     )
     RETURNING *`,
    [
      identity.tenantId,
      escalationTaskInput.workflow_id ?? null,
      escalationTaskInput.work_item_id ?? null,
      escalationTaskInput.workspace_id ?? null,
      escalationTaskInput.title,
      escalationTaskInput.role ?? null,
      escalationTaskInput.stage_name ?? null,
      escalationTaskInput.priority ?? 'normal',
      initialState,
      [],
      escalationTaskInput.input ?? {},
      escalationTaskInput.context ?? {},
      escalationTaskInput.role_config ?? null,
      null,
      [],
      await context.resolveInheritedTaskTimeoutMinutes(
        identity.tenantId,
        task.timeout_minutes,
        client,
      ),
      null,
      null,
      false,
      0,
      escalationTaskInput.metadata ?? {},
    ],
  );
  const escalationTask = escalationInsert.rows[0] as Record<string, unknown>;

  await context.deps.eventService.emit(
    {
      tenantId: identity.tenantId,
      type: 'task.created',
      entityType: 'task',
      entityId: String(escalationTask.id),
      actorType: 'system',
      actorId: 'lifecycle_policy',
      data: { state: initialState },
    },
    client,
  );
  await client.query(
    `UPDATE tasks
        SET metadata = metadata || $3::jsonb
      WHERE tenant_id = $1
        AND id = $2`,
    [
      identity.tenantId,
      task.id,
      {
        escalation_status: 'pending',
        escalation_task_id: escalationTask.id,
      },
    ],
  );
  await context.deps.eventService.emit(
    {
      tenantId: identity.tenantId,
      type: 'task.escalated',
      entityType: 'task',
      entityId: String(task.id),
      actorType: 'system',
      actorId: 'lifecycle_policy',
      data: {
        escalation_task_id: escalationTask.id,
        failure,
        role: escalation.role,
      },
    },
    client,
  );
  await context.deps.eventService.emit(
    {
      tenantId: identity.tenantId,
      type: 'task.escalation',
      entityType: 'task',
      entityId: String(task.id),
      actorType: 'system',
      actorId: 'lifecycle_policy',
      data: {
        escalation_task_id: escalationTask.id,
        failure,
        role: escalation.role,
      },
    },
    client,
  );
  await context.logGovernanceTransition(
    identity.tenantId,
    'task.escalation.policy',
    task,
    {
      event_type: 'task.escalation',
      escalation_task_id: escalationTask.id,
      failure,
      role: escalation.role,
    },
    client,
  );
}

export async function resolveInheritedTaskTimeoutMinutes(
  context: TaskLifecycleServiceOperationContext,
  tenantId: string,
  explicitValue: unknown,
  client: DatabaseClient,
): Promise<number> {
  return resolveInheritedTimeout({
    tenantId,
    explicitValue,
    client,
    defaultTaskTimeoutMinutes: context.deps.defaultTaskTimeoutMinutes,
    runtimeDefaultKey: TASK_DEFAULT_TIMEOUT_MINUTES_RUNTIME_KEY,
  });
}
