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
    expect(source).toContain('Grouped by Milestone');
    expect(source).toContain('Flat Board');
    expect(source).toContain('Grouped board mode keeps parent milestones first-class');
    expect(source).toContain('Ungrouped board mode shows every work item directly');
    expect(source).toContain('children_completed');
    expect(source).toContain('% complete');
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
    expect(source).toContain("'gate'");
    expect(source).toContain('Gate focus');
  });

  it('adds workflow-detail permalinks for work items, activations, and child workflows', () => {
    const source = readSource();
    expect(source).toContain('buildWorkflowDetailPermalink');
    expect(source).toContain('work-item-');
    expect(source).toContain('activation-');
    expect(source).toContain('child-workflow-');
    expect(source).toContain('Permalink');
    expect(source).toContain('Highlight lineage');
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
    expect(source).toContain('recovery_status');
    expect(source).toContain('stale_started_at');
    expect(source).toContain('redispatched_task_id');
    expect(source).toContain('Open logs');
    expect(source).toContain('Redispatched task');
    expect(source).not.toContain('<StructuredRecordView data={activation.payload}');
  });
});
