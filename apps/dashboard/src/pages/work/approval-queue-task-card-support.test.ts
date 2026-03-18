import { describe, expect, it } from 'vitest';

import {
  buildApprovalDecisionPacket,
  buildApprovalOutputPacket,
  buildApprovalRecoveryPacket,
  truncateOutput,
} from './approval-queue-task-card-support.js';

describe('approval queue task card support', () => {
  it('builds review guidance for output gates and direct approvals', () => {
    expect(
      buildApprovalDecisionPacket({
        id: 'task-1',
        title: 'Review generated release notes',
        state: 'output_pending_review',
        created_at: '2026-03-13T00:00:00Z',
      }),
    ).toEqual({
      title: 'Review the output packet',
      summary:
        'Validate the specialist output, then either approve it, request targeted changes, or reject it if the work should not continue.',
    });

    expect(
      buildApprovalDecisionPacket({
        id: 'task-2',
        title: 'Approve deployment checklist',
        state: 'awaiting_approval',
        created_at: '2026-03-13T00:00:00Z',
      }),
    ).toEqual({
      title: 'Approve or reject the specialist step',
      summary:
        'Review the board context and current step evidence before deciding whether this specialist step should advance, be reworked, or stop here.',
    });
  });

  it('prefers work-item recovery guidance and demotes stage-only workflow context to supporting evidence', () => {
    expect(
      buildApprovalRecoveryPacket({
        id: 'task-1',
        title: 'Review generated release notes',
        state: 'awaiting_approval',
        work_item_id: 'wi-1',
        created_at: '2026-03-13T00:00:00Z',
      }),
    ).toEqual({
      title: 'Keep recovery in the work-item flow',
      summary:
        'Run rework, retry, and follow-up decisions from the linked work-item flow so board state, related steps, and operator context stay aligned.',
    });

    expect(
      buildApprovalRecoveryPacket({
        id: 'task-2',
        title: 'Approve deployment checklist',
        state: 'awaiting_approval',
        workflow_id: 'wf-1',
        stage_name: 'qa',
        created_at: '2026-03-13T00:00:00Z',
      }),
    ).toEqual({
      title: 'Use direct recovery and keep workflow context nearby',
      summary:
        'Run rework and follow-up decisions from the step record. Use workflow context as supporting evidence when you need stage history or surrounding work state.',
    });
  });

  it('summarizes output evidence and truncates long payloads', () => {
    expect(
      buildApprovalOutputPacket({
        id: 'task-3',
        title: 'Review generated release notes',
        state: 'output_pending_review',
        created_at: '2026-03-13T00:00:00Z',
        output: 'Rendered summary',
      }),
    ).toEqual({
      title: 'Output evidence is available',
      summary:
        'Start with the short preview below, then open the full step record if you need exact payload details or linked artifacts before deciding.',
    });

    expect(truncateOutput('x'.repeat(220))).toBe(`${'x'.repeat(200)}...`);
    expect(
      buildApprovalOutputPacket({
        id: 'task-4',
        title: 'Review generated release notes',
        state: 'output_pending_review',
        created_at: '2026-03-13T00:00:00Z',
      }),
    ).toEqual({
      title: 'No output preview recorded yet',
      summary:
        'Open the step record and logs before approving. If the specialist should have produced evidence by now, request changes or reject with context.',
    });
  });
});
