import { describe, expect, it } from 'vitest';

import {
  describeTaskGraphPacket,
  summarizeTasks,
} from './workflow-detail-support.js';

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

describe('workflow task graph packet', () => {
  it('turns dependency ids and timestamps into operator-readable task graph copy', () => {
    const packet = describeTaskGraphPacket(
      {
        id: 'task-child',
        title: 'Review release candidate',
        state: 'in_progress',
        depends_on: ['task-parent'],
        role: 'reviewer',
        stage_name: 'review',
        created_at: '2026-03-12T11:45:00.000Z',
      },
      [
        {
          id: 'task-parent',
          title: 'Build release candidate',
          state: 'completed',
          depends_on: [],
        },
        {
          id: 'task-child',
          title: 'Review release candidate',
          state: 'in_progress',
          depends_on: ['task-parent'],
          role: 'reviewer',
          stage_name: 'review',
          created_at: '2026-03-12T11:45:00.000Z',
        },
      ],
      new Date('2026-03-12T12:00:00.000Z').getTime(),
    );

    expect(packet).toEqual({
      focus: 'reviewer • stage review',
      upstream: 'Build release candidate',
      timing: 'Queued 15m ago',
    });
  });
});
