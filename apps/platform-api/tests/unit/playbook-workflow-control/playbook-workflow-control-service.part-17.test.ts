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
        if (sql.includes('UPDATE workflow_stages') && sql.includes("SET status = $4")) {
          expect(params?.slice(0, 4)).toEqual([
            'tenant-1',
            'workflow-1',
            'stage-implementation',
            'completed',
          ]);
          return { rowCount: 1, rows: [] };
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
});
