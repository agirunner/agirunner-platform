import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './workflow-list-page.tsx'), 'utf8');
}

describe('workflow board page source', () => {
  it('keeps the workflow list centered on summary-first delivery operations', () => {
    const source = readSource();
    expect(source).toContain('Delivery Boards');
    expect(source).toContain('Board operations');
    expect(source).toContain('Review posture, progress, live stages, gate pressure, and reported spend');
    expect(source).toContain('WorkflowSummaryCards');
    expect(source).toContain('Visible Boards');
    expect(source).toContain('Reported Spend');
    expect(source).toContain('All Postures');
    expect(source).toContain('Search runs, stages, gates, or projects...');
    expect(source).toContain('Failed to load delivery boards. Please try again later.');
    expect(source).toContain('No runs match the current filters.');
    expect(source).toContain('Clear the filters or launch a new playbook run');
  });

  it('supports responsive list and board layouts with human-readable summaries', () => {
    const source = readSource();
    expect(source).toContain('lg:hidden');
    expect(source).toContain('hidden overflow-hidden rounded-xl border border-border/70 bg-card lg:block');
    expect(source).toContain('WorkflowListCard');
    expect(source).toContain('Board posture view');
    expect(source).toContain('describeWorkflowProgress');
    expect(source).toContain('describeWorkflowCost');
    expect(source).toContain('formatRelativeRunAge');
    expect(source).toContain('Search: {props.searchQuery}');
  });
});
