import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkflowActivationDispatchService } from '../../../../../src/services/workflow-activation-dispatch-service.js';
import { buildTaskPlatformHandoffsApp, matchDeliverablePromotionQuery, registerTaskPlatformHandoffsRoutes } from './support.js';

describe('task platform handoff routes', () => {
  let app: Awaited<ReturnType<typeof buildTaskPlatformHandoffsApp>> | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('submits a structured handoff for the active task owner', async () => {
    const dispatchSpy = vi
      .spyOn(WorkflowActivationDispatchService.prototype, 'dispatchActivation')
      .mockResolvedValue('orchestrator-task-1');
    const eventService = { emit: vi.fn(async () => undefined) };
    app = buildTaskPlatformHandoffsApp(async (sql: string) => {
      if (sql.includes('FROM tasks') && sql.includes('assigned_agent_id')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'task-1',
            workflow_id: 'workflow-1',
            workspace_id: 'workspace-1',
            work_item_id: 'work-item-1',
            stage_name: 'implementation',
            activation_id: null,
            assigned_agent_id: 'agent-1',
            is_orchestrator_task: false,
            state: 'in_progress',
          }],
        };
      }
      if (sql.includes('FROM tasks') && sql.includes('LIMIT 1')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'task-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'developer',
            stage_name: 'implementation',
            state: 'in_progress',
            rework_count: 0,
            metadata: { team_name: 'delivery' },
          }],
        };
      }
      if (sql.includes('SELECT COALESCE(MAX(sequence)')) {
        return { rowCount: 1, rows: [{ next_sequence: 0 }] };
      }
      if (sql.includes('FROM task_handoffs') && sql.includes('request_id')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('FROM task_handoffs') && sql.includes('task_rework_count')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('INSERT INTO task_handoffs')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'handoff-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            request_id: 'req-1',
            role: 'developer',
            team_name: 'delivery',
            stage_name: 'implementation',
            sequence: 0,
            summary: 'Implemented auth flow.',
            completion: 'full',
            changes: [],
            decisions: [],
            remaining_items: [],
            blockers: [],
            focus_areas: ['error handling'],
            known_risks: [],
            successor_context: null,
            role_data: {},
            artifact_ids: [],
            created_at: new Date('2026-03-15T12:00:00Z'),
          }],
        };
      }
      if (sql.startsWith('SELECT playbook_id FROM workflows')) {
        return { rowCount: 1, rows: [{ playbook_id: 'playbook-1' }] };
      }
      if (sql.includes('INSERT INTO workflow_activations')) {
        return {
          rowCount: 1,
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
        };
      }
      const deliverablePromotionQuery = matchDeliverablePromotionQuery(sql);
      if (deliverablePromotionQuery) {
        return deliverablePromotionQuery;
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    app.decorate('eventService', eventService as never);

    await registerTaskPlatformHandoffsRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-1/handoff',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'req-1',
        summary: 'Implemented auth flow.',
        completion: 'full',
        focus_areas: ['error handling'],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(
      expect.objectContaining({
        id: 'handoff-1',
        role: 'developer',
        focus_areas: ['error handling'],
      }),
    );
    expect(dispatchSpy).toHaveBeenCalledWith('tenant-1', 'activation-1', undefined);
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
  });

  it('accepts explicit completion_state and decision_state payloads on task handoff submission', async () => {
    vi
      .spyOn(WorkflowActivationDispatchService.prototype, 'dispatchActivation')
      .mockResolvedValue('orchestrator-task-1');
    const eventService = { emit: vi.fn(async () => undefined) };
    app = buildTaskPlatformHandoffsApp(async (sql: string) => {
      if (sql.includes('FROM tasks') && sql.includes('assigned_agent_id')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'task-1',
            workflow_id: 'workflow-1',
            workspace_id: 'workspace-1',
            work_item_id: 'work-item-1',
            stage_name: 'verification',
            activation_id: null,
            assigned_agent_id: 'agent-1',
            is_orchestrator_task: false,
            state: 'in_progress',
          }],
        };
      }
      if (sql.includes('FROM tasks') && sql.includes('LIMIT 1')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'task-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'policy-reviewer',
            stage_name: 'verification',
            state: 'in_progress',
            rework_count: 0,
            is_orchestrator_task: false,
            input: {
              subject_task_id: 'task-dev-1',
              subject_work_item_id: 'work-item-impl-1',
              subject_revision: 3,
            },
            metadata: { task_kind: 'assessment', team_name: 'delivery' },
          }],
        };
      }
      if (sql.includes('SELECT COALESCE(MAX(sequence)')) {
        return { rowCount: 1, rows: [{ next_sequence: 0 }] };
      }
      if (sql.includes('FROM task_handoffs') && sql.includes('request_id')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('FROM task_handoffs') && sql.includes('task_rework_count')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('INSERT INTO task_handoffs')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'handoff-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            request_id: 'req-1',
            role: 'policy-reviewer',
            team_name: 'delivery',
            stage_name: 'verification',
            sequence: 0,
            summary: 'Blocked pending legal clarification.',
            completion: 'full',
            completion_state: 'full',
            resolution: 'blocked',
            decision_state: 'blocked',
            changes: [],
            decisions: [],
            remaining_items: [],
            blockers: ['Legal clarification is required before release.'],
            focus_areas: [],
            known_risks: [],
            successor_context: null,
            role_data: {},
            subject_ref: {
              kind: 'task',
              task_id: 'task-dev-1',
              work_item_id: 'work-item-impl-1',
            },
            subject_revision: 3,
            outcome_action_applied: 'block_subject',
            branch_id: null,
            artifact_ids: [],
            created_at: new Date('2026-03-23T12:00:00Z'),
          }],
        };
      }
      if (sql.startsWith('SELECT playbook_id FROM workflows')) {
        return { rowCount: 1, rows: [{ playbook_id: 'playbook-1' }] };
      }
      if (sql.includes('INSERT INTO workflow_activations')) {
        return {
          rowCount: 1,
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
            queued_at: new Date('2026-03-23T12:00:00Z'),
            started_at: null,
            consumed_at: null,
            completed_at: null,
            summary: null,
            error: null,
          }],
        };
      }
      const deliverablePromotionQuery = matchDeliverablePromotionQuery(sql);
      if (deliverablePromotionQuery) {
        return deliverablePromotionQuery;
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    app.decorate('eventService', eventService as never);

    await registerTaskPlatformHandoffsRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-1/handoff',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'req-1',
        summary: 'Blocked pending legal clarification.',
        completion_state: 'full',
        decision_state: 'blocked',
        outcome_action_applied: 'block_subject',
        blockers: ['Legal clarification is required before release.'],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(
      expect.objectContaining({
        id: 'handoff-1',
        completion_state: 'full',
        decision_state: 'blocked',
        outcome_action_applied: 'block_subject',
      }),
    );
  });

  it('accepts guided closure fields on task handoff submission', async () => {
    vi
      .spyOn(WorkflowActivationDispatchService.prototype, 'dispatchActivation')
      .mockResolvedValue('orchestrator-task-1');
    const eventService = { emit: vi.fn(async () => undefined) };
    app = buildTaskPlatformHandoffsApp(async (sql: string) => {
      if (sql.includes('FROM tasks') && sql.includes('assigned_agent_id')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'task-1',
            workflow_id: 'workflow-1',
            workspace_id: 'workspace-1',
            work_item_id: 'work-item-1',
            stage_name: 'review',
            activation_id: null,
            assigned_agent_id: 'agent-1',
            is_orchestrator_task: false,
            state: 'in_progress',
          }],
        };
      }
      if (sql.includes('FROM tasks') && sql.includes('LIMIT 1')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'task-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'policy-reviewer',
            stage_name: 'review',
            state: 'in_progress',
            rework_count: 0,
            metadata: { task_kind: 'approval', team_name: 'review' },
          }],
        };
      }
      if (sql.includes('SELECT COALESCE(MAX(sequence)')) {
        return { rowCount: 1, rows: [{ next_sequence: 0 }] };
      }
      if (sql.includes('FROM task_handoffs') && sql.includes('request_id')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('FROM task_handoffs') && sql.includes('task_rework_count')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('INSERT INTO task_handoffs')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'handoff-guided-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            request_id: 'req-guided-1',
            role: 'policy-reviewer',
            team_name: 'review',
            stage_name: 'review',
            sequence: 0,
            summary: 'Advisory approval note recorded.',
            completion: 'full',
            completion_state: 'full',
            resolution: 'approved',
            decision_state: 'approved',
            changes: [],
            decisions: [],
            remaining_items: [],
            blockers: [],
            focus_areas: [],
            known_risks: [],
            recommended_next_actions: [{ action_code: 'continue_work' }],
            waived_steps: [{ code: 'secondary_review', reason: 'Primary review was sufficient.' }],
            completion_callouts: { completion_notes: 'Approval remained advisory.' },
            successor_context: null,
            role_data: { task_kind: 'approval', closure_effect: 'advisory' },
            artifact_ids: [],
            created_at: new Date('2026-03-25T01:00:00Z'),
          }],
        };
      }
      if (sql.startsWith('SELECT playbook_id FROM workflows')) {
        return { rowCount: 1, rows: [{ playbook_id: 'playbook-1' }] };
      }
      if (sql.includes('INSERT INTO workflow_activations')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'activation-guided-1',
            workflow_id: 'workflow-1',
            activation_id: null,
            request_id: 'task-handoff-submitted:task-1:0:req-guided-1',
            reason: 'task.handoff_submitted',
            event_type: 'task.handoff_submitted',
            payload: { task_id: 'task-1' },
            state: 'queued',
            dispatch_attempt: 0,
            dispatch_token: null,
            queued_at: new Date('2026-03-25T01:00:00Z'),
            started_at: null,
            consumed_at: null,
            completed_at: null,
            summary: null,
            error: null,
          }],
        };
      }
      const deliverablePromotionQuery = matchDeliverablePromotionQuery(sql);
      if (deliverablePromotionQuery) {
        return deliverablePromotionQuery;
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    app.decorate('eventService', eventService as never);

    await registerTaskPlatformHandoffsRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-1/handoff',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'req-guided-1',
        summary: 'Advisory approval note recorded.',
        completion: 'full',
        resolution: 'approved',
        closure_effect: 'advisory',
        recommended_next_actions: [{
          action_code: 'continue_work',
          target_type: 'work_item',
          target_id: 'work-item-1',
          why: 'No blocking approval is required.',
          requires_orchestrator_judgment: false,
        }],
        waived_steps: [{
          code: 'secondary_review',
          reason: 'Primary review was sufficient.',
        }],
        completion_callouts: {
          completion_notes: 'Approval remained advisory.',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(expect.objectContaining({
      id: 'handoff-guided-1',
      closure_effect: 'advisory',
      completion_callouts: expect.objectContaining({
        completion_notes: 'Approval remained advisory.',
      }),
    }));
  });
});
