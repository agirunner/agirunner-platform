import { describe, expect, it, vi } from 'vitest';

import { ConflictError, ValidationError } from '../../../src/errors/domain-errors.js';
import { PlaybookWorkflowControlService } from '../../../src/services/playbook-workflow-control/playbook-workflow-control-service.js';

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

  it('records aggregated completion callouts when finishing a workflow', async () => {
    const emit = vi.fn(async () => undefined);
    const recomputeWorkflowState = vi.fn(async () => 'completed');
    const aggregatedCallouts = {
      residual_risks: [
        { code: 'known_gap', summary: 'One non-blocking risk remained.', evidence_refs: ['handoff:1'] },
      ],
      unmet_preferred_expectations: [],
      waived_steps: [{ code: 'extra_review', reason: 'Core review already covered the risk.' }],
      unresolved_advisory_items: [{ kind: 'escalation', id: 'esc-1', summary: 'Escalation was advisory.' }],
      completion_notes: 'Workflow completed with advisory callouts.',
    };
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
              completion_callouts: {},
              definition,
            }],
          };
        }
        if (sql.includes('FROM workflow_stages') && sql.includes('name = $3')) {
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
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT ws.id') && sql.includes('FROM workflow_stages ws')) {
          return {
            rowCount: 1,
            rows: [{
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
              total_work_item_count: 1,
              first_work_item_at: new Date('2026-03-11T01:00:00Z'),
              last_completed_work_item_at: new Date('2026-03-11T02:00:00Z'),
            }],
          };
        }
        if (sql.includes('UPDATE workflow_stages')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT wi.id,') && sql.includes('wi.next_expected_actor') && sql.includes('wi.next_expected_action')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('UPDATE workflow_work_items')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT completion_callouts') && sql.includes('FROM workflow_work_items')) {
          return {
            rowCount: 1,
            rows: [{
              completion_callouts: {
                residual_risks: [
                  { code: 'known_gap', summary: 'One non-blocking risk remained.', evidence_refs: ['handoff:1'] },
                ],
                unmet_preferred_expectations: [],
                waived_steps: [],
                unresolved_advisory_items: [],
                completion_notes: null,
              },
            }],
          };
        }
        if (sql.includes('SELECT name') && sql.includes('FROM workflow_stages')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('UPDATE workflow_activations')) {
          consumedQueuedActivations = true;
          return { rowCount: 1, rows: [{ id: 'activation-1' }] };
        }
        if (sql.includes('UPDATE workflows')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'Ship it',
            JSON.stringify(['artifacts/release-notes.md']),
            aggregatedCallouts,
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
        final_artifacts: ['artifacts/release-notes.md'],
        waived_steps: [{ code: 'extra_review', reason: 'Core review already covered the risk.' }],
        unresolved_advisory_items: [{ kind: 'escalation', id: 'esc-1', summary: 'Escalation was advisory.' }],
        completion_notes: 'Workflow completed with advisory callouts.',
      },
      pool as never,
    );

    expect(result).toEqual({
      workflow_id: 'workflow-1',
      state: 'completed',
      summary: 'Ship it',
      final_artifacts: ['artifacts/release-notes.md'],
      completion_callouts: aggregatedCallouts,
    });
    expect(emit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'workflow.completed',
        data: expect.objectContaining({
          completion_callouts: aggregatedCallouts,
        }),
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
        if (sql.includes('SELECT completion_callouts') && sql.includes('FROM workflow_work_items')) {
          expect(params).toEqual(['tenant-1', 'workflow-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('UPDATE workflows') && sql.includes('orchestration_state')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'Ship it',
            JSON.stringify([]),
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
      { summary: 'Ship it' },
      pool as never,
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
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.completed',
        data: {
          summary: 'Ship it',
          final_artifacts: [],
          completion_callouts: {
            residual_risks: [],
            unmet_preferred_expectations: [],
            waived_steps: [],
            unresolved_advisory_items: [],
            completion_notes: null,
          },
        },
      }),
      pool,
    );
  });
});
