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
    expect(source).toContain('stage_summary');
    expect(source).toContain('completed_count');
    expect(source).toContain('Acceptance:');
    expect(source).toContain('owner_role');
    expect(source).toContain('onSelectWorkItem');
    expect(source).toContain('selectedWorkItemId');
    expect(source).toContain('Milestone groups');
    expect(source).toContain('Grouped by milestone for parent-child orchestration visibility.');
    expect(source).toContain('children_completed');
    expect(source).toContain('% complete');
  });

  it('shows stage summaries directly on workflow stage cards', () => {
    const source = readSource();
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
});
