import { describe, expect, it } from 'vitest';

import {
  buildWorkflowInspectorFocusSummary,
  buildWorkflowInspectorTraceModel,
} from './workflow-inspector-support.js';

describe('workflow inspector support', () => {
  it('builds trace coverage metrics, links, and stage spend context from workflow and workspace records', () => {
    const model = buildWorkflowInspectorTraceModel({
      workflow: {
        id: 'workflow-1',
        name: 'Release board',
        state: 'active',
        created_at: '2026-03-10T00:00:00Z',
        workspace_id: 'workspace-1',
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
            rework_count: 2,
            current_subject_revision: 2,
            title: 'Review release notes',
            column_id: 'review',
            next_expected_actor: 'reviewer',
            next_expected_action: 'review',
            unresolved_findings: ['Verify the rollback notes.'],
            review_focus: ['Rollback notes'],
            known_risks: ['Release timing'],
            latest_handoff_completion: 'partial',
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
      workspace: {
        id: 'workspace-1',
        name: 'Release workspace',
        slug: 'release-workspace',
        memory: {
          last_run_summary: {},
          workspace_timeline: [],
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
        label: 'Continuity',
        value: 'reviewer -> review',
        detail: '1 unresolved finding is still attached to the focus work item.',
      },
      {
        label: 'Gate checkpoints',
        value: '1',
        detail: '1 waiting for operator decision across 1 gate stage.',
      },
      {
        label: 'Artifacts',
        value: '2',
        detail: 'Run summary artifacts are ready for workspace-level preview and download.',
      },
      {
        label: 'Memory handoff',
        value: '1 keys',
        detail: 'Workspace memory includes operator-visible handoff keys alongside the run timeline packets.',
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
        href: '/work/boards/workflow-1',
        detail: 'Open activations, work items, gates, and specialist steps in one board view.',
      },
      {
        label: 'Activation drill-in',
        href: '/work/boards/workflow-1/inspector?view=detailed&activation=activation-1',
        detail: 'Queued follow-up review work.',
      },
      {
        label: 'Open work item',
        href: '/work/boards/workflow-1?work_item=work-item-1',
        detail: 'Review release notes is still open in review.',
      },
      {
        label: 'Gate decision lane',
        href: '/work/boards/workflow-1?stage=review',
        detail: 'review is carrying the current gate decision posture for this workflow.',
      },
      {
        label: 'Workspace memory',
        href: '/workspaces/workspace-1/memory',
        detail: 'Inspect memory versions, diffs, and run handoff packets.',
      },
      {
        label: 'Workspace artifacts',
        href: '/workspaces/workspace-1/artifacts?workflow_id=workflow-1',
        detail: 'Review delivered artifacts and workflow output packets.',
      },
    ]);
    expect(model.focusWorkItem).toEqual({
      id: 'work-item-1',
      title: 'Review release notes',
      stageName: 'review',
      reworkCount: 2,
      nextExpectedActor: 'reviewer',
      nextExpectedAction: 'review',
      unresolvedFindingsCount: 1,
      assessmentFocusCount: 1,
      knownRiskCount: 1,
      latestHandoffCompletion: 'partial',
      currentSubjectRevision: 2,
    });
  });

  it('surfaces focus continuity details and the latest handoff packet for the highlighted work item', () => {
    const latestHandoff = {
      id: 'handoff-1',
      workflow_id: 'workflow-5',
      work_item_id: 'work-item-5',
      task_id: 'task-qa-1',
      role: 'qa',
      stage_name: 'review',
      sequence: 4,
      summary: 'QA validated the approved branch successfully.',
      completion: 'partial',
      changes: [],
      decisions: [],
      remaining_items: [],
      blockers: [],
      review_focus: [],
      known_risks: [],
      successor_context: 'Use the verified QA evidence as the release input.',
      role_data: {},
      artifact_ids: [],
      created_at: '2026-03-16T02:00:00Z',
    };

    const traceModel = buildWorkflowInspectorTraceModel({
      workflow: {
        id: 'workflow-5',
        name: 'Release board',
        state: 'active',
        created_at: '2026-03-10T00:00:00Z',
        work_item_summary: {
          total_work_items: 1,
          open_work_item_count: 1,
          completed_work_item_count: 0,
          active_stage_count: 1,
          awaiting_gate_count: 0,
          active_stage_names: ['review'],
        },
        work_items: [
          {
            id: 'work-item-5',
            workflow_id: 'workflow-5',
            stage_name: 'review',
            rework_count: 2,
            title: 'Review release notes',
            column_id: 'review',
            next_expected_actor: 'reviewer',
            next_expected_action: 'review',
            unresolved_findings: ['Verify rollback notes'],
            review_focus: ['Rollback notes'],
            known_risks: ['Release timing'],
            latest_handoff_completion: 'partial',
            current_subject_revision: 2,
            priority: 'high',
          },
        ],
      },
    });

    expect(traceModel.focusWorkItem).toEqual({
      id: 'work-item-5',
      title: 'Review release notes',
      stageName: 'review',
      reworkCount: 2,
      nextExpectedActor: 'reviewer',
      nextExpectedAction: 'review',
      unresolvedFindingsCount: 1,
      assessmentFocusCount: 1,
      knownRiskCount: 1,
      latestHandoffCompletion: 'partial',
      currentSubjectRevision: 2,
    });

    expect(
      buildWorkflowInspectorFocusSummary({
        workflowId: 'workflow-5',
        workflow: {
          id: 'workflow-5',
          name: 'Release board',
          state: 'active',
          created_at: '2026-03-10T00:00:00Z',
          work_item_summary: {
            total_work_items: 1,
            open_work_item_count: 1,
            completed_work_item_count: 0,
            active_stage_count: 1,
            awaiting_gate_count: 0,
            active_stage_names: ['review'],
          },
        },
        liveStageLabel: 'review',
        traceModel,
        latestHandoff,
      }),
    ).toEqual({
      title: 'Focus on Review release notes',
      detail:
        'Stage review • Subject revision 2 • 2 reworks • 1 unresolved finding • 1 assessment focus item • 1 known risk • Latest handoff: QA validated the approved branch successfully. • Successor context: Use the verified QA evidence as the release input. • Next actor: reviewer should review next',
      nextAction:
        'Open the focus work item first, clear the unresolved findings and assessment focus notes, then decide whether the next move is approval, rework, or a new orchestrator turn.',
      actionLabel: 'Open focus work item',
      actionHref: '/work/boards/workflow-5?work_item=work-item-5',
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
    expect(model.metrics[5]).toEqual({
      label: 'Memory handoff',
      value: 'Not recorded',
      detail: 'No workspace memory handoff packets are available for this workflow yet.',
    });
    expect(model.topStageSpend).toBeNull();
    expect(model.latestActivationSummary).toBeNull();
    expect(model.links).toEqual([
      {
        label: 'Board trace',
        href: '/work/boards/workflow-2',
        detail: 'Open activations, work items, gates, and specialist steps in one board view.',
      },
    ]);
    expect(model.focusWorkItem).toBeNull();
  });

  it('builds an operator focus summary from gate and work-item posture', () => {
    const traceModel = buildWorkflowInspectorTraceModel({
      workflow: {
        id: 'workflow-3',
        name: 'Release board',
        state: 'active',
        created_at: '2026-03-10T00:00:00Z',
        work_item_summary: {
          total_work_items: 2,
          open_work_item_count: 1,
          completed_work_item_count: 1,
          active_stage_count: 1,
          awaiting_gate_count: 1,
          active_stage_names: ['review'],
        },
        work_items: [
          {
            id: 'work-item-9',
            workflow_id: 'workflow-3',
            stage_name: 'review',
            title: 'Review release candidate',
            column_id: 'review',
            priority: 'high',
          },
        ],
      },
    });

    expect(
      buildWorkflowInspectorFocusSummary({
        workflowId: 'workflow-3',
        workflow: {
          id: 'workflow-3',
          name: 'Release board',
          state: 'active',
          created_at: '2026-03-10T00:00:00Z',
          work_item_summary: {
            total_work_items: 2,
            open_work_item_count: 1,
            completed_work_item_count: 1,
            active_stage_count: 1,
            awaiting_gate_count: 1,
            active_stage_names: ['review'],
          },
        },
        liveStageLabel: 'review',
        traceModel,
      }),
    ).toEqual({
      title: 'Gate decision needs attention first',
      detail: '1 gate checkpoint is waiting across review.',
      nextAction:
        'Start with the board stage that is waiting for operator decision, then use the trace packets below to confirm spend, artifacts, and memory context before deciding.',
      actionLabel: 'Open board stage',
      actionHref: '/work/boards/workflow-3',
    });
  });

  it('uses continuity posture when the focus work item is the best starting point', () => {
    const traceModel = buildWorkflowInspectorTraceModel({
      workflow: {
        id: 'workflow-5',
        name: 'Release board',
        state: 'active',
        created_at: '2026-03-10T00:00:00Z',
        work_item_summary: {
          total_work_items: 1,
          open_work_item_count: 1,
          completed_work_item_count: 0,
          active_stage_count: 1,
          awaiting_gate_count: 0,
          active_stage_names: ['review'],
        },
        work_items: [
          {
            id: 'work-item-5',
            workflow_id: 'workflow-5',
            stage_name: 'review',
            title: 'Review release notes',
            column_id: 'review',
            next_expected_actor: 'reviewer',
            next_expected_action: 'review',
            unresolved_findings: ['Verify rollback notes'],
            review_focus: ['Rollback notes'],
            known_risks: ['Release timing'],
            latest_handoff_completion: 'partial',
            current_subject_revision: 1,
            priority: 'high',
          },
        ],
      },
    });

    expect(
      buildWorkflowInspectorFocusSummary({
        workflowId: 'workflow-5',
        workflow: {
          id: 'workflow-5',
          name: 'Release board',
          state: 'active',
          created_at: '2026-03-10T00:00:00Z',
          work_item_summary: {
            total_work_items: 1,
            open_work_item_count: 1,
            completed_work_item_count: 0,
            active_stage_count: 1,
            awaiting_gate_count: 0,
            active_stage_names: ['review'],
          },
        },
        liveStageLabel: 'review',
        traceModel,
      }),
    ).toEqual({
      title: 'Focus on Review release notes',
      detail:
        'Stage review • Subject revision 1 • 1 unresolved finding • 1 assessment focus item • 1 known risk • Next actor: reviewer should review next',
      nextAction:
        'Open the focus work item first, clear the unresolved findings and assessment focus notes, then decide whether the next move is approval, rework, or a new orchestrator turn.',
      actionLabel: 'Open focus work item',
      actionHref: '/work/boards/workflow-5?work_item=work-item-5',
    });
  });
});
