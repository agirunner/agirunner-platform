import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readPage() {
  return readFileSync(resolve(import.meta.dirname, './logs-page.tsx'), 'utf8');
}

function readActivityPackets() {
  return readFileSync(resolve(import.meta.dirname, './logs-page-activity-packets.tsx'), 'utf8');
}

describe('logs page source', () => {
  it('keeps the mission-control logs route raw-log-first while preserving inspector tabs', () => {
    const source = readPage();
    expect(source).toContain('return <LogsSurface mode="logs" />;');
    expect(source).toContain("const surfaceMode = props.mode ?? (scopedWorkflowId ? 'inspector' : 'logs');");
    expect(source).toContain('const [logsSurfaceView, setLogsSurfaceView] = useState<InspectorView>(() =>');
    expect(source).toContain('readLogsSurfaceView(searchParams)');
    expect(source).toContain('setLogsSurfaceView(readLogsSurfaceView(searchParams));');
    expect(source).toContain("const selectedView = rawFirstSurface");
    expect(source).toContain('Operator Log</h1>');
    expect(source).toContain(
      "Raw logs and events are always visible. Use the summary, delivery, and trace tabs for curated views when you need them.",
    );
    expect(source).toContain("rawFirstSurface ? 'Log Stream' : 'Raw Logs'");
    expect(source).toContain("rawFirstSurface ? 'Activity Summary' : 'Summary'");
    expect(source).toContain("rawFirstSurface ? 'Delivery Packets' : 'Delivery'");
    expect(source).toContain("rawFirstSurface ? 'Trace Detail' : 'Debug'");
    expect(source).toContain('Failed to load delivery entries. Please refine filters and try again.');
    expect(source).not.toContain('Export');
    expect(source).not.toContain('Permalink');
    expect(source).not.toContain('rounded-3xl border border-border/70 bg-card/80 p-5 shadow-sm sm:p-6');
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
    expect(source).toContain('dashboardApi.queryLogs');
    expect(source).toContain("detail: SUMMARY_DETAIL_MODE");
    expect(source).toContain('dashboardApi.getLog');
    expect(source).toContain('dashboardApi.getLogStats');
    expect(source).toContain('dashboardApi.getWorkflowBudget(scopedWorkflowId)');
    expect(source).toContain('buildInspectorOverviewCards');
    expect(source).toContain('WorkflowBudgetCard');
    expect(source).toContain('describeExecutionOperationOption');
    expect(source).toContain('context="inspector"');
    expect(source).toContain('LogViewer compact');
    expect(source).toContain('data-testid="operator-log-surface"');
    expect(source).toContain("aria-label=\"Log view\"");
  });

  it('raw tab renders only the log stream without inspector chrome', () => {
    const source = readPage();
    const rawTabStart = source.indexOf('TabsContent value="raw"');
    const rawTabEnd = source.indexOf('</TabsContent>', rawTabStart);
    const rawTabContent = source.slice(rawTabStart, rawTabEnd);

    expect(rawTabContent).toContain('<LogViewer');
    expect(rawTabContent).not.toContain('LogsPageActivityPackets');
    expect(rawTabContent).toContain('<LogsSurfacePanel');
    expect(source).toContain("eyebrow: rawFirstSurface ? 'Raw log truth' : 'Inspector baseline'");
    expect(source).toContain('chronological source-of-truth stream');
  });

  it('keeps activity packets additive on the summary tab', () => {
    const source = readPage();
    const packetsSource = readActivityPackets();
    expect(source).toContain('LogsPageActivityPackets');
    expect(source).toContain('buildRecentLogActivityPackets(entries)');
    expect(source).toContain("updateView('detailed')");

    // Activity packets must be on the summary tab, not the raw tab
    const summaryTabStart = source.indexOf('TabsContent value="summary"');
    const summaryTabEnd = source.indexOf('</TabsContent>', summaryTabStart);
    const summaryTabContent = source.slice(summaryTabStart, summaryTabEnd);
    expect(summaryTabContent).toContain('<LogsSurfacePanel');
    expect(summaryTabContent).toContain('LogsPageActivityPackets');
    expect(summaryTabContent).toContain('operator-log-activity-packets');
    expect(summaryTabContent).toContain('ExecutionInspectorSummaryView');
    expect(source).toContain("eyebrow: 'Curated summary'");

    expect(packetsSource).toContain('Recent activity packets');
    expect(packetsSource).toContain('packet.actorLabel');
    expect(packetsSource).toContain('packet.emphasisLabel');
    expect(packetsSource).toContain('packet.narrativeHeadline');
    expect(packetsSource).toContain('Why surfaced');
    expect(packetsSource).toContain('packet.whyItMatters');
    expect(packetsSource).toContain('packet.facts.map((fact)');
    expect(packetsSource).toContain('Trace context');
    expect(packetsSource).toContain('packet.supportingContext.map((item)');
    expect(packetsSource).toContain('packet.actions.map((action)');
    expect(packetsSource).toContain('Open trace detail');
    expect(packetsSource).toContain('dateTime={packet.createdAtIso}');
    expect(packetsSource).toContain('title={packet.createdAtDetail}');
    expect(packetsSource).toContain('Use these human-readable summaries to decide whether to stay in the raw stream');
  });

  it('drives inspector filters and selected entries from url search params', () => {
    const source = readPage();
    expect(source).toContain('useSearchParams');
    expect(source).toContain('readInspectorFilters(searchParams)');
    expect(source).toContain("next.set('log', String(logId))");
    expect(source).toContain("next.set('view', view)");
    expect(source).not.toContain("return `/diagnostics/logs?");
  });

  it('shows segment-oriented pagination copy and lazy selected-detail loading', () => {
    const source = readPage();
    expect(source).toContain('Loading selected trace detail…');
    expect(source).toContain('isSelectedOutsideSegment');
    expect(source).toContain('loadedCount={entries.length}');
    expect(source).toContain('Action queue');
    expect(source).toContain('Trace diagnostics');
    expect(source).toContain('InspectorFiltersCard');
  });
});
