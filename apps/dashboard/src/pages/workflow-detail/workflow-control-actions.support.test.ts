import { describe, expect, it } from 'vitest';

import { getWorkflowControlAvailability } from './workflow-control-actions.support.js';

describe('workflow control action availability', () => {
  it('only allows pause and cancel for active workflows', () => {
    expect(getWorkflowControlAvailability({ state: 'pending' })).toEqual({
      canPause: false,
      canResume: false,
      canCancel: false,
    });
    expect(getWorkflowControlAvailability({ state: 'active' })).toEqual({
      canPause: true,
      canResume: false,
      canCancel: true,
    });
  });

  it('allows resume and cancel for paused workflows', () => {
    expect(getWorkflowControlAvailability({ state: 'paused' })).toEqual({
      canPause: false,
      canResume: true,
      canCancel: true,
    });
  });

  it('hides controls for terminal workflows', () => {
    expect(getWorkflowControlAvailability({ state: 'completed' })).toEqual({
      canPause: false,
      canResume: false,
      canCancel: false,
    });
    expect(getWorkflowControlAvailability({ state: 'failed' })).toEqual({
      canPause: false,
      canResume: false,
      canCancel: false,
    });
    expect(getWorkflowControlAvailability({ state: 'cancelled' })).toEqual({
      canPause: false,
      canResume: false,
      canCancel: false,
    });
  });

  it('falls back to workflow state when the action list is empty', () => {
    expect(
      getWorkflowControlAvailability({
        state: 'paused',
        availableActions: [],
      }),
    ).toEqual({
      canPause: false,
      canResume: true,
      canCancel: true,
    });
  });

  it('ignores non-workflow scoped action rows when deciding header controls', () => {
    expect(
      getWorkflowControlAvailability({
        state: 'active',
        availableActions: [
          {
            kind: 'pause_workflow',
            scope: 'task',
            enabled: true,
          },
          {
            kind: 'cancel_workflow',
            scope: 'work_item',
            enabled: true,
          },
        ],
      }),
    ).toEqual({
      canPause: false,
      canResume: false,
      canCancel: false,
    });
  });
});
