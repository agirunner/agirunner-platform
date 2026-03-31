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
  it('attaches filtered workspace memory and compact workspace indexes to specialist task context', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workspaces')) {
          return {
            rows: [
              {
                id: 'workspace-ctx-1',
                name: 'Hello World',
                description: 'Test workspace',
                repository_url: 'https://github.com/agirunner/agirunner-test-fixtures',
                settings: {},
                memory: {
                  shared_note: 'visible',
                  release_note: 'visible in workflow',
                  old_private_note: 'should be hidden',
                },
              },
            ],
          };
        }
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [
              {
                id: 'workflow-ctx-1',
                name: 'Planned workflow',
                lifecycle: 'planned',
                context: {},
                git_branch: 'main',
                parameters: {},
                resolved_config: {},
                instruction_config: {},
                metadata: {},
                playbook_id: 'playbook-ctx-1',
                playbook_name: 'SDLC',
                playbook_outcome: 'Ship the change',
                playbook_definition: {
                  lifecycle: 'planned',
                  process_instructions: 'Developer implements then reviewer reviews.',
                  board: {
                    entry_column_id: 'planned',
                    columns: [
                      { id: 'planned', label: 'Planned' },
                      { id: 'active', label: 'Active' },
                      { id: 'review', label: 'In Review' },
                    ],
                  },
                  stages: [{ name: 'implementation', goal: 'Implement the change' }],
                },
                workspace_spec_version: null,
              },
            ],
          };
        }
        if (sql.includes('SELECT DISTINCT wi.stage_name')) {
          return { rows: [{ stage_name: 'implementation' }] };
        }
        if (sql.includes('FROM workflow_stages') && sql.includes('ORDER BY ws.position ASC')) {
          return {
            rows: [
              {
                id: 'stage-implementation',
                lifecycle: 'planned',
                name: 'implementation',
                position: 0,
                goal: 'Implement the change',
                guidance: null,
                human_gate: false,
                status: 'active',
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: null,
                started_at: null,
                completed_at: null,
                open_work_item_count: 1,
                total_work_item_count: 1,
                first_work_item_at: null,
                last_completed_work_item_at: null,
              },
            ],
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('AND id = $2')) {
          return {
            rows: [
              {
                id: 'wi-ctx-1',
                stage_name: 'implementation',

                column_id: 'active',
                title: 'Implement hello world',
                goal: 'Implement hello world',
                acceptance_criteria: [],
                owner_role: 'developer',
                next_expected_actor: 'developer',
                next_expected_action: 'implement',
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
        if (sql.includes('FROM events') && sql.includes("entity_type = 'workspace'")) {
          return {
            rows: [
              {
                id: 11,
                type: 'workspace.memory_updated',
                actor_type: 'agent',
                actor_id: 'agent:key',
                created_at: '2026-03-16T08:00:00.000Z',
                data: { key: 'shared_note' },
              },
              {
                id: 12,
                type: 'workspace.memory_updated',
                actor_type: 'agent',
                actor_id: 'agent:key',
                created_at: '2026-03-16T08:01:00.000Z',
                data: { key: 'release_note', workflow_id: 'workflow-ctx-1' },
              },
              {
                id: 13,
                type: 'workspace.memory_updated',
                actor_type: 'agent',
                actor_id: 'agent:key',
                created_at: '2026-03-16T08:02:00.000Z',
                data: { key: 'old_private_note', workflow_id: 'workflow-old' },
              },
            ],
            rowCount: 3,
          };
        }
        if (sql.includes('FROM workflow_artifacts')) {
          return {
            rows: [
              {
                id: 'artifact-requirements',
                logical_path: 'docs/requirements.md',
                task_id: 'task-pm-1',
                content_type: 'text/markdown',
                created_at: '2026-03-16T09:00:00.000Z',
                total_count: 2,
              },
              {
                id: 'artifact-design',
                logical_path: 'docs/design.md',
                task_id: 'task-arch-1',
                content_type: 'text/markdown',
                created_at: '2026-03-16T09:30:00.000Z',
                total_count: 2,
              },
            ],
            rowCount: 2,
          };
        }
        if (sql.includes('FROM task_handoffs')) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [] };
      }),
    };

    const context = await buildTaskContext(db as never, 'tenant-1', {
      id: 'task-dev-ctx-1',
      workspace_id: 'workspace-ctx-1',
      workflow_id: 'workflow-ctx-1',
      work_item_id: 'wi-ctx-1',
      role: 'developer',
      is_orchestrator_task: false,
      depends_on: [],
      role_config: { system_prompt: 'Role prompt' },
      input: { instructions: 'Implement the task.' },
    });

    const workspace = context.workspace as Record<string, unknown>;
    expect(workspace.memory).toEqual({
      shared_note: 'visible',
      release_note: 'visible in workflow',
    });
    expect(workspace.memory_index).toEqual({
      keys: ['release_note', 'shared_note'],
      total: 2,
      more_available: false,
    });
    expect(workspace.artifact_index).toEqual({
      items: [
        {
          artifact_id: 'artifact-requirements',
          logical_path: 'docs/requirements.md',
          task_id: 'task-pm-1',
          content_type: 'text/markdown',
          created_at: '2026-03-16T09:00:00.000Z',
        },
        {
          artifact_id: 'artifact-design',
          logical_path: 'docs/design.md',
          task_id: 'task-arch-1',
          content_type: 'text/markdown',
          created_at: '2026-03-16T09:30:00.000Z',
        },
      ],
      total: 2,
      more_available: false,
    });
  });

});
