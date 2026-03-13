import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readPage() {
  return readFileSync(resolve(import.meta.dirname, './logs-page.tsx'), 'utf8');
}

describe('logs page source', () => {
  it('keeps the mission-control logs route raw-log-first while preserving inspector tabs', () => {
    const source = readPage();
    expect(source).toContain('return <LogsSurface mode="logs" />;');
    expect(source).toContain("const surfaceMode = props.mode ?? (scopedWorkflowId ? 'inspector' : 'logs');");
    expect(source).toContain("{rawFirstSurface ? 'Logs' : 'Execution Inspector'}");
    expect(source).toContain(
      "Browse raw log and event rows first. Use the summary, delivery, and trace tabs only when you need curated inspector packets or deeper drill-in.",
    );
    expect(source).toContain("{rawFirstSurface ? 'Log Stream' : 'Raw Logs'}");
    expect(source).toContain("{rawFirstSurface ? 'Activity Summary' : 'Summary'}");
    expect(source).toContain("{rawFirstSurface ? 'Delivery Packets' : 'Delivery'}");
    expect(source).toContain("{rawFirstSurface ? 'Trace Detail' : 'Debug'}");
    expect(source).toContain('Failed to load delivery entries. Please refine filters and try again.');
    expect(source).toContain('Raw event and log rows stay first-class here');
  });

  it('keeps the inspector surfaces available without forcing inspector summary cards onto raw logs', () => {
    const source = readPage();
    expect(source).toContain('dashboardApi.queryLogs');
    expect(source).toContain("detail: SUMMARY_DETAIL_MODE");
    expect(source).toContain('dashboardApi.getLog');
    expect(source).toContain('dashboardApi.getLogStats');
    expect(source).toContain('dashboardApi.getWorkflowBudget(scopedWorkflowId)');
    expect(source).toContain('buildInspectorOverviewCards');
    expect(source).toContain('WorkflowBudgetCard');
    expect(source).toContain('describeExecutionOperationOption');
    expect(source).toContain('context="inspector"');
    expect(source).toContain("surfaceMode === 'inspector' || selectedView !== 'raw'");
    expect(source).toContain('LogViewer compact');
  });

  it('drives inspector filters and selected entries from url search params', () => {
    const source = readPage();
    expect(source).toContain('useSearchParams');
    expect(source).toContain('readInspectorFilters(searchParams)');
    expect(source).toContain("next.set('log', String(logId))");
    expect(source).toContain("next.set('view', view)");
    expect(source).toContain("return `/logs?");
    expect(source).toContain('Permalink');
  });

  it('shows segment-oriented pagination copy and lazy selected-detail loading', () => {
    const source = readPage();
    expect(source).toContain('Loading selected trace detail…');
    expect(source).toContain('isSelectedOutsideSegment');
    expect(source).toContain('loadedCount={entries.length}');
    expect(source).toContain('Step record');
    expect(source).toContain('md:grid-cols-3');
  });
});
