import { describe, expect, it, vi } from 'vitest';

import { ApprovalQueueService } from '../../src/services/approval-queue-service.js';

describe('ApprovalQueueService', () => {
  it('returns task and stage approvals together', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM tasks t')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-1',
              title: 'Review output',
              state: 'output_pending_review',
              workflow_id: 'workflow-1',
              workflow_name: 'Workflow One',
              work_item_id: 'work-item-1',
              work_item_title: 'Ship docs',
              stage_name: 'review',
              next_expected_actor: 'reviewer',
              next_expected_action: 'assess',
              role: 'qa',
              activation_id: 'activation-1',
              rework_count: 1,
              handoff_count: 2,
              latest_handoff_role: 'developer',
              latest_handoff_stage_name: 'implementation',
              latest_handoff_summary:
                'Implemented the feature. Validation token: Bearer sk-live-secret-value.',
              latest_handoff_completion: 'partial',
              latest_handoff_successor_context:
                'Reviewer should reuse api_key sk-live-secret-value during spot checks.',
              latest_handoff_created_at: new Date('2026-03-11T00:30:00Z'),
              created_at: new Date('2026-03-11T00:00:00Z'),
              output: {
                summary: 'Done',
                api_key: 'sk-live-output-secret',
                note: 'Replay with Bearer sk-live-output-secret if the preview fails.',
              },
            }],
          };
        }
        if (sql.includes("SELECT wa.payload->>'gate_id' AS gate_id")) {
          return {
            rowCount: 2,
            rows: [
              {
                gate_id: 'gate-1',
                id: 'activation-row-1',
                workflow_id: 'workflow-1',
                activation_id: 'activation-2',
                request_id: 'gate-approval-1',
                reason: 'stage.gate.approve',
                event_type: 'stage.gate.approve',
                state: 'processing',
                queued_at: new Date('2026-03-11T01:01:00Z'),
                started_at: new Date('2026-03-11T01:02:00Z'),
                consumed_at: null,
                completed_at: null,
                summary: 'Queued orchestrator follow-up',
                error: null,
                task_id: 'task-orchestrator-1',
                task_title: 'Resume requirements orchestration',
                task_state: 'in_progress',
                task_started_at: new Date('2026-03-11T01:02:30Z'),
                task_completed_at: null,
              },
              {
                gate_id: 'gate-1',
                id: 'activation-row-2',
                workflow_id: 'workflow-1',
                activation_id: 'activation-2',
                request_id: null,
                reason: 'gate_decision_recorded',
                event_type: 'gate_decision_recorded',
                state: 'processing',
                queued_at: new Date('2026-03-11T01:03:00Z'),
                started_at: null,
                consumed_at: null,
                completed_at: null,
                summary: 'Picked up by orchestrator',
                error: null,
                task_id: 'task-orchestrator-1',
                task_title: 'Resume requirements orchestration',
                task_state: 'in_progress',
                task_started_at: new Date('2026-03-11T01:02:30Z'),
                task_completed_at: null,
              },
            ],
          };
        }
        return {
          rowCount: 1,
          rows: [{
            id: 'gate-1',
            workflow_id: 'workflow-1',
            workflow_name: 'Workflow One',
            stage_id: 'stage-1',
            stage_name: 'requirements',
            stage_goal: 'Define scope',
            status: 'awaiting_approval',
            request_summary: 'Ready for review',
            recommendation: 'approve',
            concerns: ['none'],
            key_artifacts: [{ id: 'artifact-1' }],
            requested_by_type: 'orchestrator',
            requested_by_id: 'task-1',
            requested_at: new Date('2026-03-11T01:00:00Z'),
            updated_at: new Date('2026-03-11T01:00:00Z'),
            decided_by_type: null,
            decided_by_id: null,
            decision_feedback: null,
            decided_at: null,
            requested_by_task_id: 'task-9',
            requested_by_task_title: 'Orchestrator review packet',
            requested_by_task_role: 'orchestrator',
            requested_by_work_item_id: 'work-item-1',
            requested_by_work_item_title: 'Ship docs',
            resume_activation_id: 'activation-2',
            resume_activation_state: 'queued',
            resume_activation_event_type: 'stage.gate.approve',
            resume_activation_reason: 'stage.gate.approve',
            resume_activation_queued_at: new Date('2026-03-11T01:01:00Z'),
            resume_activation_started_at: null,
            resume_activation_completed_at: null,
            resume_activation_summary: null,
            resume_activation_error: null,
            decision_history: [
              {
                action: 'requested',
                actor_type: 'agent',
                actor_id: 'agent-1',
                feedback: null,
                created_at: '2026-03-11T01:00:00.000Z',
              },
            ],
          }],
        };
      }),
    };

    const service = new ApprovalQueueService(pool as never);
    const queue = await service.listApprovals('tenant-1');
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('AND e.entity_id = g.id'),
      expect.any(Array),
    );
    expect((pool.query as unknown as { mock: { calls: Array<[string]> } }).mock.calls[1][0]).not.toContain(
      'e.entity_id = g.id::text',
    );

    expect(queue.task_approvals).toHaveLength(1);
    expect(queue.stage_gates).toHaveLength(1);
    expect(queue.task_approvals[0]).toEqual(
      expect.objectContaining({
        work_item_id: 'work-item-1',
        work_item_title: 'Ship docs',
        stage_name: 'review',
        next_expected_actor: 'reviewer',
        next_expected_action: 'assess',
        role: 'qa',
        activation_id: 'activation-1',
        rework_count: 1,
        handoff_count: 2,
        latest_handoff: expect.objectContaining({
          role: 'developer',
          stage_name: 'implementation',
          summary: 'redacted://secret',
          completion: 'partial',
          successor_context: 'redacted://secret',
        }),
        output: {
          summary: 'Done',
          api_key: 'redacted://secret',
          note: 'redacted://secret',
        },
      }),
    );
    expect(queue.task_approvals[0]).not.toHaveProperty('current_checkpoint');
    expect(queue.stage_gates[0]).toEqual(
      expect.objectContaining({
        id: 'gate-1',
        gate_id: 'gate-1',
        workflow_id: 'workflow-1',
        stage_id: 'stage-1',
        stage_name: 'requirements',
        recommendation: 'approve',
        requested_by_type: 'orchestrator',
        requested_by_id: 'task-1',
        requested_by_task: expect.objectContaining({
          id: 'task-9',
          title: 'Orchestrator review packet',
          work_item_id: 'work-item-1',
        }),
        orchestrator_resume: expect.objectContaining({
          activation_id: 'activation-2',
          state: 'processing',
          task: expect.objectContaining({
            id: 'task-orchestrator-1',
            title: 'Resume requirements orchestration',
            state: 'in_progress',
          }),
        }),
        orchestrator_resume_history: [
          expect.objectContaining({
            activation_id: 'activation-2',
            event_count: 2,
          }),
        ],
        decision_history: [
          expect.objectContaining({
            action: 'requested',
            actor_type: 'agent',
            actor_id: 'agent-1',
          }),
        ],
      }),
    );
  });

  it('looks up a gate by id', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT wa.payload->>'gate_id' AS gate_id")) {
          return {
            rowCount: 1,
            rows: [{
              gate_id: 'gate-9',
              id: 'activation-row-9',
              workflow_id: 'workflow-9',
              activation_id: 'activation-9',
              request_id: 'gate-9-approve',
              reason: 'stage.gate.approve',
              event_type: 'stage.gate.approve',
              state: 'queued',
              queued_at: new Date('2026-03-11T02:11:00Z'),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: 'Queued follow-up',
              error: null,
              task_id: null,
              task_title: null,
              task_state: null,
              task_started_at: null,
              task_completed_at: null,
            }],
          };
        }
        return {
          rowCount: 1,
          rows: [{
            id: 'gate-9',
            workflow_id: 'workflow-9',
            workflow_name: 'Workflow Nine',
            stage_id: 'stage-9',
            stage_name: 'qa',
            stage_goal: 'Validate release',
            status: 'awaiting_approval',
            request_summary: 'Ready for final review',
            recommendation: 'approve',
            concerns: [],
            key_artifacts: [],
            requested_by_type: 'orchestrator',
            requested_by_id: 'task-9',
            requested_at: new Date('2026-03-11T02:00:00Z'),
            updated_at: new Date('2026-03-11T02:00:00Z'),
            decided_by_type: null,
            decided_by_id: null,
            decision_feedback: null,
            decided_at: null,
            decision_history: [
              {
                action: 'requested',
                actor_type: 'agent',
                actor_id: 'agent-9',
                feedback: null,
                created_at: '2026-03-11T02:00:00.000Z',
              },
              {
                action: 'request_changes',
                actor_type: 'admin',
                actor_id: 'admin-1',
                feedback: 'Needs revision',
                created_at: '2026-03-11T02:05:00.000Z',
              },
              {
                action: 'approve',
                actor_type: 'admin',
                actor_id: 'admin-1',
                feedback: 'Looks good now',
                created_at: '2026-03-11T02:10:00.000Z',
              },
            ],
          }],
        };
      }),
    };

    const service = new ApprovalQueueService(pool as never);
    const gate = await service.getGate('tenant-1', 'gate-9');
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('AND e.entity_id = g.id'),
      ['tenant-1', 'gate-9', ['stage.gate_requested', 'stage.gate.approve', 'stage.gate.reject', 'stage.gate.request_changes']],
    );

    expect(gate).toEqual(
      expect.objectContaining({
        id: 'gate-9',
        workflow_id: 'workflow-9',
        stage_name: 'qa',
        requested_by_id: 'task-9',
        orchestrator_resume_history: [
          expect.objectContaining({
            activation_id: 'activation-9',
            state: 'processing',
          }),
        ],
        decision_history: [
          expect.objectContaining({ action: 'requested' }),
          expect.objectContaining({ action: 'request_changes', feedback: 'Needs revision' }),
          expect.objectContaining({ action: 'approve', feedback: 'Looks good now' }),
        ],
      }),
    );
  });

  it('redacts secret references from gate packets', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT wa.payload->>'gate_id' AS gate_id")) {
          return {
            rowCount: 1,
            rows: [{
              gate_id: 'gate-secret',
              id: 'activation-row-secret',
              workflow_id: 'workflow-secret',
              activation_id: 'activation-secret',
              request_id: 'gate-secret-approve',
              reason: 'stage.gate.approve',
              event_type: 'stage.gate.approve',
              state: 'processing',
              queued_at: new Date('2026-03-11T03:11:00Z'),
              started_at: new Date('2026-03-11T03:12:00Z'),
              consumed_at: null,
              completed_at: null,
              summary: 'secret:RESUME_SUMMARY',
              error: { token: 'secret:RESUME_TOKEN' },
              task_id: 'task-orchestrator-secret',
              task_title: 'secret:RESUME_TASK_TITLE',
              task_state: 'in_progress',
              task_started_at: new Date('2026-03-11T03:12:30Z'),
              task_completed_at: null,
            }],
          };
        }
        return {
          rowCount: 1,
          rows: [{
            id: 'gate-secret',
            workflow_id: 'workflow-secret',
            workflow_name: 'Workflow Secret',
            stage_id: 'stage-secret',
            stage_name: 'qa',
            stage_goal: 'Validate release',
            status: 'approved',
            request_summary: 'secret:GATE_SUMMARY',
            recommendation: 'secret:GATE_RECOMMENDATION',
            concerns: ['secret:CONCERN_SECRET'],
            key_artifacts: [{ note: 'secret:ARTIFACT_SECRET' }],
            requested_by_type: 'orchestrator',
            requested_by_id: 'task-secret',
            requested_at: new Date('2026-03-11T03:00:00Z'),
            updated_at: new Date('2026-03-11T03:15:00Z'),
            decided_by_type: 'admin',
            decided_by_id: 'admin-1',
            decision_feedback: 'secret:DECISION_SECRET',
            decided_at: new Date('2026-03-11T03:15:00Z'),
            requested_by_task_id: 'task-secret',
            requested_by_task_title: 'secret:REQUEST_TASK_TITLE',
            requested_by_task_role: 'orchestrator',
            requested_by_work_item_id: 'work-item-secret',
            requested_by_work_item_title: 'secret:WORK_ITEM_TITLE',
            decision_history: [
              {
                action: 'requested',
                actor_type: 'agent',
                actor_id: 'agent-9',
                feedback: 'secret:REQUEST_FEEDBACK',
                created_at: '2026-03-11T03:00:00.000Z',
              },
              {
                action: 'approve',
                actor_type: 'admin',
                actor_id: 'admin-1',
                feedback: 'secret:APPROVE_FEEDBACK',
                created_at: '2026-03-11T03:15:00.000Z',
              },
            ],
          }],
        };
      }),
    };

    const service = new ApprovalQueueService(pool as never);
    const gate = await service.getGate('tenant-1', 'gate-secret');

    expect(gate).toEqual(
      expect.objectContaining({
        request_summary: 'redacted://gate-secret',
        summary: 'redacted://gate-secret',
        recommendation: 'redacted://gate-secret',
        concerns: ['redacted://gate-secret'],
        key_artifacts: [{ note: 'redacted://gate-secret' }],
        decision_feedback: 'redacted://gate-secret',
        requested_by_task: expect.objectContaining({
          title: 'redacted://gate-secret',
          work_item_title: 'redacted://gate-secret',
        }),
        human_decision: expect.objectContaining({
          feedback: 'redacted://gate-secret',
        }),
        decision_history: [
          expect.objectContaining({ feedback: 'redacted://gate-secret' }),
          expect.objectContaining({ feedback: 'redacted://gate-secret' }),
        ],
        orchestrator_resume: expect.objectContaining({
          summary: 'redacted://gate-secret',
          error: { token: 'redacted://gate-secret' },
          task: expect.objectContaining({
            title: 'redacted://gate-secret',
          }),
        }),
      }),
    );
  });
});
