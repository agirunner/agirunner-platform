import type {
  MissionControlActionAvailability,
  MissionControlActionKind,
  MissionControlConfirmationLevel,
  MissionControlWorkflowPosture,
} from './mission-control-types.js';

interface VersionSnapshot {
  readModelEventId: number | null;
  latestEventId: number | null;
}

export interface WorkflowActionAvailabilityInput {
  workflowState: string;
  posture: MissionControlWorkflowPosture;
  hasCancelRequest?: boolean;
  version?: VersionSnapshot;
}

export interface TaskActionAvailabilityInput {
  workflowState: string;
  posture: MissionControlWorkflowPosture;
  taskState: string;
  hasPendingDecision: boolean;
  escalationStatus: string | null;
  version?: VersionSnapshot;
}

export function deriveWorkflowActionAvailability(
  input: WorkflowActionAvailabilityInput,
): MissionControlActionAvailability[] {
  const stale = isStale(input.version);
  const hasCancelRequest = input.hasCancelRequest === true;
  return [
    buildWorkflowAction(
      'pause_workflow',
      canPause(input.workflowState, input.posture, hasCancelRequest),
      'immediate',
      stale,
    ),
    buildWorkflowAction(
      'resume_workflow',
      canResume(input.workflowState, input.posture, hasCancelRequest),
      'immediate',
      stale,
    ),
    buildWorkflowAction(
      'cancel_workflow',
      canCancel(input.workflowState, hasCancelRequest),
      'high_impact_confirm',
      stale,
    ),
    buildWorkflowAction(
      'add_work_item',
      canAddWork(input.posture),
      'standard_confirm',
      stale,
    ),
    buildWorkflowAction(
      'request_replan',
      canReplan(input.posture),
      'standard_confirm',
      stale,
    ),
    buildWorkflowAction(
      'spawn_child_workflow',
      canSpawnChildWorkflow(input.posture),
      'high_impact_confirm',
      stale,
    ),
    buildWorkflowAction(
      'redrive_workflow',
      input.posture === 'terminal_failed',
      'high_impact_confirm',
      stale,
    ),
  ];
}

export function deriveTaskActionAvailability(
  input: TaskActionAvailabilityInput,
): MissionControlActionAvailability[] {
  const stale = isStale(input.version);
  return [
    buildTaskAction('approve_task', input.hasPendingDecision, 'standard_confirm', stale),
    buildTaskAction('reject_task', input.hasPendingDecision, 'standard_confirm', stale),
    buildTaskAction('request_changes_task', input.hasPendingDecision, 'standard_confirm', stale),
    buildTaskAction('retry_task', canRetryTask(input.taskState, input.posture), 'standard_confirm', stale),
    buildTaskAction('skip_task', canSkipTask(input.taskState), 'standard_confirm', stale),
    buildTaskAction('reassign_task', canReassignTask(input.taskState, input.workflowState), 'standard_confirm', stale),
    buildTaskAction('resolve_escalation', input.escalationStatus === 'open', 'standard_confirm', stale),
  ];
}

function canPause(
  workflowState: string,
  posture: MissionControlWorkflowPosture,
  hasCancelRequest: boolean,
): boolean {
  return workflowState !== 'paused' && !isTerminalState(workflowState) && posture !== 'paused' && !hasCancelRequest;
}

function canResume(
  workflowState: string,
  posture: MissionControlWorkflowPosture,
  hasCancelRequest: boolean,
): boolean {
  return workflowState === 'paused' && posture === 'paused' && !hasCancelRequest;
}

function canCancel(workflowState: string, hasCancelRequest: boolean): boolean {
  return !isTerminalState(workflowState) && !hasCancelRequest;
}

function canAddWork(posture: MissionControlWorkflowPosture): boolean {
  return posture !== 'terminal_failed' && posture !== 'completed' && posture !== 'cancelled' && posture !== 'cancelling';
}

function canReplan(posture: MissionControlWorkflowPosture): boolean {
  return posture !== 'completed' && posture !== 'cancelled' && posture !== 'cancelling';
}

function canSpawnChildWorkflow(posture: MissionControlWorkflowPosture): boolean {
  return posture !== 'completed' && posture !== 'cancelled' && posture !== 'terminal_failed' && posture !== 'cancelling';
}

function canRetryTask(taskState: string, posture: MissionControlWorkflowPosture): boolean {
  return taskState === 'failed' || posture === 'recoverable_needs_steering';
}

function canSkipTask(taskState: string): boolean {
  return taskState === 'pending' || taskState === 'ready' || taskState === 'failed';
}

function canReassignTask(taskState: string, workflowState: string): boolean {
  return !isTerminalState(workflowState) && taskState !== 'completed' && taskState !== 'cancelled';
}

function isStale(version: VersionSnapshot | undefined): boolean {
  if (!version) return false;
  if (version.readModelEventId === null || version.latestEventId === null) return false;
  return version.readModelEventId < version.latestEventId;
}

function isTerminalState(workflowState: string): boolean {
  return workflowState === 'completed' || workflowState === 'cancelled' || workflowState === 'failed';
}

function buildWorkflowAction(
  kind: MissionControlActionKind,
  enabled: boolean,
  confirmationLevel: MissionControlConfirmationLevel,
  stale: boolean,
): MissionControlActionAvailability {
  return buildAction(kind, 'workflow', enabled, confirmationLevel, stale);
}

function buildTaskAction(
  kind: MissionControlActionKind,
  enabled: boolean,
  confirmationLevel: MissionControlConfirmationLevel,
  stale: boolean,
): MissionControlActionAvailability {
  return buildAction(kind, 'task', enabled, confirmationLevel, stale);
}

function buildAction(
  kind: MissionControlActionKind,
  scope: MissionControlActionAvailability['scope'],
  enabled: boolean,
  confirmationLevel: MissionControlConfirmationLevel,
  stale: boolean,
): MissionControlActionAvailability {
  if (stale) {
    return {
      kind,
      scope,
      enabled: false,
      confirmationLevel,
      stale: true,
      disabledReason: 'Mission Control view is stale. Refresh before applying this action.',
    };
  }
  return {
    kind,
    scope,
    enabled,
    confirmationLevel,
    stale: false,
    disabledReason: enabled ? null : 'Action is not available in the current workflow state.',
  };
}
