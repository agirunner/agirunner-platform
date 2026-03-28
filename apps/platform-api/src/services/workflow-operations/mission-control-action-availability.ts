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
      canAddWork(input.workflowState, input.posture, hasCancelRequest),
      'standard_confirm',
      stale,
    ),
    buildWorkflowAction(
      'request_replan',
      canReplan(input.workflowState, input.posture, hasCancelRequest),
      'standard_confirm',
      stale,
    ),
    buildWorkflowAction(
      'spawn_child_workflow',
      canSpawnChildWorkflow(input.workflowState, input.posture, hasCancelRequest),
      'high_impact_confirm',
      stale,
    ),
    buildWorkflowAction(
      'redrive_workflow',
      isTerminalState(input.workflowState),
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
    (workflowState === 'pending' || workflowState === 'active')
    && posture !== 'paused'
    && !hasCancelRequest
  );
}

function canResume(
  workflowState: string,
  posture: MissionControlWorkflowPosture,
  hasCancelRequest: boolean,
): boolean {
  return workflowState === 'paused' && posture === 'paused' && !hasCancelRequest;
}

function canCancel(workflowState: string, hasCancelRequest: boolean): boolean {
  return !isTerminalState(workflowState)
    && workflowState !== 'cancelling'
    && !hasCancelRequest;
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
