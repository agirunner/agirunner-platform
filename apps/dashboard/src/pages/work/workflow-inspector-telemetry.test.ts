import { describe, expect, it } from 'vitest';

import { buildWorkflowInspectorTelemetryModel } from './workflow-inspector-telemetry.js';

describe('workflow inspector telemetry', () => {
  it('builds spend packets and memory evolution summaries for the focused workflow trace', () => {
    const model = buildWorkflowInspectorTelemetryModel({
      workflowId: 'workflow-1',
      workflow: {
        id: 'workflow-1',
        name: 'Release board',
        state: 'active',
        created_at: '2026-03-10T00:00:00Z',
        work_items: [
          {
            id: 'work-item-1',
            workflow_id: 'workflow-1',
            stage_name: 'review',
            title: 'Review release notes',
            column_id: 'review',
            priority: 'high',
          },
          {
            id: 'work-item-2',
            workflow_id: 'workflow-1',
            stage_name: 'qa',
            title: 'QA verification',
            column_id: 'qa',
            priority: 'medium',
          },
        ],
        metadata: {
          run_summary: {
            orchestrator_analytics: {
              activation_count: 3,
              total_cost_usd: 6.75,
              cost_by_stage: [
                { stage_name: 'review', total_cost_usd: 4.5, task_count: 3 },
                { stage_name: 'qa', total_cost_usd: 2.25, task_count: 2 },
              ],
              cost_by_work_item: [
                { work_item_id: 'work-item-1', total_cost_usd: 4.5, task_count: 3 },
                { work_item_id: 'work-item-2', total_cost_usd: 2.25, task_count: 2 },
              ],
            },
          },
        },
      },
      taskCostStats: {
        data: {
          totals: { count: 12, error_count: 0, total_duration_ms: 2_000 },
          groups: [
            {
              group: 'task-123456789',
              count: 6,
              error_count: 0,
              total_duration_ms: 1_200,
              avg_duration_ms: 200,
              agg: { total_cost_usd: 1.75 },
            },
          ],
        },
      },
      activationCostStats: {
        data: {
          totals: { count: 5, error_count: 0, total_duration_ms: 900 },
          groups: [
            {
              group: 'activation-123456789',
              count: 5,
              error_count: 0,
              total_duration_ms: 900,
              avg_duration_ms: 180,
              agg: { total_cost_usd: 2.25 },
            },
          ],
        },
      },
      focusWorkItem: {
        id: 'work-item-1',
        title: 'Review release notes',
        stageName: 'review',
        nextExpectedActor: null,
        nextExpectedAction: null,
        unresolvedFindingsCount: 0,
        reviewFocusCount: 0,
        knownRiskCount: 0,
        latestHandoffCompletion: null,
      },
      memoryHistory: [
        {
          key: 'release_risk',
          value: { level: 'high' },
          event_id: 11,
          event_type: 'updated',
          updated_at: '2026-03-10T05:00:00Z',
          actor_type: 'agent',
          actor_id: 'agent-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: 'task-123456789',
          stage_name: 'review',
        },
        {
          key: 'release_risk',
          value: { level: 'medium' },
          event_id: 10,
          event_type: 'updated',
          updated_at: '2026-03-10T04:00:00Z',
          actor_type: 'agent',
          actor_id: 'agent-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: 'task-123456789',
          stage_name: 'review',
        },
        {
          key: 'release_notes',
          value: 'Ready for QA',
          event_id: 9,
          event_type: 'deleted',
          updated_at: '2026-03-10T03:00:00Z',
          actor_type: 'system',
          actor_id: null,
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: null,
          stage_name: 'review',
        },
      ],
      now: Date.parse('2026-03-10T05:30:00Z'),
    });

    expect(model.spendPackets).toEqual([
      {
        label: 'Stage cost leader',
        value: '$4.5000',
        detail: 'review is leading reported stage spend across 3 steps.',
        href: '/work/boards/workflow-1/inspector?view=detailed&stage=review',
      },
      {
        label: 'Task cost leader',
        value: '$1.7500',
        detail:
          'Step task-123 leads the current log slice across 6 trace entries • 200 ms average recorded duration.',
        href: '/work/boards/workflow-1/inspector?view=detailed&task=task-123456789',
      },
      {
        label: 'Activation cost leader',
        value: '$2.2500',
        detail:
          'Activation activati is carrying the highest orchestrator batch spend across 5 trace entries.',
        href:
          '/work/boards/workflow-1/inspector?view=detailed&activation=activation-123456789',
      },
    ]);
    expect(model.executionSummaryPackets).toEqual([
      {
        label: 'Stage spend coverage',
        value: '$6.7500',
        detail: '2 recorded stages across 5 contributing steps.',
        sourceLabel: 'Workflow run summary',
        href: '/work/boards/workflow-1/inspector?view=detailed',
      },
      {
        label: 'Task spend coverage',
        value: '$1.7500',
        detail: '1 traced step across 12 trace entries • 2.00 s total recorded duration.',
        sourceLabel: 'Inspector log slice',
        href: '/work/boards/workflow-1/inspector?view=detailed',
      },
      {
        label: 'Activation spend coverage',
        value: '$2.2500',
        detail: '1 orchestrator activation across 5 trace entries • 900 ms total recorded duration.',
        sourceLabel: 'Inspector orchestrator slice',
        href: '/work/boards/workflow-1/inspector?view=detailed',
      },
      {
        label: 'Work item spend coverage',
        value: '$6.7500',
        detail: '2 workflow work items across 5 contributing steps.',
        sourceLabel: 'Workflow run summary',
        href: '/work/boards/workflow-1/inspector?view=detailed',
      },
    ]);
    expect(
      model.spendBreakdowns.map(({ title, description, entries }) => ({ title, description, entries })),
    ).toEqual([
      {
        title: 'Stage breakdown',
        description: 'Top reported stage spend from the workflow run summary.',
        entries: [
          {
            label: 'review',
            value: '$4.5000',
            detail: '3 steps contributed to this stage.',
            href: '/work/boards/workflow-1/inspector?view=detailed&stage=review',
          },
          {
            label: 'qa',
            value: '$2.2500',
            detail: '2 steps contributed to this stage.',
            href: '/work/boards/workflow-1/inspector?view=detailed&stage=qa',
          },
        ],
      },
      {
        title: 'Task breakdown',
        description: 'Top task-level spend from the current inspector log slice.',
        entries: [
          {
            label: 'Step task-123',
            value: '$1.7500',
            detail: '6 trace entries • 200 ms average recorded duration.',
            href: '/work/boards/workflow-1/inspector?view=detailed&task=task-123456789',
          },
        ],
      },
      {
        title: 'Activation breakdown',
        description: 'Top orchestrator activation spend from the current inspector slice.',
        entries: [
          {
            label: 'Activation activati',
            value: '$2.2500',
            detail: '5 trace entries • 180 ms average recorded duration.',
            href:
              '/work/boards/workflow-1/inspector?view=detailed&activation=activation-123456789',
          },
        ],
      },
      {
        title: 'Work item breakdown',
        description: 'Top workflow work-item spend from the current run summary.',
        entries: [
          {
            label: 'Review release notes',
            value: '$4.5000',
            detail: 'review • 3 steps contributed to this work item.',
            href: '/work/boards/workflow-1/inspector?view=detailed&work_item=work-item-1',
          },
          {
            label: 'QA verification',
            value: '$2.2500',
            detail: 'qa • 2 steps contributed to this work item.',
            href: '/work/boards/workflow-1/inspector?view=detailed&work_item=work-item-2',
          },
        ],
      },
    ]);
    expect(
      model.spendBreakdowns.map(({ coverageLabel, coverageDetail }) => ({
        coverageLabel,
        coverageDetail,
      })),
    ).toEqual([
      {
        coverageLabel: 'Showing all 2 stages',
        coverageDetail: '$6.7500 of recorded spend is visible in this slice.',
      },
      {
        coverageLabel: 'Showing all 1 task',
        coverageDetail: '$1.7500 of recorded spend is visible in this slice.',
      },
      {
        coverageLabel: 'Showing all 1 activation',
        coverageDetail: '$2.2500 of recorded spend is visible in this slice.',
      },
      {
        coverageLabel: 'Showing all 2 work items',
        coverageDetail: '$6.7500 of recorded spend is visible in this slice.',
      },
    ]);
    expect(model.memoryPacket.title).toBe('Memory evolution · Review release notes');
    expect(model.memoryPacket.changes).toEqual([
      expect.objectContaining({
        key: 'release_risk',
        status: 'Updated',
        summary: 'Changed from level: medium to level: high.',
        detail: 'agent agent-1 updated this key in stage review.',
        occurredAtLabel: '30m ago',
        occurredAtTitle: new Date('2026-03-10T05:00:00Z').toLocaleString(),
        changedFields: ['level'],
        canRenderDiff: true,
      }),
      expect.objectContaining({
        key: 'release_risk',
        status: 'Created',
        summary: 'Recorded level: medium for the first time.',
        detail: 'agent agent-1 updated this key in stage review.',
        occurredAtLabel: '1h ago',
        occurredAtTitle: new Date('2026-03-10T04:00:00Z').toLocaleString(),
        changedFields: ['value'],
        canRenderDiff: true,
      }),
      expect.objectContaining({
        key: 'release_notes',
        status: 'Deleted',
        summary: 'Removed from the work-item memory packet.',
        detail: 'system updated this key in stage review.',
        occurredAtLabel: '2h ago',
        occurredAtTitle: new Date('2026-03-10T03:00:00Z').toLocaleString(),
        changedFields: ['value'],
        canRenderDiff: false,
      }),
    ]);
  });

  it('falls back gracefully when telemetry packets are still sparse', () => {
    const model = buildWorkflowInspectorTelemetryModel({
      workflowId: 'workflow-2',
      workflow: {
        id: 'workflow-2',
        name: 'Empty board',
        state: 'pending',
        created_at: '2026-03-10T00:00:00Z',
      },
      now: Date.parse('2026-03-10T05:30:00Z'),
    });

    expect(model.spendPackets[0]).toEqual({
      label: 'Stage cost leader',
      value: 'Not recorded',
      detail: 'No stage-level cost packet is available in the current run summary yet.',
      href: null,
    });
    expect(model.executionSummaryPackets).toEqual([
      {
        label: 'Stage spend coverage',
        value: 'Not recorded',
        detail: 'No stage-level spend is available in the workflow run summary yet.',
        sourceLabel: 'Workflow run summary',
        href: null,
      },
      {
        label: 'Task spend coverage',
        value: 'Not recorded',
        detail: 'No task-level spend is available in the current inspector log slice yet.',
        sourceLabel: 'Inspector log slice',
        href: null,
      },
      {
        label: 'Activation spend coverage',
        value: 'Not recorded',
        detail: 'No activation-level spend is available in the current orchestrator slice yet.',
        sourceLabel: 'Inspector orchestrator slice',
        href: null,
      },
      {
        label: 'Work item spend coverage',
        value: 'Not recorded',
        detail: 'No work-item-level spend is available in the workflow run summary yet.',
        sourceLabel: 'Workflow run summary',
        href: null,
      },
    ]);
    expect(
      model.spendBreakdowns.map(({ title, description, entries }) => ({ title, description, entries })),
    ).toEqual([
      {
        title: 'Stage breakdown',
        description: 'Top reported stage spend from the workflow run summary.',
        entries: [],
      },
      {
        title: 'Task breakdown',
        description: 'Top task-level spend from the current inspector log slice.',
        entries: [],
      },
      {
        title: 'Activation breakdown',
        description: 'Top orchestrator activation spend from the current inspector slice.',
        entries: [],
      },
      {
        title: 'Work item breakdown',
        description: 'Top workflow work-item spend from the current run summary.',
        entries: [],
      },
    ]);
    expect(
      model.spendBreakdowns.map(({ coverageLabel, coverageDetail }) => ({
        coverageLabel,
        coverageDetail,
      })),
    ).toEqual([
      {
        coverageLabel: 'No stage spend recorded',
        coverageDetail: 'No stage-level spend is available in this inspector lane yet.',
      },
      {
        coverageLabel: 'No task spend recorded',
        coverageDetail: 'No task-level spend is available in this inspector lane yet.',
      },
      {
        coverageLabel: 'No activation spend recorded',
        coverageDetail: 'No activation-level spend is available in this inspector lane yet.',
      },
      {
        coverageLabel: 'No work item spend recorded',
        coverageDetail: 'No work item-level spend is available in this inspector lane yet.',
      },
    ]);
    expect(model.memoryPacket).toEqual({
      title: 'Memory evolution',
      detail: 'No active work item is available to anchor a memory evolution packet.',
      emptyMessage: 'As work items start recording memory, the latest key changes will appear here.',
      changes: [],
    });
  });
});
