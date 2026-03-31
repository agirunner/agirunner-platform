import { describe, expect, it, vi } from 'vitest';

import { ConflictError, ValidationError } from '../../../src/errors/domain-errors.js';
import { PlaybookWorkflowControlService } from '../../../src/services/playbook-workflow-control-service.js';

const definition = {
  lifecycle: 'planned',
  board: {
    columns: [
      { id: 'planned', label: 'Planned' },
      { id: 'done', label: 'Done', is_terminal: true },
    ],
  },
  stages: [
    { name: 'requirements', goal: 'Define scope' },
    { name: 'implementation', goal: 'Ship code' },
  ],
};

describe('PlaybookWorkflowControlService', () => {

  it('allows approving a stage-addressed gate after changes were previously requested', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const activationService = { enqueueForWorkflow: vi.fn(async () => ({ id: 'activation-4', activation_id: 'activation-4', state: 'queued', event_type: 'stage.gate.approve', reason: 'stage.gate.approve', queued_at: null, started_at: null, completed_at: null, summary: null, error: null })) };
    const dispatchService = { dispatchActivation: vi.fn(async () => 'task-4') };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              workspace_id: 'workspace-1',
              playbook_id: 'playbook-1',
              lifecycle: 'planned',
              active_stage_name: 'requirements',
              state: 'active',
              definition,
              orchestration_state: {},
            }],
          };
        }
        if (sql.includes('FROM workflow_stages') && sql.includes('name = $3')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'stage-1',
              name: 'requirements',
              position: 0,
              goal: 'Define scope',
              guidance: null,
              human_gate: true,
              status: 'active',
              gate_status: 'changes_requested',
              iteration_count: 1,
              summary: 'Needs rework',
              metadata: {},
              started_at: new Date('2026-03-11T00:00:00Z'),
              completed_at: null,
              updated_at: new Date('2026-03-11T00:31:00Z'),
            }],
          };
        }
        if (sql.includes('FROM workflow_stage_gates') && sql.includes("AND status = 'awaiting_approval'")) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_stage_gates') && sql.includes('ORDER BY requested_at DESC')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'gate-1',
              workflow_id: 'workflow-1',
              stage_id: 'stage-1',
              stage_name: 'requirements',
              status: 'changes_requested',
              request_summary: 'Ready for review',
              recommendation: 'approve',
              concerns: [],
              key_artifacts: [],
              requested_by_type: 'agent',
              requested_by_id: 'k1',
              requested_at: new Date('2026-03-11T00:30:00Z'),
              updated_at: new Date('2026-03-11T00:31:00Z'),
              decided_by_type: 'admin',
              decided_by_id: 'k1',
              decision_feedback: 'Please revise',
              decided_at: new Date('2026-03-11T00:31:00Z'),
            }],
          };
        }
        if (sql.includes('UPDATE workflow_stage_gates')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'gate-1',
              workflow_id: 'workflow-1',
              stage_id: 'stage-1',
              stage_name: 'requirements',
              status: 'approved',
              request_summary: 'Ready for review',
              recommendation: 'approve',
              concerns: [],
              key_artifacts: [],
              requested_by_type: 'agent',
              requested_by_id: 'k1',
              requested_at: new Date('2026-03-11T00:30:00Z'),
              updated_at: new Date('2026-03-11T00:35:00Z'),
              decided_by_type: 'admin',
              decided_by_id: 'k1',
              decision_feedback: 'Looks good now.',
              decided_at: new Date('2026-03-11T00:35:00Z'),
            }],
          };
        }
        if (sql.includes('UPDATE workflow_stages')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'stage-1',
              name: 'requirements',
              position: 0,
              goal: 'Define scope',
              guidance: null,
              human_gate: true,
              status: 'active',
              gate_status: 'approved',
              iteration_count: 1,
              summary: 'Needs rework',
              metadata: {},
              started_at: new Date('2026-03-11T00:00:00Z'),
              completed_at: null,
              updated_at: new Date('2026-03-11T00:35:00Z'),
            }],
          };
        }
        if (sql.includes('UPDATE workflow_work_items')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'requirements']);
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new PlaybookWorkflowControlService({
      pool: pool as never,
      eventService: eventService as never,
      stateService: { recomputeWorkflowState: vi.fn(async () => 'active') } as never,
      activationService: activationService as never,
      activationDispatchService: dispatchService as never,
    });

    const stage = await service.actOnStageGate(
      { tenantId: 'tenant-1', scope: 'admin', ownerType: 'user', ownerId: 'user-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      'requirements',
      { action: 'approve', feedback: 'Looks good now.' },
      pool as never,
    );

    expect(stage).toEqual(
      expect.objectContaining({
        name: 'requirements',
        status: 'active',
        gate_status: 'approved',
      }),
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'stage.gate.approve',
        entityId: 'gate-1',
      }),
      pool,
    );
    expect(activationService.enqueueForWorkflow).toHaveBeenCalledTimes(1);
    expect(dispatchService.dispatchActivation).toHaveBeenCalledTimes(1);
  });


  it('emits move and reparent events and queues a follow-on activation when a work item changes', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const activationService = {
      enqueueForWorkflow: vi.fn(async () => ({ id: 'activation-9' })),
    };
    const dispatchService = {
      dispatchActivation: vi.fn(async () => 'task-9'),
    };
    const stateService = {
      recomputeWorkflowState: vi.fn(async () => 'active'),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          expect(sql).toContain('FOR UPDATE OF w');
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              workspace_id: 'workspace-1',
              playbook_id: 'playbook-1',
              lifecycle: 'planned',
              active_stage_name: 'requirements',
              state: 'active',
              definition,
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('AND id = $3') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-2',
              parent_work_item_id: 'wi-1',
              stage_name: 'requirements',
              title: 'Implement scope',
              goal: 'Ship it',
              acceptance_criteria: 'works',
              column_id: 'planned',
              owner_role: 'engineer',
              priority: 'normal',
              notes: null,
              completed_at: null,
              metadata: {},
              updated_at: new Date('2026-03-11T00:00:00Z'),
            }],
          };
        }
        if (sql.includes('WITH RECURSIVE descendants')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('AND id = $3') && sql.includes('LIMIT 1') && !sql.includes('FOR UPDATE')) {
          return { rowCount: 1, rows: [{ id: 'wi-3' }] };
        }
        if (sql.includes('UPDATE workflow_work_items')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-2',
              parent_work_item_id: 'wi-3',
              stage_name: 'requirements',
              title: 'Implement scope',
              goal: 'Ship it',
              acceptance_criteria: 'works',
              column_id: 'done',
              owner_role: 'engineer',
              priority: 'normal',
              notes: null,
              completed_at: new Date('2026-03-11T01:00:00Z'),
              metadata: {},
              updated_at: new Date('2026-03-11T01:00:00Z'),
            }],
          };
        }
        if (sql.includes('SELECT ws.id') && sql.includes('FROM workflow_stages ws')) {
          return {
            rowCount: 2,
            rows: [
              {
                id: 'stage-1',
                lifecycle: 'planned',
                name: 'requirements',
                position: 0,
                goal: 'Define scope',
                guidance: null,
                human_gate: true,
                status: 'active',
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: null,
                started_at: new Date('2026-03-11T00:00:00Z'),
                completed_at: null,
                open_work_item_count: 0,
                total_work_item_count: 1,
                first_work_item_at: new Date('2026-03-11T00:00:00Z'),
                last_completed_work_item_at: new Date('2026-03-11T01:00:00Z'),
              },
              {
                id: 'stage-2',
                lifecycle: 'planned',
                name: 'implementation',
                position: 1,
                goal: 'Ship code',
                guidance: null,
                human_gate: false,
                status: 'pending',
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: null,
                started_at: null,
                completed_at: null,
                open_work_item_count: 0,
                total_work_item_count: 0,
                first_work_item_at: null,
                last_completed_work_item_at: null,
              },
            ],
          };
        }
        if (sql.includes('SELECT latest_assessment.resolution AS blocking_resolution')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('UPDATE workflow_stages') && params?.[2] === 'stage-1') {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('UPDATE workflows')) {
          throw new Error('planned work item updates should not persist workflow.current_stage');
        }
        if (sql.includes('FROM tasks') && sql.includes('work_item_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new PlaybookWorkflowControlService({
      pool: pool as never,
      eventService: eventService as never,
      stateService: stateService as never,
      activationService: activationService as never,
      activationDispatchService: dispatchService as never,
    });

    const updated = await service.updateWorkItem(
      { tenantId: 'tenant-1', scope: 'admin', ownerType: 'user', ownerId: 'user-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      'wi-2',
      { parent_work_item_id: 'wi-3', column_id: 'done' },
      pool as never,
    );

    expect(updated.parent_work_item_id).toBe('wi-3');
    expect(updated.column_id).toBe('done');
    expect(updated).not.toHaveProperty('current_checkpoint');
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'work_item.updated',
        entityType: 'work_item',
        entityId: 'wi-2',
        data: expect.objectContaining({ workflow_id: 'workflow-1', work_item_id: 'wi-2' }),
      }),
      pool,
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'work_item.moved',
        entityType: 'work_item',
        entityId: 'wi-2',
      }),
      pool,
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'work_item.reparented',
        entityType: 'work_item',
        entityId: 'wi-2',
      }),
      pool,
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'work_item.completed',
        entityType: 'work_item',
        entityId: 'wi-2',
      }),
      pool,
    );
    expect(activationService.enqueueForWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow-1',
        eventType: 'work_item.updated',
        payload: expect.objectContaining({
          work_item_id: 'wi-2',
          previous_parent_work_item_id: 'wi-1',
          parent_work_item_id: 'wi-3',
          previous_column_id: 'planned',
          column_id: 'done',
        }),
      }),
      pool,
    );
    expect(dispatchService.dispatchActivation).toHaveBeenCalledWith('tenant-1', 'activation-9', pool);
    expect(stateService.recomputeWorkflowState).toHaveBeenCalledWith(
      'tenant-1',
      'workflow-1',
      pool,
      expect.objectContaining({ actorType: 'admin', actorId: 'k1' }),
    );
  });
});
