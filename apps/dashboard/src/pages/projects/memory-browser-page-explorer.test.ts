import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(
    resolve(import.meta.dirname, './memory-browser-page-explorer.tsx'),
    'utf8',
  );
}

describe('memory browser explorer source', () => {
  it('turns the explorer into packet-first tabs instead of one long stacked review surface', () => {
    const source = readSource();

    expect(source).toContain('TabsTrigger value="project"');
    expect(source).toContain('TabsTrigger value="scoped"');
    expect(source).toContain('TabsTrigger value="history"');
    expect(source).toContain('Project packets');
    expect(source).toContain('Scoped packets');
    expect(source).toContain('History trail');
    expect(source).toContain("setActiveView(props.selectedWorkItemId.length > 0 ? 'scoped' : 'project')");
    expect(source).toContain('ExplorerFocusCard');
    expect(source).toContain('ExplorerSectionHeader');
  });

  it('keeps clear operator guidance for project packets, scoped packets, and history review', () => {
    const source = readSource();

    expect(source).toContain('Project memory packets');
    expect(source).toContain('Review shared memory that applies across runs');
    expect(source).toContain('Scoped history trail');
    expect(source).toContain('Compare who changed scoped memory');
    expect(source).toContain('Select a work item');
    expect(source).toContain('No project memory entries matched the current filter.');
    expect(source).toContain('No work-item memory entries matched the current filter.');
  });

  it('wraps history panel in a tab-level error boundary to preserve the page shell on crashes', () => {
    const source = readSource();

    expect(source).toContain('TabErrorBoundary');
    expect(source).toContain('<TabErrorBoundary label="History trail">');
    expect(source).toContain('encountered an error');
    expect(source).toContain('Retry');
  });
});
