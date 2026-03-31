import { logSafetynetTriggered } from '../../../services/safetynet/logging.js';
import type { ActiveOrchestratorTaskScope } from '../../../services/task/task-agent-scope-service.js';

import {
  buildRecoverableGuidedNoop,
  NOT_READY_NOOP_RECOVERY_SAFETYNET,
  readString,
} from './shared.js';

type MessageDeliveryState =
  | 'pending_delivery'
  | 'delivery_in_progress'
  | 'delivered'
  | 'task_not_in_progress'
  | 'worker_unassigned'
  | 'worker_unavailable';

const messageRecoveryByState: Record<
  Exclude<MessageDeliveryState, 'delivered'>,
  {
    reasonCode: string;
    firstActionCode: string;
    firstActionWhy: string;
    secondActionCode: string;
    secondActionWhy: string;
  }
> = {
  pending_delivery: {
    reasonCode: 'managed_task_message_pending_delivery',
    firstActionCode: 'inspect_task_assignment',
    firstActionWhy: 'The message is queued but has not reached a worker yet.',
    secondActionCode: 'wait_for_message_delivery',
    secondActionWhy: 'Do not narrate reroute success until the active worker actually receives the instruction.',
  },
  delivery_in_progress: {
    reasonCode: 'managed_task_message_delivery_in_progress',
    firstActionCode: 'inspect_task_assignment',
    firstActionWhy: 'A prior delivery attempt is still in progress for this task message.',
    secondActionCode: 'avoid_replaying_same_message',
    secondActionWhy: 'Re-read current state instead of looping the same message request while delivery is still pending.',
  },
  task_not_in_progress: {
    reasonCode: 'managed_task_not_in_progress',
    firstActionCode: 'inspect_task_state',
    firstActionWhy: 'The referenced specialist task is no longer actively running.',
    secondActionCode: 'reroute_from_current_state',
    secondActionWhy: 'Create or update the real successor work instead of treating the stale message as routed work.',
  },
  worker_unassigned: {
    reasonCode: 'managed_task_worker_unassigned',
    firstActionCode: 'inspect_task_assignment',
    firstActionWhy: 'The referenced specialist task has no assigned worker.',
    secondActionCode: 'reroute_or_reassign_from_current_state',
    secondActionWhy: 'Attach a worker or route a fresh task before claiming that the rework path is active.',
  },
  worker_unavailable: {
    reasonCode: 'managed_task_worker_unavailable',
    firstActionCode: 'inspect_task_assignment',
    firstActionWhy: 'The worker could not accept the message right now.',
    secondActionCode: 'retry_or_reroute_from_current_state',
    secondActionWhy: 'Retry only after confirming worker availability or route the next legal task explicitly.',
  },
};

export function normalizeManagedTaskMessageResult(
  taskScope: ActiveOrchestratorTaskScope,
  managedTaskId: string,
  response: Record<string, unknown>,
): Record<string, unknown> {
  const deliveryState = readMessageDeliveryState(response.delivery_state);
  if (!deliveryState || deliveryState === 'delivered') {
    return response;
  }

  const recovery = messageRecoveryByState[deliveryState];
  const recoveryTargetId = taskScope.work_item_id ?? taskScope.workflow_id;
  const recoveryTargetType = taskScope.work_item_id ? 'work_item' : 'workflow';

  logSafetynetTriggered(
    NOT_READY_NOOP_RECOVERY_SAFETYNET,
    'recoverable send_task_message noop returned because the managed task could not receive the message',
    {
      workflow_id: taskScope.workflow_id,
      task_id: managedTaskId,
      reason_code: recovery.reasonCode,
      delivery_state: deliveryState,
    },
  );

  return buildRecoverableGuidedNoop({
    reasonCode: recovery.reasonCode,
    safetynetBehaviorId: NOT_READY_NOOP_RECOVERY_SAFETYNET.id,
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
        action_code: recovery.firstActionCode,
        target_type: 'task',
        target_id: managedTaskId,
        why: recovery.firstActionWhy,
        requires_orchestrator_judgment: false,
      },
      {
        action_code: recovery.secondActionCode,
        target_type: recoveryTargetType,
        target_id: recoveryTargetId,
        why: recovery.secondActionWhy,
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

function readMessageDeliveryState(value: unknown): MessageDeliveryState | null {
  switch (value) {
    case 'pending_delivery':
    case 'delivery_in_progress':
    case 'delivered':
    case 'task_not_in_progress':
    case 'worker_unassigned':
    case 'worker_unavailable':
      return value;
    default:
      return null;
  }
}
