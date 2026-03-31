import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { ApiKeyIdentity } from '../../../auth/api-key.js';
import type { DatabaseClient } from '../../../db/database.js';
import {
  NotFoundError,
  SchemaValidationFailedError,
  ValidationError,
} from '../../../errors/domain-errors.js';
import {
  buildRecoverableMutationResult,
  type GuidedClosureStateSnapshot,
} from '../../../services/guided-closure/types.js';
import {
  PLATFORM_CONTROL_PLANE_NOT_READY_NOOP_RECOVERY_ID,
  mustGetSafetynetEntry,
} from '../../../services/safetynet/registry.js';
import type { ActiveOrchestratorTaskScope } from '../../../services/task/task-agent-scope-service.js';
import { WorkflowToolResultService } from '../../../services/workflow-tool-result-service.js';

import { orchestratorContinuityWriteSchema } from './schemas.js';

const uuidParamSchema = z.string().uuid();
const workItemIdParamSchema = uuidParamSchema;
export const NOT_READY_NOOP_RECOVERY_SAFETYNET = mustGetSafetynetEntry(
  PLATFORM_CONTROL_PLANE_NOT_READY_NOOP_RECOVERY_ID,
);

export function isRecoverableNotAppliedResult(value: Record<string, unknown>): boolean {
  return value.mutation_outcome === 'recoverable_not_applied';
}

export function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

export function parseWorkItemIdOrThrow(value: string): string {
  const parsed = workItemIdParamSchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError('work_item_id must be a valid uuid');
  }
  return parsed.data;
}

export function parseUuidParamOrThrow(value: string, label: string): string {
  const parsed = uuidParamSchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(`${label} must be a valid uuid`);
  }
  return parsed.data;
}

export function normalizeUUIDList(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return [
    ...new Set(
      values
        .map((value) => uuidParamSchema.safeParse(value))
        .filter((parsed): parsed is z.SafeParseSuccess<string> => parsed.success)
        .map((parsed) => parsed.data),
    ),
  ];
}

export function buildRecoverableGuidedNoop(input: {
  reasonCode: string;
  safetynetBehaviorId?: string;
  stateSnapshot: GuidedClosureStateSnapshot;
  suggestedNextActions: Array<{
    action_code: string;
    target_type: string;
    target_id: string;
    why: string;
    requires_orchestrator_judgment: boolean;
  }>;
  suggestedTargetIds: {
    workflow_id: string;
    work_item_id?: string | null;
    task_id?: string | null;
  };
}) {
  const response = buildRecoverableMutationResult({
    recovery_class: input.reasonCode,
    blocking: false,
    reason_code: input.reasonCode,
    state_snapshot: input.stateSnapshot,
    suggested_next_actions: input.suggestedNextActions,
    suggested_target_ids: input.suggestedTargetIds,
    callout_recommendations: [],
    closure_still_possible: true,
  });
  if (!input.safetynetBehaviorId) {
    return response;
  }
  return {
    ...response,
    safetynet_behavior_id: input.safetynetBehaviorId,
  };
}

export function buildRecoverableApproveTaskNoop(
  taskScope: ActiveOrchestratorTaskScope,
  managedTask: Record<string, unknown>,
) {
  const taskState = readString(managedTask.state);
  if (!taskState || taskState === 'awaiting_approval') {
    return null;
  }

  return buildRecoverableGuidedNoop({
    reasonCode: 'task_not_awaiting_approval',
    safetynetBehaviorId: NOT_READY_NOOP_RECOVERY_SAFETYNET.id,
    stateSnapshot: {
      workflow_id: taskScope.workflow_id,
      work_item_id: readString(managedTask.work_item_id) ?? taskScope.work_item_id ?? null,
      task_id: readString(managedTask.id) ?? null,
      current_stage: readString(managedTask.stage_name) ?? taskScope.stage_name ?? null,
      active_blocking_controls: [],
      active_advisory_controls: [],
    },
    suggestedNextActions: [
      {
        action_code: 'inspect_task_state',
        target_type: 'task',
        target_id: readString(managedTask.id) ?? taskScope.id,
        why: 'The task is no longer waiting for approval.',
        requires_orchestrator_judgment: false,
      },
      {
        action_code: 'continue_current_cycle',
        target_type: readString(managedTask.work_item_id) ? 'work_item' : 'workflow',
        target_id: readString(managedTask.work_item_id) ?? taskScope.workflow_id,
        why: 'Route from the canonical task state instead of replaying a stale approval.',
        requires_orchestrator_judgment: true,
      },
    ],
    suggestedTargetIds: {
      workflow_id: taskScope.workflow_id,
      work_item_id: readString(managedTask.work_item_id) ?? taskScope.work_item_id ?? null,
      task_id: readString(managedTask.id) ?? null,
    },
  });
}

export function buildRecoverableMissingManagedTaskNoop(
  taskScope: ActiveOrchestratorTaskScope,
  managedTaskId: string,
) {
  const recoveryTargetId = taskScope.work_item_id ?? taskScope.workflow_id;
  const recoveryTargetType = taskScope.work_item_id ? 'work_item' : 'workflow';

  return buildRecoverableGuidedNoop({
    reasonCode: 'managed_task_not_found',
    stateSnapshot: {
      workflow_id: taskScope.workflow_id,
      work_item_id: taskScope.work_item_id ?? null,
      task_id: managedTaskId,
      current_stage: taskScope.stage_name ?? null,
      active_blocking_controls: [],
      active_advisory_controls: [],
    },
    suggestedNextActions: [
      {
        action_code: 'inspect_current_cycle',
        target_type: recoveryTargetType,
        target_id: recoveryTargetId,
        why: 'The referenced specialist task is no longer present in the workflow state.',
        requires_orchestrator_judgment: false,
      },
      {
        action_code: 'reroute_from_current_state',
        target_type: recoveryTargetType,
        target_id: recoveryTargetId,
        why: 'Re-read the canonical workflow state before issuing another managed-task control action.',
        requires_orchestrator_judgment: true,
      },
    ],
    suggestedTargetIds: {
      workflow_id: taskScope.workflow_id,
      work_item_id: taskScope.work_item_id ?? null,
      task_id: managedTaskId,
    },
  });
}

export async function resolveContinuityWorkItemId(
  app: FastifyInstance,
  tenantId: string,
  taskScope: ActiveOrchestratorTaskScope,
  body: z.infer<typeof orchestratorContinuityWriteSchema>,
): Promise<string> {
  if (body.work_item_id) {
    return body.work_item_id;
  }
  if (taskScope.work_item_id) {
    return taskScope.work_item_id;
  }

  const subordinateTaskIds = normalizeUUIDList(body.active_subordinate_tasks);
  if (subordinateTaskIds.length > 0) {
    const result = await app.pgPool.query<{ work_item_id: string }>(
      `SELECT DISTINCT work_item_id
         FROM tasks
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = ANY($3::uuid[])
          AND work_item_id IS NOT NULL`,
      [tenantId, taskScope.workflow_id, subordinateTaskIds],
    );
    const resolvedCount = result.rowCount ?? result.rows.length;
    if (resolvedCount === 1) {
      return result.rows[0].work_item_id;
    }
    if (resolvedCount > 1) {
      throw new ValidationError(
        'This continuity update spans multiple work items; specify work_item_id explicitly',
        {
          recovery_hint: 'skip_optional_continuity_write',
          reason_code: 'ambiguous_work_item_scope',
        },
      );
    }
  }

  throw new ValidationError('This task is not linked to a work item');
}

export async function runIdempotentMutation<T extends Record<string, unknown>>(
  app: FastifyInstance,
  toolResultService: WorkflowToolResultService,
  tenantId: string,
  workflowId: string,
  toolName: string,
  requestId: string | undefined,
  run: (client: DatabaseClient) => Promise<T>,
): Promise<T> {
  const normalizedRequestId = requestId?.trim();
  if (!normalizedRequestId) {
    const client = await app.pgPool.connect();
    try {
      await client.query('BEGIN');
      const response = await run(client);
      await client.query('COMMIT');
      return response;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  const client = await app.pgPool.connect();
  try {
    await client.query('BEGIN');
    await toolResultService.lockRequest(
      tenantId,
      workflowId,
      toolName,
      normalizedRequestId,
      client,
    );
    const existing = await toolResultService.getResult(
      tenantId,
      workflowId,
      toolName,
      normalizedRequestId,
      client,
    );
    if (existing) {
      await client.query('COMMIT');
      return existing as T;
    }
    const response = await run(client);
    const stored = await toolResultService.storeResult(
      tenantId,
      workflowId,
      toolName,
      normalizedRequestId,
      response,
      client,
    );
    await client.query('COMMIT');
    return stored as T;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function loadManagedSpecialistTask(
  app: FastifyInstance,
  identity: ApiKeyIdentity,
  workflowId: string,
  taskId: string,
) {
  const managedTaskId = parseUuidParamOrThrow(taskId, 'managed task id');
  const task = await app.taskService.getTask(identity.tenantId, managedTaskId) as Record<string, unknown>;
  if (task.workflow_id !== workflowId) {
    throw new ValidationError('Managed task must belong to the orchestrator workflow');
  }
  if (task.is_orchestrator_task) {
    throw new ValidationError('Managed task must be a specialist task');
  }
  return task;
}

export async function loadManagedSpecialistTaskOrRecoverableNoop(
  app: FastifyInstance,
  identity: ApiKeyIdentity,
  taskScope: ActiveOrchestratorTaskScope,
  taskId: string,
): Promise<Record<string, unknown>> {
  try {
    return await loadManagedSpecialistTask(app, identity, taskScope.workflow_id, taskId);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return buildRecoverableMissingManagedTaskNoop(
        taskScope,
        parseUuidParamOrThrow(taskId, 'managed task id'),
      );
    }
    throw error;
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

export function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function readInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
