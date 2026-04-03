import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { ApiKeyIdentity } from '../../../auth/api-key.js';
import type { DatabaseClient } from '../../../db/database.js';
import { ValidationError } from '../../../errors/domain-errors.js';
import { logSafetynetTriggered } from '../../../services/safetynet/logging.js';
import type { ActiveOrchestratorTaskScope } from '../../../services/task/task-agent-scope-service.js';

import {
  buildRecoverableGuidedNoop,
  NOT_READY_NOOP_RECOVERY_SAFETYNET,
} from './shared.js';
import {
  workItemCompleteSchema,
  workItemCreateSchema,
} from './schemas.js';

function readErrorReasonCode(error: unknown): string | null {
  if (!(error instanceof ValidationError)) {
    return null;
  }
  const details = error.details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return null;
  }
  const reasonCode = (details as Record<string, unknown>).reason_code;
  return typeof reasonCode === 'string' && reasonCode.trim().length > 0 ? reasonCode : null;
}

function readAllowedErrorReasonCode(error: unknown, allowed: readonly string[]): string | null {
  const reasonCode = readErrorReasonCode(error);
  return reasonCode && allowed.includes(reasonCode) ? reasonCode : null;
}

function readValidationErrorDetails(error: unknown): Record<string, unknown> {
  if (!(error instanceof ValidationError)) {
    return {};
  }
  const details = error.details;
  return details && typeof details === 'object' && !Array.isArray(details)
    ? (details as Record<string, unknown>)
    : {};
}

function readValidationStringDetail(details: Record<string, unknown>, key: string): string | null {
  const value = details[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readValidationStringArrayDetail(details: Record<string, unknown>, key: string): string[] {
  const value = details[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

export async function createWorkflowWorkItemOrNoop(
  app: FastifyInstance,
  identity: ApiKeyIdentity,
  taskScope: ActiveOrchestratorTaskScope,
  workflowId: string,
  input: z.infer<typeof workItemCreateSchema>,
  client: DatabaseClient,
): Promise<Record<string, unknown>> {
  try {
    return await app.workflowService.createWorkflowWorkItem(
      identity,
      workflowId,
      input,
      client,
    );
  } catch (error) {
    const noop = buildRecoverableCreateWorkItemNoop(taskScope, input, error);
    if (noop) {
      return noop;
    }
    throw error;
  }
}

function buildRecoverableCreateWorkItemNoop(
  taskScope: ActiveOrchestratorTaskScope,
  input: z.infer<typeof workItemCreateSchema>,
  error: unknown,
): Record<string, unknown> | null {
  if (!(error instanceof ValidationError)) {
    return null;
  }

  const reasonCode = classifyRecoverableCreateWorkItemReason(error);
  if (!reasonCode) {
    return null;
  }
  logSafetynetTriggered(
    NOT_READY_NOOP_RECOVERY_SAFETYNET,
    'recoverable create_work_item noop returned',
    { stage_name: input.stage_name, reason_code: reasonCode },
  );

  const response = buildRecoverableGuidedNoop({
    reasonCode,
    safetynetBehaviorId: NOT_READY_NOOP_RECOVERY_SAFETYNET.id,
    stateSnapshot: {
      workflow_id: taskScope.workflow_id,
      work_item_id: taskScope.work_item_id ?? input.parent_work_item_id ?? null,
      task_id: taskScope.id,
      current_stage: taskScope.stage_name ?? input.stage_name,
      active_blocking_controls: [],
      active_advisory_controls: [],
    },
    suggestedNextActions: recoverableCreateWorkItemActions(reasonCode, taskScope, input),
    suggestedTargetIds: {
      workflow_id: taskScope.workflow_id,
      work_item_id: taskScope.work_item_id ?? input.parent_work_item_id ?? null,
      task_id: taskScope.id,
    },
  });

  const details = readValidationErrorDetails(error);
  if (reasonCode === 'planned_stage_starter_role_required') {
    return {
      ...response,
      stage_name: readValidationStringDetail(details, 'stage_name') ?? input.stage_name,
      requested_role: readValidationStringDetail(details, 'requested_role'),
      allowed_starter_roles: readValidationStringArrayDetail(details, 'allowed_starter_roles'),
    };
  }
  if (reasonCode === 'unknown_stage_name') {
    return {
      ...response,
      requested_stage_name: readValidationStringDetail(details, 'requested_stage_name') ?? input.stage_name,
      authored_stage_names: readValidationStringArrayDetail(details, 'authored_stage_names'),
    };
  }

  return response;
}

function classifyRecoverableCreateWorkItemReason(error: unknown): string | null {
  return readAllowedErrorReasonCode(error, [
    'predecessor_not_ready',
    'predecessor_waiting_for_gate',
    'predecessor_waiting_for_handoff',
    'planned_stage_starter_role_required',
    'unknown_stage_name',
  ]);
}

function classifyRecoverableCompleteWorkItemReason(error: unknown): string | null {
  return readAllowedErrorReasonCode(error, [
    'work_item_tasks_not_ready',
    'work_item_waiting_for_continuation',
  ]);
}

export function buildRecoverableCompleteWorkItemNoopIfNotReady(input: {
  error: unknown;
  taskScope: ActiveOrchestratorTaskScope;
  workItemId: string;
}) {
  if (!(input.error instanceof ValidationError)) {
    return null;
  }
  const reasonCode = classifyRecoverableCompleteWorkItemReason(input.error);
  if (!reasonCode) {
    return null;
  }
  logSafetynetTriggered(
    NOT_READY_NOOP_RECOVERY_SAFETYNET,
    'recoverable complete_work_item noop returned',
    { work_item_id: input.workItemId, reason_code: reasonCode },
  );
  return buildRecoverableGuidedNoop({
    reasonCode,
    safetynetBehaviorId: NOT_READY_NOOP_RECOVERY_SAFETYNET.id,
    stateSnapshot: {
      workflow_id: input.taskScope.workflow_id,
      work_item_id: input.workItemId,
      task_id: input.taskScope.id,
      current_stage: input.taskScope.stage_name ?? null,
      active_blocking_controls: [],
      active_advisory_controls: [],
    },
    suggestedNextActions: recoverableCompleteWorkItemActions(
      reasonCode,
      input.workItemId,
    ),
    suggestedTargetIds: {
      workflow_id: input.taskScope.workflow_id,
      work_item_id: input.workItemId,
      task_id: input.taskScope.id,
    },
  });
}

function recoverableCompleteWorkItemActions(
  reasonCode: string,
  workItemId: string,
) {
  switch (reasonCode) {
    case 'work_item_waiting_for_continuation':
      return [
        {
          action_code: 'inspect_current_work_item',
          target_type: 'work_item',
          target_id: workItemId,
          why: 'The current work item still has unresolved continuity that blocks closure.',
          requires_orchestrator_judgment: false,
        },
        {
          action_code: 'route_pending_current_stage_action',
          target_type: 'work_item',
          target_id: workItemId,
          why: 'Resolve the pending current-stage continuation before attempting closure again.',
          requires_orchestrator_judgment: true,
        },
      ];
    case 'work_item_tasks_not_ready':
    default:
      return [
        {
          action_code: 'inspect_current_work_item',
          target_type: 'work_item',
          target_id: workItemId,
          why: 'The current work item state determines whether closure is legal yet.',
          requires_orchestrator_judgment: false,
        },
        {
          action_code: 'wait_for_current_work_item_tasks',
          target_type: 'work_item',
          target_id: workItemId,
          why: 'Wait for in-flight specialist work on the current work item to settle before closing it.',
          requires_orchestrator_judgment: false,
        },
      ];
  }
}

function recoverableCreateWorkItemActions(
  reasonCode: string,
  taskScope: ActiveOrchestratorTaskScope,
  input: z.infer<typeof workItemCreateSchema>,
) {
  const baseTargetId = input.parent_work_item_id ?? taskScope.work_item_id ?? taskScope.workflow_id;
  const baseTargetType = input.parent_work_item_id ? 'work_item' : 'workflow';
  switch (reasonCode) {
    case 'planned_stage_starter_role_required':
      return [
        {
          action_code: 'inspect_stage_contract',
          target_type: 'workflow',
          target_id: taskScope.workflow_id,
          why: `The first work item in planned stage '${input.stage_name}' must start with one of the stage's authored starter roles.`,
          requires_orchestrator_judgment: false,
        },
        {
          action_code: 'retry_create_work_item_with_authored_stage_starter',
          target_type: baseTargetType,
          target_id: baseTargetId,
          why: 'Retry create_work_item using one of the allowed starter roles instead of the current role guess.',
          requires_orchestrator_judgment: true,
        },
      ];
    case 'unknown_stage_name':
      return [
        {
          action_code: 'inspect_stage_contract',
          target_type: 'workflow',
          target_id: taskScope.workflow_id,
          why: 'The requested stage is not one of the workflow playbook’s authored stage names.',
          requires_orchestrator_judgment: false,
        },
        {
          action_code: 'retry_create_work_item_with_authored_stage_name',
          target_type: baseTargetType,
          target_id: baseTargetId,
          why: 'Retry create_work_item using an exact authored stage name from the workflow definition or stage-status output.',
          requires_orchestrator_judgment: true,
        },
      ];
    case 'predecessor_waiting_for_gate':
      return [
        {
          action_code: 'inspect_predecessor',
          target_type: baseTargetType,
          target_id: baseTargetId,
          why: 'The predecessor stage still has an unresolved gate decision.',
          requires_orchestrator_judgment: false,
        },
        {
          action_code: 'wait_for_gate_resolution',
          target_type: baseTargetType,
          target_id: baseTargetId,
          why: 'Resolve or wait for the gate before creating successor work.',
          requires_orchestrator_judgment: false,
        },
      ];
    case 'predecessor_waiting_for_handoff':
      return [
        {
          action_code: 'inspect_predecessor',
          target_type: baseTargetType,
          target_id: baseTargetId,
          why: 'The predecessor still lacks a full handoff.',
          requires_orchestrator_judgment: false,
        },
        {
          action_code: 'rerun_predecessor_for_handoff',
          target_type: baseTargetType,
          target_id: baseTargetId,
          why: 'Create or reroute the missing predecessor delivery so successor work can start legally.',
          requires_orchestrator_judgment: true,
        },
      ];
    case 'predecessor_not_ready':
    default:
      return [
        {
          action_code: 'inspect_predecessor',
          target_type: baseTargetType,
          target_id: baseTargetId,
          why: 'The predecessor state determines the next legal move.',
          requires_orchestrator_judgment: false,
        },
        {
          action_code: 'wait_for_predecessor_completion',
          target_type: baseTargetType,
          target_id: baseTargetId,
          why: 'Finish or clear predecessor work before routing successor work.',
          requires_orchestrator_judgment: false,
        },
      ];
  }
}
