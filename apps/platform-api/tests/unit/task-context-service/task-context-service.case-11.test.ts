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
  it('prefers the parent-linked predecessor handoff over a later unrelated workflow handoff', async () => {
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [
              {
                id: 'workflow-6',
                name: 'Planned workflow',
                lifecycle: 'planned',
                context: {},
                git_branch: 'release-branch',
                parameters: {},
                resolved_config: {},
                instruction_config: {},
                metadata: {},
                playbook_id: 'playbook-6',
                playbook_name: 'SDLC',
                playbook_outcome: 'Ship a reviewed change',
                playbook_definition: {
                  lifecycle: 'planned',
                  process_instructions:
                    'Developer implements, reviewer reviews, QA validates, product-manager confirms release readiness.',
                  board: {
                    entry_column_id: 'planned',
                    columns: [
                      { id: 'planned', label: 'Planned' },
                      { id: 'active', label: 'Active' },
                      { id: 'done', label: 'Done', is_terminal: true },
                    ],
                  },
                  stages: [
                    { name: 'verification', goal: 'Validate approved changes' },
                    { name: 'release', goal: 'Confirm release readiness' },
                  ],
                },
                workspace_spec_version: null,
              },
            ],
          };
        }
        if (sql.includes('SELECT DISTINCT wi.stage_name')) {
          return { rows: [{ stage_name: 'release' }] };
        }
        if (sql.includes('FROM workflow_stages') && sql.includes('ORDER BY ws.position ASC')) {
          return {
            rows: [
              {
                id: 'stage-release',
                name: 'release',
                position: 1,
                goal: 'Confirm release readiness',
                guidance: null,
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
          return {
            rows: [
              {
                id: 'wi-release',
                stage_name: 'release',

                column_id: 'active',
                title: 'Confirm release readiness',
                goal: 'Confirm release readiness',
                acceptance_criteria: [],
                owner_role: 'product-manager',
                next_expected_actor: 'product-manager',
                next_expected_action: 'release_assess',
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
        if (
          sql.includes('FROM task_handoffs') &&
          sql.includes('AND work_item_id = $3') &&
          Array.isArray(params) &&
          params[2] === 'wi-release'
        ) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('COUNT(*)::int AS sibling_count')) {
          return {
            rows: [{ sibling_count: 1 }],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('parent_work_item_id')) {
          return {
            rows: [{ parent_work_item_id: 'wi-verification' }],
            rowCount: 1,
          };
        }
        if (
          sql.includes('FROM task_handoffs') &&
          sql.includes('AND work_item_id = $3') &&
          Array.isArray(params) &&
          params[2] === 'wi-verification'
        ) {
          return {
            rows: [
              {
                id: 'handoff-qa',
                task_id: 'task-qa-1',
                role: 'qa',
                stage_name: 'verification',
                summary: 'QA validated the approved branch successfully.',
                completion: 'full',
                changes: [],
                decisions: ['Release can proceed'],
                remaining_items: [],
                blockers: [],
                focus_areas: ['Use this evidence for release approval'],
                known_risks: [],
                successor_context: 'Use the verified QA evidence as the release input.',
                role_data: { branch: 'release-branch' },
                artifact_ids: ['artifact-qa-1'],
                created_at: new Date('2026-03-16T02:00:00Z'),
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM task_handoffs') && sql.includes('ORDER BY created_at DESC')) {
          return {
            rows: [
              {
                id: 'handoff-unrelated',
                task_id: 'task-other-1',
                role: 'architect',
                stage_name: 'design',
                summary: 'Unrelated later workflow note.',
                completion: 'full',
                changes: [],
                decisions: [],
                remaining_items: [],
                blockers: [],
                focus_areas: [],
                known_risks: [],
                successor_context: 'Ignore this for release.',
                role_data: {},
                artifact_ids: [],
                created_at: new Date('2026-03-16T03:00:00Z'),
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [] };
      }),
    };

    const context = await buildTaskContext(db as never, 'tenant-1', {
      id: 'task-release-1',
      workflow_id: 'workflow-6',
      work_item_id: 'wi-release',
      role: 'product-manager',
      is_orchestrator_task: false,
      depends_on: [],
      role_config: { system_prompt: 'Role prompt' },
      input: { instructions: 'Confirm release readiness.' },
    });

    expect((context.task as Record<string, unknown>).predecessor_handoff).toEqual(
      expect.objectContaining({
        id: 'handoff-qa',
        role: 'qa',
        summary: 'QA validated the approved branch successfully.',
        successor_context: 'Use the verified QA evidence as the release input.',
      }),
    );
    expect((context.task as Record<string, unknown>).predecessor_handoff_resolution).toEqual(
      expect.objectContaining({
        source: 'parent_work_item',
        source_work_item_id: 'wi-verification',
        parent_work_item_id: 'wi-verification',
        sibling_count: 1,
      }),
    );
    expect(((context as Record<string, any>).execution_brief ?? {}).rendered_markdown).toContain(
      'QA validated the approved branch successfully.',
    );
    expect(
      ((context as Record<string, any>).execution_brief ?? {}).rendered_markdown,
    ).not.toContain('Unrelated later workflow note.');
  });

});
