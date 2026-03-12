import { describe, expect, it } from 'vitest';

import {
  buildTaskSearchText,
  describeTaskKind,
  describeTaskNextAction,
  describeTaskScope,
  formatRelativeTime,
  formatTaskDuration,
  formatStatusLabel,
  resolveTaskStatus,
  statusBadgeVariant,
  summarizeTaskPosture,
} from './task-list-page.support.js';

describe('task list page support', () => {
  it('describes v2 step kind, scope, and next action', () => {
    const approvalTask = {
      id: 'task-1',
      status: 'awaiting_approval',
      stage_name: 'review',
      work_item_id: 'work-item-12345678',
      activation_id: 'activation-12345678',
      created_at: '2026-03-12T12:00:00.000Z',
    };

    expect(resolveTaskStatus(approvalTask)).toBe('awaiting_approval');
    expect(describeTaskKind(approvalTask)).toBe('Operator approval');
    expect(describeTaskScope(approvalTask)).toBe(
      'Stage review • Work item work-ite…5678 • Activation activati…5678',
    );
    expect(describeTaskNextAction(approvalTask)).toBe(
      'Review and approve the step output.',
    );
  });

  it('formats timing and status labels for operator scanning', () => {
    expect(
      formatTaskDuration(
        {
          id: 'task-2',
          status: 'in_progress',
          started_at: '2026-03-12T11:45:00.000Z',
          created_at: '2026-03-12T11:40:00.000Z',
        },
        new Date('2026-03-12T12:00:00.000Z').getTime(),
      ),
    ).toBe('15m 0s');
    expect(
      formatRelativeTime(
        '2026-03-12T11:15:00.000Z',
        new Date('2026-03-12T12:00:00.000Z').getTime(),
      ),
    ).toBe('45m ago');
    expect(formatStatusLabel('output_pending_review')).toBe('Output Pending Review');
    expect(statusBadgeVariant('failed')).toBe('destructive');
  });

  it('summarizes posture and builds the task search index text', () => {
    const tasks = [
      { id: 'task-1', status: 'ready', created_at: '2026-03-12T12:00:00.000Z' },
      { id: 'task-2', status: 'in_progress', created_at: '2026-03-12T12:00:00.000Z' },
      { id: 'task-3', status: 'awaiting_approval', created_at: '2026-03-12T12:00:00.000Z' },
      { id: 'task-4', status: 'escalated', created_at: '2026-03-12T12:00:00.000Z' },
      {
        id: 'task-5',
        status: 'in_progress',
        is_orchestrator_task: true,
        workflow_name: 'Release train',
        stage_name: 'verify',
        created_at: '2026-03-12T12:00:00.000Z',
      },
    ];

    expect(summarizeTaskPosture(tasks)).toEqual({
      active: 2,
      ready: 1,
      review: 1,
      recovery: 1,
      orchestrator: 1,
    });
    expect(buildTaskSearchText(tasks[4])).toContain('release train');
    expect(buildTaskSearchText(tasks[4])).toContain('verify');
  });
});
