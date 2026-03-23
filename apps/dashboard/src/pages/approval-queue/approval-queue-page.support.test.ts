import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  APPROVAL_QUEUE_INITIAL_VISIBLE_COUNT,
  APPROVAL_QUEUE_VISIBLE_INCREMENT,
  countHiddenApprovalQueueItems,
  findApprovalQueueGateIndex,
  limitApprovalQueueItems,
  nextApprovalQueueVisibleCount,
  readApprovalQueueTargetGateId,
  readApprovalQueueWindowSummary,
} from './approval-queue-page.support.js';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './approval-queue-page.support.ts'), 'utf8');
}

describe('approval queue page support source', () => {
  it('centralizes workflow invalidation and url param updates for the queue shell', () => {
    const source = readSource();
    expect(source).toContain('invalidateWorkflowQueries');
    expect(source).toContain('invalidateApprovalWorkflowQueries');
    expect(source).toContain('updateApprovalQueueSearchParams');
    expect(source).toContain('{ replace: true }');
  });

  it('bounds visible queue slices and caps show-more growth at the total count', () => {
    expect(limitApprovalQueueItems(['a', 'b', 'c'], 2)).toEqual(['a', 'b']);
    expect(countHiddenApprovalQueueItems(9, 4)).toBe(5);
    expect(
      nextApprovalQueueVisibleCount(
        APPROVAL_QUEUE_INITIAL_VISIBLE_COUNT,
        APPROVAL_QUEUE_INITIAL_VISIBLE_COUNT + 3,
      ),
    ).toBe(APPROVAL_QUEUE_INITIAL_VISIBLE_COUNT + 3);
    expect(nextApprovalQueueVisibleCount(5, 50, APPROVAL_QUEUE_VISIBLE_INCREMENT)).toBe(30);
    expect(readApprovalQueueWindowSummary(25, 60, 'stage gates')).toBe(
      'Showing 25 of 60 visible stage gates.',
    );
  });

  it('resolves gate permalink targets from search params or hashes and finds the gate index', () => {
    const fromSearch = new URLSearchParams('gate=gate-2');
    const fromHash = new URLSearchParams('');

    expect(readApprovalQueueTargetGateId(fromSearch, '')).toBe('gate-2');
    expect(readApprovalQueueTargetGateId(fromHash, '#gate-gate-3')).toBe('gate-3');
    expect(
      findApprovalQueueGateIndex(
        [
          {
            id: 'legacy-1',
            gate_id: 'gate-1',
            workflow_id: 'wf-1',
            workflow_name: 'Workflow 1',
            stage_name: 'requirements',
            stage_goal: 'Confirm scope',
            gate_status: 'awaiting_approval',
            concerns: [],
            key_artifacts: [],
            updated_at: '2026-03-12T12:00:00.000Z',
          },
          {
            id: 'legacy-2',
            gate_id: 'gate-2',
            workflow_id: 'wf-1',
            workflow_name: 'Workflow 1',
            stage_name: 'qa',
            stage_goal: 'Approve release',
            gate_status: 'awaiting_approval',
            concerns: [],
            key_artifacts: [],
            updated_at: '2026-03-12T12:10:00.000Z',
          },
        ],
        'gate-2',
      ),
    ).toBe(1);
  });
});
