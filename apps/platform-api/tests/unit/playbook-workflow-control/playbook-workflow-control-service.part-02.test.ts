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
});
