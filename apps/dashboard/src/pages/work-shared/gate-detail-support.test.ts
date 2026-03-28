import { describe, expect, it } from 'vitest';

import {
  buildGateRecoveryPacket,
  buildGateBreadcrumbs,
  buildWorkflowGatePermalink,
  readGateDecisionSummary,
  readGatePacketSummary,
  readGateRequestSourceSummary,
  readGateResumptionSummary,
  readGateTimelineRows,
  readGateId,
} from './gate-detail-support.js';

describe('gate detail support', () => {
  it('prefers gate_id over id when reading gate identity', () => {
    expect(readGateId({ gate_id: 'gate-1', id: 'legacy-1' })).toBe('gate-1');
    expect(readGateId({ id: 'legacy-1' })).toBe('legacy-1');
    expect(readGateId({})).toBeNull();
  });

  it('builds stable workflow gate permalinks', () => {
    expect(buildWorkflowGatePermalink('workflow-1', 'review')).toBe(
      '/workflows/workflow-1?tab=needs_action#gate-review',
    );
  });

  it('builds operator breadcrumbs and packet summaries', () => {
    expect(
      buildGateBreadcrumbs({
        workflow_name: 'Customer Onboarding',
        stage_name: 'qa',
        requested_by_task: {
          id: 'task-1',
          title: 'Draft release notes',
          role: 'writer',
          work_item_title: 'Ship onboarding polish',
        },
        gate_id: 'gate-1',
      }),
    ).toEqual([
      'Board: Customer Onboarding',
      'Stage: qa',
      'Work item: Ship onboarding polish',
      'Step: Draft release notes • writer',
      'Gate: gate-1',
    ]);
    expect(
      readGatePacketSummary({
        concerns: ['one', 'two'],
        key_artifacts: [{ id: 'a1' }],
        recommendation: 'approve',
        human_decision: { action: 'request_changes' },
        is_superseded: true,
        superseded_by_revision: 3,
      }),
    ).toEqual([
      '2 concerns',
      '1 artifact',
      'recommendation: approve',
      'decision: request changes',
      'superseded at revision 3',
    ]);
  });

  it('reads request-source, decision, and resumption summaries for operator surfaces', () => {
    expect(
      readGateRequestSourceSummary({
        requested_by_type: 'orchestrator',
        requested_by_id: 'task-1',
        requested_by_task: {
          title: 'Draft release notes',
          role: 'writer',
          work_item_title: 'Ship onboarding polish',
        },
      }),
    ).toEqual([
      'work item: Ship onboarding polish',
      'step: Draft release notes • writer',
      'requested by orchestrator:task-1',
    ]);

    expect(
      readGateDecisionSummary({
        human_decision: {
          action: 'request_changes',
          decided_by_type: 'admin',
          decided_by_id: 'user-1',
          decided_at: '2026-03-12T12:00:00.000Z',
        },
        is_superseded: true,
        superseded_by_revision: 4,
      }),
    ).toContain('superseded at revision 4');

    expect(
      readGateResumptionSummary({
        human_decision: { action: 'approve' },
      }),
    ).toBe('Decision recorded • follow-up activation not visible yet');

    expect(
      readGateResumptionSummary({
        orchestrator_resume: {
          activation_id: 'activation-1',
          state: 'processing',
          event_type: 'gate_decision_recorded',
          queued_at: '2026-03-12T12:01:00.000Z',
          task: {
            id: 'task-1',
            title: 'Resume QA orchestration',
            state: 'in_progress',
          },
        },
      }),
    ).toContain(
      'processing • gate decision recorded • activation activation-1 • Resume QA orchestration • in progress',
    );
  });

  it('builds recovery packets for waiting, stalled, and in-flight follow-up states', () => {
    expect(
      buildGateRecoveryPacket({
        is_superseded: true,
      }),
    ).toEqual({
      tone: 'warning',
      title: 'Decision history is superseded',
      summary:
        'Keep the recorded operator decision for audit, but rely on the current subject revision before taking another gate action.',
    });

    expect(
      buildGateRecoveryPacket({
        gate_status: 'awaiting_approval',
      }),
    ).toEqual({
      tone: 'warning',
      title: 'Decision is blocking this stage',
      summary:
        'Review the packet, then approve, request changes, or reject so the board can continue or recover with clear direction.',
    });

    expect(
      buildGateRecoveryPacket({
        human_decision: { action: 'approve' },
      }),
    ).toEqual({
      tone: 'warning',
      title: 'Decision recorded; follow-up not visible yet',
      summary:
        'Refresh the board gate first. If the gate stays stalled, inspect the linked activation flow before recording another decision.',
    });

    expect(
      buildGateRecoveryPacket({
        orchestrator_resume: {
          state: 'processing',
          activation_id: 'activation-1',
        },
      }),
    ).toEqual({
      tone: 'secondary',
      title: 'Follow-up is running',
      summary:
        'Stay on the board gate or activation flow for recovery. Use step diagnostics only if the follow-up stalls or errors.',
    });

    expect(
      buildGateRecoveryPacket({
        orchestrator_resume: {
          state: 'failed',
          error: { message: 'network timeout' },
        },
      }),
    ).toEqual({
      tone: 'destructive',
      title: 'Follow-up stalled after the decision',
      summary:
        'Open the linked activation or follow-up step diagnostics, capture the error details, then retry from the board gate once the blocker is clear.',
    });
  });

  it('builds operator timeline rows for request and decision context', () => {
    const rows = readGateTimelineRows({
      gate_status: 'awaiting_approval',
      requested_at: '2026-03-12T10:00:00.000Z',
      requested_by_type: 'orchestrator',
      requested_by_id: 'task-1',
      decided_at: '2026-03-12T12:00:00.000Z',
      decided_by_type: 'admin',
      decided_by_id: 'user-1',
      orchestrator_resume: {
        activation_id: 'activation-1',
        state: 'processing',
        queued_at: '2026-03-12T12:01:00.000Z',
      },
    });

    expect(rows).toHaveLength(6);
    expect(rows[0].label).toBe('Requested');
    expect(rows[0].value).toContain('orchestrator:task-1');
    expect(rows[1]).toEqual({
      label: 'Request source',
      value: 'requested by orchestrator:task-1',
    });
    expect(rows[2].label).toBe('Last decision');
    expect(rows[2].value).toContain('admin:user-1');
    expect(rows[3].label).toBe('Orchestrator follow-up');
    expect(rows[3].value).toContain('activation activation-1');
    expect(rows[4]).toEqual({ label: 'Activation', value: 'activation-1' });
    expect(rows[5]).toEqual({ label: 'Status', value: 'awaiting approval' });
  });

  it('adds superseded state to the operator timeline', () => {
    const rows = readGateTimelineRows({
      gate_status: 'approved',
      requested_at: '2026-03-12T10:00:00.000Z',
      is_superseded: true,
      superseded_by_revision: 5,
    });

    expect(rows).toContainEqual({
      label: 'Superseded',
      value: 'superseded at revision 5',
    });
  });
});
