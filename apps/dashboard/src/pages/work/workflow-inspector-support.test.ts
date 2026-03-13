import { describe, expect, it } from 'vitest';

import { buildWorkflowInspectorTraceModel } from './workflow-inspector-support.js';

describe('workflow inspector support', () => {
  it('builds trace coverage metrics, links, and stage spend context from workflow and project records', () => {
    const model = buildWorkflowInspectorTraceModel({
      workflow: {
        id: 'workflow-1',
        name: 'Release board',
        state: 'active',
        created_at: '2026-03-10T00:00:00Z',
        project_id: 'project-1',
        work_item_summary: {
          total_work_items: 5,
          open_work_item_count: 2,
          completed_work_item_count: 3,
          active_stage_count: 2,
          awaiting_gate_count: 1,
          active_stage_names: ['review', 'qa'],
        },
        workflow_stages: [
          {
            id: 'stage-1',
            name: 'review',
            position: 0,
            goal: 'Review work',
            human_gate: true,
            status: 'awaiting_gate',
            is_active: true,
            gate_status: 'awaiting_approval',
            iteration_count: 0,
            open_work_item_count: 1,
            total_work_item_count: 2,
          },
        ],
        work_items: [
          {
            id: 'work-item-1',
            workflow_id: 'workflow-1',
            stage_name: 'review',
            title: 'Review release notes',
            column_id: 'review',
            priority: 'high',
          },
        ],
        activations: [
          {
            id: 'activation-1',
            workflow_id: 'workflow-1',
            reason: 'work_item.created',
            event_type: 'work_item.created',
            payload: {},
            state: 'processing',
            queued_at: '2026-03-10T00:05:00Z',
            latest_event_at: '2026-03-10T00:06:00Z',
            event_count: 3,
            summary: 'Queued follow-up review work.',
          },
        ],
        metadata: {
          run_summary: {
            orchestrator_analytics: {
              cost_by_stage: [
                { group_key: 'review', total_cost_usd: 7.35, task_count: 4 },
                { group_key: 'qa', total_cost_usd: 2.5, task_count: 2 },
              ],
            },
            produced_artifacts: [{ id: 'artifact-1' }, { id: 'artifact-2' }],
          },
        },
      },
      project: {
        id: 'project-1',
        name: 'Release project',
        slug: 'release-project',
        memory: {
          last_run_summary: {},
          project_timeline: [],
          release_risk: { level: 'medium' },
        },
      },
    });

    expect(model.metrics).toEqual([
      {
        label: 'Activation batches',
        value: '1',
        detail: 'work item.created • processing • 3 queued events',
      },
      {
        label: 'Work items',
        value: '5',
        detail: '2 open • 3 completed',
      },
      {
        label: 'Gate checkpoints',
        value: '1',
        detail: '1 waiting for operator review across 1 gate stage.',
      },
      {
        label: 'Artifacts',
        value: '2',
        detail: 'Run summary artifacts are ready for project-level preview and download.',
      },
      {
        label: 'Memory handoff',
        value: '1 keys',
        detail: 'Project memory includes operator-visible handoff keys alongside the run timeline packets.',
      },
    ]);
    expect(model.topStageSpend).toBe(
      'review leads reported spend at $7.35 across 4 steps.',
    );
    expect(model.latestActivationSummary).toBe(
      'Latest activation: work item.created • processing • Queued follow-up review work.',
    );
    expect(model.links).toEqual([
      {
        label: 'Board trace',
        href: '/work/workflows/workflow-1',
        detail: 'Open activations, work items, gates, and specialist steps in one board view.',
      },
      {
        label: 'Activation drill-in',
        href: '/work/workflows/workflow-1/inspector?view=detailed&activation=activation-1',
        detail: 'Queued follow-up review work.',
      },
      {
        label: 'Open work item',
        href: '/work/workflows/workflow-1?work_item=work-item-1',
        detail: 'Review release notes is still open in review.',
      },
      {
        label: 'Gate review lane',
        href: '/work/workflows/workflow-1?stage=review',
        detail: 'review is carrying the current gate posture for this workflow.',
      },
      {
        label: 'Project memory',
        href: '/projects/project-1/memory',
        detail: 'Inspect memory versions, diffs, and run handoff packets.',
      },
      {
        label: 'Project artifacts',
        href: '/projects/project-1/artifacts',
        detail: 'Review delivered artifacts and workflow output packets.',
      },
    ]);
    expect(model.focusWorkItem).toEqual({
      id: 'work-item-1',
      title: 'Review release notes',
      stageName: 'review',
    });
  });

  it('falls back gracefully when trace packets are sparse', () => {
    const model = buildWorkflowInspectorTraceModel({
      workflow: {
        id: 'workflow-2',
        name: 'Empty board',
        state: 'pending',
        created_at: '2026-03-10T00:00:00Z',
      },
    });

    expect(model.metrics[0]).toEqual({
      label: 'Activation batches',
      value: '0',
      detail: 'No activation batches are recorded on this workflow yet.',
    });
    expect(model.metrics[4]).toEqual({
      label: 'Memory handoff',
      value: 'Not recorded',
      detail: 'No project memory handoff packets are available for this workflow yet.',
    });
    expect(model.topStageSpend).toBeNull();
    expect(model.latestActivationSummary).toBeNull();
    expect(model.links).toEqual([
      {
        label: 'Board trace',
        href: '/work/workflows/workflow-2',
        detail: 'Open activations, work items, gates, and specialist steps in one board view.',
      },
    ]);
    expect(model.focusWorkItem).toBeNull();
  });
});
