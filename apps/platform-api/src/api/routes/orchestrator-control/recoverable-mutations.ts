import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { ApiKeyIdentity } from '../../../auth/api-key.js';
import type { DatabaseClient } from '../../../db/database.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../../errors/domain-errors.js';
import {
  buildRecoverableMutationResult,
  type GuidedClosureStateSnapshot,
} from '../../../services/guided-closure/types.js';
import { logSafetynetTriggered } from '../../../services/safetynet/logging.js';
import type { ActiveOrchestratorTaskScope } from '../../../services/task/task-agent-scope-service.js';
import type { PlaybookWorkflowControlService } from '../../../services/playbook-workflow-control/playbook-workflow-control-service.js';

import {
  buildRecoverableGuidedNoop,
  NOT_READY_NOOP_RECOVERY_SAFETYNET,
} from './shared.js';
import {
  gateRequestSchema,
  workItemCompleteSchema,
  workItemCreateSchema,
  workflowCompleteSchema,
} from './schemas.js';

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

export async function completeWorkflowOrNoop(
  identity: ApiKeyIdentity,
  taskScope: ActiveOrchestratorTaskScope,
  input: z.infer<typeof workflowCompleteSchema>,
  client: DatabaseClient,
  playbookControlService: PlaybookWorkflowControlService,
): Promise<Record<string, unknown>> {
  try {
    return await playbookControlService.completeWorkflow(
      identity,
      taskScope.workflow_id,
      input,
      client,
    );
  } catch (error) {
    const noop = buildRecoverableCompleteWorkflowNoopIfNotReady({
      error,
      taskScope,
    });
    if (noop) {
      return noop;
    }
    throw error;
  }
}

export async function buildUnconfiguredGateApprovalAdvisory(
  app: FastifyInstance,
  identity: ApiKeyIdentity,
  taskScope: ActiveOrchestratorTaskScope,
  stageName: string,
  input: z.infer<typeof gateRequestSchema>,
  client: DatabaseClient,
  error: unknown,
): Promise<Record<string, unknown> | null> {
  const reasonCode = classifyUnconfiguredGateApprovalReason(error);
  if (!reasonCode) {
    return null;
  }

  const message = error instanceof Error ? error.message : 'Approval stage is not configured';
  const stateSnapshot: GuidedClosureStateSnapshot = {
    workflow_id: taskScope.workflow_id,
    work_item_id: taskScope.work_item_id ?? null,
    task_id: taskScope.id,
    current_stage: taskScope.stage_name ?? null,
    active_blocking_controls: [],
    active_advisory_controls: [],
  };
  const recovery = buildRecoverableMutationResult({
    recovery_class: reasonCode,
    blocking: false,
    reason_code: reasonCode,
    state_snapshot: stateSnapshot,
    suggested_next_actions: [
      {
        action_code: 'continue_work',
        target_type: 'work_item',
        target_id: taskScope.work_item_id ?? taskScope.workflow_id,
        why: 'The stage has no configured blocking approval gate.',
        requires_orchestrator_judgment: false,
      },
      {
        action_code: 'record_callout',
        target_type: 'workflow',
        target_id: taskScope.workflow_id,
        why: 'Persist the advisory concern if the workflow closes without a separate approval.',
        requires_orchestrator_judgment: true,
      },
    ],
    suggested_target_ids: {
      workflow_id: taskScope.workflow_id,
      work_item_id: taskScope.work_item_id ?? null,
      task_id: taskScope.id,
    },
    callout_recommendations: [
      {
        code: reasonCode,
        summary: message,
      },
    ],
    closure_still_possible: true,
  });
  const advisory = {
    ...recovery,
    advisory: true,
    advisory_event_type: 'workflow.advisory_recorded',
    advisory_kind: 'approval_not_configured',
    advisory_recorded: true,
    blocking: false,
    configured: false,
    control_type: 'approval',
    message,
    reason_code: reasonCode,
    request_summary: input.summary.trim(),
    stage_name: stageName,
    status: 'ignored_not_configured',
    task_id: taskScope.id,
    work_item_id: taskScope.work_item_id ?? null,
    workflow_id: taskScope.workflow_id,
  } satisfies Record<string, unknown>;

  await app.eventService.emit(
    {
      tenantId: identity.tenantId,
      type: 'workflow.advisory_recorded',
      entityType: 'workflow',
      entityId: taskScope.workflow_id,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: advisory,
    },
    client,
  );

  return advisory;
}

function classifyUnconfiguredGateApprovalReason(error: unknown): string | null {
  if (error instanceof ValidationError && error.message.includes('does not require a human gate')) {
    return 'approval_not_configured';
  }
  if (error instanceof NotFoundError && error.message.includes('Workflow stage')) {
    return 'approval_not_configured';
  }
  return null;
}

function buildRecoverableCreateWorkItemNoop(
  taskScope: ActiveOrchestratorTaskScope,
  input: z.infer<typeof workItemCreateSchema>,
  error: unknown,
): Record<string, unknown> | null {
  if (!(error instanceof ValidationError)) {
    return null;
  }

  const reasonCode = classifyRecoverableCreateWorkItemReason(error.message);
  if (!reasonCode) {
    return null;
  }
  logSafetynetTriggered(
    NOT_READY_NOOP_RECOVERY_SAFETYNET,
    'recoverable create_work_item noop returned',
    { stage_name: input.stage_name, reason_code: reasonCode },
  );

  return buildRecoverableGuidedNoop({
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
}

function classifyRecoverableCreateWorkItemReason(message: string): string | null {
  if (message.includes('still has non-terminal tasks')) {
    return 'predecessor_not_ready';
  }
  if (message.includes('still awaits gate approval')) {
    return 'predecessor_waiting_for_gate';
  }
  if (message.includes('has a full handoff')) {
    return 'predecessor_waiting_for_handoff';
  }
  return null;
}

function classifyRecoverableCompleteWorkItemReason(message: string): string | null {
  if (message.includes('while task') && message.includes('is still')) {
    return 'work_item_tasks_not_ready';
  }
  if (message.includes('while required') && message.includes('is still pending')) {
    return 'work_item_waiting_for_continuation';
  }
  return null;
}

function classifyRecoverableCompleteWorkflowReason(message: string): string | null {
  if (message.includes('Only planned playbook workflows can be completed by the orchestrator')) {
    return 'workflow_lifecycle_not_closable';
  }
  return null;
}

function recoverableCompleteWorkflowActions(
  reasonCode: string,
  taskScope: ActiveOrchestratorTaskScope,
) {
  switch (reasonCode) {
    case 'workflow_lifecycle_not_closable':
    default:
      return [
        {
          action_code: 'inspect_workflow_state',
          target_type: 'workflow',
          target_id: taskScope.workflow_id,
          why: 'The workflow lifecycle and state determine whether global closure is legal.',
          requires_orchestrator_judgment: false,
        },
        {
          action_code: 'continue_ongoing_workflow',
          target_type: 'workflow',
          target_id: taskScope.workflow_id,
          why: 'Ongoing workflows stay open after the current cycle settles; record callouts and wait for the next actionable event instead of forcing workflow completion.',
          requires_orchestrator_judgment: true,
        },
      ];
  }
}

export function buildRecoverableCompleteWorkflowNoopIfNotReady(input: {
  error: unknown;
  taskScope: ActiveOrchestratorTaskScope;
}) {
  if (!(input.error instanceof ConflictError || input.error instanceof ValidationError)) {
    return null;
  }
  const reasonCode = classifyRecoverableCompleteWorkflowReason(input.error.message);
  if (!reasonCode) {
    return null;
  }
  logSafetynetTriggered(
    NOT_READY_NOOP_RECOVERY_SAFETYNET,
    'recoverable complete_workflow noop returned',
    { workflow_id: input.taskScope.workflow_id, reason_code: reasonCode },
  );
  return buildRecoverableGuidedNoop({
    reasonCode,
    safetynetBehaviorId: NOT_READY_NOOP_RECOVERY_SAFETYNET.id,
    stateSnapshot: {
      workflow_id: input.taskScope.workflow_id,
      work_item_id: input.taskScope.work_item_id ?? null,
      task_id: input.taskScope.id,
      current_stage: input.taskScope.stage_name ?? null,
      active_blocking_controls: [],
      active_advisory_controls: [],
    },
    suggestedNextActions: recoverableCompleteWorkflowActions(
      reasonCode,
      input.taskScope,
    ),
    suggestedTargetIds: {
      workflow_id: input.taskScope.workflow_id,
      work_item_id: input.taskScope.work_item_id ?? null,
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

export function buildRecoverableCompleteWorkItemNoopIfNotReady(input: {
  error: unknown;
  taskScope: ActiveOrchestratorTaskScope;
  workItemId: string;
}) {
  if (!(input.error instanceof ValidationError)) {
    return null;
  }
  const reasonCode = classifyRecoverableCompleteWorkItemReason(input.error.message);
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

function recoverableCreateWorkItemActions(
  reasonCode: string,
  taskScope: ActiveOrchestratorTaskScope,
  input: z.infer<typeof workItemCreateSchema>,
) {
  const baseTargetId = input.parent_work_item_id ?? taskScope.work_item_id ?? taskScope.workflow_id;
  const baseTargetType = input.parent_work_item_id ? 'work_item' : 'workflow';
  switch (reasonCode) {
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
