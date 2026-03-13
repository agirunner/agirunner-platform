import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './task-list-page.tsx',
    './task-list-page.sections.tsx',
    './task-list-page.rows.tsx',
    './task-list-page.support.ts',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('task list page source', () => {
  it('frames the list as specialist execution instead of a generic task table', () => {
    const source = readSource();
    expect(source).toContain('Execution Steps');
    expect(source).toContain('Operator view of specialist steps');
    expect(source).toContain('TaskListFilters');
    expect(source).toContain('TaskListContent');
    expect(source).toContain('TaskPostureSection');
    expect(source).toContain('Execution pressure');
    expect(source).toContain('Review queue');
    expect(source).toContain('Recovery queue');
    expect(source).toContain('Orchestrator turns');
  });

  it('surfaces v2 workflow scope and operator review states', () => {
    const source = readSource();
    expect(source).toContain('output_pending_review');
    expect(source).toContain('escalated');
    expect(source).toContain('describeTaskNextAction');
    expect(source).toContain('describeTaskScope');
    expect(source).toContain('buildTaskSearchText');
    expect(source).not.toContain("status === 'running' || status === 'claimed'");
    expect(source).toContain('Visible execution steps');
  });

  it('adds a mobile card fallback and next-action-first table layout', () => {
    const source = readSource();
    expect(source).toContain('lg:hidden');
    expect(source).toContain('TaskMobileCard');
    expect(source).toContain('Board context');
    expect(source).toContain('Next action');
    expect(source).toContain('Open board');
    expect(source).toContain('Open work-item flow');
    expect(source).toContain('Open board stage flow');
    expect(source).toContain('Open step record');
    expect(source).toContain('Every row or card leads with current posture, board context, and the correct operator');
  });
});
