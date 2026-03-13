import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildWorkItemHistoryOverview,
  buildWorkItemHistoryPacket,
} from './workflow-work-item-history-support.js';

describe('workflow work-item history support', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds operator-ready history overview metrics from the latest activity', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-12T22:00:00Z'));

    const overview = buildWorkItemHistoryOverview([
      {
        id: 'event-2',
        type: 'task.failed',
        entity_type: 'task',
        entity_id: 'task-abcdef12',
        actor_type: 'agent',
        actor_id: 'agent-7',
        created_at: '2026-03-12T21:50:00Z',
        data: {
          task_title: 'Investigate failing smoke test',
          task_id: 'task-abcdef12',
          work_item_id: 'workitem-12345678',
          stage_name: 'qa',
          error: 'Pytest failed',
          role: 'qa',
        },
      },
      {
        id: 'event-1',
        type: 'work_item.created',
        entity_type: 'work_item',
        entity_id: 'workitem-12345678',
        actor_type: 'agent',
        actor_id: 'agent-2',
        created_at: '2026-03-12T21:30:00Z',
        data: {
          title: 'Stabilize smoke suite',
          work_item_id: 'workitem-12345678',
          stage_name: 'qa',
        },
      },
    ]);

    expect(overview).toEqual({
      focusLabel: 'Failure',
      focusTone: 'destructive',
      focusDetail: 'Actor Agent agent-7 • Stage qa • Work item workitem • Step task-abc',
      metrics: [
        {
          label: 'Activity packets',
          value: '2',
          detail: 'Newest activity is listed first for rapid review.',
        },
        {
          label: 'Attention signals',
          value: '1',
          detail: 'Warnings and failures that may need operator follow-up.',
        },
        {
          label: 'Linked stages',
          value: '1',
          detail: 'Distinct board stages represented in this history slice.',
        },
        {
          label: 'Linked steps',
          value: '1',
          detail: 'Specialist steps referenced by the recorded activity.',
        },
      ],
    });
  });

  it('builds a work-item history packet with scope and drill-in fields', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-12T22:00:00Z'));

    const packet = buildWorkItemHistoryPacket({
      id: 'event-2',
      type: 'task.failed',
      entity_type: 'task',
      entity_id: 'task-abcdef12',
      actor_type: 'agent',
      actor_id: 'agent-7',
      created_at: '2026-03-12T21:50:00Z',
      data: {
        task_title: 'Investigate failing smoke test',
        task_id: 'task-abcdef12',
        work_item_id: 'workitem-12345678',
        stage_name: 'qa',
        error: 'Pytest failed',
        role: 'qa',
      },
    });

    expect(packet).toEqual({
      id: 'event-2',
      headline: 'Step failed: Investigate failing smoke test',
      summary: 'Pytest failed',
      scopeSummary: 'Actor Agent agent-7 • Stage qa • Work item workitem • Step task-abc',
      emphasisLabel: 'Failure',
      emphasisTone: 'destructive',
      signalBadges: ['qa'],
      stageName: 'qa',
      workItemId: 'workitem-12345678',
      taskId: 'task-abcdef12',
      actor: 'Agent agent-7',
      createdAtLabel: '10m ago',
      createdAtTitle: new Date('2026-03-12T21:50:00Z').toLocaleString(),
      payload: {
        task_title: 'Investigate failing smoke test',
        task_id: 'task-abcdef12',
        work_item_id: 'workitem-12345678',
        stage_name: 'qa',
        error: 'Pytest failed',
        role: 'qa',
      },
    });
  });
});
