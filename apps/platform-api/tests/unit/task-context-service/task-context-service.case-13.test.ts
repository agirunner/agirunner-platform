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
} from '../../../src/services/task-context-service/task-context-service.js';

describe('buildTaskContext active stage semantics', () => {
  it('includes recent ancestor handoffs when a work item follows a single-parent lineage', async () => {
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [
              {
                id: 'workflow-lineage',
                name: 'PRD lineage workflow',
                lifecycle: 'planned',
                context: {},
                git_branch: null,
                parameters: {},
                resolved_config: {},
                instruction_config: {},
                metadata: {},
                playbook_id: 'playbook-lineage',
                playbook_name: 'PRD',
                playbook_outcome: 'Finalize the PRD',
                playbook_definition: {
                  lifecycle: 'planned',
                  stages: [
                    { name: 'requirements', goal: 'Draft the PRD' },
                    { name: 'technical-review', goal: 'Review the PRD' },
                    { name: 'approval', goal: 'Finalize the PRD' },
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
          return { rows: [] };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('AND id = $2')) {
          return {
            rows: [
              {
                id: 'wi-approval',
                stage_name: 'approval',
                column_id: 'active',
                title: 'Finalize the PRD',
                goal: 'Finalize the PRD',
                acceptance_criteria: [],
                owner_role: 'product-manager',
                next_expected_actor: 'product-manager',
                next_expected_action: 'revise_prd',
                rework_count: 0,
                latest_handoff_completion: null,
                unresolved_findings: [],
                focus_areas: [],
                known_risks: [],
                priority: 1,
                notes: null,
              },
            ],
          };
        }
        if (sql.includes('COUNT(*)::int AS sibling_count')) {
          return { rows: [{ sibling_count: 1 }], rowCount: 1 };
        }
        if (
          sql.includes('FROM workflow_work_items') &&
          sql.includes('parent_work_item_id') &&
          !sql.includes('COUNT(*)::int AS sibling_count')
        ) {
          if (Array.isArray(params) && params[2] === 'wi-approval') {
            return { rows: [{ parent_work_item_id: 'wi-review' }], rowCount: 1 };
          }
          if (Array.isArray(params) && params[2] === 'wi-review') {
            return { rows: [{ parent_work_item_id: 'wi-requirements' }], rowCount: 1 };
          }
          if (Array.isArray(params) && params[2] === 'wi-requirements') {
            return { rows: [{ parent_work_item_id: null }], rowCount: 1 };
          }
        }
        if (
          sql.includes('FROM task_handoffs') &&
          sql.includes('AND work_item_id = $3') &&
          Array.isArray(params) &&
          params[2] === 'wi-approval'
        ) {
          return { rows: [], rowCount: 0 };
        }
        if (
          sql.includes('FROM task_handoffs') &&
          sql.includes('AND work_item_id = $3') &&
          Array.isArray(params) &&
          params[2] === 'wi-review'
        ) {
          return {
            rows: [
              {
                id: 'handoff-review-1',
                work_item_id: 'wi-review',
                task_id: 'task-architect-1',
                role: 'architect',
                stage_name: 'technical-review',
                summary: 'Technical review requires PRD revisions.',
                completion: 'full',
                changes: ['Uploaded technical review findings'],
                decisions: ['Reuse the existing spend pipeline'],
                remaining_items: ['Revise the PRD'],
                blockers: [],
                focus_areas: ['Budget semantics'],
                known_risks: ['Attribution drift'],
                successor_context: 'Revise the PRD before approval.',
                role_data: {},
                artifact_ids: ['artifact-review-1'],
                created_at: new Date('2026-03-16T02:00:00Z'),
              },
            ],
            rowCount: 1,
          };
        }
        if (
          sql.includes('FROM task_handoffs') &&
          sql.includes('AND work_item_id = $3') &&
          Array.isArray(params) &&
          params[2] === 'wi-requirements'
        ) {
          return {
            rows: [
              {
                id: 'handoff-prd-1',
                work_item_id: 'wi-requirements',
                task_id: 'task-pm-1',
                role: 'product-manager',
                stage_name: 'requirements',
                summary: 'Initial PRD draft ready.',
                completion: 'full',
                changes: ['Uploaded the baseline PRD'],
                decisions: ['Threshold is configurable'],
                remaining_items: [],
                blockers: [],
                focus_areas: [],
                known_risks: [],
                successor_context: 'Use the baseline PRD as the revision source.',
                role_data: {},
                artifact_ids: ['artifact-prd-1'],
                created_at: new Date('2026-03-16T01:00:00Z'),
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [] };
      }),
    };

    const context = await buildTaskContext(db as never, 'tenant-1', {
      id: 'task-approval-1',
      workflow_id: 'workflow-lineage',
      work_item_id: 'wi-approval',
      role: 'product-manager',
      is_orchestrator_task: false,
      depends_on: [],
      role_config: { system_prompt: 'Role prompt' },
      input: { instructions: 'Finalize the PRD.' },
    });

    expect((context.task as Record<string, unknown>).predecessor_handoff).toEqual(
      expect.objectContaining({
        id: 'handoff-review-1',
        artifact_ids: ['artifact-review-1'],
        work_item_id: 'wi-review',
      }),
    );
    expect((context.task as Record<string, unknown>).recent_handoffs).toEqual([
      expect.objectContaining({
        id: 'handoff-review-1',
        work_item_id: 'wi-review',
      }),
      expect.objectContaining({
        id: 'handoff-prd-1',
        artifact_ids: ['artifact-prd-1'],
        work_item_id: 'wi-requirements',
      }),
    ]);
    expect((context.task as Record<string, unknown>).predecessor_handoff_resolution).toEqual(
      expect.objectContaining({
        source: 'parent_work_item',
        source_work_item_id: 'wi-review',
        parent_work_item_id: 'wi-review',
        sibling_count: 1,
      }),
    );
  });

});
