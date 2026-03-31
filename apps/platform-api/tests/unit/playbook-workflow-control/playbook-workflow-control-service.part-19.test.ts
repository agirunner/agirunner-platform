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
