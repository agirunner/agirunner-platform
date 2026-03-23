import { describe, expect, it } from 'vitest';

import {
  buildApprovalQueueSummary,
  buildTaskContextPacket,
} from './alerts-approvals-page.support.js';

describe('alerts approvals support', () => {
  it('prioritizes stage gates and reports the oldest queued age', () => {
    const summary = buildApprovalQueueSummary({
      stageGates: [{ requested_at: '2026-03-12T10:00:00.000Z' }],
      approvals: [{ created_at: '2026-03-12T10:15:00.000Z' }],
      outputGates: [],
      escalations: [],
      failures: [{ created_at: '2026-03-12T10:30:00.000Z' }],
      nowMs: Date.parse('2026-03-12T11:00:00.000Z'),
    });

    expect(summary.total).toBe(3);
    expect(summary.primaryLane).toBe('Stage gates first');
    expect(summary.oldestAgeLabel).toBe('Oldest waiting 1h');
  });

  it('falls back to queue clear when nothing needs operator action', () => {
    const summary = buildApprovalQueueSummary({
      stageGates: [],
      approvals: [],
      outputGates: [],
      escalations: [],
      failures: [],
      nowMs: Date.parse('2026-03-12T11:00:00.000Z'),
    });

    expect(summary.primaryLane).toBe('Queue clear');
    expect(summary.oldestAgeLabel).toBe('No queued work');
  });

  it('builds direct context links and facts for workflow-owned queue tasks', () => {
    const packet = buildTaskContextPacket({
      id: 'task-abcdef12',
      workflow_id: 'workflow-12345678',
      work_item_id: 'workitem-87654321',
      activation_id: 'activation-345',
      stage_name: 'qa',
      depends_on: ['task-upstream-1', 'task-upstream-2'],
      assigned_worker_id: 'worker-778899',
    });

    expect(packet).toEqual({
      facts: [
        { label: 'Stage', value: 'qa' },
        { label: 'Work item', value: 'workitem' },
        { label: 'Upstream steps', value: '2' },
        { label: 'Assigned worker', value: 'worker-7' },
      ],
      links: [
        {
          label: 'Open work item flow',
          to: '/work/boards/workflow-12345678?work_item=workitem-87654321&activation=activation-345#work-item-workitem-87654321',
          priority: 'primary',
        },
        {
          label: 'Open board context',
          to: '/work/boards/workflow-12345678',
          priority: 'secondary',
        },
        {
          label: 'Open step diagnostics',
          to: '/work/tasks/task-abcdef12',
          priority: 'secondary',
        },
      ],
    });
  });

  it('keeps standalone queue tasks directly actionable', () => {
    const packet = buildTaskContextPacket({
      id: 'task-abcdef12',
      stage_name: 'triage',
    });

    expect(packet).toEqual({
      facts: [{ label: 'Stage', value: 'triage' }],
      links: [
        {
          label: 'Open step detail',
          to: '/work/tasks/task-abcdef12',
          priority: 'secondary',
        },
      ],
    });
  });
});
