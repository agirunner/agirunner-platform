import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readPage() {
  return readFileSync(resolve(import.meta.dirname, './logs-page.tsx'), 'utf8');
}

describe('logs page source', () => {
  it('keeps the live logs route raw-log-first while preserving summary-only inspector tabs', () => {
    const source = readPage();
    expect(source).toContain('return <LogsSurface mode="logs" />;');
    expect(source).toContain("const surfaceMode = props.mode ?? (scopedWorkflowId ? 'inspector' : 'logs');");
    expect(source).toContain('readLogsSurfaceView(searchParams)');
    expect(source).toContain("const selectedView = useMemo(() => readLogsSurfaceView(searchParams), [searchParams]);");
    expect(source).toContain('Live Logs</h1>');
    expect(source).toContain(
      "Raw logs stay visible as the source of truth. Activity Summary highlights the current filtered results without leaving the stream.",
    );
    expect(source).not.toContain('defaultLive');
    expect(source).toContain("rawFirstSurface ? 'Log Stream' : 'Raw Logs'");
    expect(source).toContain("rawFirstSurface ? 'Activity Summary' : 'Summary'");
    expect(source).toContain('Chronological raw logs and events across the current filters.');
    expect(source).toContain('A curated summary of the current log results');
    expect(source).toContain('Top activity paths, role lanes, and');
    expect(source).toContain('agent or operator activity reflect the current filters.');
    expect(source).not.toContain('Focus the current log results');
    expect(source).not.toContain('Delivery Packets');
    expect(source).not.toContain('LogsPageActivityPackets');
    expect(source).not.toContain('ExecutionInspectorDetailView');
    expect(source).not.toContain('TabsContent value="detailed"');
    expect(source).not.toContain('Export');
    expect(source).not.toContain('Permalink');
    expect(source).not.toContain('rounded-3xl border border-border/70 bg-card/80 p-5 shadow-sm sm:p-6');
    expect(source).not.toContain('LogsSurfacePanel');
    expect(source).not.toContain('buildTabFacts');
    expect(source).not.toContain('Board context');
    expect(source).not.toContain('Step record');
  });

  it('MCL-004: uses shorter mobile tab labels to prevent truncation', () => {
    const source = readPage();
    expect(source).toContain('grid h-auto w-full grid-cols-2');
    expect(source).toContain('sm:hidden');
    expect(source).toContain('hidden sm:inline');
    expect(source).toContain("rawFirstSurface ? 'Logs' : 'Raw'");
  });

  it('keeps the inspector surfaces available without forcing inspector summary cards onto raw logs', () => {
    const source = readPage();
    expect(source).toContain('useLogFilters()');
    expect(source).toContain('LogFilters');
    expect(source).toContain('applyLogScope');
    expect(source).toContain('dashboardApi.getLogStats');
    expect(source).toContain('dashboardApi.getLogOperations');
    expect(source).toContain('dashboardApi.getLogRoles');
    expect(source).toContain('dashboardApi.getLogActors');
    expect(source).toContain('dashboardApi.getWorkflowBudget(scopedWorkflowId)');
    expect(source).toContain('WorkflowBudgetCard');
    expect(source).toContain('context="inspector"');
    expect(source).toContain('<LogViewer');
    expect(source).toContain('compact');
    expect(source).toContain('data-testid="operator-log-surface"');
    expect(source).toContain("aria-label=\"Log view\"");
    expect(source).not.toContain('dashboardApi.listWorkspaces()');
    expect(source).not.toContain('dashboardApi.listWorkflows(requestFilters)');
    expect(source).not.toContain('dashboardApi.listTasks(requestFilters)');
    expect(source).not.toContain("queryKey: ['operator-log', 'filter-workspaces'");
    expect(source).not.toContain("queryKey: ['operator-log', 'filter-workflows'");
    expect(source).not.toContain("queryKey: ['operator-log', 'filter-tasks'");
    expect(source).not.toContain('workspaceItemsOverride={');
    expect(source).not.toContain('workflowItemsOverride={');
    expect(source).not.toContain('taskItemsOverride={');
    expect(source).toContain("queryKey: ['operator-log', 'operations', filters, logScope]");
    expect(source).toContain("queryKey: ['operator-log', 'roles', filters, logScope]");
    expect(source).toContain("queryKey: ['operator-log', 'actors', filters, logScope]");
    expect(source).toContain("enabled: selectedView === 'summary'");
    expect(source).toContain('staleTime: 300_000');
    expect(source).not.toContain("category: 'agent_loop,tool,llm,task_lifecycle,container'");
    expect(source).not.toContain('buildLogFilters(filters)');
    expect(source).not.toContain('readInspectorFilters(searchParams)');
    expect(source).not.toContain('InspectorFiltersCard');
  });

  it('raw tab renders only the log stream without inspector chrome', () => {
    const source = readPage();
    const rawTabStart = source.indexOf("{selectedView === 'raw' ? (");
    const rawTabEnd = source.indexOf('</TabsContent>', rawTabStart);
    const rawTabContent = source.slice(rawTabStart, rawTabEnd);

    expect(rawTabContent).toContain('<LogViewer');
    expect(rawTabContent).not.toContain('<LogsSurfacePanel');
    expect(rawTabContent).toContain('Chronological raw logs and events across the current filters.');
    expect(source).not.toContain('chronological source-of-truth stream');
  });

  it('keeps summary focused on aggregate signals instead of packet drill-in', () => {
    const source = readPage();

    const summaryTabStart = source.indexOf("{selectedView === 'summary' ? (");
    const summaryTabEnd = source.indexOf('</TabsContent>', summaryTabStart);
    const summaryTabContent = source.slice(summaryTabStart, summaryTabEnd);
    expect(summaryTabContent).not.toContain('<LogsSurfacePanel');
    expect(summaryTabContent).toContain('A curated summary of the current log results');
    expect(summaryTabContent).toContain('<LogFilters');
    expect(summaryTabContent).toContain('disableOptionQueries');
    expect(summaryTabContent).toContain('ExecutionInspectorSummaryView');
    expect(summaryTabContent).not.toContain('<Card key={card.title}');
    expect(summaryTabContent).not.toContain('Recent activity packets');
    expect(summaryTabContent).not.toContain('ExecutionInspectorDetailView');
  });

  it('drives inspector filters and selected entries from url search params', () => {
    const source = readPage();
    expect(source).toContain('useSearchParams');
    expect(source).toContain('useLogFilters()');
    expect(source).not.toContain('readInspectorView(searchParams)');
    expect(source).toContain("next.set('view', 'summary')");
    expect(source).not.toContain("return `/diagnostics/live-logs?");
    expect(source).not.toContain("setLogsSurfaceView(view)");
  });

  it('keeps the simplified summary tab free of delivery-detail pagination chrome', () => {
    const source = readPage();
    expect(source).toContain('<LogFilters');
    expect(source).not.toContain('loadedCount={entries.length}');
    expect(source).not.toContain('effectiveSelectedLogId');
  });

  it('does not mount inactive log tabs that would duplicate heavy aggregate queries', () => {
    const source = readPage();
    expect(source).toContain("{selectedView === 'raw' ? (");
    expect(source).toContain("{selectedView === 'summary' ? (");
    const rawGuardIndex = source.indexOf("{selectedView === 'raw' ? (");
    const summaryGuardIndex = source.indexOf("{selectedView === 'summary' ? (");
    expect(source.indexOf('<TabsContent value="raw"', rawGuardIndex)).toBeGreaterThan(rawGuardIndex);
    expect(source.indexOf('<TabsContent value="summary"', summaryGuardIndex)).toBeGreaterThan(summaryGuardIndex);
  });
});
