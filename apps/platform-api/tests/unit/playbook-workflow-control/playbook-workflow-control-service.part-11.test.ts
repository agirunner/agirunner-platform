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
});
