import {
  type MissionControlAttentionLane,
  type MissionControlPulse,
  type MissionControlWorkflowPosture,
} from './types.js';

export interface MissionControlPostureInput {
  workflowState: string;
  hasPauseRequest: boolean;
  hasCancelRequest: boolean;
  waitingForDecisionCount: number;
  openEscalationCount: number;
  blockedWorkItemCount: number;
  failedTaskCount: number;
  recoverableIssueCount: number;
  activeTaskCount: number;
  activeWorkItemCount: number;
  pendingWorkItemCount: number;
  recentOutputCount: number;
  currentActivitySummary?: string | null;
  waitingReason?: string | null;
  blockerReason?: string | null;
  updatedAt?: string | null;
}

export interface MissionControlDerivedPosture {
  posture: MissionControlWorkflowPosture;
  attentionLane: MissionControlAttentionLane;
  pulse: MissionControlPulse;
}

export function deriveMissionControlPosture(
  input: MissionControlPostureInput,
): MissionControlDerivedPosture {
  if (input.workflowState === 'cancelled') {
    return buildResult('cancelled', 'watchlist', buildPulse('Workflow was cancelled', 'settled', input));
  }

  if (input.hasCancelRequest) {
    return buildResult(
      'cancelling',
      'watchlist',
      buildPulse('Workflow cancellation is in progress', 'waiting', input),
    );
  }

  if (input.hasPauseRequest || input.workflowState === 'paused') {
    return buildResult('paused', 'watchlist', buildPulse('Workflow is paused', 'waiting', input));
  }

  if (input.workflowState === 'completed') {
    return buildResult('completed', 'watchlist', buildPulse('Workflow completed', 'settled', input));
  }

  if (input.recoverableIssueCount > 0) {
    return buildResult(
      'recoverable_needs_steering',
      'needs_intervention',
      buildPulse(
        input.blockerReason ?? input.currentActivitySummary ?? 'Workflow can continue with operator steering',
        input.failedTaskCount > 0 ? 'critical' : 'warning',
        input,
      ),
    );
  }

  if (input.workflowState === 'failed') {
    return buildResult(
      'terminal_failed',
      'needs_intervention',
      buildPulse(
        input.blockerReason ?? input.currentActivitySummary ?? 'Workflow failed and needs redrive',
        'critical',
        input,
      ),
    );
  }

  if (input.waitingForDecisionCount > 0) {
    return buildResult(
      'needs_decision',
      'needs_decision',
      buildPulse(
        input.waitingReason ?? 'Waiting on an operator decision',
        'waiting',
        input,
      ),
    );
  }

  if (
    input.hasCancelRequest
    || input.openEscalationCount > 0
    || input.blockedWorkItemCount > 0
    || input.failedTaskCount > 0
  ) {
    return buildResult(
      'needs_intervention',
      'needs_intervention',
      buildPulse(
        input.blockerReason ?? input.currentActivitySummary ?? 'Workflow needs operator intervention',
        input.failedTaskCount > 0 ? 'critical' : 'warning',
        input,
      ),
    );
  }

  if (
    input.activeTaskCount > 0
    || input.activeWorkItemCount > 0
    || input.workflowState === 'active'
  ) {
    return buildResult(
      'progressing',
      'watchlist',
      buildPulse(
        input.currentActivitySummary ?? 'Workflow is progressing',
        'progressing',
        input,
      ),
    );
  }

  return buildResult(
    'waiting_by_design',
    'watchlist',
    buildPulse(
      input.waitingReason
        ?? describeWaitingState(input.pendingWorkItemCount, input.recentOutputCount),
      'waiting',
      input,
    ),
  );
}

function describeWaitingState(pendingWorkItemCount: number, recentOutputCount: number): string {
  if (pendingWorkItemCount > 0) {
    return 'Workflow is queued for the next workflow event';
  }
  if (recentOutputCount > 0) {
    return 'Workflow is waiting after the latest output change';
  }
  return 'No work is running right now';
}

function buildPulse(
  summary: string,
  tone: MissionControlPulse['tone'],
  input: MissionControlPostureInput,
): MissionControlPulse {
  return {
    summary,
    tone,
    updatedAt: input.updatedAt ?? null,
  };
}

function buildResult(
  posture: MissionControlWorkflowPosture,
  attentionLane: MissionControlAttentionLane,
  pulse: MissionControlPulse,
): MissionControlDerivedPosture {
  return {
    posture,
    attentionLane,
    pulse,
  };
}
