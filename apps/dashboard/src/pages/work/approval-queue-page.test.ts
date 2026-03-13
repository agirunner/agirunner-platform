import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './approval-queue-page.tsx'), 'utf8');
}

describe('approval queue page source', () => {
  it('prioritizes stage gates with stronger summary cards and section hierarchy', () => {
    const source = readSource();
    expect(source).toContain('Review stage gates first');
    expect(source).toContain('Oldest wait');
    expect(source).toContain('Recovery watch');
    expect(source).toContain('Stage gates');
    expect(source).toContain('Step reviews');
    expect(source).toContain('Step Approvals');
    expect(source).toContain('QueueMetricCard');
    expect(source).toContain('QueueSectionHeader');
    expect(source).toContain('ApprovalQueueSectionJumpStrip');
    expect(source).toContain('approval-stage-gates');
    expect(source).toContain('approval-step-approvals');
    expect(source).toContain('Human review packets waiting by stage.');
    expect(source).not.toContain('First up');
  });

  it('delegates stage-gate and step packets to focused queue components', () => {
    const source = readSource();
    expect(source).toContain('StageGateQueueCard');
    expect(source).toContain('TaskApprovalCard');
    expect(source).toContain('countPendingOrchestratorFollowUp');
  });

  it('adds url-driven search, saved views, and workflow gate deep links', () => {
    const source = readSource();
    expect(source).toContain('useSearchParams');
    expect(source).toContain("searchParams.get('q')");
    expect(source).toContain("searchParams.get('view')");
    expect(source).toContain('SavedViews');
    expect(source).toContain('storageKey="approval-queue"');
  });

  it('subscribes to realtime updates and invalidates workflow detail queries after decisions', () => {
    const source = readSource();
    expect(source).toContain('subscribeToEvents');
    expect(source).toContain('invalidateApprovalWorkflowQueries');
  });
});
