import { describe, expect, it } from 'vitest';

import { buildApprovalQueueSummary } from './alerts-approvals-page.support.js';

describe('alerts approvals support', () => {
  it('prioritizes stage gates and reports the oldest queued age', () => {
    const summary = buildApprovalQueueSummary({
      stageGates: [{ requested_at: '2026-03-12T10:00:00.000Z' }],
      approvals: [{ created_at: '2026-03-12T10:15:00.000Z' }],
      outputGates: [],
      escalations: [],
      failures: [{ created_at: '2026-03-12T10:30:00.000Z' }],
      nowMs: Date.parse('2026-03-12T11:00:00.000Z'),
    });

    expect(summary.total).toBe(3);
    expect(summary.primaryLane).toBe('Stage gates first');
    expect(summary.oldestAgeLabel).toBe('Oldest waiting 1h');
  });

  it('falls back to queue clear when nothing needs operator action', () => {
    const summary = buildApprovalQueueSummary({
      stageGates: [],
      approvals: [],
      outputGates: [],
      escalations: [],
      failures: [],
      nowMs: Date.parse('2026-03-12T11:00:00.000Z'),
    });

    expect(summary.primaryLane).toBe('Queue clear');
    expect(summary.oldestAgeLabel).toBe('No queued work');
  });
});
