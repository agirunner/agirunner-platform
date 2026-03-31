import { describe, expect, it } from 'vitest';

import { deriveMissionControlPosture } from '../../../../src/services/workflow-operations/mission-control-posture.js';

describe('mission control posture', () => {
  it('classifies approval waits as needs_decision ahead of coarse active state', () => {
    const posture = deriveMissionControlPosture({
      workflowState: 'active',
      hasPauseRequest: false,
      hasCancelRequest: false,
      waitingForDecisionCount: 1,
      openEscalationCount: 0,
      blockedWorkItemCount: 0,
      failedTaskCount: 0,
      recoverableIssueCount: 0,
      activeTaskCount: 0,
      activeWorkItemCount: 0,
      pendingWorkItemCount: 1,
      recentOutputCount: 0,
      waitingReason: 'Waiting on approval for release gate',
    });

    expect(posture).toEqual(
      expect.objectContaining({
        posture: 'needs_decision',
        attentionLane: 'needs_decision',
        pulse: expect.objectContaining({
          summary: 'Waiting on approval for release gate',
          tone: 'waiting',
        }),
      }),
    );
  });

  it('classifies failed but recoverable runs as recoverable_needs_steering', () => {
    const posture = deriveMissionControlPosture({
      workflowState: 'failed',
      hasPauseRequest: false,
      hasCancelRequest: false,
      waitingForDecisionCount: 0,
      openEscalationCount: 0,
      blockedWorkItemCount: 1,
      failedTaskCount: 1,
      recoverableIssueCount: 1,
      activeTaskCount: 0,
      activeWorkItemCount: 0,
      pendingWorkItemCount: 0,
      recentOutputCount: 0,
      blockerReason: 'Verification failed twice but the operator can steer a replan',
    });

    expect(posture).toEqual(
      expect.objectContaining({
        posture: 'recoverable_needs_steering',
        attentionLane: 'needs_intervention',
        pulse: expect.objectContaining({
          summary: 'Verification failed twice but the operator can steer a replan',
          tone: 'critical',
        }),
      }),
    );
  });

  it('classifies idle queued workflows as waiting_by_design', () => {
    const posture = deriveMissionControlPosture({
      workflowState: 'pending',
      hasPauseRequest: false,
      hasCancelRequest: false,
      waitingForDecisionCount: 0,
      openEscalationCount: 0,
      blockedWorkItemCount: 0,
      failedTaskCount: 0,
      recoverableIssueCount: 0,
      activeTaskCount: 0,
      activeWorkItemCount: 0,
      pendingWorkItemCount: 2,
      recentOutputCount: 0,
    });

    expect(posture).toEqual(
      expect.objectContaining({
        posture: 'waiting_by_design',
        attentionLane: 'watchlist',
        pulse: expect.objectContaining({
          summary: 'Workflow is queued for the next workflow event',
          tone: 'waiting',
        }),
      }),
    );
  });

  it('avoids the vague waiting-by-design summary when no concrete waiting reason exists', () => {
    const posture = deriveMissionControlPosture({
      workflowState: 'pending',
      hasPauseRequest: false,
      hasCancelRequest: false,
      waitingForDecisionCount: 0,
      openEscalationCount: 0,
      blockedWorkItemCount: 0,
      failedTaskCount: 0,
      recoverableIssueCount: 0,
      activeTaskCount: 0,
      activeWorkItemCount: 0,
      pendingWorkItemCount: 0,
      recentOutputCount: 0,
    });

    expect(posture.pulse.summary).toBe('No work is running right now');
  });

  it('classifies cancellation-in-progress separately from a true paused workflow', () => {
    const posture = deriveMissionControlPosture({
      workflowState: 'paused',
      hasPauseRequest: false,
      hasCancelRequest: true,
      waitingForDecisionCount: 0,
      openEscalationCount: 0,
      blockedWorkItemCount: 0,
      failedTaskCount: 0,
      recoverableIssueCount: 0,
      activeTaskCount: 0,
      activeWorkItemCount: 1,
      pendingWorkItemCount: 0,
      recentOutputCount: 0,
    });

    expect(posture).toEqual(
      expect.objectContaining({
        posture: 'cancelling',
        attentionLane: 'watchlist',
        pulse: expect.objectContaining({
          summary: 'Workflow cancellation is in progress',
          tone: 'waiting',
        }),
      }),
    );
  });
});
