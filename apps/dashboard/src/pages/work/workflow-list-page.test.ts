import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './workflow-list-page.tsx',
    './workflow-list-board-view.tsx',
    './workflow-list-layouts.tsx',
    './workflow-list-view-toggle.tsx',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('workflow board page source', () => {
  it('keeps the workflow list centered on summary-first delivery operations', () => {
    const source = readSource();
    expect(source).toContain('Workflow Boards');
    expect(source).toContain('Board operations');
    expect(source).toContain('Review posture, progress, live stages, gate pressure, and reported spend');
    expect(source).toContain('WorkflowSummaryCards');
    expect(source).toContain('attentionCount={collectionSummary.gated + collectionSummary.blocked}');
    expect(source).toContain('spentBoards={collectionSummary.spentBoards}');
    expect(source).toContain('All Postures');
    expect(source).toContain('Search runs, stages, gates, or workspaces...');
    expect(source).toContain('Failed to load workflow boards. Please try again later.');
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
    expect(source).toContain('describeWorkflowStageLabel(workflow)');
    expect(source).toContain('formatRelativeRunAge');
    expect(source).toContain('Search: {props.searchQuery}');
    expect(source).toContain('WorkflowListViewToggle');
    expect(source).toContain('Board layout mode');
    expect(source).toContain('List view');
    expect(source).toContain('Board view');
    expect(source).toContain('Jump to posture');
    expect(source).toContain('Review the board sections in posture order without horizontal scrolling.');
    expect(source).toContain('xl:hidden');
    expect(source).toContain('hidden gap-4 xl:grid xl:grid-cols-2 2xl:grid-cols-5');
    expect(source).toContain('workflow-posture-');
  });

  it('exposes workflow pause, resume, and cancel controls from both list layouts', () => {
    const source = readSource();
    expect(source).toContain('WorkflowControlActions');
    expect(source).toContain('TableHead className="text-right">Controls</TableHead>');
    expect(source).toContain('workflowState={workflow.state ?? workflow.status}');
    expect(source).toContain('workspaceId={workflow.workspace_id}');
    expect(source).toContain('Open board');
  });
});
