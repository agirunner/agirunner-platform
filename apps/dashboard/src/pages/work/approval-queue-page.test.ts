import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(
    resolve(import.meta.dirname, './approval-queue-page.tsx'),
    'utf8',
  );
}

describe('approval queue page source', () => {
  it('prioritizes stage gates with stronger summary cards and section hierarchy', () => {
    const source = readSource();
    expect(source).toContain('Review stage gates first');
    expect(source).toContain('Oldest wait');
    expect(source).toContain('First up');
    expect(source).toContain('Awaiting follow-up');
    expect(source).toContain('Stage gates');
    expect(source).toContain('Step Approvals');
    expect(source).toContain('QueueMetricCard');
    expect(source).toContain('QueueSectionHeader');
    expect(source).toContain('Human review packets waiting by stage.');
  });

  it('renders stage-gate packets as queue cards with breadcrumbs and request-source context', () => {
    const source = readSource();
    expect(source).toContain('GateDetailCard');
    expect(source).toContain('source="approval-queue"');
    expect(source).toContain('StageGateQueueCard');
    expect(source).toContain('OperatorBreadcrumbTrail');
    expect(source).toContain('renderQueuePriorityLabel');
    expect(source).toContain('Oldest wait first');
    expect(source).toContain('readGateDecisionSummary');
    expect(source).toContain('readGateResumptionSummary');
    expect(source).toContain('readGateResumeTaskSummary');
    expect(source).toContain('readGateRequestSourceSummary');
    expect(source).toContain('Gate packet');
    expect(source).toContain('Request source');
    expect(source).toContain('Orchestrator follow-up');
    expect(source).toContain('Follow-up step:');
    expect(source).toContain('countPendingOrchestratorFollowUp');
  });

  it('adds url-driven search, saved views, and workflow gate deep links', () => {
    const source = readSource();
    expect(source).toContain('useSearchParams');
    expect(source).toContain("searchParams.get('q')");
    expect(source).toContain("searchParams.get('view')");
    expect(source).toContain('SavedViews');
    expect(source).toContain("storageKey=\"approval-queue\"");
    expect(source).toContain('buildWorkflowDetailPermalink');
    expect(source).toContain('Open board gate');
  });

  it('subscribes to realtime updates and invalidates workflow detail queries after decisions', () => {
    const source = readSource();
    expect(source).toContain('subscribeToEvents');
    expect(source).toContain('invalidateWorkflowQueries');
    expect(source).toContain('invalidateApprovalWorkflowQueries');
  });

  it('renders task approval breadcrumbs with work-item, role, activation, and board-flow context', () => {
    const source = readSource();
    expect(source).toContain('buildWorkflowDetailPermalink');
    expect(source).toContain('buildTaskApprovalBreadcrumbs');
    expect(source).toContain('readTaskOperatorFlowLabel');
    expect(source).toContain('OperatorBreadcrumbTrail');
    expect(source).toContain('Open board context');
    expect(source).toContain('Activation ');
    expect(source).toContain('QueueInfoTile');
    expect(source).toContain('Rework round');
    expect(source).toContain('Step approval');
    expect(source).toContain('Output gate');
    expect(source).toContain('activationId: task.activation_id ?? null');
    expect(source).toContain('Open Work Item Flow');
    expect(source).toContain('Open Step Record');
    expect(source).toContain('usesWorkItemOperatorFlow');
  });

  it('keeps request-changes dialogs scroll-safe on smaller viewports', () => {
    const source = readSource();
    expect(source).toContain('DialogContent className="sm:max-w-lg"');
    expect(source).toContain('max-h-[75vh]');
    expect(source).toContain('overflow-y-auto');
    expect(source).toContain('className="min-h-[140px]"');
    expect(source).toContain('className="w-full sm:w-auto"');
    expect(source).toContain('flex-wrap items-center gap-2');
  });
});
