import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(
    resolve(import.meta.dirname, './alerts-approvals-page.tsx'),
    'utf8',
  );
}

describe('alerts approvals page source', () => {
  it('treats stage gates as the first operator approval surface', () => {
    const source = readSource();
    expect(source).toContain('getApprovalQueue');
    expect(source).toContain('Stage Gates');
    expect(source).toContain('Review stage gates first');
    expect(source).toContain('GateDetailCard');
    expect(source).toContain('Operator Queue');
    expect(source).toContain('buildApprovalQueueSummary');
    expect(source).toContain('Operator priority order');
  });

  it('keeps escalations and failures as separate operator intervention lanes', () => {
    const source = readSource();
    expect(source).toContain('Operator Guidance');
    expect(source).toContain('Execution Failures');
    expect(source).toContain('escalated');
    expect(source).toContain('output_pending_review');
    expect(source).toContain('Cancel Failed Step');
    expect(source).toContain('Cancel Work');
  });

  it('routes workflow-owned task interventions through the grouped work-item flow instead of task-first actions', () => {
    const source = readSource();
    expect(source).toContain('buildTaskContextPacket');
    expect(source).toContain('usesWorkItemOperatorFlow');
    expect(source).toContain('WorkItemFlowActionBlock');
    expect(source).toContain("contextPacket.links.find((link) => link.label === 'Open work item flow')");
    expect(source).toContain('contextPacket.links.map((link) =>');
    expect(source).toContain('Use the grouped work-item flow first. Open the step record later from the work-item view');
    expect(source).toContain('workflow-owned specialist step must be approved, reworked, bypassed, or rejected from the grouped work-item flow');
    expect(source).toContain('workflow-owned output gate must be handled from the grouped work-item flow');
    expect(source).toContain('failed workflow-owned specialist step must be retried, bypassed, or cancelled from the grouped work-item flow');
    expect(source).toContain('escalated workflow-owned specialist step must be resumed, bypassed, or cancelled from the grouped work-item flow');
  });

  it('uses board and specialist-step language instead of generic workflow status copy', () => {
    const source = readSource();
    expect(source).toContain('active boards');
    expect(source).toContain('Step Approvals');
    expect(source).toContain('Output Gates');
    expect(source).toContain('TaskContextPacket');
    expect(source).toContain('buildTaskContextPacket(task)');
    expect(source).toContain('{fact.label}: {fact.value}');
    expect(source).toContain('Awaiting Operator Decision');
    expect(source).toContain('dismissedEscalationTaskIds');
    expect(source).toContain('dismissedFailureTaskIds');
    expect(source).not.toContain('No failed tasks.');
  });

  it('keeps the page shell visible when one intervention lane fails instead of blanking the entire surface', () => {
    const source = readSource();
    expect(source).toContain('showInitialLoading');
    expect(source).toContain('approvalsError');
    expect(source).toContain('escalationError');
    expect(source).toContain('failedError');
    expect(source).toContain('LaneErrorState');
    expect(source).toContain('LaneLoadingState');
    expect(source).not.toContain('Failed to load operator intervention lanes. Please retry.');
  });

  it('adds queue summaries, a manual refresh action, and grouped all-lane sections for faster scanning', () => {
    const source = readSource();
    expect(source).toContain('Refresh Queue');
    expect(source).toContain('QueueSummaryCard');
    expect(source).toContain('LaneSection');
    expect(source).toContain('overflow-x-auto pb-1');
    expect(source).toContain('Stage gates');
    expect(source).toContain('Execution failures');
  });
});
