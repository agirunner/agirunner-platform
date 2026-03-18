import { describe, expect, it, vi } from 'vitest';

import { ConflictError, ValidationError } from '../../src/errors/domain-errors.js';
import { PlaybookWorkflowControlService } from '../../src/services/playbook-workflow-control-service.js';

const definition = {
  lifecycle: 'planned',
  board: {
    columns: [
      { id: 'planned', label: 'Planned' },
      { id: 'done', label: 'Done', is_terminal: true },
    ],
  },
  stages: [
    { name: 'requirements', goal: 'Define scope', human_gate: true },
    { name: 'implementation', goal: 'Ship code' },
  ],
};

describe('PlaybookWorkflowControlService', () => {
  it('wraps gate requests in a transaction when no client is provided', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
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
              status: 'active',
              gate_status: 'not_requested',
              iteration_count: 0,
              summary: null,
              metadata: {},
              started_at: new Date('2026-03-11T00:00:00Z'),
              completed_at: null,
              updated_at: new Date('2026-03-11T00:00:00Z'),
            }],
          };
        }
        if (sql.includes('FROM workflow_stage_gates')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_stage_gates')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'gate-1',
              workflow_id: 'workflow-1',
              stage_id: 'stage-1',
              stage_name: 'requirements',
              status: 'awaiting_approval',
              request_summary: 'Ready for gate review',
              recommendation: null,
              concerns: [],
              key_artifacts: [],
              requested_by_type: 'agent',
              requested_by_id: 'k1',
              requested_at: new Date('2026-03-11T00:00:00Z'),
              updated_at: new Date('2026-03-11T00:00:00Z'),
              decided_by_type: null,
              decided_by_id: null,
              decision_feedback: null,
              decided_at: null,
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
              gate_status: 'awaiting_approval',
              iteration_count: 0,
              summary: 'Ready for gate',
              metadata: {},
              started_at: new Date('2026-03-11T00:00:00Z'),
              completed_at: null,
              updated_at: new Date('2026-03-11T00:00:00Z'),
            }],
          };
        }
        if (sql.includes('UPDATE workflow_work_items')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'requirements']);
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };
    const service = new PlaybookWorkflowControlService({
      pool: pool as never,
      eventService: eventService as never,
      stateService: { recomputeWorkflowState: vi.fn(async () => 'active') } as never,
      activationService: { enqueueForWorkflow: vi.fn() } as never,
      activationDispatchService: { dispatchActivation: vi.fn() } as never,
    });

    const stage = await service.requestStageGateApproval(
      { tenantId: 'tenant-1', scope: 'agent', ownerType: 'agent', ownerId: 'agent-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      'requirements',
      { summary: 'Ready for gate review' },
    );

    expect(stage.gate_status).toBe('awaiting_approval');
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'stage.gate_requested',
        entityType: 'gate',
        entityId: 'gate-1',
        data: expect.objectContaining({
          workflow_id: 'workflow-1',
          stage_name: 'requirements',
          gate_id: 'gate-1',
        }),
      }),
      client,
    );
    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('treats late duplicate gate requests as a no-op after a gate was already approved', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const pool = {
      query: vi.fn(async (sql: string) => {
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
              gate_status: 'approved',
              iteration_count: 0,
              summary: 'Already approved',
              metadata: {},
              started_at: new Date('2026-03-11T00:00:00Z'),
              completed_at: null,
              updated_at: new Date('2026-03-11T00:31:00Z'),
            }],
          };
        }
        if (sql.includes('FROM workflow_stage_gates')) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new PlaybookWorkflowControlService({
      pool: pool as never,
      eventService: eventService as never,
      stateService: { recomputeWorkflowState: vi.fn(async () => 'active') } as never,
      activationService: { enqueueForWorkflow: vi.fn() } as never,
      activationDispatchService: { dispatchActivation: vi.fn() } as never,
    });

    const stage = await service.requestStageGateApproval(
      { tenantId: 'tenant-1', scope: 'agent', ownerType: 'agent', ownerId: 'agent-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      'requirements',
      { summary: 'Ready for gate review' },
      pool as never,
    );

    expect(stage.gate_status).toBe('approved');
    expect(eventService.emit).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO workflow_stage_gates'));
  });

  it('rolls back gate decisions when a later step fails without an outer client', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
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
        if (sql.includes('FROM workflow_stage_gates')) {
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'requirements']);
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };
    const service = new PlaybookWorkflowControlService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      stateService: {
        recomputeWorkflowState: vi.fn(async () => {
          throw new Error('state recompute failed');
        }),
      } as never,
      activationService: { enqueueForWorkflow: vi.fn(async () => ({ id: 'activation-3' })) } as never,
      activationDispatchService: { dispatchActivation: vi.fn(async () => 'task-3') } as never,
    });

    await expect(
      service.actOnStageGate(
        { tenantId: 'tenant-1', scope: 'admin', ownerType: 'user', ownerId: 'user-1', keyPrefix: 'k1', id: 'key-1' },
        'workflow-1',
        'requirements',
        { action: 'approve', feedback: 'Ship it' },
      ),
    ).rejects.toThrow('state recompute failed');

    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('advances the current stage to the next configured stage', async () => {
    const activationService = {
      enqueueForWorkflow: vi.fn(async () => ({
        id: 'activation-advance-1',
        activation_id: 'activation-advance-1',
        state: 'queued',
        event_type: 'stage.started',
        reason: 'stage.started',
        queued_at: '2026-03-11T00:31:00.000Z',
        started_at: null,
        completed_at: null,
        summary: null,
        error: null,
      })),
    };
    const dispatchService = {
      dispatchActivation: vi.fn(async () => 'task-advance-1'),
    };
    const pool = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
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
          const stageName = params[2];
          if (stageName === 'requirements') {
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
                summary: null,
                metadata: {},
                started_at: new Date('2026-03-11T00:00:00Z'),
                completed_at: null,
                updated_at: new Date('2026-03-11T00:00:00Z'),
              }],
            };
          }
          return {
            rowCount: 1,
            rows: [{
              id: 'stage-2',
              name: 'implementation',
              position: 1,
              goal: 'Ship code',
              guidance: null,
              human_gate: false,
              status: 'pending',
              gate_status: 'not_requested',
              iteration_count: 0,
              summary: null,
              metadata: {},
              started_at: null,
              completed_at: null,
              updated_at: new Date('2026-03-11T00:00:00Z'),
            }],
          };
        }
        return { rowCount: 1, rows: [] };
      }),
    };
    const service = new PlaybookWorkflowControlService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      stateService: {
        recomputeWorkflowState: vi.fn(async () => 'active'),
      } as never,
      activationService: activationService as never,
      activationDispatchService: dispatchService as never,
    });

    const result = await service.advanceStage(
      { tenantId: 'tenant-1', scope: 'agent', ownerType: 'agent', ownerId: 'agent-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      'requirements',
      { summary: 'Requirements approved' },
      pool as never,
    );

    expect(result).toEqual({
      completed_stage: 'requirements',
      next_stage: 'implementation',
    });
    expect(activationService.enqueueForWorkflow).toHaveBeenCalledWith(
      {
        tenantId: 'tenant-1',
        workflowId: 'workflow-1',
        reason: 'stage.started',
        eventType: 'stage.started',
        payload: {
          stage_name: 'implementation',
          previous_stage_name: 'requirements',
        },
        actorType: 'agent',
        actorId: 'k1',
      },
      pool,
    );
    expect(dispatchService.dispatchActivation).toHaveBeenCalledWith(
      'tenant-1',
      'activation-advance-1',
      pool,
    );
  });

  it('closes open predecessor work items when advancing a planned workflow stage', async () => {
    const activationService = {
      enqueueForWorkflow: vi.fn(async () => ({
        id: 'activation-advance-2',
        activation_id: 'activation-advance-2',
        state: 'queued',
        event_type: 'stage.started',
        reason: 'stage.started',
        queued_at: '2026-03-11T00:32:00.000Z',
        started_at: null,
        completed_at: null,
        summary: null,
        error: null,
      })),
    };
    const dispatchService = {
      dispatchActivation: vi.fn(async () => 'task-advance-2'),
    };
    const pool = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
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
            }],
          };
        }
        if (sql.includes('FROM workflow_stages') && sql.includes('name = $3')) {
          const stageName = params[2];
          if (stageName === 'requirements') {
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
                summary: null,
                metadata: {},
                started_at: new Date('2026-03-11T00:00:00Z'),
                completed_at: null,
                updated_at: new Date('2026-03-11T00:00:00Z'),
              }],
            };
          }
          return {
            rowCount: 1,
            rows: [{
              id: 'stage-2',
              name: 'implementation',
              position: 1,
              goal: 'Ship code',
              guidance: null,
              human_gate: false,
              status: 'pending',
              gate_status: 'not_requested',
              iteration_count: 0,
              summary: null,
              metadata: {},
              started_at: null,
              completed_at: null,
              updated_at: new Date('2026-03-11T00:00:00Z'),
            }],
          };
        }
        return { rowCount: 1, rows: [] };
      }),
    };
    const service = new PlaybookWorkflowControlService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      stateService: {
        recomputeWorkflowState: vi.fn(async () => 'active'),
      } as never,
      activationService: activationService as never,
      activationDispatchService: dispatchService as never,
    });

    await service.advanceStage(
      { tenantId: 'tenant-1', scope: 'agent', ownerType: 'agent', ownerId: 'agent-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      'requirements',
      { summary: 'Requirements approved' },
      pool as never,
    );

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workflow_work_items'),
      ['tenant-1', 'workflow-1', 'requirements', 'done'],
    );
    expect(activationService.enqueueForWorkflow).toHaveBeenCalledWith(
      {
        tenantId: 'tenant-1',
        workflowId: 'workflow-1',
        reason: 'stage.started',
        eventType: 'stage.started',
        payload: {
          stage_name: 'implementation',
          previous_stage_name: 'requirements',
        },
        actorType: 'agent',
        actorId: 'k1',
      },
      pool,
    );
    expect(dispatchService.dispatchActivation).toHaveBeenCalledWith(
      'tenant-1',
      'activation-advance-2',
      pool,
    );
  });

  it('records a gate decision and queues a follow-on activation', async () => {
    const activationService = {
      enqueueForWorkflow: vi.fn(async () => ({
        id: 'activation-2',
        activation_id: 'activation-2',
        state: 'queued',
        event_type: 'stage.gate.approve',
        reason: 'stage.gate.approve',
        queued_at: '2026-03-11T00:31:00.000Z',
        started_at: null,
        completed_at: null,
        summary: null,
        error: null,
      })),
    };
    const dispatchService = {
      dispatchActivation: vi.fn(async () => 'task-2'),
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
        if (sql.includes('FROM workflow_stage_gates')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'gate-1',
              status: 'awaiting_approval',
              recommendation: 'approve',
              concerns: [],
              key_artifacts: [],
              requested_at: new Date('2026-03-11T00:30:00Z'),
            }],
          };
        }
        if (sql.includes('UPDATE workflow_stage_gates')) {
          return { rowCount: 1, rows: [] };
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
              updated_at: new Date('2026-03-11T00:00:00Z'),
            }],
          };
        }
        return { rowCount: 1, rows: [] };
      }),
    };
    const service = new PlaybookWorkflowControlService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      stateService: { recomputeWorkflowState: vi.fn(async () => 'active') } as never,
      activationService: activationService as never,
      activationDispatchService: dispatchService as never,
    });

    const stage = await service.actOnStageGate(
      { tenantId: 'tenant-1', scope: 'admin', ownerType: 'user', ownerId: 'user-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      'requirements',
      { action: 'approve', feedback: 'Looks good' },
      pool as never,
    );

    expect(stage.gate_status).toBe('approved');
    expect(stage).toHaveProperty('orchestrator_resume.activation_id', 'activation-2');
    expect(stage).toHaveProperty('orchestrator_resume.state', 'queued');
    expect(stage).toHaveProperty('orchestrator_resume.event_type', 'stage.gate.approve');
    expect(stage).toHaveProperty('orchestrator_resume.reason', 'stage.gate.approve');
    expect(activationService.enqueueForWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow-1',
        eventType: 'stage.gate.approve',
      }),
      pool,
    );
    expect(dispatchService.dispatchActivation).toHaveBeenCalledWith(
      'tenant-1',
      'activation-2',
      pool,
    );
  });

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

  it('treats a repeated stage-addressed gate decision as idempotent once the stage already reflects it', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const activationService = { enqueueForWorkflow: vi.fn(async () => ({ id: 'activation-4' })) };
    const dispatchService = { dispatchActivation: vi.fn(async () => 'task-4') };
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

    const stage = await service.actOnStageGate(
      { tenantId: 'tenant-1', scope: 'admin', ownerType: 'user', ownerId: 'user-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      'requirements',
      { action: 'approve', feedback: 'Ship it' },
      pool as never,
    );

    expect(stage).toEqual(
      expect.objectContaining({
        name: 'requirements',
        gate_status: 'approved',
      }),
    );
    expect(eventService.emit).not.toHaveBeenCalled();
    expect(activationService.enqueueForWorkflow).not.toHaveBeenCalled();
    expect(dispatchService.dispatchActivation).not.toHaveBeenCalled();
  });

  it('allows approving the same gate id after changes were previously requested', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const activationService = { enqueueForWorkflow: vi.fn(async () => ({ id: 'activation-4', state: 'queued', event_type: 'stage.gate.approve', reason: 'stage.gate.approve', queued_at: null, started_at: null, completed_at: null, summary: null, error: null })) };
    const dispatchService = { dispatchActivation: vi.fn(async () => 'task-4') };
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
              status: 'awaiting_gate',
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

    const gate = await service.actOnGate(
      { tenantId: 'tenant-1', scope: 'admin', ownerType: 'user', ownerId: 'user-1', keyPrefix: 'k1', id: 'key-1' },
      'gate-1',
      { action: 'approve', feedback: 'Looks good now.' },
      pool as never,
    );

    expect(gate).toEqual(
      expect.objectContaining({
        gate_id: 'gate-1',
        gate_status: 'approved',
        decision_feedback: 'Looks good now.',
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
              status: 'awaiting_gate',
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
              current_checkpoint: 'requirements',
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
        if (sql.includes('UPDATE workflow_stages') && params?.[2] === 'stage-1') {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('UPDATE workflows')) {
          throw new Error('planned work item updates should not persist workflow.current_stage');
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

  it('treats a no-op work-item patch as idempotent and skips side effects', async () => {
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
    const updatedAt = new Date('2026-03-11T00:00:00Z');
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
              metadata: { lane: 'alpha' },
              updated_at: updatedAt,
            }],
          };
        }
        if (sql.includes('WITH RECURSIVE descendants')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('AND id = $3') && sql.includes('LIMIT 1') && !sql.includes('FOR UPDATE')) {
          return { rowCount: 1, rows: [{ id: 'wi-1' }] };
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
      {
        parent_work_item_id: 'wi-1',
        title: ' Implement scope ',
        goal: 'Ship it',
        acceptance_criteria: 'works',
        stage_name: 'requirements',
        column_id: 'planned',
        owner_role: 'engineer',
        priority: 'normal',
        notes: null,
        metadata: { lane: 'alpha' },
      },
      pool as never,
    );

    expect(updated).toEqual(
      expect.objectContaining({
        id: 'wi-2',
        updated_at: updatedAt.toISOString(),
        metadata: { lane: 'alpha' },
      }),
    );
    expect(pool.query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE workflow_work_items'), expect.anything());
    expect(eventService.emit).not.toHaveBeenCalled();
    expect(activationService.enqueueForWorkflow).not.toHaveBeenCalled();
    expect(dispatchService.dispatchActivation).not.toHaveBeenCalled();
    expect(stateService.recomputeWorkflowState).not.toHaveBeenCalled();
  });

  it('rejects reparenting a work item under one of its descendants', async () => {
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
          return { rowCount: 1, rows: [{ id: 'wi-3' }] };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('AND id = $3') && sql.includes('LIMIT 1') && !sql.includes('FOR UPDATE')) {
          return { rowCount: 1, rows: [{ id: 'wi-3' }] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new PlaybookWorkflowControlService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      stateService: { recomputeWorkflowState: vi.fn(async () => 'active') } as never,
      activationService: { enqueueForWorkflow: vi.fn() } as never,
      activationDispatchService: { dispatchActivation: vi.fn() } as never,
    });

    await expect(
      service.updateWorkItem(
        { tenantId: 'tenant-1', scope: 'admin', ownerType: 'user', ownerId: 'user-1', keyPrefix: 'k1', id: 'key-1' },
        'workflow-1',
        'wi-2',
        { parent_work_item_id: 'wi-3' },
        pool as never,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('requests a human gate with the schema-valid awaiting_approval status', async () => {
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
              gate_status: 'not_requested',
              iteration_count: 0,
              summary: null,
              metadata: {},
              started_at: new Date('2026-03-11T00:00:00Z'),
              completed_at: null,
              updated_at: new Date('2026-03-11T00:00:00Z'),
            }],
          };
        }
        if (sql.includes('FROM workflow_stage_gates')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_stage_gates')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'gate-1',
              workflow_id: 'workflow-1',
              stage_id: 'stage-1',
              stage_name: 'requirements',
              status: 'awaiting_approval',
              request_summary: 'Ready for gate review',
              recommendation: null,
              concerns: [],
              key_artifacts: [],
              requested_by_type: 'agent',
              requested_by_id: 'k1',
              requested_at: new Date('2026-03-11T00:00:00Z'),
              updated_at: new Date('2026-03-11T00:00:00Z'),
              decided_by_type: null,
              decided_by_id: null,
              decision_feedback: null,
              decided_at: null,
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
              gate_status: 'awaiting_approval',
              iteration_count: 0,
              summary: 'Ready for gate',
              metadata: {},
              started_at: new Date('2026-03-11T00:00:00Z'),
              completed_at: null,
              updated_at: new Date('2026-03-11T00:00:00Z'),
            }],
          };
        }
        return { rowCount: 1, rows: [] };
      }),
    };
    const service = new PlaybookWorkflowControlService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      stateService: { recomputeWorkflowState: vi.fn(async () => 'active') } as never,
      activationService: { enqueueForWorkflow: vi.fn() } as never,
      activationDispatchService: { dispatchActivation: vi.fn() } as never,
    });

    const stage = await service.requestStageGateApproval(
      { tenantId: 'tenant-1', scope: 'agent', ownerType: 'agent', ownerId: 'agent-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      'requirements',
      { summary: 'Ready for gate review' },
      pool as never,
    );

    expect(stage.gate_status).toBe('awaiting_approval');
  });

  it('treats a repeated pending gate request as idempotent when the existing request matches', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const activationService = { enqueueForWorkflow: vi.fn() };
    const dispatchService = { dispatchActivation: vi.fn() };
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
              summary: 'Ready for gate review',
              metadata: {},
              started_at: new Date('2026-03-11T00:00:00Z'),
              completed_at: null,
              updated_at: new Date('2026-03-11T00:00:00Z'),
            }],
          };
        }
        if (sql.includes('FROM workflow_stage_gates')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'gate-1',
              workflow_id: 'workflow-1',
              stage_id: 'stage-1',
              stage_name: 'requirements',
              status: 'awaiting_approval',
              request_summary: 'Ready for gate review',
              recommendation: null,
              concerns: [],
              key_artifacts: [],
              requested_at: new Date('2026-03-11T00:15:00Z'),
            }],
          };
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

    const stage = await service.requestStageGateApproval(
      { tenantId: 'tenant-1', scope: 'agent', ownerType: 'agent', ownerId: 'agent-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      'requirements',
      { summary: 'Ready for gate review' },
      pool as never,
    );

    expect(stage).toEqual(
      expect.objectContaining({
        name: 'requirements',
        gate_status: 'awaiting_approval',
      }),
    );
    expect(eventService.emit).not.toHaveBeenCalled();
    expect(activationService.enqueueForWorkflow).not.toHaveBeenCalled();
    expect(dispatchService.dispatchActivation).not.toHaveBeenCalled();
  });

  it('treats a second pending gate request for the same stage as a no-op', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const activationService = { enqueueForWorkflow: vi.fn() };
    const dispatchService = { dispatchActivation: vi.fn() };
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
              summary: 'Ready for gate',
              metadata: {},
              started_at: new Date('2026-03-11T00:00:00Z'),
              completed_at: null,
              updated_at: new Date('2026-03-11T00:00:00Z'),
            }],
          };
        }
        if (sql.includes('FROM workflow_stage_gates')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'gate-1',
              status: 'awaiting_approval',
              recommendation: null,
              concerns: [],
              key_artifacts: [],
              requested_at: new Date('2026-03-11T00:15:00Z'),
            }],
          };
        }
        return { rowCount: 0, rows: [] };
      }),
    };
    const service = new PlaybookWorkflowControlService({
      pool: pool as never,
      eventService: eventService as never,
      stateService: { recomputeWorkflowState: vi.fn(async () => 'active') } as never,
      activationService: activationService as never,
      activationDispatchService: dispatchService as never,
    });

    const stage = await service.requestStageGateApproval(
      { tenantId: 'tenant-1', scope: 'agent', ownerType: 'agent', ownerId: 'agent-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      'requirements',
      { summary: 'Ready for gate review' },
      pool as never,
    );

    expect(stage).toEqual(
      expect.objectContaining({
        name: 'requirements',
        gate_status: 'awaiting_approval',
      }),
    );
    expect(eventService.emit).not.toHaveBeenCalled();
    expect(activationService.enqueueForWorkflow).not.toHaveBeenCalled();
    expect(dispatchService.dispatchActivation).not.toHaveBeenCalled();
  });

  it('treats a repeated stage advance as idempotent once the next stage is already current', async () => {
    const service = new PlaybookWorkflowControlService({
      pool: {} as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      stateService: { recomputeWorkflowState: vi.fn(async () => 'active') } as never,
      activationService: { enqueueForWorkflow: vi.fn() } as never,
      activationDispatchService: { dispatchActivation: vi.fn() } as never,
    });
    const loadWorkflow = vi.spyOn(service as never, 'loadWorkflow').mockResolvedValue({
      id: 'workflow-1',
      workspace_id: 'workspace-1',
      playbook_id: 'playbook-1',
      lifecycle: 'planned',
      active_stage_name: 'implementation',
      state: 'active',
      orchestration_state: {},
      definition,
    });
    const loadStage = vi.spyOn(service as never, 'loadStage').mockResolvedValue({
      id: 'stage-1',
      name: 'requirements',
      position: 0,
      goal: 'Define scope',
      guidance: null,
      human_gate: true,
      status: 'completed',
      gate_status: 'approved',
      iteration_count: 0,
      summary: 'Requirements approved',
      metadata: {},
      started_at: new Date('2026-03-11T00:00:00Z'),
      completed_at: new Date('2026-03-11T00:30:00Z'),
      updated_at: new Date('2026-03-11T00:30:00Z'),
    });

    const result = await service.advanceStage(
      { tenantId: 'tenant-1', scope: 'agent', ownerType: 'agent', ownerId: 'agent-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      'requirements',
      { summary: 'Requirements approved' },
      {} as never,
    );

    expect(result).toEqual({
      completed_stage: 'requirements',
      next_stage: 'implementation',
    });
    expect(loadWorkflow).toHaveBeenCalled();
    expect(loadStage).toHaveBeenCalled();
  });

  it('treats a repeated workflow completion as idempotent once the workflow is already completed', async () => {
    const service = new PlaybookWorkflowControlService({
      pool: {} as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      stateService: { recomputeWorkflowState: vi.fn(async () => 'completed') } as never,
      activationService: { enqueueForWorkflow: vi.fn() } as never,
      activationDispatchService: { dispatchActivation: vi.fn() } as never,
    });
    vi.spyOn(service as never, 'loadWorkflow').mockResolvedValue({
      id: 'workflow-1',
      workspace_id: 'workspace-1',
      playbook_id: 'playbook-1',
      lifecycle: 'planned',
      active_stage_name: null,
      state: 'completed',
      orchestration_state: { completion_summary: 'Ship it' },
      definition,
    });

    const result = await service.completeWorkflow(
      { tenantId: 'tenant-1', scope: 'agent', ownerType: 'agent', ownerId: 'agent-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      { summary: 'Ship it' },
      {} as never,
    );

    expect(result).toEqual({
      workflow_id: 'workflow-1',
      state: 'completed',
      summary: 'Ship it',
      final_artifacts: [],
    });
  });

  it('completes the active stage implicitly and records final artifacts when finishing a workflow', async () => {
    const emit = vi.fn(async () => undefined);
    const recomputeWorkflowState = vi.fn(async () => 'completed');
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
              active_stage_name: 'implementation',
              state: 'active',
              orchestration_state: {},
              definition,
            }],
          };
        }
        if (sql.includes('FROM workflow_stages') && sql.includes('name = $3')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'implementation']);
          return {
            rowCount: 1,
            rows: [{
              id: 'stage-2',
              name: 'implementation',
              position: 1,
              goal: 'Ship the feature',
              guidance: null,
              human_gate: false,
              status: 'in_progress',
              gate_status: 'not_requested',
              iteration_count: 0,
              summary: null,
              metadata: {},
              started_at: new Date('2026-03-11T01:00:00Z'),
              completed_at: null,
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
                status: 'completed',
                gate_status: 'approved',
                iteration_count: 0,
                summary: 'Scope approved',
                started_at: new Date('2026-03-11T00:00:00Z'),
                completed_at: new Date('2026-03-11T00:30:00Z'),
                open_work_item_count: 0,
                total_work_item_count: 1,
                first_work_item_at: new Date('2026-03-11T00:00:00Z'),
                last_completed_work_item_at: new Date('2026-03-11T00:30:00Z'),
              },
              {
                id: 'stage-2',
                lifecycle: 'planned',
                name: 'implementation',
                position: 1,
                goal: 'Ship the feature',
                guidance: null,
                human_gate: false,
                status: 'active',
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: null,
                started_at: new Date('2026-03-11T01:00:00Z'),
                completed_at: null,
                open_work_item_count: 0,
                total_work_item_count: 0,
                first_work_item_at: null,
                last_completed_work_item_at: null,
              },
            ],
          };
        }
        if (sql.includes('UPDATE workflow_stages')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'implementation', 'Ship it']);
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('UPDATE workflow_work_items')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'implementation', 'done']);
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('UPDATE workflows') && sql.includes('current_stage')) {
          throw new Error('planned stage advancement should not persist workflow.current_stage');
        }
        if (sql.includes('SELECT name') && sql.includes('FROM workflow_stages')) {
          expect(params).toEqual(['tenant-1', 'workflow-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('UPDATE workflows')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'Ship it',
            JSON.stringify(['artifacts/release-notes.md', 'artifacts/test-report.json']),
          ]);
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new PlaybookWorkflowControlService({
      pool: pool as never,
      eventService: { emit } as never,
      stateService: { recomputeWorkflowState } as never,
      activationService: { enqueueForWorkflow: vi.fn() } as never,
      activationDispatchService: { dispatchActivation: vi.fn() } as never,
    });

    const result = await service.completeWorkflow(
      { tenantId: 'tenant-1', scope: 'agent', ownerType: 'agent', ownerId: 'agent-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      {
        summary: 'Ship it',
        final_artifacts: ['artifacts/release-notes.md', 'artifacts/test-report.json'],
      },
      pool as never,
    );

    expect(result).toEqual({
      workflow_id: 'workflow-1',
      state: 'completed',
      summary: 'Ship it',
      final_artifacts: ['artifacts/release-notes.md', 'artifacts/test-report.json'],
    });
    expect(recomputeWorkflowState).toHaveBeenCalledWith(
      'tenant-1',
      'workflow-1',
      pool,
      expect.objectContaining({ actorId: 'k1', actorType: 'agent' }),
    );
    expect(emit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'stage.completed',
        data: { stage_name: 'implementation', summary: 'Ship it' },
      }),
      pool,
    );
    expect(emit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'workflow.completed',
        data: {
          summary: 'Ship it',
          final_artifacts: ['artifacts/release-notes.md', 'artifacts/test-report.json'],
        },
      }),
      pool,
    );
  });

  it('reconciles completed planned stages before checking workflow completion', async () => {
    const emit = vi.fn(async () => undefined);
    const recomputeWorkflowState = vi.fn(async () => 'completed');
    let workflowLoadCount = 0;
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          workflowLoadCount += 1;
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              workspace_id: 'workspace-1',
              playbook_id: 'playbook-1',
              lifecycle: 'planned',
              active_stage_name: workflowLoadCount === 1 ? 'requirements' : null,
              state: 'active',
              orchestration_state: {},
              definition,
            }],
          };
        }
        if (sql.includes('FROM workflow_stages') && sql.includes('name = $3')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'requirements']);
          return {
            rowCount: 1,
            rows: [{
              id: 'stage-1',
              name: 'requirements',
              position: 0,
              goal: 'Define scope',
              guidance: null,
              human_gate: true,
              status: 'completed',
              gate_status: 'approved',
              iteration_count: 0,
              summary: 'Approved requirements',
              metadata: {},
              started_at: new Date('2026-03-11T00:00:00Z'),
              completed_at: new Date('2026-03-11T00:30:00Z'),
              updated_at: new Date('2026-03-11T00:30:00Z'),
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
                gate_status: 'approved',
                iteration_count: 0,
                summary: 'Approved requirements',
                started_at: new Date('2026-03-11T00:00:00Z'),
                completed_at: null,
                open_work_item_count: 0,
                total_work_item_count: 1,
                first_work_item_at: new Date('2026-03-11T00:00:00Z'),
                last_completed_work_item_at: new Date('2026-03-11T00:30:00Z'),
              },
              {
                id: 'stage-2',
                lifecycle: 'planned',
                name: 'implementation',
                position: 1,
                goal: 'Ship the feature',
                guidance: null,
                human_gate: false,
                status: 'pending',
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: null,
                started_at: null,
                completed_at: null,
                open_work_item_count: 0,
                total_work_item_count: 1,
                first_work_item_at: new Date('2026-03-11T01:00:00Z'),
                last_completed_work_item_at: new Date('2026-03-11T01:30:00Z'),
              },
            ],
          };
        }
        if (sql.includes('UPDATE workflow_stages') && params?.[2] === 'stage-1') {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'stage-1',
            'completed',
            '2026-03-11T00:00:00.000Z',
            '2026-03-11T00:30:00.000Z',
          ]);
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('UPDATE workflow_stages') && params?.[2] === 'stage-2') {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'stage-2',
            'completed',
            '2026-03-11T01:00:00.000Z',
            '2026-03-11T01:30:00.000Z',
          ]);
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('UPDATE workflows') && sql.includes('current_stage')) {
          throw new Error('planned workflow completion should not persist workflow.current_stage');
        }
        if (sql.includes('SELECT name') && sql.includes('FROM workflow_stages')) {
          expect(params).toEqual(['tenant-1', 'workflow-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('UPDATE workflows') && sql.includes('orchestration_state')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'Ship it',
            JSON.stringify([]),
          ]);
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new PlaybookWorkflowControlService({
      pool: pool as never,
      eventService: { emit } as never,
      stateService: { recomputeWorkflowState } as never,
      activationService: { enqueueForWorkflow: vi.fn() } as never,
      activationDispatchService: { dispatchActivation: vi.fn() } as never,
    });

    const result = await service.completeWorkflow(
      { tenantId: 'tenant-1', scope: 'agent', ownerType: 'agent', ownerId: 'agent-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      { summary: 'Ship it' },
      pool as never,
    );

    expect(result).toEqual({
      workflow_id: 'workflow-1',
      state: 'completed',
      summary: 'Ship it',
      final_artifacts: [],
    });
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.completed',
        data: { summary: 'Ship it', final_artifacts: [] },
      }),
      pool,
    );
  });
});
