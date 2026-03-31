import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/services/document-reference/document-reference-service.js', () => ({
  listTaskDocuments: vi.fn(async () => []),
}));

vi.mock('../../../src/services/orchestrator-task-context/orchestrator-task-context.js', () => ({
  buildOrchestratorTaskContext: vi.fn(async () => null),
}));

import {
  buildTaskContext,
  summarizeTaskContextAttachments,
} from '../../../src/services/task-context-service/task-context-service.js';

describe('buildTaskContext active stage semantics', () => {
  it('returns no predecessor handoff when a new work item has no local or linked predecessor history', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [
              {
                id: 'workflow-5',
                name: 'Planned workflow',
                lifecycle: 'planned',
                context: {},
                git_branch: null,
                parameters: {},
                resolved_config: {},
                instruction_config: {},
                metadata: {},
                playbook_id: 'playbook-5',
                playbook_name: 'SDLC',
                playbook_outcome: 'Ship a reviewed change',
                playbook_definition: {
                  lifecycle: 'planned',
                  process_instructions:
                    'Product defines requirements, architect designs, developer implements, reviewer reviews, QA validates.',
                  board: {
                    entry_column_id: 'planned',
                    columns: [
                      { id: 'planned', label: 'Planned' },
                      { id: 'active', label: 'Active' },
                      { id: 'done', label: 'Done', is_terminal: true },
                    ],
                  },
                  stages: [
                    { name: 'requirements', goal: 'Clarify requirements' },
                    { name: 'design', goal: 'Produce a technical design' },
                  ],
                },
                workspace_spec_version: null,
              },
            ],
          };
        }
        if (sql.includes('SELECT DISTINCT wi.stage_name')) {
          return { rows: [{ stage_name: 'design' }] };
        }
        if (sql.includes('FROM workflow_stages') && sql.includes('ORDER BY ws.position ASC')) {
          return {
            rows: [
              {
                id: 'stage-1',
                name: 'design',
                position: 1,
                goal: 'Produce a technical design',
                guidance: null,
                status: 'active',
                is_active: true,
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
                id: 'wi-design',
                stage_name: 'design',

                column_id: 'active',
                title: 'Design hello world',
                goal: 'Produce the design for hello world',
                acceptance_criteria: [],
                owner_role: 'architect',
                next_expected_actor: 'architect',
                next_expected_action: 'design',
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
        if (sql.includes('FROM task_handoffs') && sql.includes('AND work_item_id = $3')) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };

    const context = await buildTaskContext(db as never, 'tenant-1', {
      id: 'task-architect-1',
      workflow_id: 'workflow-5',
      work_item_id: 'wi-design',
      role: 'architect',
      is_orchestrator_task: false,
      depends_on: [],
      role_config: { system_prompt: 'Role prompt' },
      input: { instructions: 'Create the design.' },
    });

    expect((context.task as Record<string, unknown>).predecessor_handoff).toBeNull();
    expect(
      ((context.instruction_layers as Record<string, any>).workflow ?? {}).content,
    ).not.toContain('Requirements approved for hello world.');
  });

});
