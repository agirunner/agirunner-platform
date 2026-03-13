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
    expect(source).toContain("const selectedView = rawFirstSurface");
    expect(source).toContain('Operator Log</h1>');
    expect(source).toContain(
      "Raw logs and events are always visible. Use the summary, delivery, and trace tabs for curated views when you need them.",
    );
    expect(source).toContain('Current surface');
    expect(source).toContain("rawFirstSurface ? 'Log Stream' : 'Raw Logs'");
    expect(source).toContain("rawFirstSurface ? 'Activity Summary' : 'Summary'");
    expect(source).toContain("rawFirstSurface ? 'Delivery Packets' : 'Delivery'");
    expect(source).toContain("rawFirstSurface ? 'Trace Detail' : 'Debug'");
    expect(source).toContain('Failed to load delivery entries. Please refine filters and try again.');
  });

  it('MCL-004: uses shorter mobile tab labels to prevent truncation', () => {
    const source = readPage();
    expect(source).toContain('overflow-x-auto');
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
    expect(source).toContain("surfaceMode === 'inspector' || selectedView !== 'raw'");
    expect(source).toContain('LogViewer compact');
    expect(source).toContain('data-testid="operator-log-surface"');
    expect(source).toContain("aria-label=\"Log view\"");
  });

  it('shows raw logs first with activity packets additive below', () => {
    const source = readPage();
    const packetsSource = readActivityPackets();
    expect(source).toContain('LogsPageActivityPackets');
    expect(source).toContain('buildRecentLogActivityPackets(entries)');
    expect(source).toContain("updateView('detailed')");

    // LogViewer must render before activity packets so raw events are immediately visible
    const rawTabContent = source.slice(source.indexOf("TabsContent value=\"raw\""));
    const logViewerPos = rawTabContent.indexOf('<LogViewer');
    const activityPacketsPos = rawTabContent.indexOf('<LogsPageActivityPackets');
    expect(logViewerPos).toBeGreaterThan(-1);
    expect(activityPacketsPos).toBeGreaterThan(logViewerPos);

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
    expect(source).toContain("return `/logs?");
    expect(source).toContain('Permalink');
  });

  it('shows segment-oriented pagination copy and lazy selected-detail loading', () => {
    const source = readPage();
    expect(source).toContain('Loading selected trace detail…');
    expect(source).toContain('isSelectedOutsideSegment');
    expect(source).toContain('loadedCount={entries.length}');
    expect(source).toContain('md:grid-cols-3');
    expect(source).toContain('operator-log-activity-packets');
  });
});
