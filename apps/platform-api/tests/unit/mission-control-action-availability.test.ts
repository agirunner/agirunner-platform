import { describe, expect, it } from 'vitest';

import {
  deriveTaskActionAvailability,
  deriveWorkflowActionAvailability,
} from '../../src/services/workflow-operations/mission-control-action-availability.js';

describe('mission control action availability', () => {
  it('enables workflow actions with platform-authored confirmation levels', () => {
    const actions = deriveWorkflowActionAvailability({
      workflowState: 'active',
      posture: 'progressing',
    });

    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'pause_workflow',
          enabled: true,
          confirmationLevel: 'immediate',
        }),
        expect.objectContaining({
          kind: 'cancel_workflow',
          enabled: true,
          confirmationLevel: 'high_impact_confirm',
        }),
        expect.objectContaining({
          kind: 'add_work_item',
          enabled: true,
          confirmationLevel: 'standard_confirm',
        }),
      ]),
    );
  });

  it('enables redrive but not add-work on terminal failed workflows', () => {
    const actions = deriveWorkflowActionAvailability({
      workflowState: 'failed',
      posture: 'terminal_failed',
    });

    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'redrive_workflow',
          enabled: true,
          confirmationLevel: 'high_impact_confirm',
        }),
        expect.objectContaining({
          kind: 'add_work_item',
          enabled: false,
        }),
      ]),
    );
  });

  it('disables all actions when the read model is stale', () => {
    const actions = deriveWorkflowActionAvailability({
      workflowState: 'active',
      posture: 'needs_intervention',
      version: {
        readModelEventId: 8,
        latestEventId: 9,
      },
    });

    expect(actions.every((action) => action.enabled === false && action.stale)).toBe(true);
    expect(actions[0]?.disabledReason).toBe(
      'Mission Control view is stale. Refresh before applying this action.',
    );
  });

  it('enables task recovery and escalation actions from platform state', () => {
    const actions = deriveTaskActionAvailability({
      workflowState: 'active',
      posture: 'recoverable_needs_steering',
      taskState: 'failed',
      hasPendingDecision: false,
      escalationStatus: 'open',
    });

    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'retry_task',
          enabled: true,
        }),
        expect.objectContaining({
          kind: 'resolve_escalation',
          enabled: true,
        }),
        expect.objectContaining({
          kind: 'approve_task',
          enabled: false,
        }),
      ]),
    );
  });
});
