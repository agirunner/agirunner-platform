import { z } from 'zod';

import type { ApiKeyIdentity } from '../../../auth/api-key.js';
import type { DatabaseClient } from '../../../db/database.js';
import {
  ConflictError,
  ValidationError,
} from '../../../errors/domain-errors.js';
import { logSafetynetTriggered } from '../../../services/safetynet/logging.js';
import type { ActiveOrchestratorTaskScope } from '../../../services/task/task-agent-scope-service.js';
import type { PlaybookWorkflowControlService } from '../../../services/playbook-workflow-control/playbook-workflow-control-service.js';

import {
  buildRecoverableGuidedNoop,
  NOT_READY_NOOP_RECOVERY_SAFETYNET,
} from './shared.js';
import {
  stageAdvanceSchema,
  workflowCompleteSchema,
} from './schemas.js';

export {
  buildRecoverableCompleteWorkItemNoopIfNotReady,
  createWorkflowWorkItemOrNoop,
} from './recoverable-work-item-mutations.js';
export { buildUnconfiguredGateApprovalAdvisory } from './recoverable-gate-advisory.js';

function readErrorReasonCode(error: unknown): string | null {
  if (!(error instanceof ConflictError || error instanceof ValidationError)) {
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

function classifyRecoverableCompleteWorkflowReason(error: unknown): string | null {
  return readAllowedErrorReasonCode(error, [
    'workflow_lifecycle_not_closable',
    'workflow_waiting_for_gate_approval',
    'workflow_tasks_not_ready',
    'workflow_incomplete_stage',
    'workflow_stage_blocked',
    'workflow_stage_open_escalation',
    'workflow_continuation_pending',
    'workflow_assessment_blocked',
  ]);
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
  const reasonCode = classifyRecoverableCompleteWorkflowReason(input.error);
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

function classifyRecoverableAdvanceStageReason(error: unknown): string | null {
  return readAllowedErrorReasonCode(error, [
    'final_stage_use_complete_workflow',
    'stage_waiting_for_gate_approval',
    'stage_wrong_successor',
    'stage_not_current',
    'workflow_lifecycle_not_planned',
  ]);
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
  const reasonCode = classifyRecoverableAdvanceStageReason(input.error);
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
