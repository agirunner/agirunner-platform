import { describe, expect, it } from 'vitest';

import { isTaskState, isTaskStateChangedEvent } from './index.js';

describe('@agentbaton/shared-types guards', () => {
  it('validates known task states', () => {
    expect(isTaskState('running')).toBe(true);
    expect(isTaskState('unknown')).toBe(false);
  });

  it('validates task.state_changed event envelopes', () => {
    const validPayload = {
      type: 'task.state_changed',
      task_id: 'task-123',
      previous_state: 'claimed',
      state: 'running',
    };

    const invalidPayload = {
      type: 'task.state_changed',
      task_id: 'task-123',
      previous_state: 'claimed',
      state: 'invalid-state',
    };

    expect(isTaskStateChangedEvent(validPayload)).toBe(true);
    expect(isTaskStateChangedEvent(invalidPayload)).toBe(false);
  });
});
