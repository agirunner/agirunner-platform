import type {
  MissionControlActionAvailability,
  MissionControlActionKind,
  MissionControlConfirmationLevel,
  MissionControlWorkflowPosture,
} from './types.js';

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
  const pauseEnabled = canPause(input.workflowState, input.posture, hasCancelRequest);
  const resumeEnabled = canResume(input.workflowState, hasCancelRequest);
  const cancelEnabled = canCancel(input.workflowState, hasCancelRequest);
  const addWorkEnabled = canAddWork(input.workflowState, input.posture, hasCancelRequest);
  const replanEnabled = canReplan(input.workflowState, input.posture, hasCancelRequest);
  const spawnChildEnabled = canSpawnChildWorkflow(input.workflowState, input.posture, hasCancelRequest);
  const redriveEnabled = isTerminalState(input.workflowState);
  return [
    buildWorkflowAction(
      'pause_workflow',
      pauseEnabled,
      'immediate',
      stale,
      pauseEnabled ? null : explainPauseDisabled(input.workflowState, hasCancelRequest),
    ),
    buildWorkflowAction(
      'resume_workflow',
      resumeEnabled,
      'immediate',
      stale,
      resumeEnabled ? null : explainResumeDisabled(input.workflowState, hasCancelRequest),
    ),
    buildWorkflowAction(
      'cancel_workflow',
      cancelEnabled,
      'high_impact_confirm',
      stale,
      cancelEnabled ? null : explainCancelDisabled(input.workflowState, hasCancelRequest),
    ),
    buildWorkflowAction(
      'add_work_item',
      addWorkEnabled,
      'standard_confirm',
      stale,
      addWorkEnabled ? null : explainWorkflowSteeringDisabled(input.workflowState, input.posture, hasCancelRequest),
    ),
    buildWorkflowAction(
      'request_replan',
      replanEnabled,
      'standard_confirm',
      stale,
      replanEnabled ? null : explainWorkflowSteeringDisabled(input.workflowState, input.posture, hasCancelRequest),
    ),
    buildWorkflowAction(
      'spawn_child_workflow',
      spawnChildEnabled,
      'high_impact_confirm',
      stale,
      spawnChildEnabled ? null : explainWorkflowSteeringDisabled(input.workflowState, input.posture, hasCancelRequest),
    ),
    buildWorkflowAction(
      'redrive_workflow',
      redriveEnabled,
      'high_impact_confirm',
      stale,
      redriveEnabled ? null : 'Action is not available in the current workflow state.',
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

export function isWorkflowScopeHeaderAction(kind: MissionControlActionKind): boolean {
  return kind === 'pause_workflow'
    || kind === 'resume_workflow'
    || kind === 'cancel_workflow'
    || kind === 'add_work_item'
    || kind === 'request_replan'
    || kind === 'spawn_child_workflow'
    || kind === 'redrive_workflow';
}

function canPause(
  workflowState: string,
  posture: MissionControlWorkflowPosture,
  hasCancelRequest: boolean,
): boolean {
  return (
    workflowState === 'active'
    && posture !== 'paused'
    && !hasCancelRequest
  );
}

function canResume(workflowState: string, hasCancelRequest: boolean): boolean {
  return workflowState === 'paused' && !hasCancelRequest;
}

function canCancel(workflowState: string, hasCancelRequest: boolean): boolean {
  return (workflowState === 'pending' || workflowState === 'active' || workflowState === 'paused') && !hasCancelRequest;
}

function canAddWork(
  workflowState: string,
  posture: MissionControlWorkflowPosture,
  hasCancelRequest: boolean,
): boolean {
  return canSteerWorkflow(workflowState, posture, hasCancelRequest);
}

function canReplan(
  workflowState: string,
  posture: MissionControlWorkflowPosture,
  hasCancelRequest: boolean,
): boolean {
  return canSteerWorkflow(workflowState, posture, hasCancelRequest);
}

function canSpawnChildWorkflow(
  workflowState: string,
  posture: MissionControlWorkflowPosture,
  hasCancelRequest: boolean,
): boolean {
  return canSteerWorkflow(workflowState, posture, hasCancelRequest);
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

function canSteerWorkflow(
  workflowState: string,
  posture: MissionControlWorkflowPosture,
  hasCancelRequest: boolean,
): boolean {
  return !isTerminalState(workflowState)
    && workflowState !== 'paused'
    && posture !== 'paused'
    && posture !== 'cancelling'
    && !hasCancelRequest;
}

function buildWorkflowAction(
  kind: MissionControlActionKind,
  enabled: boolean,
  confirmationLevel: MissionControlConfirmationLevel,
  stale: boolean,
  disabledReason: string | null,
): MissionControlActionAvailability {
  return buildAction(kind, 'workflow', enabled, confirmationLevel, stale, disabledReason);
}

function buildTaskAction(
  kind: MissionControlActionKind,
  enabled: boolean,
  confirmationLevel: MissionControlConfirmationLevel,
  stale: boolean,
): MissionControlActionAvailability {
  return buildAction(kind, 'task', enabled, confirmationLevel, stale, null);
}

function buildAction(
  kind: MissionControlActionKind,
  scope: MissionControlActionAvailability['scope'],
  enabled: boolean,
  confirmationLevel: MissionControlConfirmationLevel,
  stale: boolean,
  disabledReason: string | null,
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
    disabledReason: enabled ? null : disabledReason ?? 'Action is not available in the current workflow state.',
  };
}

function explainPauseDisabled(workflowState: string, hasCancelRequest: boolean): string {
  if (hasCancelRequest) {
    return 'Workflow cancellation is already in progress.';
  }
  if (workflowState === 'paused') {
    return 'Workflow is already paused.';
  }
  if (workflowState === 'pending') {
    return 'Only active workflows can be paused.';
  }
  if (workflowState === 'cancelled') {
    return 'Cancelled workflows cannot be paused.';
  }
  if (workflowState === 'completed') {
    return 'Completed workflows cannot be paused.';
  }
  if (workflowState === 'failed') {
    return 'Failed workflows cannot be paused.';
  }
  return 'Action is not available in the current workflow state.';
}

function explainResumeDisabled(workflowState: string, hasCancelRequest: boolean): string {
  if (hasCancelRequest) {
    return 'Workflow cancellation is already in progress and cannot be resumed.';
  }
  if (workflowState === 'cancelled') {
    return 'Cancelled workflows cannot be resumed.';
  }
  if (workflowState === 'completed') {
    return 'Completed workflows cannot be resumed.';
  }
  if (workflowState === 'failed') {
    return 'Failed workflows cannot be resumed.';
  }
  if (workflowState === 'active' || workflowState === 'pending') {
    return 'Workflow is not paused.';
  }
  return 'Action is not available in the current workflow state.';
}

function explainCancelDisabled(workflowState: string, hasCancelRequest: boolean): string {
  if (hasCancelRequest || workflowState === 'cancelling') {
    return 'Workflow cancellation is already in progress.';
  }
  if (workflowState === 'pending') {
    return 'Pending workflows can be cancelled before work starts.';
  }
  if (workflowState === 'cancelled') {
    return 'Workflow is already cancelled.';
  }
  if (workflowState === 'completed') {
    return 'Completed workflows cannot be cancelled.';
  }
  if (workflowState === 'failed') {
    return 'Failed workflows cannot be cancelled.';
  }
  return 'Action is not available in the current workflow state.';
}

function explainWorkflowSteeringDisabled(
  workflowState: string,
  posture: MissionControlWorkflowPosture,
  hasCancelRequest: boolean,
): string {
  if (hasCancelRequest || posture === 'cancelling') {
    return 'Workflow cancellation is already in progress.';
  }
  if (workflowState === 'paused' || posture === 'paused') {
    return 'Resume the workflow before applying this action.';
  }
  if (workflowState === 'cancelled') {
    return 'Cancelled workflows cannot accept new work.';
  }
  if (workflowState === 'completed') {
    return 'Completed workflows cannot accept new work.';
  }
  if (workflowState === 'failed') {
    return 'Redrive the workflow before applying this action.';
  }
  return 'Action is not available in the current workflow state.';
}
