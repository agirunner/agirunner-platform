import { describe, expect, it } from 'vitest';

import {
  STATUS_FILTERS,
  TASK_LIST_PAGE_SIZE,
  buildTaskSearchText,
  describeTaskKind,
  describeTaskNextAction,
  describeTaskScope,
  formatRelativeTime,
  formatTaskDuration,
  formatStatusLabel,
  normalizeTaskListRecords,
  readTaskRecoveryCue,
  resolveTaskStatus,
  statusBadgeVariant,
  summarizeTaskPosture,
} from './task-list-page.support.js';
import {
  buildTaskDiagnosticAction,
  buildTaskPrimaryOperatorAction,
} from './task-list-page.actions.js';

describe('task list page support', () => {
  it('describes v2 step kind, scope, and next action', () => {
    const approvalTask = {
      id: 'task-1',
      status: 'awaiting_approval',
      workflow_id: 'workflow-1',
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
      'Review and approve this step from the grouped work-item flow.',
    );
    expect(buildTaskPrimaryOperatorAction(approvalTask)).toEqual({
      href: '/work/boards/workflow-1?work_item=work-item-12345678&activation=activation-12345678#work-item-work-item-12345678',
      label: 'Open work-item flow',
      helper: 'Review this step from the grouped work-item flow so board context stays aligned.',
      showsDiagnosticLink: true,
    });
    expect(buildTaskDiagnosticAction(approvalTask)).toEqual({
      href: '/work/tasks/task-1',
      label: 'Open step diagnostics',
    });
  });

  it('routes workflow-linked tasks through the workflow flow, not the step record', () => {
    // Stage-only: primary routes to workflow context, diagnostic to step record
    expect(
      buildTaskPrimaryOperatorAction({
        id: 'task-stage',
        status: 'failed',
        workflow_id: 'workflow-1',
        stage_name: 'review',
        created_at: '2026-03-12T12:00:00.000Z',
      }),
    ).toEqual({
      href: '/work/boards/workflow-1?gate=review#gate-review',
      label: 'Open workflow context',
      helper:
        'Review this step in its workflow stage context. Step diagnostics are available separately when you need execution details.',
      showsDiagnosticLink: true,
    });
    expect(
      buildTaskDiagnosticAction({
        id: 'task-stage',
        status: 'failed',
        workflow_id: 'workflow-1',
        stage_name: 'review',
        created_at: '2026-03-12T12:00:00.000Z',
      }),
    ).toEqual({
      href: '/work/tasks/task-stage',
      label: 'Open failed step diagnostics',
    });

    // Workflow-only: primary routes to board, diagnostic to step record
    expect(
      buildTaskPrimaryOperatorAction({
        id: 'task-board',
        status: 'in_progress',
        workflow_id: 'workflow-2',
        created_at: '2026-03-12T12:00:00.000Z',
      }),
    ).toEqual({
      href: '/work/boards/workflow-2',
      label: 'Open workflow board',
      helper:
        'This step is linked to a workflow. Use the board for operator decisions so workflow state stays aligned.',
      showsDiagnosticLink: true,
    });
    expect(
      buildTaskDiagnosticAction({
        id: 'task-board',
        status: 'in_progress',
        workflow_id: 'workflow-2',
        created_at: '2026-03-12T12:00:00.000Z',
      }),
    ).toEqual({
      href: '/work/tasks/task-board',
      label: 'Open step diagnostics',
    });

    // Standalone: primary stays on step record, no diagnostic
    expect(
      buildTaskPrimaryOperatorAction({
        id: 'task-direct',
        status: 'failed',
        created_at: '2026-03-12T12:00:00.000Z',
      }),
    ).toEqual({
      href: '/work/tasks/task-direct',
      label: 'Open step record',
      helper: 'Open the step record for full context and recent activity.',
      showsDiagnosticLink: false,
    });
    expect(
      buildTaskDiagnosticAction({
        id: 'task-direct',
        status: 'failed',
        created_at: '2026-03-12T12:00:00.000Z',
      }),
    ).toBeNull();
  });

  it('includes workflow flow description in next action guidance for all workflow-linked tasks', () => {
    expect(
      describeTaskNextAction({
        id: 'task-stage-review',
        status: 'awaiting_approval',
        workflow_id: 'workflow-1',
        stage_name: 'review',
        created_at: '2026-03-12T12:00:00.000Z',
      }),
    ).toBe('Review and approve this step from the workflow stage context.');

    expect(
      describeTaskNextAction({
        id: 'task-board-only',
        status: 'failed',
        workflow_id: 'workflow-1',
        created_at: '2026-03-12T12:00:00.000Z',
      }),
    ).toBe(
      'Inspect the failure from the workflow board and choose retry, rework, or escalation.',
    );

    // Standalone tasks get generic language without flow reference
    expect(
      describeTaskNextAction({
        id: 'task-standalone',
        status: 'failed',
        created_at: '2026-03-12T12:00:00.000Z',
      }),
    ).toBe('Inspect the failure and choose retry, rework, or escalation.');
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
    expect(formatStatusLabel('output_pending_assessment')).toBe('Output Pending Assessment');
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
      assessment: 1,
      recovery: 1,
      orchestrator: 1,
    });
    expect(buildTaskSearchText(tasks[4])).toContain('release train');
    expect(buildTaskSearchText(tasks[4])).toContain('verify');
  });

  it('reads recovery cues that match the current operator posture', () => {
    expect(
      readTaskRecoveryCue({
        id: 'task-failed',
        status: 'failed',
        created_at: '2026-03-12T12:00:00.000Z',
      }),
    ).toBe(
      'Failure is blocking downstream work. Inspect diagnostics, then choose retry, rework, or escalation.',
    );
    expect(
      readTaskRecoveryCue({
        id: 'task-review',
        status: 'output_pending_assessment',
        created_at: '2026-03-12T12:00:00.000Z',
      }),
    ).toBe(
      'Output is ready for assessment. Validate the packet, then approve or request targeted changes.',
    );
    expect(
      readTaskRecoveryCue({
        id: 'task-orchestrator',
        status: 'in_progress',
        is_orchestrator_task: true,
        created_at: '2026-03-12T12:00:00.000Z',
      }),
    ).toBe(
      'Watch this orchestrator turn for new work items, gates, or retries before leaving the queue.',
    );
  });

  it('exports the shared page constants and task normalization helpers', () => {
    expect(STATUS_FILTERS[0]).toBe('all');
    expect(TASK_LIST_PAGE_SIZE).toBe(20);
    expect(
      normalizeTaskListRecords({
        data: [{ id: 'task-9', status: 'ready', created_at: '2026-03-12T12:00:00.000Z' }],
      }),
    ).toHaveLength(1);
  });
});
