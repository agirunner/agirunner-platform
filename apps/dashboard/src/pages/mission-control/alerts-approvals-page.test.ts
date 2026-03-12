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

  it('uses board and specialist-step language instead of generic workflow status copy', () => {
    const source = readSource();
    expect(source).toContain('active boards');
    expect(source).toContain('Step Approvals');
    expect(source).toContain('Output Gates');
    expect(source).toContain('Board:');
    expect(source).toContain('Upstream steps:');
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
});
