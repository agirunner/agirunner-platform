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
    expect(source).toContain('Execution steps grouped by board stage');
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
    expect(source).toContain('Grouped move controls');
    expect(source).toContain('dashboardApi.updateWorkflowWorkItem');
  });

  it('shows stage summaries directly on workflow stage cards', () => {
    const source = readSource();
    expect(source).toContain('Stage Gates');
    expect(source).toContain('stage.summary');
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
    expect(source).toContain('describeActivationRecovery');
    expect(source).toContain('recovery_status');
    expect(source).toContain('stale_started_at');
    expect(source).toContain('redispatched_task_id');
  });
});
