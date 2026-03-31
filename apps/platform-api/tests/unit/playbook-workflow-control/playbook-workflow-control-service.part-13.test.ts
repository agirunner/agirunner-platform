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
      completion_callouts: {
        residual_risks: [],
        unmet_preferred_expectations: [],
        waived_steps: [],
        unresolved_advisory_items: [],
        completion_notes: null,
      },
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
        if (sql.includes('SELECT completion_callouts') && sql.includes('FROM workflow_work_items')) {
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
            {
              residual_risks: [],
              unmet_preferred_expectations: [],
              waived_steps: [],
              unresolved_advisory_items: [],
              completion_notes: null,
            },
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
      completion_callouts: {
        residual_risks: [],
        unmet_preferred_expectations: [],
        waived_steps: [],
        unresolved_advisory_items: [],
        completion_notes: null,
      },
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
        data: expect.objectContaining({
          summary: 'Ship it',
          final_artifacts: ['artifacts/release-notes.md', 'artifacts/test-report.json'],
        }),
      }),
      pool,
    );
    expect(consumedQueuedActivations).toBe(true);
  });


  it('persists structured completion callouts when completing a work item', async () => {
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
    const callouts = {
      residual_risks: [],
      unmet_preferred_expectations: [],
      waived_steps: [{ code: 'secondary_review', reason: 'Primary review was decisive.' }],
      unresolved_advisory_items: [{ kind: 'approval', id: 'gate-1', summary: 'Approval stayed advisory.' }],
      completion_notes: 'Closed with one waived preferred review.',
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
              next_expected_actor: 'reviewer',
              next_expected_action: 'approve',
              blocked_state: null,
              blocked_reason: null,
              escalation_status: null,
              rework_count: 0,
              priority: 'normal',
              notes: null,
              completed_at: null,
              metadata: { lane: 'default' },
              completion_callouts: {},
              updated_at: new Date('2026-03-11T02:00:00Z'),
            }],
          };
        }
        if (sql.includes('UPDATE workflow_work_items')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'wi-ongoing-1',
            null,
            'Triage request',
            'Clarify the incoming ask',
            'Next action is unblocked',
            'requirements',
            'done',
            'analyst',
            'normal',
            null,
            { lane: 'default' },
            callouts,
          ]);
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
              blocked_state: null,
              blocked_reason: null,
              escalation_status: null,
              rework_count: 0,
              priority: 'normal',
              notes: null,
              completed_at: new Date('2026-03-11T02:00:00Z'),
              metadata: { lane: 'default' },
              completion_callouts: callouts,
              updated_at: updatedAt,
            }],
          };
        }
        if (sql.includes('SELECT id,') && sql.includes('completion_callouts')) {
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
              blocked_state: null,
              blocked_reason: null,
              escalation_status: null,
              rework_count: 0,
              priority: 'normal',
              notes: null,
              completed_at: new Date('2026-03-11T02:00:00Z'),
              metadata: { lane: 'default' },
              completion_callouts: callouts,
              updated_at: updatedAt,
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('work_item_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT latest_assessment.resolution AS blocking_resolution')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-ongoing-1']);
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
      {
        waived_steps: [{ code: 'secondary_review', reason: 'Primary review was decisive.' }],
        unresolved_advisory_items: [{ kind: 'approval', id: 'gate-1', summary: 'Approval stayed advisory.' }],
        completion_notes: 'Closed with one waived preferred review.',
      },
      pool as never,
    );

    expect(updated).toEqual(expect.objectContaining({
      id: 'wi-ongoing-1',
      completion_callouts: callouts,
    }));
  });
});
