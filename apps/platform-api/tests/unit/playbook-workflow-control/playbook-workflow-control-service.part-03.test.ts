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

  it('acts on a gate directly by gate id, clears approval expectations, and returns the updated gate', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    let clearedApprovalExpectation = false;
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2') && sql.includes('FROM workflow_stage_gates')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'gate-1',
              workflow_id: 'workflow-1',
              stage_id: 'stage-1',
              stage_name: 'requirements',
              status: 'awaiting_approval',
              request_summary: 'Ready for review',
              recommendation: 'approve',
              concerns: [],
              key_artifacts: [],
              requested_by_type: 'agent',
              requested_by_id: 'k1',
              requested_at: new Date('2026-03-11T00:30:00Z'),
              updated_at: new Date('2026-03-11T00:30:00Z'),
              decided_by_type: null,
              decided_by_id: null,
              decision_feedback: null,
              decided_at: null,
            }],
          };
        }
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
              status: 'awaiting_gate',
              gate_status: 'awaiting_approval',
              iteration_count: 0,
              summary: 'Ready for review',
              metadata: {},
              started_at: new Date('2026-03-11T00:00:00Z'),
              completed_at: null,
              updated_at: new Date('2026-03-11T00:00:00Z'),
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
              updated_at: new Date('2026-03-11T00:31:00Z'),
              decided_by_type: 'admin',
              decided_by_id: 'k1',
              decision_feedback: 'Ship it',
              decided_at: new Date('2026-03-11T00:31:00Z'),
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
              status: 'awaiting_gate',
              gate_status: 'approved',
              iteration_count: 0,
              summary: 'Ready for review',
              metadata: {},
              started_at: new Date('2026-03-11T00:00:00Z'),
              completed_at: null,
              updated_at: new Date('2026-03-11T00:31:00Z'),
            }],
          };
        }
        if (sql.includes('UPDATE workflow_work_items')) {
          clearedApprovalExpectation = true;
          expect(params).toEqual(['tenant-1', 'workflow-1', 'requirements']);
          return { rowCount: 1, rows: [] };
        }
        return { rowCount: 1, rows: [] };
      }),
    };
    const service = new PlaybookWorkflowControlService({
      pool: pool as never,
      eventService: eventService as never,
      stateService: { recomputeWorkflowState: vi.fn(async () => 'active') } as never,
      activationService: {
        enqueueForWorkflow: vi.fn(async () => ({
          id: 'activation-3',
          activation_id: 'activation-3',
          state: 'queued',
          event_type: 'stage.gate.approve',
          reason: 'stage.gate.approve',
          queued_at: new Date('2026-03-11T00:31:00Z'),
          started_at: null,
          completed_at: null,
          summary: null,
          error: null,
        })),
      } as never,
      activationDispatchService: { dispatchActivation: vi.fn(async () => 'task-3') } as never,
    });

    const gate = await service.actOnGate(
      { tenantId: 'tenant-1', scope: 'admin', ownerType: 'user', ownerId: 'user-1', keyPrefix: 'k1', id: 'key-1' },
      'gate-1',
      { action: 'approve', feedback: 'Ship it' },
      pool as never,
    );

    expect(gate).toEqual(
      expect.objectContaining({
        id: 'gate-1',
        gate_status: 'approved',
        requested_by_id: 'k1',
        decided_by_id: 'k1',
        decision_feedback: 'Ship it',
        orchestrator_resume: expect.objectContaining({
          activation_id: 'activation-3',
          state: 'queued',
          event_type: 'stage.gate.approve',
        }),
        human_decision: expect.objectContaining({
          action: 'approve',
          feedback: 'Ship it',
        }),
      }),
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'stage.gate.approve',
        entityType: 'gate',
        entityId: 'gate-1',
        data: expect.objectContaining({
          workflow_id: 'workflow-1',
          gate_id: 'gate-1',
          stage_name: 'requirements',
        }),
      }),
      pool,
    );
    expect(clearedApprovalExpectation).toBe(true);
  });


  it('treats a repeated gate-id decision as idempotent once the gate is already decided', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const activationService = { enqueueForWorkflow: vi.fn(async () => ({ id: 'activation-3' })) };
    const dispatchService = { dispatchActivation: vi.fn(async () => 'task-3') };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("AND status = 'awaiting_approval'")) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_stage_gates') && sql.includes('AND id = $2') && !sql.includes("AND status = 'awaiting_approval'")) {
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
              updated_at: new Date('2026-03-11T00:31:00Z'),
              decided_by_type: 'admin',
              decided_by_id: 'k1',
              decision_feedback: 'Ship it',
              decided_at: new Date('2026-03-11T00:31:00Z'),
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

    const gate = await service.actOnGate(
      { tenantId: 'tenant-1', scope: 'admin', ownerType: 'user', ownerId: 'user-1', keyPrefix: 'k1', id: 'key-1' },
      'gate-1',
      { action: 'approve', feedback: 'Ship it' },
      pool as never,
    );

    expect(gate).toEqual(
      expect.objectContaining({
        gate_id: 'gate-1',
        gate_status: 'approved',
        decision_feedback: 'Ship it',
      }),
    );
    expect(eventService.emit).not.toHaveBeenCalled();
    expect(activationService.enqueueForWorkflow).not.toHaveBeenCalled();
    expect(dispatchService.dispatchActivation).not.toHaveBeenCalled();
  });


  it('treats a repeated gate-id decision as idempotent even when the retried feedback differs', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const activationService = { enqueueForWorkflow: vi.fn(async () => ({ id: 'activation-3' })) };
    const dispatchService = { dispatchActivation: vi.fn(async () => 'task-3') };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("AND status = 'awaiting_approval'")) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_stage_gates') && sql.includes('AND id = $2') && !sql.includes("AND status = 'awaiting_approval'")) {
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
              updated_at: new Date('2026-03-11T00:31:00Z'),
              decided_by_type: 'admin',
              decided_by_id: 'k1',
              decision_feedback: 'Original approval note',
              decided_at: new Date('2026-03-11T00:31:00Z'),
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

    const gate = await service.actOnGate(
      { tenantId: 'tenant-1', scope: 'admin', ownerType: 'user', ownerId: 'user-1', keyPrefix: 'k1', id: 'key-1' },
      'gate-1',
      { action: 'approve', feedback: 'Retried approval note' },
      pool as never,
    );

    expect(gate).toEqual(
      expect.objectContaining({
        gate_id: 'gate-1',
        gate_status: 'approved',
        decision_feedback: 'Original approval note',
      }),
    );
    expect(eventService.emit).not.toHaveBeenCalled();
    expect(activationService.enqueueForWorkflow).not.toHaveBeenCalled();
    expect(dispatchService.dispatchActivation).not.toHaveBeenCalled();
  });
});
