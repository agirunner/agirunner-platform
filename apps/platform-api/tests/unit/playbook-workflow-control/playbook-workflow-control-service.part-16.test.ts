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
});
