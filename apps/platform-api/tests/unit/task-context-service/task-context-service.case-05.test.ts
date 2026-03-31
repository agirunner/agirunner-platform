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
  it('anchors orchestrator live visibility scope to the activation event work item', async () => {
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [
              {
                id: 'workflow-anchor',
                name: 'Anchored workflow',
                lifecycle: 'ongoing',
                context: {},
                git_branch: 'main',
                parameters: {},
                resolved_config: {},
                instruction_config: {},
                metadata: {},
                playbook_id: 'playbook-anchor',
                playbook_name: 'Anchored playbook',
                playbook_outcome: 'Ship work',
                playbook_definition: {
                  lifecycle: 'ongoing',
                  board: { columns: [{ id: 'review', label: 'Review' }] },
                  stages: [{ name: 'review', goal: 'Review work' }],
                },
                workspace_spec_version: null,
              },
            ],
          };
        }
        if (sql.includes('SELECT DISTINCT wi.stage_name')) {
          return { rows: [{ stage_name: 'review' }] };
        }
        if (sql.includes('FROM workflow_work_items')) {
          expect(params).toEqual(expect.arrayContaining(['tenant-1', 'work-item-9']));
          return {
            rows: [
              {
                id: 'work-item-9',
                stage_name: 'review',
                column_id: 'review',
                title: 'Review the output',
                goal: 'Review the output',
                acceptance_criteria: [],
                owner_role: 'reviewer',
                next_expected_actor: 'reviewer',
                next_expected_action: 'assess',
                rework_count: 0,
                metadata: {},
                latest_handoff_completion: null,
                latest_handoff_resolution: null,
                unresolved_findings: [],
                focus_areas: [],
                known_risks: [],
                priority: 1,
                notes: null,
              },
            ],
          };
        }
        if (sql.includes('FROM agentic_settings')) {
          return {
            rowCount: 1,
            rows: [
              {
                live_visibility_mode_default: 'enhanced',
              },
            ],
          };
        }
        return { rowCount: 0, rows: [] };
      }),
    };

    const context = await buildTaskContext(db as never, 'tenant-1', {
      id: 'task-anchor',
      workflow_id: 'workflow-anchor',
      activation_id: 'activation-anchor',
      is_orchestrator_task: true,
      depends_on: [],
      input: {
        events: [
          {
            type: 'work_item.created',
            work_item_id: 'work-item-9',
            stage_name: 'review',
          },
        ],
      },
    });

    expect((context.workflow as Record<string, any>).live_visibility).toEqual(
      expect.objectContaining({
        workflow_id: 'workflow-anchor',
        work_item_id: 'work-item-9',
        task_id: null,
        execution_context_id: 'activation-anchor',
      }),
    );
  });

});
