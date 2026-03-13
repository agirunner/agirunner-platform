import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './live-board-page.tsx',
    './live-board-attention-actions.ts',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('live board page source', () => {
  it('does not retain phase-era workflow fields in the live board model', () => {
    const source = readSource();
    expect(source).toContain('isLiveWorkflow');
    expect(source).not.toContain('phases?: Array');
  });

  it('adds search, saved views, stronger invalidation, and workflow-context deep links', () => {
    const source = readSource();
    expect(source).toContain('useSearchParams');
    expect(source).toContain("searchParams.get('q')");
    expect(source).toContain('SavedViews');
    expect(source).toContain("storageKey=\"live-board\"");
    expect(source).toContain("['workflow-stages']");
    expect(source).toContain("['workflow-activations']");
    expect(source).toContain('buildWorkflowDetailPermalink');
    expect(source).toContain('workItemId: item.id');
    expect(source).toContain('gateStageName: gate.stage_name');
  });

  it('replaces the hard live-board cap with paged board navigation', () => {
    const source = readSource();
    expect(source).toContain('LIVE_BOARD_PAGE_SIZE');
    expect(source).toContain('Board Pages');
    expect(source).toContain('Showing {start}-{end} of {props.totalBoards} live boards.');
    expect(source).not.toContain('.slice(0, 4)');
  });

  it('uses board and step language and avoids raw task-status comparisons in the operator lane', () => {
    const source = readSource();
    expect(source).toContain('Operator Live Board');
    expect(source).toContain('Mission control');
    expect(source).toContain('Triage what needs attention first');
    expect(source).toContain('Search boards, work items, stages, gates, steps, or IDs');
    expect(source).toContain('describeAttentionStep');
    expect(source).toContain('resolveTaskOperatorState');
    expect(source).toContain('buildAttentionTaskActions');
    expect(source).toContain('Open approvals');
    expect(source).toContain('Open work-item flow');
    expect(source).toContain('Open board context');
    expect(source).toContain('Open failed step diagnostics');
    expect(source).toContain('Open step diagnostics');
    expect(source).toContain('Board work linked');
    expect(source).not.toContain("t.status === 'awaiting_approval'");
    expect(source).not.toContain("t.status === 'failed'");
  });

  it('uses truthful KPI cards and triage-first operator copy instead of placeholder metrics', () => {
    const source = readSource();
    expect(source).toContain('Filter the live operator view');
    expect(source).toContain('Visible Board Triage Posture');
    expect(source).toContain('Orchestrator pool posture');
    expect(source).toContain('Specialist pool posture');
    expect(source).toContain('Escalation and stale attention');
    expect(source).toContain('Spend and token posture');
    expect(source).toContain('Visible board scope');
    expect(source).toContain('Delivery progress');
    expect(source).toContain('Attention posture');
    expect(source).toContain('Spend & token coverage');
    expect(source).toContain('Latest operator activity');
    expect(source).toContain('board runs reporting spend');
    expect(source).not.toContain('Containers Running');
    expect(source).not.toContain('Cost Today');
  });

  it('turns fleet telemetry into operator-capacity packets instead of raw worker rows', () => {
    const source = readSource();
    expect(source).toContain('summarizeWorkerFleet');
    expect(source).toContain('describeFleetHeadline');
    expect(source).toContain('describeWorkerCapacity');
    expect(source).toContain('Assigned steps');
    expect(source).toContain('Use this to spot capacity gaps before work starts queueing.');
    expect(source).toContain('assigned');
  });

  it('uses human-readable progress, spend, and relative timing in board summaries', () => {
    const source = readSource();
    expect(source).toContain('describeBoardProgress');
    expect(source).toContain('describeBoardSpend');
    expect(source).toContain('describeBoardTokens');
    expect(source).toContain('describeOrchestratorPool');
    expect(source).toContain('describeSpecialistPool');
    expect(source).toContain('describeRiskPosture');
    expect(source).toContain('formatRelativeTimestamp');
    expect(source).toContain('Compare board posture, pool pressure, progress, spend and tokens, and risk');
    expect(source).toContain('Each card highlights board posture first, then pool posture, progress, spend, and risk.');
  });

  it('renders human-readable live activity instead of raw event type rows', () => {
    const source = readSource();
    expect(source).toContain('describeTimelineEvent');
    expect(source).toContain('descriptor.emphasisLabel');
    expect(source).toContain('descriptor.scopeSummary');
    expect(source).toContain('descriptor.signalBadges');
    expect(source).toContain('descriptor.emphasisTone');
    expect(source).toContain('Recent operator activity recorded.');
    expect(source).toContain('Latest human-readable operator activity across the visible live scope.');
    expect(source).not.toContain('Badge variant="secondary">{evt.type}');
  });
});
