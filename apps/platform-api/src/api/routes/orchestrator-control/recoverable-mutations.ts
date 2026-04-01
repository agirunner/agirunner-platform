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
  stageAdvanceSchema,
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

export async function advanceStageOrNoop(
  identity: ApiKeyIdentity,
  taskScope: ActiveOrchestratorTaskScope,
  stageName: string,
  input: z.infer<typeof stageAdvanceSchema>,
  client: DatabaseClient,
  playbookControlService: PlaybookWorkflowControlService,
): Promise<Record<string, unknown>> {
  try {
    return await playbookControlService.advanceStage(
      identity,
      taskScope.workflow_id,
      stageName,
      input,
      client,
    );
  } catch (error) {
    const noop = buildRecoverableAdvanceStageNoopIfNotReady({
      error,
      taskScope,
      stageName,
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
  if (message.includes('requires human approval before workflow completion')) {
    return 'workflow_waiting_for_gate_approval';
  }
  if (message.includes('Cannot complete workflow while task') && message.includes('is still')) {
    return 'workflow_tasks_not_ready';
  }
  if (message.includes('Workflow still has incomplete stage')) {
    return 'workflow_incomplete_stage';
  }
  if (message.includes('blocked work item')) {
    return 'workflow_stage_blocked';
  }
  if (message.includes('open escalation on work item')) {
    return 'workflow_stage_open_escalation';
  }
  if (message.includes('required') && message.includes('pending on work item')) {
    return 'workflow_continuation_pending';
  }
  if (message.includes('blocking') && message.includes('assessment')) {
    return 'workflow_assessment_blocked';
  }
  return null;
}

function recoverableCompleteWorkflowActions(
  reasonCode: string,
  taskScope: ActiveOrchestratorTaskScope,
) {
  switch (reasonCode) {
    case 'workflow_waiting_for_gate_approval':
      return [
        {
          action_code: 'inspect_workflow_state',
          target_type: 'workflow',
          target_id: taskScope.workflow_id,
          why: 'The current stage still has an approval gate that must resolve before workflow closure.',
          requires_orchestrator_judgment: false,
        },
        {
          action_code: 'wait_for_gate_resolution',
          target_type: 'workflow',
          target_id: taskScope.workflow_id,
          why: 'Do not retry workflow completion until the required approval lands or is explicitly resolved.',
          requires_orchestrator_judgment: false,
        },
      ];
    case 'workflow_tasks_not_ready':
      return [
        {
          action_code: 'inspect_workflow_state',
          target_type: 'workflow',
          target_id: taskScope.workflow_id,
          why: 'The workflow still has non-orchestrator specialist work in flight.',
          requires_orchestrator_judgment: false,
        },
        {
          action_code: 'wait_for_open_specialist_tasks',
          target_type: 'workflow',
          target_id: taskScope.workflow_id,
          why: 'Let the active specialist work settle before retrying workflow closure.',
          requires_orchestrator_judgment: false,
        },
      ];
    case 'workflow_incomplete_stage':
      return [
        {
          action_code: 'inspect_workflow_state',
          target_type: 'workflow',
          target_id: taskScope.workflow_id,
          why: 'At least one planned stage is still incomplete.',
          requires_orchestrator_judgment: false,
        },
        {
          action_code: 'finish_remaining_stage_work',
          target_type: 'workflow',
          target_id: taskScope.workflow_id,
          why: 'Close or route the remaining stage work before retrying workflow completion.',
          requires_orchestrator_judgment: true,
        },
      ];
    case 'workflow_stage_blocked':
    case 'workflow_stage_open_escalation':
    case 'workflow_continuation_pending':
    case 'workflow_assessment_blocked':
      return [
        {
          action_code: 'inspect_workflow_state',
          target_type: 'workflow',
          target_id: taskScope.workflow_id,
          why: 'The current stage still has a blocking condition that prevents workflow closure.',
          requires_orchestrator_judgment: false,
        },
        {
          action_code: 'settle_current_stage_blocker',
          target_type: 'workflow',
          target_id: taskScope.workflow_id,
          why: 'Resolve the current stage blocker before retrying workflow completion.',
          requires_orchestrator_judgment: true,
        },
      ];
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

function classifyRecoverableAdvanceStageReason(message: string): string | null {
  if (message.includes('No next stage is available; use complete_workflow for the final stage')) {
    return 'final_stage_use_complete_workflow';
  }
  if (message.includes('requires human approval before it can advance')) {
    return 'stage_waiting_for_gate_approval';
  }
  if (message.includes('may only advance to the immediate next planned stage')) {
    return 'stage_wrong_successor';
  }
  if (message.includes('is not the current workflow stage')) {
    return 'stage_not_current';
  }
  if (message.includes('Stage advancement is only supported for planned playbook workflows')) {
    return 'workflow_lifecycle_not_planned';
  }
  return null;
}

function recoverableAdvanceStageActions(
  reasonCode: string,
  taskScope: ActiveOrchestratorTaskScope,
  stageName: string,
) {
  switch (reasonCode) {
    case 'final_stage_use_complete_workflow':
      return [
        {
          action_code: 'inspect_workflow_state',
          target_type: 'workflow',
          target_id: taskScope.workflow_id,
          why: 'There is no successor stage after the current final stage.',
          requires_orchestrator_judgment: false,
        },
        {
          action_code: 'complete_workflow_if_ready',
          target_type: 'workflow',
          target_id: taskScope.workflow_id,
          why: 'After the accepted final-stage work item is closed and closure is legal, complete the workflow instead of retrying stage advance.',
          requires_orchestrator_judgment: true,
        },
      ];
    case 'stage_waiting_for_gate_approval':
      return [
        {
          action_code: 'inspect_workflow_state',
          target_type: 'workflow',
          target_id: taskScope.workflow_id,
          why: `Stage '${stageName}' still has a required approval gate.`,
          requires_orchestrator_judgment: false,
        },
        {
          action_code: 'wait_for_gate_resolution',
          target_type: 'workflow',
          target_id: taskScope.workflow_id,
          why: 'Resolve or wait for the stage gate before retrying stage advancement.',
          requires_orchestrator_judgment: false,
        },
      ];
    case 'stage_wrong_successor':
      return [
        {
          action_code: 'inspect_workflow_state',
          target_type: 'workflow',
          target_id: taskScope.workflow_id,
          why: 'Stage advancement only allows the immediate authored successor stage.',
          requires_orchestrator_judgment: false,
        },
        {
          action_code: 'retry_with_immediate_successor_stage',
          target_type: 'workflow',
          target_id: taskScope.workflow_id,
          why: 'Use the immediate next planned stage instead of an invented or skipped successor.',
          requires_orchestrator_judgment: true,
        },
      ];
    case 'stage_not_current':
    case 'workflow_lifecycle_not_planned':
    default:
      return [
        {
          action_code: 'inspect_workflow_state',
          target_type: 'workflow',
          target_id: taskScope.workflow_id,
          why: 'The current workflow stage has already changed or stage advancement is no longer the legal move.',
          requires_orchestrator_judgment: false,
        },
        {
          action_code: 'route_from_current_workflow_state',
          target_type: 'workflow',
          target_id: taskScope.workflow_id,
          why: 'Re-read the canonical workflow state before issuing another stage mutation.',
          requires_orchestrator_judgment: true,
        },
      ];
  }
}

export function buildRecoverableAdvanceStageNoopIfNotReady(input: {
  error: unknown;
  taskScope: ActiveOrchestratorTaskScope;
  stageName: string;
}) {
  if (!(input.error instanceof ConflictError || input.error instanceof ValidationError)) {
    return null;
  }
  const reasonCode = classifyRecoverableAdvanceStageReason(input.error.message);
  if (!reasonCode) {
    return null;
  }
  logSafetynetTriggered(
    NOT_READY_NOOP_RECOVERY_SAFETYNET,
    'recoverable advance_stage noop returned',
    { workflow_id: input.taskScope.workflow_id, stage_name: input.stageName, reason_code: reasonCode },
  );
  return buildRecoverableGuidedNoop({
    reasonCode,
    safetynetBehaviorId: NOT_READY_NOOP_RECOVERY_SAFETYNET.id,
    stateSnapshot: {
      workflow_id: input.taskScope.workflow_id,
      work_item_id: input.taskScope.work_item_id ?? null,
      task_id: input.taskScope.id,
      current_stage: input.taskScope.stage_name ?? input.stageName,
      active_blocking_controls: [],
      active_advisory_controls: [],
    },
    suggestedNextActions: recoverableAdvanceStageActions(
      reasonCode,
      input.taskScope,
      input.stageName,
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
