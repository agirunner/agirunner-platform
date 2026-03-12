import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './live-board-page.tsx'), 'utf8');
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
    expect(source).toContain('Search boards, work items, stages, gates, steps, or IDs');
    expect(source).toContain('describeAttentionStep');
    expect(source).toContain('resolveTaskOperatorState');
    expect(source).toContain('Open approvals');
    expect(source).toContain('Open work-item flow');
    expect(source).toContain('Open failed step');
    expect(source).not.toContain("t.status === 'awaiting_approval'");
    expect(source).not.toContain("t.status === 'failed'");
  });

  it('uses truthful KPI cards and triage-first operator copy instead of placeholder metrics', () => {
    const source = readSource();
    expect(source).toContain('Blocked Work');
    expect(source).toContain('Failed Steps');
    expect(source).toContain('Combined gates, blocked work, and step interventions');
    expect(source).not.toContain('Containers Running');
    expect(source).not.toContain('Cost Today');
  });

  it('renders human-readable live activity instead of raw event type rows', () => {
    const source = readSource();
    expect(source).toContain('describeTimelineEvent');
    expect(source).toContain('describeEventScope');
    expect(source).toContain('Recent operator activity recorded.');
    expect(source).not.toContain('Badge variant="secondary">{evt.type}');
  });
});
