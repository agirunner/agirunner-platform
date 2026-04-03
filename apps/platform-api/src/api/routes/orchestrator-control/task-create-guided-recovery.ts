import {
  ConflictError,
  ValidationError,
} from '../../../errors/domain-errors.js';

import {
  asRecord,
  readString,
} from './shared.js';

export interface RecoverableCreateTaskGuidanceDetails {
  reasonCode: string;
  workflowId: string | null;
  workItemId: string | null;
  requestedRole: string | null;
  linkedWorkItemStageName: string | null;
  requestedStageName: string | null;
  definedRoles: string[];
  allowedRoles: string[];
  successorStageName: string | null;
  nextExpectedActor: string | null;
  nextExpectedAction: string | null;
}

export function recoverableCreateTaskCorrectionActions(
  details: RecoverableCreateTaskGuidanceDetails,
  recoveryTargetType: 'work_item' | 'workflow',
  recoveryTargetId: string,
) {
  switch (details.reasonCode) {
    case 'role_not_defined_in_playbook':
      return [
        {
          action_code: 'inspect_available_roles',
          target_type: 'workflow',
          target_id: details.workflowId ?? recoveryTargetId,
          why: details.definedRoles.length > 0
            ? `Use one of the exact authored roles: ${details.definedRoles.join(', ')}.`
            : 'Use only exact authored playbook role names before retrying create_task.',
          requires_orchestrator_judgment: false,
        },
        {
          action_code: 'retry_create_task_with_authored_role',
          target_type: recoveryTargetType,
          target_id: recoveryTargetId,
          why: details.requestedRole
            ? `Retry with an exact authored role name instead of '${details.requestedRole}'.`
            : 'Retry with an exact authored role name from the playbook role catalog.',
          requires_orchestrator_judgment: true,
        },
      ];
    case 'task_stage_mismatch':
      return [
        {
          action_code: 'inspect_work_item_stage',
          target_type: recoveryTargetType,
          target_id: recoveryTargetId,
          why: `The linked work item is in stage '${details.linkedWorkItemStageName ?? 'unknown'}'.`,
          requires_orchestrator_judgment: false,
        },
        {
          action_code: 'create_or_move_work_item_for_requested_stage',
          target_type: recoveryTargetType,
          target_id: recoveryTargetId,
          why: details.requestedStageName
            ? `Create or move a work item into stage '${details.requestedStageName}' before dispatching specialist work there.`
            : 'Create or move the work item into the intended stage before retrying create_task.',
          requires_orchestrator_judgment: true,
        },
      ];
    case 'planned_stage_already_completed':
      return [
        {
          action_code: 'inspect_completed_stage_state',
          target_type: recoveryTargetType,
          target_id: recoveryTargetId,
          why: details.linkedWorkItemStageName
            ? `Stage '${details.linkedWorkItemStageName}' is already completed.`
            : 'The linked planned stage is already completed.',
          requires_orchestrator_judgment: false,
        },
        {
          action_code: 'route_successor_stage_or_close_current_work',
          target_type: recoveryTargetType,
          target_id: recoveryTargetId,
          why: 'Do not dispatch another task on the completed stage; advance the successor path or close the current work legally.',
          requires_orchestrator_judgment: true,
        },
      ];
    case 'role_routes_to_successor_stage':
      return [
        {
          action_code: 'inspect_stage_routing',
          target_type: recoveryTargetType,
          target_id: recoveryTargetId,
          why: details.successorStageName
            ? `Role '${details.requestedRole ?? 'requested'}' belongs to successor stage '${details.successorStageName}'.`
            : 'The requested role belongs to a different planned stage.',
          requires_orchestrator_judgment: false,
        },
        {
          action_code: 'create_or_move_successor_work_item',
          target_type: recoveryTargetType,
          target_id: recoveryTargetId,
          why: details.successorStageName
            ? `Route work into '${details.successorStageName}' before dispatching '${details.requestedRole ?? 'the requested role'}'.`
            : 'Route work into the correct successor stage before retrying create_task.',
          requires_orchestrator_judgment: true,
        },
      ];
    case 'role_not_allowed_on_stage':
      return [
        {
          action_code: 'inspect_stage_role_catalog',
          target_type: recoveryTargetType,
          target_id: recoveryTargetId,
          why: details.allowedRoles.length > 0
            ? `Current stage allows: ${details.allowedRoles.join(', ')}.`
            : 'The current stage has a narrower role contract than the requested dispatch.',
          requires_orchestrator_judgment: false,
        },
        {
          action_code: 'dispatch_allowed_stage_role',
          target_type: recoveryTargetType,
          target_id: recoveryTargetId,
          why: 'Dispatch a role that is legal for the current stage or route the work item before retrying.',
          requires_orchestrator_judgment: true,
        },
      ];
    case 'next_expected_actor_mismatch':
      return [
        {
          action_code: 'inspect_current_work_item_continuity',
          target_type: recoveryTargetType,
          target_id: recoveryTargetId,
          why: details.nextExpectedActor
            ? `The current continuity expects '${details.nextExpectedActor}'${details.nextExpectedAction ? ` for '${details.nextExpectedAction}'` : ''}.`
            : 'The current work item continuity expects a different actor.',
          requires_orchestrator_judgment: false,
        },
        {
          action_code: 'follow_expected_actor',
          target_type: recoveryTargetType,
          target_id: recoveryTargetId,
          why: 'Continue from the recorded continuity instead of dispatching a conflicting role.',
          requires_orchestrator_judgment: true,
        },
      ];
    default:
      return [
        {
          action_code: 'inspect_current_workflow_state',
          target_type: recoveryTargetType,
          target_id: recoveryTargetId,
          why: 'The platform rejected the mutation with recoverable guidance.',
          requires_orchestrator_judgment: false,
        },
      ];
  }
}

export function readRecoverableCreateTaskGuidanceDetails(
  error: unknown,
): RecoverableCreateTaskGuidanceDetails | null {
  if (!(error instanceof ValidationError) && !(error instanceof ConflictError)) {
    return null;
  }
  const details = asRecord(error.details);
  if (readString(details.recovery_hint) !== 'orchestrator_guided_recovery') {
    return null;
  }
  const reasonCode = readString(details.reason_code);
  if (!reasonCode) {
    return null;
  }
  return {
    reasonCode,
    workflowId: readString(details.workflow_id),
    workItemId: readString(details.work_item_id),
    requestedRole: readString(details.requested_role),
    linkedWorkItemStageName: readString(details.linked_work_item_stage_name),
    requestedStageName: readString(details.requested_stage_name),
    definedRoles: readStringArray(details.defined_roles),
    allowedRoles: readStringArray(details.allowed_roles),
    successorStageName: readString(details.successor_stage_name),
    nextExpectedActor: readString(details.next_expected_actor),
    nextExpectedAction: readString(details.next_expected_action),
  };
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const parsed = readString(entry);
    return parsed ? [parsed] : [];
  });
}
