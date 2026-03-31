import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/services/document-reference/document-reference-service.js', () => ({
  listTaskDocuments: vi.fn(async () => []),
}));

vi.mock('../../../src/services/orchestrator-task-context.js', () => ({
  buildOrchestratorTaskContext: vi.fn(async () => null),
}));

import {
  buildTaskContext,
  summarizeTaskContextAttachments,
} from '../../../src/services/task-context-service.js';

describe('buildTaskContext active stage semantics', () => {
  it('uses the activation-event work item when an orchestrator task only has a stage name on the row', async () => {
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [
              {
                id: 'workflow-approval',
                name: 'Approval workflow',
                lifecycle: 'planned',
                context: {},
                git_branch: 'main',
                parameters: {},
                resolved_config: {},
                instruction_config: {},
                metadata: {},
                playbook_id: 'playbook-approval',
                playbook_name: 'Approval playbook',
                playbook_outcome: 'Approve the PRD',
                playbook_definition: {
                  lifecycle: 'planned',
                  stages: [
                    { name: 'requirements', goal: 'Draft the PRD' },
                    { name: 'technical-review', goal: 'Review the PRD' },
                    { name: 'approval', goal: 'Approve the PRD' },
                  ],
                },
                workspace_spec_version: null,
              },
            ],
          };
        }
        if (sql.includes('SELECT DISTINCT wi.stage_name')) {
          return { rows: [{ stage_name: 'approval' }] };
        }
        if (sql.includes('FROM workflow_stages') && sql.includes('ORDER BY ws.position ASC')) {
          return {
            rows: [
              {
                id: 'stage-approval',
                name: 'approval',
                position: 2,
                goal: 'Approve the PRD',
                guidance: null,
                human_gate: true,
                status: 'active',
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: null,
                started_at: null,
                completed_at: null,
                open_work_item_count: 1,
                total_work_item_count: 1,
              },
            ],
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('AND id = $2')) {
          expect(params?.[1]).toBe('wi-approval');
          return {
            rows: [
              {
                id: 'wi-approval',
                stage_name: 'approval',
                column_id: 'planned',
                title: 'Finalize PRD for approval',
                goal: 'Prepare the final PRD for approval',
                acceptance_criteria: [],
                owner_role: 'product-manager',
                next_expected_actor: 'product-manager',
                next_expected_action: 'Finalize the PRD and submit approval handoff',
                rework_count: 0,
                latest_handoff_completion: 'full',
                unresolved_findings: [],
                focus_areas: ['Validate final PRD language'],
                known_risks: ['Attribution drift'],
                priority: 'high',
                notes: null,
              },
            ],
          };
        }
        if (
          sql.includes('FROM task_handoffs') &&
          sql.includes('AND work_item_id = $3') &&
          Array.isArray(params)
        ) {
          expect(params[2]).toBe('wi-approval');
          return {
            rows: [
              {
                id: 'handoff-approval-1',
                workflow_id: 'workflow-approval',
                work_item_id: 'wi-approval',
                task_id: 'task-pm-approval-1',
                role: 'product-manager',
                stage_name: 'approval',
                sequence: 1,
                summary: 'Final PRD is ready for approval.',
                completion: 'full',
                changes: ['Updated requirements/prd.md'],
                decisions: ['Approval review can begin'],
                remaining_items: [],
                blockers: [],
                focus_areas: ['Validate final PRD language'],
                known_risks: ['Attribution drift'],
                successor_context: 'Request the approval gate with the final PRD.',
                role_data: {},
                artifact_ids: ['artifact-prd-final-1'],
                created_at: new Date('2026-03-18T12:00:00Z'),
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const context = await buildTaskContext(db as never, 'tenant-1', {
      id: 'task-orchestrator-approval-1',
      workflow_id: 'workflow-approval',
      stage_name: 'approval',
      is_orchestrator_task: true,
      depends_on: [],
      input: {
        activation_reason: 'queued_events',
        events: [
          {
            type: 'task.handoff_submitted',
            reason: 'task.handoff_submitted',
            work_item_id: 'wi-approval',
            stage_name: 'approval',
            payload: {
              task_id: 'task-pm-approval-1',
              work_item_id: 'wi-approval',
              stage_name: 'approval',
            },
          },
        ],
      },
    });

    expect((context.task as Record<string, unknown>).context_anchor).toEqual({
      source: 'activation_event',
      event_type: 'task.handoff_submitted',
      work_item_id: 'wi-approval',
      stage_name: 'approval',
      triggering_task_id: 'task-pm-approval-1',
    });
    expect((context.task as Record<string, unknown>).work_item).toEqual(
      expect.objectContaining({
        id: 'wi-approval',
        stage_name: 'approval',
      }),
    );
    expect((context.task as Record<string, unknown>).predecessor_handoff).toEqual(
      expect.objectContaining({
        id: 'handoff-approval-1',
        work_item_id: 'wi-approval',
        task_id: 'task-pm-approval-1',
      }),
    );
    expect((context.task as Record<string, unknown>).predecessor_handoff_resolution).toEqual(
      expect.objectContaining({
        source: 'local_work_item',
        source_work_item_id: 'wi-approval',
      }),
    );
  });

});
