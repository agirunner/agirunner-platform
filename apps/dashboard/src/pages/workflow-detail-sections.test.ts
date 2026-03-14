import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(
    resolve(import.meta.dirname, './workflow-detail-sections.tsx'),
    'utf8',
  );
}

describe('workflow detail sections source', () => {
  it('surfaces stage-level work item summary in the playbook board card', () => {
    const source = readSource();
    expect(source).toContain('Execution Steps');
    expect(source).toContain('Human-readable specialist steps grouped by board stage');
    expect(source).toContain('describeTaskGraphPacket');
    expect(source).toContain('Execution flow, ownership, and upstream dependencies for this stage.');
    expect(source).toContain('grid gap-3 lg:hidden');
    expect(source).toContain('hidden overflow-x-auto lg:block');
    expect(source).toContain('TaskGraphMetric');
    expect(source).toContain('Upstream steps');
    expect(source).toContain('Execution focus');
    expect(source).toContain('Upstream');
    expect(source).toContain('Updated');
    expect(source).toContain('Work Board');
    expect(source).toContain('stage_summary');
    expect(source).toContain('completed_count');
    expect(source).toContain('Acceptance:');
    expect(source).toContain('owner_role');
    expect(source).toContain('onSelectWorkItem');
    expect(source).toContain('selectedWorkItemId');
    expect(source).toContain('Focused detail open');
    expect(source).toContain('aria-label="Board view mode"');
    expect(source).toContain('role="tab"');
    expect(source).toContain('Grouped by milestone');
    expect(source).toContain('Flat board');
    expect(source).toContain('Triage directly on the board');
    expect(source).not.toContain('A selected work-item packet is open beside the board.');
    expect(source).toContain('children_completed');
    expect(source).toContain('% complete');
    expect(source).toContain("xl:grid-cols-3 2xl:grid-cols-4");
    expect(source).toContain('Apply Board Move');
    expect(source).toContain('Board move controls');
    expect(source).toContain('dashboardApi.updateWorkflowWorkItem');
  });

  it('keeps mission control focused on work-item posture and latest operator activity instead of raw task totals', () => {
    const source = readSource();
    expect(source).toContain('Open Work');
    expect(source).toContain('Gate Reviews');
    expect(source).toContain('Latest operator activity');
    expect(source).toContain('Prioritize open work, gate pressure, and blocked specialist steps');
    expect(source).not.toContain('MissionMetric label="Total"');
  });

  it('shows stage summaries directly on workflow stage cards', () => {
    const source = readSource();
    expect(source).toContain('Stage Gates');
    expect(source).toContain('stage.summary');
    expect(source).toContain('summarizeStageMetrics');
    expect(source).toContain('StageSummaryMetric');
    expect(source).toContain('Awaiting gates');
    expect(source).toContain('Review goal');
    expect(source).toContain('Operator posture');
    expect(source).toContain('Stage packet ready for operator review.');
    expect(source).toContain('Started');
    expect(source).toContain('Human Gate');
    expect(source).toContain('listWorkflowGates');
    expect(source).toContain('GateDetailCard');
    expect(source).toContain('stable gate permalinks');
    expect(source).toContain("id={`gate-${stage.name}`}");
    expect(source).toContain('data-workflow-focus-anchor="true"');
    expect(source).toContain('aria-labelledby={`gate-heading-${stage.id}`}');
    expect(source).toContain("'gate'");
    expect(source).toContain('Gate focus');
  });

  it('adds workflow-detail permalinks for work items, activations, and child workflows', () => {
    const source = readSource();
    expect(source).toContain('buildWorkflowDetailPermalink');
    expect(source).toContain('work-item-card-');
    expect(source).toContain('activation-');
    expect(source).toContain('child-workflow-');
    expect(source).toContain('Permalink');
    expect(source).toContain('Highlight lineage');
    expect(source).toContain('aria-labelledby={`activation-heading-${activation.id}`}');
    expect(source).toContain('aria-labelledby={`child-workflow-heading-${entry.workflow_id}`}');
  });

  it('turns the workflow-detail project timeline into a continuity packet surface', () => {
    const source = readSource();
    expect(source).toContain('buildWorkflowProjectTimelineOverview');
    expect(source).toContain('buildWorkflowProjectTimelinePacket');
    expect(source).toContain('Run continuity');
    expect(source).toContain('Current board');
    expect(source).toContain('Best next step:');
    expect(source).toContain('Open board');
    expect(source).toContain('Open inspector');
    expect(source).toContain('Created {packet.createdLabel}');
  });

  it('adds manual workflow activation operator controls to the activations card', () => {
    const source = readSource();
    expect(source).toContain('Manual Wake-Up');
    expect(source).toContain('Operator control');
    expect(source).toContain('dashboardApi.enqueueWorkflowActivation');
    expect(source).toContain('operator.manual_enqueue');
    expect(source).toContain('Operator wake-up queued');
    expect(source).toContain('Operator reason');
    expect(source).toContain('Queue activation');
  });

  it('shows stale recovery context on workflow activations', () => {
    const source = readSource();
    expect(source).toContain('Orchestrator Activations');
    expect(source).toContain('describeActivationEvent');
    expect(source).toContain('describeTimelineEvent');
    expect(source).toContain('describeReviewPacket');
    expect(source).toContain('describeActivationRecovery');
    expect(source).toContain('Needs attention');
    expect(source).toContain('Activation attention');
    expect(source).toContain('Recovery signal');
    expect(source).toContain('Highlight activation');
    expect(source).toContain('Open event batch');
    expect(source).toContain('OperatorStatusBadge');
    expect(source).toContain('CopyableIdBadge');
    expect(source).toContain('RelativeTimestamp');
    expect(source).toContain('recovery_status');
    expect(source).toContain('stale_started_at');
    expect(source).toContain('redispatched_task_id');
    expect(source).toContain('Open inspector');
    expect(source).toContain('/work/boards/${activation.workflow_id}/inspector?activation=${activation.activation_id ?? activation.id}&view=debug');
    expect(source).not.toContain('/logs?workflow=${activation.workflow_id}&activation=${activation.activation_id ?? activation.id}&view=debug');
    expect(source).toContain('Redispatched task');
    expect(source).not.toContain('<StructuredRecordView data={activation.payload}');
  });
});
