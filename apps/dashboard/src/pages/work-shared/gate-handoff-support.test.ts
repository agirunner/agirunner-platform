import { describe, expect, it } from 'vitest';

import { buildGateHandoffEntries, readGateResumeTaskSummary } from './gate-handoff-support.js';

describe('gate handoff support', () => {
  it('builds an ordered request-decision-resume trail', () => {
    const entries = buildGateHandoffEntries({
      request_summary: 'Ready for review',
      recommendation: 'approve',
      concerns: ['Check regression coverage'],
      key_artifacts: [{ id: 'artifact-1' }],
      requested_at: '2026-03-12T09:00:00.000Z',
      requested_by_type: 'orchestrator',
      requested_by_id: 'task-orch-1',
      requested_by_task: {
        id: 'task-orch-1',
        title: 'Assemble review packet',
        role: 'orchestrator',
        work_item_title: 'Ship onboarding polish',
      },
      decision_history: [
        {
          action: 'requested',
          actor_type: 'orchestrator',
          actor_id: 'task-orch-1',
          created_at: '2026-03-12T09:00:00.000Z',
        },
        {
          action: 'request_changes',
          actor_type: 'admin',
          actor_id: 'user-1',
          feedback: 'Need test fixes first',
          created_at: '2026-03-12T09:10:00.000Z',
        },
      ],
      orchestrator_resume_history: [
        {
          activation_id: 'activation-1',
          state: 'processing',
          event_type: 'stage.gate.request_changes',
          queued_at: '2026-03-12T09:11:00.000Z',
          summary: 'Queued orchestrator rework',
          task: {
            id: 'task-2',
            title: 'Rework QA evidence',
            state: 'in_progress',
          },
        },
      ],
    });

    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      label: 'Gate requested',
      task_id: 'task-orch-1',
    });
    expect(entries[1]).toMatchObject({
      label: 'Human request changes',
      detail: 'Need test fixes first',
    });
    expect(entries[2]).toMatchObject({
      label: 'Orchestrator processing',
      activation_id: 'activation-1',
      task_id: 'task-2',
    });
  });

  it('reads the latest resume task summary for queue cards', () => {
    expect(
      readGateResumeTaskSummary({
        orchestrator_resume: {
          activation_id: 'activation-1',
          task: {
            id: 'task-2',
            title: 'Rework QA evidence',
            state: 'in_progress',
          },
        },
      }),
    ).toBe('Rework QA evidence • in progress');
  });
});
