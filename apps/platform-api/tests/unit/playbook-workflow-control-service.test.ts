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
    { name: 'requirements', goal: 'Define scope' },
    { name: 'implementation', goal: 'Ship code' },
  ],
};

describe('PlaybookWorkflowControlService', () => {
  it('filters newer gate-related handoffs by explicit orchestrator flag instead of role name', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        expect(sql).toContain('COALESCE(t.is_orchestrator_task, FALSE) = FALSE');
        expect(sql).not.toContain("COALESCE(t.role, '') <> 'orchestrator'");
        return { rows: [{ has_rework: true }], rowCount: 1 };
      }),
    };
    const service = new PlaybookWorkflowControlService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      stateService: {} as never,
      activationService: {} as never,
      activationDispatchService: {} as never,
    });

    const result = await (service as any).hasNewGateRelatedHandoffSinceGateDecision(
      'tenant-1',
      'workflow-1',
      null,
      'review',
      new Date('2026-03-24T20:00:00Z'),
      pool,
    );

    expect(result).toBe(true);
  });

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
        if (sql.includes('SELECT COALESCE(MAX(subject_revision), 0)::int AS latest_subject_revision')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'requirements']);
          return { rowCount: 1, rows: [{ latest_subject_revision: null }] };
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

    const insertCall = client.query.mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO workflow_stage_gates'),
    );
    expect(insertCall?.[0]).toContain('SELECT COUNT(*)');
    expect(insertCall?.[0]).toContain('ORDER BY wi.created_at ASC, wi.id ASC');
    expect(insertCall?.[0]).not.toContain('MIN(wi.id)');
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
        if (sql.includes('SELECT COALESCE(MAX(subject_revision), 0)::int AS latest_subject_revision')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'requirements']);
          return { rowCount: 1, rows: [{ latest_subject_revision: null }] };
        }
        if (sql.includes('FROM workflow_stage_gates')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('UPDATE workflow_stages')) {
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
              status: 'active',
              gate_status: 'approved',
              iteration_count: 0,
              summary: 'Already approved',
              metadata: {},
              started_at: new Date('2026-03-11T00:00:00Z'),
              completed_at: null,
              updated_at: new Date('2026-03-11T00:31:30Z'),
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

    expect(stage).toEqual(expect.objectContaining({ gate_status: 'approved', status: 'active' }));
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
        if (sql.includes('SELECT COALESCE(MAX(subject_revision), 0)::int AS latest_subject_revision')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'requirements']);
          return {
            rowCount: 1,
            rows: [{ latest_subject_revision: null }],
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
        if (sql.includes('SELECT COALESCE(MAX(subject_revision), 0)::int AS latest_subject_revision')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'requirements']);
          return {
            rowCount: 1,
            rows: [{ latest_subject_revision: null }],
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
        if (sql.includes('UPDATE workflow_stages')) {
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
              status: 'active',
              gate_status: 'approved',
              iteration_count: 0,
              summary: 'Ready for review',
              metadata: {},
              started_at: new Date('2026-03-11T00:00:00Z'),
              completed_at: null,
              updated_at: new Date('2026-03-11T00:31:30Z'),
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
        status: 'active',
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

  it('records a blocked gate decision and blocks open work items in the stage', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const activationService = {
      enqueueForWorkflow: vi.fn(async () => ({
        id: 'activation-block-1',
        state: 'queued',
        event_type: 'stage.gate.block',
        reason: 'stage.gate.block',
        queued_at: null,
        started_at: null,
        completed_at: null,
        summary: null,
        error: null,
      })),
    };
    const dispatchService = { dispatchActivation: vi.fn(async () => 'task-block-1') };
    let blockedStageItems = false;
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
        if (sql.includes("FROM workflow_stage_gates") && sql.includes("AND status = 'awaiting_approval'")) {
          return {
            rowCount: 1,
            rows: [{
              id: 'gate-block-1',
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
              subject_revision: 2,
              decided_by_type: null,
              decided_by_id: null,
              decision_feedback: null,
              decided_at: null,
              superseded_at: null,
              superseded_by_revision: null,
            }],
          };
        }
        if (sql.includes('UPDATE workflow_stage_gates')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'gate-block-1',
              workflow_id: 'workflow-1',
              stage_id: 'stage-1',
              stage_name: 'requirements',
              status: 'blocked',
              request_summary: 'Ready for review',
              recommendation: 'approve',
              concerns: [],
              key_artifacts: [],
              requested_by_type: 'agent',
              requested_by_id: 'k1',
              requested_at: new Date('2026-03-11T00:30:00Z'),
              updated_at: new Date('2026-03-11T00:31:00Z'),
              subject_revision: 2,
              decided_by_type: 'admin',
              decided_by_id: 'k1',
              decision_feedback: 'Missing approval memo.',
              decided_at: new Date('2026-03-11T00:31:00Z'),
              superseded_at: null,
              superseded_by_revision: null,
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
              status: 'blocked',
              gate_status: 'blocked',
              iteration_count: 1,
              summary: 'Ready for review',
              metadata: {},
              started_at: new Date('2026-03-11T00:00:00Z'),
              completed_at: null,
              updated_at: new Date('2026-03-11T00:31:00Z'),
            }],
          };
        }
        if (sql.includes('UPDATE workflow_work_items') && sql.includes("blocked_state = 'blocked'")) {
          blockedStageItems = true;
          expect(params).toEqual(['tenant-1', 'workflow-1', 'requirements', 'Missing approval memo.']);
          return { rowCount: 2, rows: [] };
        }
        if (sql.includes('UPDATE workflow_work_items')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'requirements']);
          return { rowCount: 2, rows: [] };
        }
        return { rowCount: 1, rows: [] };
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
      { action: 'block', feedback: 'Missing approval memo.' },
      pool as never,
    );

    expect(stage).toEqual(expect.objectContaining({ status: 'blocked', gate_status: 'blocked' }));
    expect(blockedStageItems).toBe(true);
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'stage.gate.block',
        entityId: 'gate-block-1',
      }),
      pool,
    );
    expect(activationService.enqueueForWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow-1',
        eventType: 'stage.gate.block',
      }),
      pool,
    );
  });

  it('reopens the gate subject task when changes are requested', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const activationService = {
      enqueueForWorkflow: vi.fn(async () => ({ id: 'activation-5', state: 'queued', event_type: 'stage.gate.request_changes' })),
    };
    const dispatchService = { dispatchActivation: vi.fn(async () => 'task-5') };
    const subjectTaskChangeService = {
      requestTaskChanges: vi.fn(async () => ({ id: 'task-author-1' })),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflow_stage_gates') && sql.includes('AND id = $2') && sql.includes("AND status = 'awaiting_approval'")) {
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
              key_artifacts: [{ id: 'artifact-1', task_id: 'task-author-1', label: 'Brief', path: 'brief.md' }],
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
        if (sql.includes('FROM workflow_stage_gates') && sql.includes('AND id = $2') && !sql.includes("AND status = 'awaiting_approval'")) {
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
              key_artifacts: [{ id: 'artifact-1', task_id: 'task-author-1', label: 'Brief', path: 'brief.md' }],
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
              status: 'awaiting_gate',
              gate_status: 'awaiting_approval',
              iteration_count: 0,
              summary: 'Needs review',
              metadata: {},
              started_at: new Date('2026-03-11T00:00:00Z'),
              completed_at: null,
              updated_at: new Date('2026-03-11T00:30:00Z'),
            }],
          };
        }
        if (sql.includes('FROM tasks t') && sql.includes('ANY($3::uuid[])')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', ['task-author-1']]);
          return {
            rowCount: 1,
            rows: [{ id: 'task-author-1', owner_role: 'writer' }],
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
              status: 'changes_requested',
              request_summary: 'Ready for review',
              recommendation: 'approve',
              concerns: [],
              key_artifacts: [{ id: 'artifact-1', task_id: 'task-author-1', label: 'Brief', path: 'brief.md' }],
              requested_by_type: 'agent',
              requested_by_id: 'k1',
              requested_at: new Date('2026-03-11T00:30:00Z'),
              updated_at: new Date('2026-03-11T00:35:00Z'),
              decided_by_type: 'admin',
              decided_by_id: 'k1',
              decision_feedback: 'Please revise the packet.',
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
              gate_status: 'changes_requested',
              iteration_count: 1,
              summary: 'Needs review',
              metadata: {},
              started_at: new Date('2026-03-11T00:00:00Z'),
              completed_at: null,
              updated_at: new Date('2026-03-11T00:35:00Z'),
            }],
          };
        }
        if (sql.includes('UPDATE workflow_work_items')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'requirements', 'writer']);
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
      subjectTaskChangeService: subjectTaskChangeService as never,
    });

    const gate = await service.actOnGate(
      { tenantId: 'tenant-1', scope: 'admin', ownerType: 'user', ownerId: 'user-1', keyPrefix: 'k1', id: 'key-1' },
      'gate-1',
      { action: 'request_changes', feedback: 'Please revise the packet.' },
      pool as never,
    );

    expect(gate).toEqual(
      expect.objectContaining({
        gate_id: 'gate-1',
        gate_status: 'changes_requested',
        decision_feedback: 'Please revise the packet.',
      }),
    );
    expect(subjectTaskChangeService.requestTaskChanges).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'task-author-1',
      { feedback: 'Please revise the packet.' },
      pool,
    );
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

  it('completes a work item by resolving the terminal column server-side', async () => {
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
    const updatedAt = new Date('2026-03-11T02:00:00Z');
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
              lifecycle: 'ongoing',
              active_stage_name: null,
              state: 'active',
              definition,
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('AND id = $3') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-ongoing-1',
              parent_work_item_id: null,
              stage_name: 'requirements',
              title: 'Triage request',
              goal: 'Clarify the incoming ask',
              acceptance_criteria: 'Next action is unblocked',
              column_id: 'planned',
              owner_role: 'analyst',
              next_expected_actor: null,
              next_expected_action: null,
              rework_count: 0,
              priority: 'normal',
              notes: null,
              completed_at: null,
              metadata: { lane: 'default' },
              updated_at: new Date('2026-03-11T00:00:00Z'),
            }],
          };
        }
        if (
          sql.includes('FROM task_handoffs th')
          && sql.includes("COALESCE(th.role_data->>'task_kind', 'delivery') = 'delivery'")
          && sql.includes('AND th.role = $4')
        ) {
          return {
            rowCount: 0,
            rows: [],
          };
        }
        if (sql.includes('SELECT latest_assessment.resolution AS blocking_resolution')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('UPDATE workflow_work_items')) {
          expect(params?.[8]).toBe('done');
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-ongoing-1',
              parent_work_item_id: null,
              stage_name: 'requirements',
              title: 'Triage request',
              goal: 'Clarify the incoming ask',
              acceptance_criteria: 'Next action is unblocked',
              column_id: 'done',
              owner_role: 'analyst',
              next_expected_actor: null,
              next_expected_action: null,
              rework_count: 0,
              priority: 'normal',
              notes: null,
              completed_at: new Date('2026-03-11T02:00:00Z'),
              metadata: { lane: 'default' },
              updated_at: updatedAt,
            }],
          };
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

    const updated = await service.completeWorkItem(
      { tenantId: 'tenant-1', scope: 'admin', ownerType: 'user', ownerId: 'user-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      'wi-ongoing-1',
      {},
      pool as never,
    );

    expect(updated.column_id).toBe('done');
    expect(updated.completed_at).toBe('2026-03-11T02:00:00.000Z');
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'work_item.completed',
        entityType: 'work_item',
        entityId: 'wi-ongoing-1',
      }),
      pool,
    );
    expect(activationService.enqueueForWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow-1',
        eventType: 'work_item.updated',
        payload: expect.objectContaining({
          work_item_id: 'wi-ongoing-1',
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

  it('treats completeWorkItem as idempotent when the work item is already terminal', async () => {
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
    const completedAt = new Date('2026-03-11T02:00:00Z');
    const updatedAt = new Date('2026-03-11T02:00:30Z');
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
              lifecycle: 'ongoing',
              active_stage_name: null,
              state: 'active',
              definition,
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('AND id = $3') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-ongoing-1',
              parent_work_item_id: null,
              stage_name: 'requirements',
              title: 'Triage request',
              goal: 'Clarify the incoming ask',
              acceptance_criteria: 'Next action is unblocked',
              column_id: 'done',
              owner_role: 'analyst',
              next_expected_actor: null,
              next_expected_action: null,
              rework_count: 0,
              priority: 'normal',
              notes: null,
              completed_at: completedAt,
              metadata: { lane: 'default' },
              updated_at: updatedAt,
            }],
          };
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

    const updated = await service.completeWorkItem(
      { tenantId: 'tenant-1', scope: 'admin', ownerType: 'user', ownerId: 'user-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      'wi-ongoing-1',
      {},
      pool as never,
    );

    expect(updated).toEqual(
      expect.objectContaining({
        id: 'wi-ongoing-1',
        column_id: 'done',
        completed_at: completedAt.toISOString(),
        updated_at: updatedAt.toISOString(),
      }),
    );
    expect(pool.query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE workflow_work_items'), expect.anything());
    expect(eventService.emit).not.toHaveBeenCalled();
    expect(activationService.enqueueForWorkflow).not.toHaveBeenCalled();
    expect(dispatchService.dispatchActivation).not.toHaveBeenCalled();
    expect(stateService.recomputeWorkflowState).not.toHaveBeenCalled();
  });

  it('rejects completing a work item that still has a blocking rejected assessment', async () => {
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
              active_stage_name: 'implementation',
              state: 'active',
              definition,
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('AND id = $3') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-implementation-1',
              parent_work_item_id: null,
              stage_name: 'implementation',
              title: 'Implement the reporting pipeline',
              goal: 'Ship the feature',
              acceptance_criteria: 'The reporting pipeline is complete.',
              column_id: 'planned',
              owner_role: 'implementer',
              next_expected_actor: null,
              next_expected_action: null,
              rework_count: 0,
              priority: 'high',
              notes: null,
              completed_at: null,
              metadata: {},
              updated_at: new Date('2026-03-11T00:00:00Z'),
            }],
          };
        }
        if (sql.includes('FROM task_handoffs th') && sql.includes("resolution IN ('request_changes', 'rejected')")) {
          expect(sql).toContain('th.work_item_id = $3');
          expect(sql).not.toContain('th.work_item_id = $4');
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-implementation-1']);
          return {
            rowCount: 1,
            rows: [{
              blocking_resolution: 'rejected',
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('work_item_id = $3')) {
          return { rowCount: 0, rows: [] };
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

    await expect(service.completeWorkItem(
      { tenantId: 'tenant-1', scope: 'admin', ownerType: 'user', ownerId: 'user-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      'wi-implementation-1',
      {},
      pool as never,
    )).rejects.toThrow(
      "Cannot complete work item 'Implement the reporting pipeline' while it still has a blocking rejected assessment.",
    );
  });

  it('rejects completing a work item while a required assessment is still pending', async () => {
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
              definition,
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('AND id = $3') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-implementation-1',
              parent_work_item_id: null,
              stage_name: 'implementation',
              title: 'Implement the reporting pipeline',
              goal: 'Ship the feature',
              acceptance_criteria: 'The reporting pipeline is complete.',
              column_id: 'planned',
              owner_role: 'implementer',
              next_expected_actor: 'release-assessor',
              next_expected_action: 'assess',
              rework_count: 0,
              priority: 'high',
              notes: null,
              completed_at: null,
              metadata: {},
              updated_at: new Date('2026-03-11T00:00:00Z'),
            }],
          };
        }
        if (
          sql.includes('FROM task_handoffs th')
          && sql.includes("COALESCE(th.role_data->>'task_kind', 'delivery') = 'delivery'")
          && sql.includes('AND th.role = $4')
        ) {
          return {
            rowCount: 0,
            rows: [],
          };
        }
        if (sql.includes('SELECT latest_assessment.resolution AS blocking_resolution')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM tasks') && sql.includes('work_item_id = $3')) {
          return { rowCount: 0, rows: [] };
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

    await expect(service.completeWorkItem(
      { tenantId: 'tenant-1', scope: 'admin', ownerType: 'user', ownerId: 'user-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      'wi-implementation-1',
      {},
      pool as never,
    )).rejects.toThrow(
      "Cannot complete work item 'Implement the reporting pipeline' while required assessment by 'release-assessor' is still pending.",
    );
  });

  it('rejects completing a work item while a required handoff is still pending', async () => {
    const definitionWithDrafting = {
      ...definition,
      stages: [
        {
          name: 'drafting',
          goal: 'Draft a review-ready packet.',
          involves: ['rework-product-strategist', 'rework-technical-editor'],
        },
      ],
    };
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
              active_stage_name: 'drafting',
              state: 'active',
              definition: definitionWithDrafting,
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('AND id = $3') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-drafting-1',
              parent_work_item_id: null,
              stage_name: 'drafting',
              title: 'Draft review-ready product brief',
              goal: 'Prepare the packet',
              acceptance_criteria: 'A review-ready packet exists.',
              column_id: 'planned',
              owner_role: 'rework-product-strategist',
              next_expected_actor: 'rework-technical-editor',
              next_expected_action: 'handoff',
              rework_count: 0,
              priority: 'high',
              notes: null,
              completed_at: null,
              metadata: {},
              updated_at: new Date('2026-03-11T00:00:00Z'),
            }],
          };
        }
        if (
          sql.includes('FROM task_handoffs th')
          && sql.includes("COALESCE(th.role_data->>'task_kind', 'delivery') = 'delivery'")
          && sql.includes('AND th.role = $4')
        ) {
          return {
            rowCount: 0,
            rows: [],
          };
        }
        if (sql.includes('SELECT latest_assessment.resolution AS blocking_resolution')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM tasks') && sql.includes('work_item_id = $3')) {
          return { rowCount: 0, rows: [] };
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

    await expect(service.completeWorkItem(
      { tenantId: 'tenant-1', scope: 'admin', ownerType: 'user', ownerId: 'user-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      'wi-drafting-1',
      {},
      pool as never,
    )).rejects.toThrow(
      "Cannot complete work item 'Draft review-ready product brief' while required handoff by 'rework-technical-editor' is still pending.",
    );
  });

  it('rejects completing a work item while a non-terminal task still exists for that work item', async () => {
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
              definition,
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('AND id = $3') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-implementation-1',
              parent_work_item_id: null,
              stage_name: 'implementation',
              title: 'Implement the reporting pipeline',
              goal: 'Ship the feature',
              acceptance_criteria: 'The reporting pipeline is complete.',
              column_id: 'planned',
              owner_role: 'implementer',
              next_expected_actor: null,
              next_expected_action: null,
              rework_count: 0,
              priority: 'high',
              notes: null,
              completed_at: null,
              metadata: {},
              updated_at: new Date('2026-03-11T00:00:00Z'),
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('work_item_id = $3')) {
          expect(sql).toContain('state::text <> ALL($4::text[])');
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-implementation-1', ['completed', 'failed', 'cancelled']]);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-implementation-1',
              role: 'implementer',
              state: 'in_progress',
              stage_name: 'implementation',
            }],
          };
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

    await expect(service.completeWorkItem(
      { tenantId: 'tenant-1', scope: 'admin', ownerType: 'user', ownerId: 'user-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      'wi-implementation-1',
      {},
      pool as never,
    )).rejects.toThrow(
      "Cannot complete work item 'Implement the reporting pipeline' while task 'implementer' is still in_progress.",
    );
  });

  it('allows completing a work item when a required handoff continuity entry is stale', async () => {
    const definitionWithReleasePass = {
      ...definition,
      stages: [
        ...definition.stages,
        {
          name: 'release-pass',
          goal: 'Validate release readiness.',
          involves: ['integration-quality-assessor', 'revision-release-coordinator'],
        },
      ],
    };
    const eventService = { emit: vi.fn(async () => undefined) };
    const activationService = {
      enqueueForWorkflow: vi.fn(async () => ({ id: 'activation-13' })),
    };
    const dispatchService = {
      dispatchActivation: vi.fn(async () => 'task-13'),
    };
    const stateService = {
      recomputeWorkflowState: vi.fn(async () => 'active'),
    };
    const updatedAt = new Date('2026-03-11T03:15:30Z');
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
              active_stage_name: 'release-pass',
              state: 'active',
              definition: definitionWithReleasePass,
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('AND id = $3') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-release-1',
              parent_work_item_id: null,
              stage_name: 'release-pass',
              title: 'Assess release readiness',
              goal: 'Close the release gate',
              acceptance_criteria: 'Release handoffs are complete.',
              column_id: 'planned',
              owner_role: 'integration-quality-assessor',
              next_expected_actor: 'revision-release-coordinator',
              next_expected_action: 'handoff',
              rework_count: 0,
              priority: 'high',
              notes: null,
              completed_at: null,
              metadata: {
                subject_revision: 1,
              },
              updated_at: new Date('2026-03-11T03:15:00Z'),
            }],
          };
        }
        if (
          sql.includes('FROM task_handoffs th')
          && sql.includes("COALESCE(th.role_data->>'task_kind', 'delivery') = 'delivery'")
          && sql.includes('AND th.role = $4')
        ) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-release-1', 'revision-release-coordinator', 1]);
          return {
            rowCount: 1,
            rows: [{ satisfied_handoff: 1 }],
          };
        }
        if (sql.includes('SELECT latest_assessment.resolution AS blocking_resolution')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('UPDATE workflow_work_items')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-release-1',
              parent_work_item_id: null,
              stage_name: 'release-pass',
              title: 'Assess release readiness',
              goal: 'Close the release gate',
              acceptance_criteria: 'Release handoffs are complete.',
              column_id: 'done',
              owner_role: 'integration-quality-assessor',
              next_expected_actor: null,
              next_expected_action: null,
              rework_count: 0,
              priority: 'high',
              notes: null,
              completed_at: new Date('2026-03-11T03:15:30Z'),
              metadata: {},
              updated_at: updatedAt,
            }],
          };
        }
        if (sql.includes('SELECT stage_name, status, gate_status, human_gate') || sql.includes('FROM workflow_stages')) {
          return {
            rowCount: 0,
            rows: [],
          };
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

    const updated = await service.completeWorkItem(
      { tenantId: 'tenant-1', scope: 'admin', ownerType: 'user', ownerId: 'user-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      'wi-release-1',
      {},
      pool as never,
    );

    expect(updated).toEqual(
      expect.objectContaining({
        id: 'wi-release-1',
        column_id: 'done',
        completed_at: '2026-03-11T03:15:30.000Z',
      }),
    );
  });

  it('allows completing a work item when no blocking assessment exists', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const activationService = {
      enqueueForWorkflow: vi.fn(async () => ({ id: 'activation-12' })),
    };
    const dispatchService = {
      dispatchActivation: vi.fn(async () => 'task-12'),
    };
    const stateService = {
      recomputeWorkflowState: vi.fn(async () => 'active'),
    };
    const updatedAt = new Date('2026-03-11T03:00:30Z');
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
              definition,
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('AND id = $3') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-implementation-1',
              parent_work_item_id: null,
              stage_name: 'implementation',
              title: 'Implement the reporting pipeline',
              goal: 'Ship the feature',
              acceptance_criteria: 'The reporting pipeline is complete.',
              column_id: 'planned',
              owner_role: 'implementer',
              next_expected_actor: 'implementer',
              next_expected_action: 'finish_delivery',
              rework_count: 0,
              priority: 'high',
              notes: null,
              completed_at: null,
              metadata: { orchestrator_finish_state: 'pending' },
              updated_at: new Date('2026-03-11T03:00:00Z'),
            }],
          };
        }
        if (sql.includes('FROM task_handoffs th') && sql.includes("resolution IN ('request_changes', 'rejected')")) {
          expect(sql).toContain('th.work_item_id = $3');
          expect(sql).not.toContain('th.work_item_id = $4');
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-implementation-1']);
          return {
            rowCount: 0,
            rows: [],
          };
        }
        if (sql.includes('UPDATE workflow_work_items')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-implementation-1',
              parent_work_item_id: null,
              stage_name: 'implementation',
              title: 'Implement the reporting pipeline',
              goal: 'Ship the feature',
              acceptance_criteria: 'The reporting pipeline is complete.',
              column_id: 'done',
              owner_role: 'implementer',
              next_expected_actor: null,
              next_expected_action: null,
              rework_count: 0,
              priority: 'high',
              notes: null,
              completed_at: new Date('2026-03-11T03:00:30Z'),
              metadata: {},
              updated_at: updatedAt,
            }],
          };
        }
        if (sql.includes('SELECT stage_name, status, gate_status, human_gate') || sql.includes('FROM workflow_stages')) {
          return {
            rowCount: 0,
            rows: [],
          };
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

    const updated = await service.completeWorkItem(
      { tenantId: 'tenant-1', scope: 'admin', ownerType: 'user', ownerId: 'user-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      'wi-implementation-1',
      {},
      pool as never,
    );

    expect(updated).toEqual(
      expect.objectContaining({
        id: 'wi-implementation-1',
        column_id: 'done',
        completed_at: '2026-03-11T03:00:30.000Z',
      }),
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'work_item.completed',
        entityType: 'work_item',
        entityId: 'wi-implementation-1',
      }),
      pool,
    );
  });

  it('clears forward-looking continuity and finish-state metadata when completing a work item', async () => {
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
    const updatedAt = new Date('2026-03-11T02:00:30Z');
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              workspace_id: 'workspace-1',
              playbook_id: 'playbook-1',
              lifecycle: 'ongoing',
              active_stage_name: null,
              state: 'active',
              definition,
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('AND id = $3') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-ongoing-1',
              parent_work_item_id: null,
              stage_name: 'requirements',
              title: 'Triage request',
              goal: 'Clarify the incoming ask',
              acceptance_criteria: 'Next action is unblocked',
              column_id: 'planned',
              owner_role: 'analyst',
              next_expected_actor: 'live-test-intake-analyst',
              next_expected_action: 'Complete task and submit a triage handoff',
              rework_count: 0,
              priority: 'normal',
              notes: null,
              completed_at: null,
              metadata: {
                lane: 'default',
                orchestrator_finish_state: {
                  status_summary: 'Waiting for analyst handoff',
                  next_expected_event: 'task.handoff_submitted',
                },
              },
              updated_at: new Date('2026-03-11T00:00:00Z'),
            }],
          };
        }
        if (sql.includes('SELECT latest_assessment.resolution AS blocking_resolution')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('UPDATE workflow_work_items')) {
          expect(sql).toContain('next_expected_actor');
          expect(sql).toContain('next_expected_action');
          expect(sql).toContain('metadata');
          expect(params).toEqual(
            expect.arrayContaining([
              null,
              {
                lane: 'default',
              },
            ]),
          );
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-ongoing-1',
              parent_work_item_id: null,
              stage_name: 'requirements',
              title: 'Triage request',
              goal: 'Clarify the incoming ask',
              acceptance_criteria: 'Next action is unblocked',
              column_id: 'done',
              owner_role: 'analyst',
              next_expected_actor: null,
              next_expected_action: null,
              rework_count: 0,
              priority: 'normal',
              notes: null,
              completed_at: new Date('2026-03-11T02:00:00Z'),
              metadata: {
                lane: 'default',
              },
              updated_at: updatedAt,
            }],
          };
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

    const updated = await service.completeWorkItem(
      { tenantId: 'tenant-1', scope: 'admin', ownerType: 'user', ownerId: 'user-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      'wi-ongoing-1',
      {},
      pool as never,
    );

    expect(updated).toEqual(
      expect.objectContaining({
        id: 'wi-ongoing-1',
        column_id: 'done',
        next_expected_actor: null,
        next_expected_action: null,
        metadata: {
          lane: 'default',
        },
      }),
    );
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

  it('allows gate requests on a stage without authored human-gate config', async () => {
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
              human_gate: false,
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
        if (sql.includes('SELECT COALESCE(MAX(subject_revision), 0)::int AS latest_subject_revision')) {
          return { rowCount: 1, rows: [{ latest_subject_revision: null }] };
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
              request_summary: 'Review before implementation',
              recommendation: null,
              concerns: [],
              key_artifacts: [],
              requested_by_type: 'agent',
              requested_by_id: 'k1',
              requested_at: new Date('2026-03-11T00:00:00Z'),
              updated_at: new Date('2026-03-11T00:00:00Z'),
              subject_revision: null,
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
              human_gate: false,
              status: 'awaiting_gate',
              gate_status: 'awaiting_approval',
              iteration_count: 0,
              summary: 'Review before implementation',
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
      { summary: 'Review before implementation' },
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
        if (sql.includes('SELECT COALESCE(MAX(subject_revision), 0)::int AS latest_subject_revision')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'requirements']);
          return {
            rowCount: 1,
            rows: [{ latest_subject_revision: null }],
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

  it('rejects re-requesting gate approval after changes were requested without new stage work', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const activationService = { enqueueForWorkflow: vi.fn() };
    const dispatchService = { dispatchActivation: vi.fn() };
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
        if (sql.includes('SELECT COALESCE(MAX(subject_revision), 0)::int AS latest_subject_revision')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'requirements']);
          return {
            rowCount: 1,
            rows: [{ latest_subject_revision: null }],
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
              request_summary: 'Needs clarification',
              recommendation: 'Rework and resubmit',
              concerns: [],
              key_artifacts: [],
              requested_by_type: 'admin',
              requested_by_id: 'k1',
              requested_at: new Date('2026-03-11T00:30:00Z'),
              updated_at: new Date('2026-03-11T00:31:00Z'),
              decided_by_type: 'admin',
              decided_by_id: 'k1',
              decision_feedback: 'Clarify the summary',
              decided_at: new Date('2026-03-11T00:31:00Z'),
            }],
          };
        }
        if (sql.includes('SELECT EXISTS (') && sql.includes('FROM task_handoffs h')) {
          return {
            rowCount: 1,
            rows: [{ has_rework: false }],
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

    await expect(
      service.requestStageGateApproval(
        { tenantId: 'tenant-1', scope: 'agent', ownerType: 'agent', ownerId: 'agent-1', keyPrefix: 'k1', id: 'key-1' },
        'workflow-1',
        'requirements',
        { summary: 'Ready for gate review again' },
        pool as never,
      ),
    ).rejects.toThrow(ConflictError);
    expect(eventService.emit).not.toHaveBeenCalled();
    expect(activationService.enqueueForWorkflow).not.toHaveBeenCalled();
    expect(dispatchService.dispatchActivation).not.toHaveBeenCalled();
  });

  it('allows re-requesting gate approval after a gate subject submits revised output', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const activationService = { enqueueForWorkflow: vi.fn() };
    const dispatchService = { dispatchActivation: vi.fn() };
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
        if (sql.includes('SELECT COALESCE(MAX(subject_revision), 0)::int AS latest_subject_revision')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'requirements']);
          return {
            rowCount: 1,
            rows: [{ latest_subject_revision: null }],
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
              request_summary: 'Needs clarification',
              recommendation: 'Rework and resubmit',
              concerns: [],
              key_artifacts: [{ id: 'artifact-1', task_id: 'task-author-1', label: 'Brief', path: 'brief.md' }],
              requested_by_type: 'admin',
              requested_by_id: 'k1',
              requested_at: new Date('2026-03-11T00:30:00Z'),
              updated_at: new Date('2026-03-11T00:31:00Z'),
              decided_by_type: 'admin',
              decided_by_id: 'k1',
              decision_feedback: 'Clarify the summary',
              decided_at: new Date('2026-03-11T00:31:00Z'),
            }],
          };
        }
        if (sql.includes('SELECT EXISTS (') && sql.includes('FROM task_handoffs h') && sql.includes('h.task_id = ANY')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', ['task-author-1'], new Date('2026-03-11T00:31:00Z')]);
          return {
            rowCount: 1,
            rows: [{ has_rework: true }],
          };
        }
        if (sql.includes('INSERT INTO workflow_stage_gates')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'gate-2',
              workflow_id: 'workflow-1',
              stage_id: 'stage-1',
              stage_name: 'requirements',
              status: 'awaiting_approval',
              request_summary: 'Revised and ready again',
              recommendation: null,
              concerns: [],
              key_artifacts: [{ id: 'artifact-2', task_id: 'task-author-1', label: 'Revised brief', path: 'brief-v2.md' }],
              requested_by_type: 'agent',
              requested_by_id: 'k1',
              requested_at: new Date('2026-03-11T00:32:00Z'),
              updated_at: new Date('2026-03-11T00:32:00Z'),
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
              iteration_count: 1,
              summary: 'Revised and ready again',
              metadata: {},
              started_at: new Date('2026-03-11T00:00:00Z'),
              completed_at: null,
              updated_at: new Date('2026-03-11T00:32:00Z'),
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
      {
        summary: 'Revised and ready again',
        key_artifacts: [{ id: 'artifact-2', task_id: 'task-author-1', label: 'Revised brief', path: 'brief-v2.md' }],
      },
      pool as never,
    );

    expect(stage.gate_status).toBe('awaiting_approval');
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

  it('treats a repeated stage advance as idempotent even before the source stage row reconciles', async () => {
    const service = new PlaybookWorkflowControlService({
      pool: {} as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      stateService: { recomputeWorkflowState: vi.fn(async () => 'active') } as never,
      activationService: { enqueueForWorkflow: vi.fn() } as never,
      activationDispatchService: { dispatchActivation: vi.fn() } as never,
    });
    vi.spyOn(service as never, 'loadWorkflow').mockResolvedValue({
      id: 'workflow-1',
      workspace_id: 'workspace-1',
      playbook_id: 'playbook-1',
      lifecycle: 'planned',
      active_stage_name: 'implementation',
      state: 'active',
      orchestration_state: {},
      definition,
    });
    vi.spyOn(service as never, 'loadStage').mockResolvedValue({
      id: 'stage-1',
      name: 'requirements',
      position: 0,
      goal: 'Define scope',
      guidance: null,
      human_gate: true,
      status: 'active',
      gate_status: 'approved',
      iteration_count: 0,
      summary: 'Requirements approved',
      metadata: {},
      started_at: new Date('2026-03-11T00:00:00Z'),
      completed_at: null,
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
  });

  it('rejects explicit stage advances that skip the immediate next planned stage', async () => {
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
      active_stage_name: 'requirements',
      state: 'active',
      orchestration_state: {},
      definition: {
        ...definition,
        stages: [
          { name: 'requirements', goal: 'Define scope', human_gate: true },
          { name: 'implementation', goal: 'Ship code' },
          { name: 'release', goal: 'Release code' },
        ],
      },
    });
    const loadStage = vi.spyOn(service as never, 'loadStage').mockResolvedValueOnce({
      id: 'stage-1',
      name: 'requirements',
      position: 0,
      goal: 'Define scope',
      guidance: null,
      human_gate: true,
      status: 'active',
      gate_status: 'approved',
      iteration_count: 0,
      summary: 'Requirements approved',
      metadata: {},
      started_at: new Date('2026-03-11T00:00:00Z'),
      completed_at: null,
      updated_at: new Date('2026-03-11T00:30:00Z'),
    });

    await expect(
      service.advanceStage(
        { tenantId: 'tenant-1', scope: 'agent', ownerType: 'agent', ownerId: 'agent-1', keyPrefix: 'k1', id: 'key-1' },
        'workflow-1',
        'requirements',
        { to_stage_name: 'release', summary: 'Requirements approved' },
        {} as never,
      ),
    ).rejects.toThrowError(ValidationError);

    expect(loadWorkflow).toHaveBeenCalled();
    expect(loadStage).toHaveBeenCalledTimes(1);
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
    let consumedQueuedActivations = false;
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
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('blocking_resolution')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'implementation']);
          return { rowCount: 0, rows: [] };
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
        if (sql.includes('SELECT wi.id,') && sql.includes('wi.next_expected_actor') && sql.includes('wi.next_expected_action')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'implementation',
            ['assess', 'approve', 'rework', 'handoff'],
          ]);
          return { rowCount: 0, rows: [] };
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
        if (sql.includes('UPDATE workflow_activations')) {
          expect(params).toEqual(['tenant-1', 'workflow-1']);
          consumedQueuedActivations = true;
          return { rowCount: 2, rows: [{ id: 'activation-1' }, { id: 'activation-2' }] };
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
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = false')) {
          return { rowCount: 0, rows: [] };
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
    expect(consumedQueuedActivations).toBe(true);
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
        if (sql.includes('UPDATE workflow_activations')) {
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
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = false')) {
          return { rowCount: 0, rows: [] };
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

  it('reconciles forward from a stale earlier stage and completes the final approved stage', async () => {
    const emit = vi.fn(async () => undefined);
    const recomputeWorkflowState = vi.fn(async () => 'completed');
    let workflowLoadCount = 0;
    let reconcileCount = 0;
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          workflowLoadCount += 1;
          if (workflowLoadCount === 1 || workflowLoadCount === 2) {
            return {
              rowCount: 1,
              rows: [{
                id: 'workflow-1',
                workspace_id: 'workspace-1',
                playbook_id: 'playbook-1',
                lifecycle: 'planned',
                active_stage_name: 'requirements',
                state: 'active',
                orchestration_state: {},
                definition: {
                  ...definition,
                  stages: [
                    { name: 'requirements', goal: 'Define scope', human_gate: false },
                    { name: 'approval', goal: 'Approve release', human_gate: true },
                  ],
                },
              }],
            };
          }
          if (workflowLoadCount === 3 || workflowLoadCount === 4) {
            return {
              rowCount: 1,
              rows: [{
                id: 'workflow-1',
                workspace_id: 'workspace-1',
                playbook_id: 'playbook-1',
                lifecycle: 'planned',
                active_stage_name: 'approval',
                state: 'active',
                orchestration_state: {},
                definition: {
                  ...definition,
                  stages: [
                    { name: 'requirements', goal: 'Define scope', human_gate: false },
                    { name: 'approval', goal: 'Approve release', human_gate: true },
                  ],
                },
              }],
            };
          }
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              workspace_id: 'workspace-1',
              playbook_id: 'playbook-1',
              lifecycle: 'planned',
              active_stage_name: null,
              state: 'active',
              orchestration_state: {},
              definition: {
                ...definition,
                stages: [
                  { name: 'requirements', goal: 'Define scope', human_gate: false },
                  { name: 'approval', goal: 'Approve release', human_gate: true },
                ],
              },
            }],
          };
        }
        if (sql.includes('SELECT ws.id') && sql.includes('FROM workflow_stages ws')) {
          reconcileCount += 1;
          if (reconcileCount === 1) {
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
                  human_gate: false,
                  status: 'active',
                  gate_status: 'not_requested',
                  iteration_count: 0,
                  summary: null,
                  started_at: new Date('2026-03-11T00:00:00Z'),
                  completed_at: null,
                  open_work_item_count: 1,
                  total_work_item_count: 1,
                  first_work_item_at: new Date('2026-03-11T00:00:00Z'),
                  last_completed_work_item_at: null,
                },
                {
                  id: 'stage-2',
                  lifecycle: 'planned',
                  name: 'approval',
                  position: 1,
                  goal: 'Approve release',
                  guidance: null,
                  human_gate: true,
                  status: 'awaiting_gate',
                  gate_status: 'approved',
                  iteration_count: 0,
                  summary: 'Approved release payload is ready.',
                  started_at: null,
                  completed_at: null,
                  open_work_item_count: 1,
                  total_work_item_count: 1,
                  first_work_item_at: new Date('2026-03-11T01:00:00Z'),
                  last_completed_work_item_at: null,
                },
              ],
            };
          }
          if (reconcileCount === 2) {
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
                  human_gate: false,
                  status: 'completed',
                  gate_status: 'not_requested',
                  iteration_count: 0,
                  summary: 'Closed during workflow completion.',
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
                  name: 'approval',
                  position: 1,
                  goal: 'Approve release',
                  guidance: null,
                  human_gate: true,
                  status: 'pending',
                  gate_status: 'approved',
                  iteration_count: 0,
                  summary: 'Approved release payload is ready.',
                  started_at: null,
                  completed_at: null,
                  open_work_item_count: 1,
                  total_work_item_count: 1,
                  first_work_item_at: new Date('2026-03-11T01:00:00Z'),
                  last_completed_work_item_at: null,
                },
              ],
            };
          }
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
                human_gate: false,
                status: 'completed',
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: 'Closed during workflow completion.',
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
                name: 'approval',
                position: 1,
                goal: 'Approve release',
                guidance: null,
                human_gate: true,
                status: 'completed',
                gate_status: 'approved',
                iteration_count: 0,
                summary: 'Approved release payload is ready.',
                started_at: new Date('2026-03-11T01:00:00Z'),
                completed_at: new Date('2026-03-11T01:30:00Z'),
                open_work_item_count: 0,
                total_work_item_count: 1,
                first_work_item_at: new Date('2026-03-11T01:00:00Z'),
                last_completed_work_item_at: new Date('2026-03-11T01:30:00Z'),
              },
            ],
          };
        }
        if (sql.includes('FROM workflow_stages') && sql.includes('name = $3')) {
          if (params?.[2] === 'requirements') {
            return {
              rowCount: 1,
              rows: [{
                id: 'stage-1',
                name: 'requirements',
                position: 0,
                goal: 'Define scope',
                guidance: null,
                human_gate: false,
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
          return {
            rowCount: 1,
            rows: [{
              id: 'stage-2',
              name: 'approval',
              position: 1,
              goal: 'Approve release',
              guidance: null,
              human_gate: true,
              status: 'active',
              gate_status: 'approved',
              iteration_count: 0,
              summary: 'Approved release payload is ready.',
              metadata: {},
              started_at: new Date('2026-03-11T01:00:00Z'),
              completed_at: null,
              updated_at: new Date('2026-03-11T01:00:00Z'),
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('blocking_resolution')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', expect.any(String)]);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT wi.id,') && sql.includes('wi.next_expected_actor') && sql.includes('wi.next_expected_action')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            expect.any(String),
            ['assess', 'approve', 'rework', 'handoff'],
          ]);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('UPDATE workflow_work_items')) {
          if (params?.[2] === 'requirements') {
            expect(params).toEqual(['tenant-1', 'workflow-1', 'requirements', 'done']);
            return { rowCount: 1, rows: [] };
          }
          expect(params).toEqual(['tenant-1', 'workflow-1', 'approval', 'done']);
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('UPDATE workflow_stages')) {
          if (params?.[2] === 'requirements') {
            expect(params).toEqual(['tenant-1', 'workflow-1', 'requirements', 'Ship it']);
            return { rowCount: 1, rows: [] };
          }
          if (params?.[2] === 'approval') {
            expect(params).toEqual(['tenant-1', 'workflow-1', 'approval', 'Ship it']);
            return { rowCount: 1, rows: [] };
          }
          if (params?.[2] === 'stage-1' || params?.[2] === 'stage-2') {
            return { rowCount: 1, rows: [] };
          }
        }
        if (sql.includes('SELECT name') && sql.includes('FROM workflow_stages')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('UPDATE workflow_activations')) {
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
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = false')) {
          return { rowCount: 0, rows: [] };
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
    expect(emit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'stage.completed',
        data: { stage_name: 'requirements', summary: 'Ship it' },
      }),
      pool,
    );
    expect(emit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'stage.completed',
        data: { stage_name: 'approval', summary: 'Ship it' },
      }),
      pool,
    );
    expect(emit).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        type: 'workflow.completed',
        data: { summary: 'Ship it', final_artifacts: [] },
      }),
      pool,
    );
  });

  it('rejects workflow completion when the active stage still has a blocking rejected assessment', async () => {
    const service = new PlaybookWorkflowControlService({
      pool: {} as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      stateService: { recomputeWorkflowState: vi.fn(async () => 'active') } as never,
      activationService: { enqueueForWorkflow: vi.fn() } as never,
      activationDispatchService: { dispatchActivation: vi.fn() } as never,
    });
    vi.spyOn(service as never, 'loadWorkflow').mockResolvedValue({
      id: 'workflow-1',
      workspace_id: 'workspace-1',
      playbook_id: 'playbook-1',
      lifecycle: 'planned',
      active_stage_name: 'implementation',
      state: 'active',
      orchestration_state: {},
      definition,
    });
    vi.spyOn(service as never, 'loadStage').mockResolvedValue({
      id: 'stage-implementation',
      name: 'implementation',
      position: 1,
      goal: 'Ship the feature',
      guidance: null,
      human_gate: false,
      status: 'active',
      gate_status: 'not_requested',
      iteration_count: 0,
      summary: null,
      metadata: {},
      started_at: new Date('2026-03-21T03:00:00Z'),
      completed_at: null,
      updated_at: new Date('2026-03-21T03:00:00Z'),
    });

    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT ws.id') && sql.includes('FROM workflow_stages ws')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'stage-implementation',
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
              started_at: new Date('2026-03-21T03:00:00Z'),
              completed_at: null,
              open_work_item_count: 1,
              total_work_item_count: 1,
              first_work_item_at: new Date('2026-03-21T03:00:00Z'),
              last_completed_work_item_at: null,
            }],
          };
        }
        if (sql.includes('SELECT wi.id,') && sql.includes('wi.escalation_status') && sql.includes('wi.next_expected_actor')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'implementation', ['assess', 'approve', 'rework', 'handoff']]);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('blocking_resolution')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'implementation']);
          return {
            rowCount: 1,
            rows: [{
              id: 'work-item-1',
              title: 'Implement the reporting pipeline',
              blocking_resolution: 'rejected',
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = false')) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    await expect(service.completeWorkflow(
      { tenantId: 'tenant-1', scope: 'agent', ownerType: 'agent', ownerId: 'agent-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      { summary: 'Ship it' },
      db as never,
    )).rejects.toThrow(
      "Cannot complete workflow while stage 'implementation' still has a blocking rejected assessment on work item 'Implement the reporting pipeline'.",
    );
  });

  it('rejects workflow completion when the active stage still has a required pending assessment', async () => {
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
              definition,
            }],
          };
        }
        if (sql.includes('FROM workflow_stages')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'stage-implementation',
              lifecycle: 'planned',
              name: 'implementation',
              position: 1,
              goal: 'Ship code',
              guidance: null,
              human_gate: false,
              status: 'active',
              gate_status: 'not_requested',
              iteration_count: 0,
              summary: null,
              metadata: {},
              started_at: new Date('2026-03-11T00:00:00Z'),
              completed_at: null,
              open_work_item_count: 1,
              total_work_item_count: 1,
              first_work_item_at: new Date('2026-03-11T00:00:00Z'),
              last_completed_work_item_at: null,
              updated_at: new Date('2026-03-11T00:00:00Z'),
            }],
          };
        }
        if (sql.includes('COALESCE(blocking_assessment.blocking_resolution')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT wi.id,') && sql.includes('wi.next_expected_actor') && sql.includes('wi.next_expected_action')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'implementation',
            ['assess', 'approve', 'rework', 'handoff'],
          ]);
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-implementation-1',
              title: 'Implement the reporting pipeline',
              next_expected_actor: 'release-assessor',
              next_expected_action: 'assess',
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = false')) {
          return { rowCount: 0, rows: [] };
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

    await expect(service.completeWorkflow(
      { tenantId: 'tenant-1', scope: 'admin', ownerType: 'user', ownerId: 'user-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      { summary: 'Done', final_artifacts: [] },
      pool as never,
    )).rejects.toThrow(
      "Cannot complete workflow while stage 'implementation' still has required assessment by 'release-assessor' pending on work item 'Implement the reporting pipeline'.",
    );
  });

  it('rejects workflow completion while a non-terminal specialist task still exists', async () => {
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
              definition,
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = false')) {
          expect(sql).toContain('state::text <> ALL($3::text[])');
          expect(params).toEqual(['tenant-1', 'workflow-1', ['completed', 'failed', 'cancelled']]);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-implementation-1',
              role: 'implementer',
              state: 'in_progress',
              stage_name: 'implementation',
            }],
          };
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

    await expect(service.completeWorkflow(
      { tenantId: 'tenant-1', scope: 'admin', ownerType: 'user', ownerId: 'user-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      { summary: 'Done', final_artifacts: [] },
      pool as never,
    )).rejects.toThrow(
      "Cannot complete workflow while task 'implementer' in stage 'implementation' is still in_progress.",
    );
  });

  it('rejects completing a workflow while a required handoff is still pending', async () => {
    const definitionWithDrafting = {
      ...definition,
      stages: [
        {
          name: 'drafting',
          goal: 'Draft a review-ready packet.',
          involves: ['rework-product-strategist', 'rework-technical-editor'],
        },
      ],
    };
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
              active_stage_name: 'drafting',
              state: 'active',
              definition: definitionWithDrafting,
            }],
          };
        }
        if (sql.includes('FROM workflow_stages') && sql.includes('AND name = $3') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'stage-drafting',
              name: 'drafting',
              position: 0,
              goal: 'Draft a review-ready packet.',
              guidance: null,
              human_gate: false,
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
        if (sql.includes('SELECT ws.id,') && sql.includes('FROM workflow_stages ws')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'stage-drafting',
              name: 'drafting',
              position: 0,
              goal: 'Draft a review-ready packet.',
              guidance: null,
              human_gate: false,
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
        if (sql.includes('COALESCE(blocking_assessment.blocking_resolution')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT wi.id,') && sql.includes('wi.next_expected_actor') && sql.includes('wi.next_expected_action')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'drafting',
            ['assess', 'approve', 'rework', 'handoff'],
          ]);
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-drafting-1',
              title: 'Draft review-ready product brief',
              next_expected_actor: 'rework-technical-editor',
              next_expected_action: 'handoff',
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = false')) {
          return { rowCount: 0, rows: [] };
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

    await expect(service.completeWorkflow(
      { tenantId: 'tenant-1', scope: 'admin', ownerType: 'user', ownerId: 'user-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      { summary: 'Done', final_artifacts: [] },
      pool as never,
    )).rejects.toThrow(
      "Cannot complete workflow while stage 'drafting' still has required handoff by 'rework-technical-editor' pending on work item 'Draft review-ready product brief'.",
    );
  });

  it('rejects stage advancement when the source stage only has completed work items with unresolved assessment changes requested', async () => {
    const activationService = { enqueueForWorkflow: vi.fn() };
    const dispatchService = { dispatchActivation: vi.fn() };
    const service = new PlaybookWorkflowControlService({
      pool: { query: vi.fn() } as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      stateService: { recomputeWorkflowState: vi.fn(async () => 'active') } as never,
      activationService: activationService as never,
      activationDispatchService: dispatchService as never,
    });
    vi.spyOn(service as never, 'loadWorkflow').mockResolvedValue({
      id: 'workflow-1',
      workspace_id: 'workspace-1',
      playbook_id: 'playbook-1',
      lifecycle: 'planned',
      active_stage_name: 'requirements',
      state: 'active',
      orchestration_state: {},
      definition,
    });
    vi.spyOn(service as never, 'loadStage')
      .mockResolvedValueOnce({
        id: 'stage-requirements',
        name: 'requirements',
        position: 0,
        goal: 'Define scope',
        guidance: null,
        human_gate: false,
        status: 'active',
        gate_status: 'not_requested',
        iteration_count: 0,
        summary: null,
        metadata: {},
        started_at: new Date('2026-03-21T03:00:00Z'),
        completed_at: null,
        updated_at: new Date('2026-03-21T03:00:00Z'),
      })
      .mockResolvedValueOnce({
        id: 'stage-implementation',
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
        updated_at: new Date('2026-03-21T03:00:00Z'),
      });

    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT wi.id,') && sql.includes('wi.escalation_status') && sql.includes('wi.next_expected_actor')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'requirements', ['assess', 'approve', 'rework', 'handoff']]);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('blocking_resolution')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'requirements']);
          expect(sql).not.toContain('wi.completed_at IS NULL');
          return {
            rowCount: 1,
            rows: [{
              id: 'work-item-1',
              title: 'Define launch scope',
              blocking_resolution: 'request_changes',
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    await expect(service.advanceStage(
      { tenantId: 'tenant-1', scope: 'agent', ownerType: 'agent', ownerId: 'agent-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      'requirements',
      {},
      db as never,
    )).rejects.toThrow(
      "Cannot complete workflow while stage 'requirements' still has a blocking request_changes assessment on work item 'Define launch scope'.",
    );

    expect(activationService.enqueueForWorkflow).not.toHaveBeenCalled();
    expect(dispatchService.dispatchActivation).not.toHaveBeenCalled();
  });

  it('rejects workflow completion when the active stage only has completed work items with unresolved pending assessment continuation', async () => {
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
              definition,
            }],
          };
        }
        if (sql.includes('FROM workflow_stages')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'stage-implementation',
              lifecycle: 'planned',
              name: 'implementation',
              position: 1,
              goal: 'Ship code',
              guidance: null,
              human_gate: false,
              status: 'active',
              gate_status: 'not_requested',
              iteration_count: 0,
              summary: null,
              metadata: {},
              started_at: new Date('2026-03-11T00:00:00Z'),
              completed_at: null,
              open_work_item_count: 0,
              total_work_item_count: 1,
              first_work_item_at: new Date('2026-03-11T00:00:00Z'),
              last_completed_work_item_at: new Date('2026-03-11T00:10:00Z'),
              updated_at: new Date('2026-03-11T00:10:00Z'),
            }],
          };
        }
        if (sql.includes('COALESCE(blocking_assessment.blocking_resolution')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT wi.id,') && sql.includes('wi.next_expected_actor') && sql.includes('wi.next_expected_action')) {
          expect(sql).not.toContain('wi.completed_at IS NULL');
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'implementation',
            ['assess', 'approve', 'rework', 'handoff'],
          ]);
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-implementation-1',
              title: 'Implement the reporting pipeline',
              next_expected_actor: 'release-assessor',
              next_expected_action: 'assess',
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = false')) {
          return { rowCount: 0, rows: [] };
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

    await expect(service.completeWorkflow(
      { tenantId: 'tenant-1', scope: 'admin', ownerType: 'user', ownerId: 'user-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      { summary: 'Done', final_artifacts: [] },
      pool as never,
    )).rejects.toThrow(
      "Cannot complete workflow while stage 'implementation' still has required assessment by 'release-assessor' pending on work item 'Implement the reporting pipeline'.",
    );
  });
  it('blocks work-item completion while an escalation is open', async () => {
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
              active_stage_name: 'drafting',
              state: 'active',
              definition: {
                lifecycle: 'planned',
                board: {
                  columns: [
                    { id: 'planned', label: 'Planned' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [{ name: 'drafting', goal: 'Draft the package' }],
              },
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'work-item-1',
              parent_work_item_id: null,
              stage_name: 'drafting',
              title: 'Draft package',
              goal: null,
              acceptance_criteria: null,
              column_id: 'planned',
              owner_role: 'writer',
              next_expected_actor: null,
              next_expected_action: null,
              blocked_state: null,
              blocked_reason: null,
              escalation_status: 'open',
              rework_count: 0,
              priority: 'normal',
              notes: null,
              completed_at: null,
              metadata: {},
              updated_at: new Date('2026-03-23T00:00:00Z'),
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('work_item_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new PlaybookWorkflowControlService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      stateService: { recomputeWorkflowState: vi.fn(async () => 'active') } as never,
      activationService: { enqueueForWorkflow: vi.fn(async () => ({ id: 'activation-1' })) } as never,
      activationDispatchService: { dispatchActivation: vi.fn(async () => undefined) } as never,
    });

    await expect(
      service.completeWorkItem(
        {
          tenantId: 'tenant-1',
          scope: 'admin',
          ownerType: 'user',
          ownerId: 'user-1',
          keyPrefix: 'k1',
          id: 'key-1',
        },
        'workflow-1',
        'work-item-1',
        {},
        pool as never,
      ),
    ).rejects.toThrow(
      "Cannot complete work item 'Draft package' while it still has an open escalation.",
    );
  });

  it('resolves an open work-item escalation by reopening the subject path', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const activationService = {
      enqueueForWorkflow: vi.fn(async () => ({
        id: 'activation-escalation-1',
        activation_id: 'activation-escalation-1',
        state: 'queued',
        event_type: 'work_item.escalation_resolved',
        reason: 'work_item.escalation_resolved',
      })),
    };
    const dispatchService = { dispatchActivation: vi.fn(async () => undefined) };
    const stateService = { recomputeWorkflowState: vi.fn(async () => 'active') };
    const updatedAt = new Date('2026-03-23T02:00:00Z');
    let escalationResolved = false;
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
              active_stage_name: 'drafting',
              state: 'active',
              definition,
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('AND id = $3') && sql.includes('FOR UPDATE')) {
          if (escalationResolved) {
            return {
              rowCount: 1,
              rows: [{
                id: 'work-item-1',
                parent_work_item_id: null,
                stage_name: 'drafting',
                title: 'Draft package',
                goal: null,
                acceptance_criteria: null,
                column_id: 'planned',
                owner_role: 'writer',
                next_expected_actor: 'writer',
                next_expected_action: 'rework',
                blocked_state: null,
                blocked_reason: null,
                escalation_status: null,
                rework_count: 1,
                priority: 'normal',
                notes: null,
                completed_at: null,
                metadata: {},
                updated_at: updatedAt,
              }],
            };
          }
          return {
            rowCount: 1,
            rows: [{
              id: 'work-item-1',
              parent_work_item_id: null,
              stage_name: 'drafting',
              title: 'Draft package',
              goal: null,
              acceptance_criteria: null,
              column_id: 'planned',
              owner_role: 'writer',
              next_expected_actor: null,
              next_expected_action: null,
              blocked_state: 'blocked',
              blocked_reason: 'Needs operator direction.',
              escalation_status: 'open',
              rework_count: 1,
              priority: 'normal',
              notes: null,
              completed_at: null,
              metadata: {},
              updated_at: new Date('2026-03-23T01:30:00Z'),
            }],
          };
        }
        if (sql.includes('FROM workflow_subject_escalations') && sql.includes("status = 'open'")) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-1']);
          return {
            rowCount: 1,
            rows: [{
              id: 'escalation-1',
            }],
          };
        }
        if (sql.includes('UPDATE workflow_subject_escalations')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'work-item-1',
            'escalation-1',
            'resolved',
            'reopen_subject',
            'Resume drafting with the security waiver attached.',
            'admin',
            'k1',
          ]);
          escalationResolved = true;
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT COUNT(*)::int AS count') && sql.includes('FROM workflow_subject_escalations')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-1']);
          return { rowCount: 1, rows: [{ count: 0 }] };
        }
        if (sql.includes('UPDATE workflow_work_items') && sql.includes('escalation_status = NULL')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT ws.id,') && sql.includes('FROM workflow_stages ws')) {
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

    const result = await service.resolveWorkItemEscalation(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: 'user-1',
        keyPrefix: 'k1',
        id: 'key-1',
      },
      'workflow-1',
      'work-item-1',
      {
        action: 'reopen_subject',
        feedback: 'Resume drafting with the security waiver attached.',
      },
      pool as never,
    );

    expect(result).toEqual(
      expect.objectContaining({
        id: 'work-item-1',
        escalation_status: null,
        next_expected_actor: 'writer',
        next_expected_action: 'rework',
        blocked_state: null,
        updated_at: updatedAt.toISOString(),
      }),
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'work_item.escalation_resolved',
        entityType: 'work_item',
        entityId: 'work-item-1',
        data: expect.objectContaining({
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          escalation_id: 'escalation-1',
          action: 'reopen_subject',
        }),
      }),
      pool,
    );
    expect(activationService.enqueueForWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow-1',
        eventType: 'work_item.escalation_resolved',
      }),
      pool,
    );
    expect(dispatchService.dispatchActivation).toHaveBeenCalledWith('tenant-1', 'activation-escalation-1', pool);
    expect(stateService.recomputeWorkflowState).toHaveBeenCalledWith(
      'tenant-1',
      'workflow-1',
      pool,
      expect.objectContaining({ actorType: 'admin', actorId: 'k1' }),
    );
  });

  it('captures subject revision on gate request and supersedes an older approved gate for the stage', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const stateService = { recomputeWorkflowState: vi.fn(async () => 'active') };
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
              active_stage_name: 'approval',
              state: 'active',
              definition: {
                lifecycle: 'planned',
                process_instructions: 'Request approval before implementation resumes.',
                roles: ['writer', 'editorial-reviewer'],
                board: { columns: [{ id: 'planned', label: 'Planned' }] },
                stages: [{ name: 'approval', goal: 'Approval' }],
              },
            }],
          };
        }
        if (sql.includes('FROM workflow_stages') && sql.includes('AND name = $3')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'stage-approval',
              name: 'approval',
              position: 0,
              goal: 'Approval',
              guidance: null,
              human_gate: true,
              status: 'active',
              gate_status: 'approved',
              iteration_count: 0,
              summary: null,
              metadata: {},
              started_at: null,
              completed_at: null,
              updated_at: new Date('2026-03-23T01:00:00Z'),
            }],
          };
        }
        if (sql.includes("FROM workflow_stage_gates") && sql.includes("status = 'awaiting_approval'")) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_stage_gates') && sql.includes('ORDER BY requested_at DESC')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'gate-old',
              workflow_id: 'workflow-1',
              stage_id: 'stage-approval',
              stage_name: 'approval',
              status: 'approved',
              request_summary: 'Old approval',
              recommendation: null,
              concerns: [],
              key_artifacts: [],
              requested_by_type: 'admin',
              requested_by_id: 'k0',
              requested_at: new Date('2026-03-22T00:00:00Z'),
              updated_at: new Date('2026-03-22T00:10:00Z'),
              subject_revision: 1,
              decision_feedback: 'Approved previously',
              decided_at: new Date('2026-03-22T00:05:00Z'),
              superseded_at: null,
              superseded_by_revision: null,
            }],
          };
        }
        if (sql.includes('SELECT COALESCE(MAX(subject_revision), 0)::int AS latest_subject_revision')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'approval']);
          return { rowCount: 1, rows: [{ latest_subject_revision: 2 }] };
        }
        if (sql.includes('UPDATE workflow_stage_gates') && sql.includes('superseded_at = now()')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'stage-approval', 2]);
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_stage_gates')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'stage-approval',
            'approval',
            'Ready for fresh approval',
            null,
            '[]',
            '[]',
            'admin',
            'k1',
            2,
          ]);
          return {
            rowCount: 1,
            rows: [{
              id: 'gate-new',
              workflow_id: 'workflow-1',
              stage_id: 'stage-approval',
              stage_name: 'approval',
              status: 'awaiting_approval',
              request_summary: 'Ready for fresh approval',
              recommendation: null,
              concerns: [],
              key_artifacts: [],
              requested_by_type: 'admin',
              requested_by_id: 'k1',
              requested_at: new Date('2026-03-23T01:05:00Z'),
              updated_at: new Date('2026-03-23T01:05:00Z'),
              subject_revision: 2,
              decision_feedback: null,
              decided_at: null,
              superseded_at: null,
              superseded_by_revision: null,
            }],
          };
        }
        if (sql.includes('UPDATE workflow_stages') && sql.includes("gate_status = 'awaiting_approval'")) {
          return {
            rowCount: 1,
            rows: [{
              id: 'stage-approval',
              name: 'approval',
              position: 0,
              goal: 'Approval',
              guidance: null,
              human_gate: true,
              status: 'awaiting_gate',
              gate_status: 'awaiting_approval',
              iteration_count: 0,
              summary: 'Ready for fresh approval',
              metadata: {},
              started_at: null,
              completed_at: null,
              updated_at: new Date('2026-03-23T01:05:00Z'),
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new PlaybookWorkflowControlService({
      pool: pool as never,
      eventService: eventService as never,
      stateService: stateService as never,
      activationService: { enqueueForWorkflow: vi.fn() } as never,
      activationDispatchService: { dispatchActivation: vi.fn() } as never,
    });

    const stage = await service.requestStageGateApproval(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: 'user-1',
        keyPrefix: 'k1',
        id: 'key-1',
      },
      'workflow-1',
      'approval',
      { summary: 'Ready for fresh approval' },
      pool as never,
    );

    expect(stage.gate_status).toBe('awaiting_approval');
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'stage.gate_requested',
        data: expect.objectContaining({
          workflow_id: 'workflow-1',
          stage_name: 'approval',
          gate_id: 'gate-new',
        }),
      }),
      pool,
    );
  });

  it('anchors approval activations to the requested gate work item when a single open stage item exists', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const activationService = {
      enqueueForWorkflow: vi.fn(async () => ({
        id: 'activation-approve-anchor-1',
        activation_id: 'activation-approve-anchor-1',
        state: 'queued',
        event_type: 'stage.gate.approve',
        reason: 'stage.gate.approve',
        queued_at: null,
        started_at: null,
        completed_at: null,
        summary: null,
        error: null,
      })),
    };
    const dispatchService = { dispatchActivation: vi.fn(async () => undefined) };
    const stateService = { recomputeWorkflowState: vi.fn(async () => 'active') };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("FROM workflow_stage_gates") && sql.includes("AND status = 'awaiting_approval'")) {
          return {
            rowCount: 1,
            rows: [{
              id: 'gate-anchor-1',
              workflow_id: 'workflow-1',
              stage_id: 'stage-approval',
              stage_name: 'approval',
              status: 'awaiting_approval',
              request_summary: 'Ready for final approval',
              recommendation: null,
              concerns: [],
              key_artifacts: [],
              requested_by_type: 'admin',
              requested_by_id: 'k0',
              requested_at: new Date('2026-03-23T00:30:00Z'),
              updated_at: new Date('2026-03-23T00:30:00Z'),
              subject_revision: 2,
              decision_feedback: null,
              decided_at: null,
              superseded_at: null,
              superseded_by_revision: null,
              requested_by_work_item_id: 'work-item-approval-1',
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
              active_stage_name: 'approval',
              state: 'active',
              definition: {
                lifecycle: 'planned',
                process_instructions: 'Approval gate before publication release.',
                roles: ['writer', 'publication-editor'],
                board: { columns: [{ id: 'planned', label: 'Planned' }] },
                stages: [{ name: 'approval', goal: 'Approval gate' }],
              },
            }],
          };
        }
        if (sql.includes('FROM workflow_stages') && sql.includes('AND name = $3')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'stage-approval',
              name: 'approval',
              position: 0,
              goal: 'Approval gate',
              guidance: null,
              human_gate: true,
              status: 'awaiting_gate',
              gate_status: 'awaiting_approval',
              iteration_count: 0,
              summary: null,
              metadata: {},
              started_at: null,
              completed_at: null,
              updated_at: new Date('2026-03-23T00:30:00Z'),
            }],
          };
        }
        if (sql.includes('UPDATE workflow_stage_gates')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'gate-anchor-1',
              workflow_id: 'workflow-1',
              stage_id: 'stage-approval',
              stage_name: 'approval',
              status: 'approved',
              request_summary: 'Ready for final approval',
              recommendation: null,
              concerns: [],
              key_artifacts: [],
              requested_by_type: 'admin',
              requested_by_id: 'k0',
              requested_at: new Date('2026-03-23T00:30:00Z'),
              updated_at: new Date('2026-03-23T00:40:00Z'),
              subject_revision: 2,
              decision_feedback: 'Approved',
              decided_at: new Date('2026-03-23T00:40:00Z'),
              superseded_at: null,
              superseded_by_revision: null,
              requested_by_work_item_id: 'work-item-approval-1',
            }],
          };
        }
        if (sql.includes('UPDATE workflow_work_items') && sql.includes("next_expected_action IN ('approve', 'rework')")) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('UPDATE workflow_stages') && sql.includes('iteration_count = $6')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'stage-approval',
              name: 'approval',
              position: 0,
              goal: 'Approval gate',
              guidance: null,
              human_gate: true,
              status: 'active',
              gate_status: 'approved',
              iteration_count: 0,
              summary: null,
              metadata: {},
              started_at: null,
              completed_at: null,
              updated_at: new Date('2026-03-23T00:40:00Z'),
            }],
          };
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

    const gate = await service.actOnGate(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: 'user-1',
        keyPrefix: 'k1',
        id: 'key-1',
      },
      'gate-anchor-1',
      { action: 'approve', feedback: 'Approved' },
      pool as never,
    );

    expect(gate.gate_status).toBe('approved');
    expect(activationService.enqueueForWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow-1',
        eventType: 'stage.gate.approve',
        payload: expect.objectContaining({
          gate_id: 'gate-anchor-1',
          stage_name: 'approval',
          work_item_id: 'work-item-approval-1',
        }),
      }),
      pool,
    );
  });
});
