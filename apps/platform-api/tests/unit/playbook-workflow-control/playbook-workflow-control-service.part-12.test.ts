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
});
