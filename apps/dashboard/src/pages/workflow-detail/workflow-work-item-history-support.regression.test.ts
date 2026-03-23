import { describe, expect, it, vi } from 'vitest';

vi.mock('./workflow-history-card.js', () => ({
  describeTimelineEvent: () => ({
    headline: { label: 'Structured failure headline' },
    summary: { message: 'Structured failure summary' },
    scopeSummary: { summary: 'Actor QA • Stage review' },
    emphasisLabel: { title: 'Needs review' },
    emphasisTone: 'warning',
    signalBadges: [{ label: 'qa' }, { name: 'follow-up' }],
    stageName: { name: 'review' },
    workItemId: { id: 'workitem-12345678' },
    taskId: { id: 'task-abcdef12' },
    actor: { label: 'Agent qa-7' },
  }),
}));

vi.mock('./workflow-detail-presentation.js', () => ({
  formatRelativeTimestamp: () => '5m ago',
}));

import { buildWorkItemHistoryPacket } from './workflow-work-item-history-support.js';

describe('workflow work-item history support regression', () => {
  it('coerces object-valued history fields into safe display text', () => {
    const packet = buildWorkItemHistoryPacket({
      id: 'event-structured',
      type: 'task.failed',
      entity_type: 'task',
      entity_id: 'task-abcdef12',
      actor_type: 'agent',
      actor_id: 'agent-qa-7',
      created_at: '2026-03-13T00:00:00Z',
      data: {
        summary: { message: 'Pytest failed' },
        stage_name: { name: 'review' },
      },
    });

    expect(packet).toEqual({
      id: 'event-structured',
      headline: 'Structured failure headline',
      summary: 'Structured failure summary',
      scopeSummary: 'Actor QA • Stage review',
      emphasisLabel: 'Needs review',
      emphasisTone: 'warning',
      signalBadges: ['qa', 'follow-up'],
      stageName: 'review',
      workItemId: 'workitem-12345678',
      taskId: 'task-abcdef12',
      actor: 'Agent qa-7',
      createdAtLabel: '5m ago',
      createdAtTitle: new Date('2026-03-13T00:00:00Z').toLocaleString(),
      payload: {
        summary: { message: 'Pytest failed' },
        stage_name: { name: 'review' },
      },
    });
  });
});
