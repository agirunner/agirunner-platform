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
});
