import { describe, expect, it } from 'vitest';

import {
  normalizeEntityStatus,
  readTaskEntityStatus,
  readWorkflowEntityStatus,
} from './use-cascading-entities.js';

describe('useCascadingEntities helpers', () => {
  it('treats canonical active states as active', () => {
    expect(normalizeEntityStatus('active')).toBe('active');
    expect(normalizeEntityStatus('in_progress')).toBe('active');
  });

  it('does not treat legacy running as a live active state', () => {
    expect(normalizeEntityStatus('running')).toBe('pending');
  });

  it('prefers canonical workflow state over legacy status fallback', () => {
    expect(
      readWorkflowEntityStatus({
        id: 'workflow-1',
        name: 'Workflow',
        state: 'failed',
        status: 'active',
      }),
    ).toBe('failed');
  });

  it('falls back to legacy task status only when canonical state is absent', () => {
    expect(
      readTaskEntityStatus({
        id: 'task-1',
        title: 'Task',
        status: 'completed',
      }),
    ).toBe('completed');
  });
});
