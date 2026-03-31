import { describe, expect, it, vi } from 'vitest';

import { HandoffService } from '../../../src/services/handoff-service.js';
import { makeHandoffRow, makeTaskRow } from './handoff-service.fixtures.js';

describe('HandoffService activation side effects', () => {
  it('enqueues and dispatches an immediate workflow activation when a playbook handoff is submitted', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const logService = { insert: vi.fn(async () => undefined) };
    const activationDispatchService = {
      dispatchActivation: vi.fn(async () => 'orchestrator-task-1'),
    };
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [makeTaskRow({ metadata: { team_name: 'delivery' } })],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{
            ...makeHandoffRow({
              id: 'handoff-1',
              request_id: 'req-1',
              summary: 'Implemented auth flow.',
              changes: [{ file: 'src/auth.ts' }],
              focus_areas: ['error handling'],
              successor_context: 'Focus on refresh token expiry.',
              created_at: new Date('2026-03-15T12:00:00Z'),
            }),
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [{
            id: 'activation-1',
            workflow_id: 'workflow-1',
            activation_id: null,
            request_id: 'task-handoff-submitted:task-1:0:req-1',
            reason: 'task.handoff_submitted',
            event_type: 'task.handoff_submitted',
            payload: { task_id: 'task-1' },
            state: 'queued',
            dispatch_attempt: 0,
            dispatch_token: null,
            queued_at: new Date('2026-03-17T12:00:00Z'),
            started_at: null,
            consumed_at: null,
            completed_at: null,
            summary: null,
            error: null,
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(
      pool as never,
      logService as never,
      eventService as never,
      activationDispatchService as never,
    );

    await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-1',
      summary: 'Implemented auth flow.',
      completion: 'full',
      changes: [{ file: 'src/auth.ts' }],
      focus_areas: ['error handling'],
      successor_context: 'Focus on refresh token expiry.',
    });

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO workflow_activations'),
      expect.arrayContaining([
        'tenant-1',
        'workflow-1',
        'task-handoff-submitted:task-1:0:req-1',
        'task.handoff_submitted',
        'task.handoff_submitted',
      ]),
    );
    expect(activationDispatchService.dispatchActivation).toHaveBeenCalledWith(
      'tenant-1',
      'activation-1',
      undefined,
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.activation_queued',
        entityType: 'workflow',
        entityId: 'workflow-1',
        data: expect.objectContaining({
          event_type: 'task.handoff_submitted',
          reason: 'task.handoff_submitted',
        }),
      }),
      undefined,
    );
    expect(logService.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'task.handoff.submitted',
        taskId: 'task-1',
        workItemId: 'work-item-1',
        stageName: 'implementation',
        role: 'developer',
        payload: expect.objectContaining({
          event_type: 'task.handoff_submitted',
          handoff_id: 'handoff-1',
          handoff_request_id: 'req-1',
          task_rework_count: 0,
          completion: 'full',
          sequence: 0,
        }),
      }),
    );
  });

  it('does not enqueue a new activation when an orchestrator task submits a handoff', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const logService = { insert: vi.fn(async () => undefined) };
    const activationDispatchService = {
      dispatchActivation: vi.fn(async () => 'orchestrator-task-1'),
    };
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [makeTaskRow({
            role: 'orchestrator',
            is_orchestrator_task: true,
            metadata: { team_name: 'delivery' },
          })],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{
            ...makeHandoffRow({
              id: 'handoff-1',
              role: 'orchestrator',
              summary: 'Closed the work item and workflow state is stable.',
              created_at: new Date('2026-03-15T12:00:00Z'),
            }),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(
      pool as never,
      logService as never,
      eventService as never,
      activationDispatchService as never,
    );

    await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-1',
      summary: 'Closed the work item and workflow state is stable.',
      completion: 'full',
    });

    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO workflow_activations'),
      expect.anything(),
    );
    expect(activationDispatchService.dispatchActivation).not.toHaveBeenCalled();
    expect(eventService.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.activation_queued',
      }),
      expect.anything(),
    );
  });

  it('anchors orchestrator handoffs to the activation work item when the task row is workflow-scoped', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [makeTaskRow({
            role: 'orchestrator',
            work_item_id: null,
            stage_name: 'operator-approval',
            is_orchestrator_task: true,
            input: {
              events: [{
                type: 'stage.gate.approve',
                work_item_id: 'work-item-approval-1',
                stage_name: 'operator-approval',
                payload: {
                  gate_id: 'gate-1',
                  stage_name: 'operator-approval',
                  work_item_id: 'work-item-approval-1',
                },
              }],
            },
          })],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{
            ...makeHandoffRow({
              id: 'handoff-anchored-1',
              work_item_id: 'work-item-approval-1',
              role: 'orchestrator',
              stage_name: 'operator-approval',
              request_id: 'req-anchored-1',
              summary: 'Approval is complete and publication may proceed.',
              created_at: new Date('2026-03-23T12:00:00Z'),
            }),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);

    const result = await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-anchored-1',
      summary: 'Approval is complete and publication may proceed.',
      completion: 'full',
    });

    expect(result).toEqual(expect.objectContaining({ work_item_id: 'work-item-approval-1' }));
    const insertCall = pool.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO task_handoffs'),
    ) as [string, unknown[]] | undefined;
    expect(insertCall?.[1]?.[2]).toBe('work-item-approval-1');
  });

  it('treats late handoff activation enqueue as a no-op once the workflow is already completed', async () => {
    const logService = {
      insert: vi.fn(async () => undefined),
    };
    const eventService = {
      emit: vi.fn(async () => undefined),
    };
    const activationDispatchService = {
      dispatchActivation: vi.fn(async () => 'activation-task'),
    };
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [makeTaskRow({
            state: 'completed',
            metadata: {},
          })],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{
            ...makeHandoffRow({
              id: 'handoff-1',
              request_id: 'req-1',
              summary: 'Implemented auth flow.',
              changes: [{ file: 'src/auth.ts' }],
              focus_areas: ['error handling'],
              successor_context: 'Focus on refresh token expiry.',
              created_at: new Date('2026-03-15T12:00:00Z'),
            }),
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [{
            id: 'activation-noop',
            workflow_id: 'workflow-1',
            activation_id: null,
            request_id: 'task-handoff-submitted:task-1:0:req-1',
            reason: 'task.handoff_submitted',
            event_type: 'task.handoff_submitted',
            payload: { task_id: 'task-1' },
            state: 'completed',
            dispatch_attempt: 0,
            dispatch_token: null,
            queued_at: new Date('2026-03-17T12:00:00Z'),
            started_at: null,
            consumed_at: new Date('2026-03-17T12:00:00Z'),
            completed_at: new Date('2026-03-17T12:00:00Z'),
            summary: 'Ignored activation because workflow is already completed.',
            error: null,
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(
      pool as never,
      logService as never,
      eventService as never,
      activationDispatchService as never,
    );

    await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-1',
      summary: 'Implemented auth flow.',
      completion: 'full',
      changes: [{ file: 'src/auth.ts' }],
      focus_areas: ['error handling'],
      successor_context: 'Focus on refresh token expiry.',
    });

    expect(activationDispatchService.dispatchActivation).not.toHaveBeenCalled();
    expect(eventService.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.activation_queued',
        entityId: 'workflow-1',
      }),
      undefined,
    );
  });
});
