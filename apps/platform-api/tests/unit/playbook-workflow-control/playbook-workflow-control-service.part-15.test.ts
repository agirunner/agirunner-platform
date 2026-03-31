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
        data: expect.objectContaining({ summary: 'Ship it', final_artifacts: [] }),
      }),
      pool,
    );
  });
});
