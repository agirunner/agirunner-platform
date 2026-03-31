import { describe, expect, it } from 'vitest';

import { toGateResponse } from '../../../src/services/workflow-stage-gate-service.js';

describe('workflow stage gate service', () => {
  it('adds continuation metrics when a decision and resume activation are present', () => {
    const response = toGateResponse({
      id: 'gate-1',
      workflow_id: 'workflow-1',
      stage_name: 'approval',
      status: 'approved',
      closure_effect: 'blocking',
      recommendation: 'approve',
      concerns: [],
      key_artifacts: [],
      requested_at: new Date('2026-03-20T10:00:00Z'),
      decided_at: new Date('2026-03-20T10:00:10Z'),
      resume_activation_id: 'activation-1',
      resume_activation_state: 'completed',
      resume_activation_event_type: 'stage.gate.approve',
      resume_activation_reason: 'stage.gate.approve',
      resume_activation_queued_at: new Date('2026-03-20T10:00:11Z'),
      resume_activation_started_at: new Date('2026-03-20T10:00:12Z'),
      resume_activation_completed_at: new Date('2026-03-20T10:00:15Z'),
    });

    expect(response.continuation_metrics).toEqual({
      request_to_decision_seconds: 10,
      decision_to_continuation_queued_seconds: 1,
      decision_to_continuation_started_seconds: 2,
      decision_to_continuation_completed_seconds: 5,
    });
    expect(response.closure_effect).toBe('blocking');
  });

  it('returns null continuation metrics when the decision or resume timestamps are absent', () => {
    const response = toGateResponse({
      id: 'gate-2',
      workflow_id: 'workflow-2',
      stage_name: 'approval',
      status: 'awaiting_approval',
      closure_effect: 'advisory',
      recommendation: null,
      concerns: [],
      key_artifacts: [],
      requested_at: new Date('2026-03-20T10:00:00Z'),
    });

    expect(response.continuation_metrics).toEqual({
      request_to_decision_seconds: null,
      decision_to_continuation_queued_seconds: null,
      decision_to_continuation_started_seconds: null,
      decision_to_continuation_completed_seconds: null,
    });
    expect(response.closure_effect).toBe('advisory');
  });

  it('maps blocked gate status to a blocked human decision action', () => {
    const response = toGateResponse({
      id: 'gate-3',
      workflow_id: 'workflow-3',
      stage_name: 'approval',
      status: 'blocked',
      recommendation: null,
      concerns: [],
      key_artifacts: [],
      requested_at: new Date('2026-03-20T10:00:00Z'),
    } as never);

    expect(response.human_decision).toEqual({
      action: 'block',
      decided_by_type: null,
      decided_by_id: null,
      feedback: null,
      decided_at: null,
    });
  });

  it('preserves superseded decision metadata in the gate response', () => {
    const response = toGateResponse({
      id: 'gate-4',
      workflow_id: 'workflow-4',
      stage_name: 'approval',
      status: 'approved',
      recommendation: 'approve',
      concerns: [],
      key_artifacts: [],
      requested_at: new Date('2026-03-20T10:00:00Z'),
      decided_at: new Date('2026-03-20T10:00:10Z'),
      decision_history: [],
      superseded_at: new Date('2026-03-20T10:15:00Z'),
      superseded_by_revision: 3,
    } as never);

    expect(response).toEqual(
      expect.objectContaining({
        superseded_at: '2026-03-20T10:15:00.000Z',
        superseded_by_revision: 3,
        is_superseded: true,
      }),
    );
  });
});
