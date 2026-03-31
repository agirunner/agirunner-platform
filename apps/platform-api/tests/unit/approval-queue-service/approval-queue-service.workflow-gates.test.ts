import { describe, expect, it, vi } from 'vitest';

import { ApprovalQueueService } from '../../../src/services/approval-queue-service/approval-queue-service.js';

describe('ApprovalQueueService listWorkflowGates', () => {
  it('scopes workflow gate queries and preserves block decisions', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("SELECT wa.payload->>'gate_id' AS gate_id")) {
          expect(params).toEqual([
            'tenant-1',
            ['gate-7'],
            'workflow-7',
          ]);
          return {
            rowCount: 1,
            rows: [{
              gate_id: 'gate-7',
              id: 'activation-row-7',
              workflow_id: 'workflow-7',
              activation_id: 'activation-7',
              request_id: 'gate-7-block',
              reason: 'stage.gate.block',
              event_type: 'stage.gate.block',
              state: 'queued',
              queued_at: new Date('2026-03-11T04:11:00Z'),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: 'Queued workflow follow-up',
              error: null,
              task_id: 'task-orchestrator-7',
              task_title: 'Resume workflow review',
              task_state: 'ready',
              task_started_at: null,
              task_completed_at: null,
            }],
          };
        }

        expect(sql).toContain('AND g.workflow_id = $2');
        expect(params).toEqual([
          'tenant-1',
          'workflow-7',
          [
            'stage.gate_requested',
            'stage.gate.approve',
            'stage.gate.block',
            'stage.gate.reject',
            'stage.gate.request_changes',
          ],
        ]);
        return {
          rowCount: 1,
          rows: [{
            id: 'gate-7',
            workflow_id: 'workflow-7',
            workflow_name: 'Workflow Seven',
            stage_id: 'stage-7',
            stage_name: 'review',
            stage_goal: 'Review the package',
            status: 'blocked',
            closure_effect: 'blocking',
            request_summary: 'Needs operator review',
            recommendation: 'block',
            concerns: ['Missing evidence'],
            key_artifacts: [{ id: 'artifact-7' }],
            requested_by_type: 'orchestrator',
            requested_by_id: 'task-7',
            requested_at: new Date('2026-03-11T04:00:00Z'),
            updated_at: new Date('2026-03-11T04:10:00Z'),
            decided_by_type: 'admin',
            decided_by_id: 'admin-7',
            decision_feedback: 'Hold until evidence is attached',
            decided_at: new Date('2026-03-11T04:10:00Z'),
            superseded_at: null,
            superseded_by_revision: null,
            requested_by_task_id: 'task-7',
            requested_by_task_title: 'Prepare review packet',
            requested_by_task_role: 'orchestrator',
            requested_by_work_item_id: 'work-item-7',
            requested_by_work_item_title: 'Release docs',
            resume_activation_id: 'activation-7',
            resume_activation_state: 'queued',
            resume_activation_event_type: 'stage.gate.block',
            resume_activation_reason: 'stage.gate.block',
            resume_activation_queued_at: new Date('2026-03-11T04:11:00Z'),
            resume_activation_started_at: null,
            resume_activation_completed_at: null,
            resume_activation_summary: null,
            resume_activation_error: null,
            decision_history: [
              {
                action: 'requested',
                actor_type: 'agent',
                actor_id: 'agent-7',
                feedback: null,
                created_at: '2026-03-11T04:00:00.000Z',
              },
              {
                action: 'block',
                actor_type: 'admin',
                actor_id: 'admin-7',
                feedback: 'Hold until evidence is attached',
                created_at: '2026-03-11T04:10:00.000Z',
              },
            ],
          }],
        };
      }),
    };

    const service = new ApprovalQueueService(pool as never);
    const gates = await service.listWorkflowGates('tenant-1', 'workflow-7');

    expect(gates).toEqual([
      expect.objectContaining({
        id: 'gate-7',
        workflow_id: 'workflow-7',
        closure_effect: 'blocking',
        human_decision: expect.objectContaining({
          decided_by_type: 'admin',
          decided_by_id: 'admin-7',
          feedback: 'Hold until evidence is attached',
        }),
        orchestrator_resume_history: [
          expect.objectContaining({
            activation_id: 'activation-7',
            state: 'processing',
            event_count: 1,
          }),
        ],
        decision_history: [
          expect.objectContaining({ action: 'requested' }),
          expect.objectContaining({ action: 'block', feedback: 'Hold until evidence is attached' }),
        ],
      }),
    ]);
  });
});
