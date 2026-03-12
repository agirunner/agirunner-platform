import { describe, expect, it } from 'vitest';

import { summarizeTasks } from './workflow-detail-support.js';

describe('workflow detail support', () => {
  it('normalizes legacy task aliases before building mission-control summaries', () => {
    expect(
      summarizeTasks([
        { state: 'ready' },
        { state: 'running' },
        { state: 'awaiting_escalation' },
        { state: 'completed' },
      ]),
    ).toEqual({
      total: 4,
      ready: 1,
      in_progress: 1,
      blocked: 1,
      completed: 1,
      failed: 0,
    });
  });
});
