import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/services/document-reference/document-reference-service.js', () => ({
  listTaskDocuments: vi.fn(async () => []),
}));

const { buildOrchestratorTaskContextMock } = vi.hoisted(() => ({
  buildOrchestratorTaskContextMock: vi.fn(async () => ({
    board: {
      pending_dispatches: [
        {
          work_item_id: 'wi-reproduce',
          stage_name: 'reproduce',
          actor: 'Software Developer',
          action: 'investigate',
          title: 'Reproduce export timeout',
        },
      ],
    },
  })),
}));

vi.mock('../../../src/services/orchestrator-task-context/orchestrator-task-context.js', () => ({
  buildOrchestratorTaskContext: buildOrchestratorTaskContextMock,
}));

import { buildTaskContext } from '../../../src/services/task-context-service/task-context-service.js';

describe('buildTaskContext orchestrator execution brief', () => {
  it('injects compact pending-dispatch focus into the orchestrator execution brief', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [
              {
                id: 'workflow-brief',
                name: 'Workflow brief',
                lifecycle: 'planned',
                context: {},
                git_branch: 'main',
                parameters: {},
                resolved_config: {},
                instruction_config: {},
                metadata: {},
                playbook_id: 'playbook-brief',
                playbook_name: 'Bug Fix',
                playbook_outcome: 'Ship the fix',
                playbook_definition: {
                  lifecycle: 'planned',
                  stages: [{ name: 'reproduce', goal: 'Reproduce the bug' }],
                },
                workspace_spec_version: null,
              },
            ],
          };
        }
        if (sql.includes('SELECT DISTINCT wi.stage_name')) {
          return { rows: [{ stage_name: 'reproduce' }] };
        }
        if (sql.includes('SELECT id,') && sql.includes('live_visibility_mode_override')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'workflow-brief',
                live_visibility_mode_override: null,
                live_visibility_revision: 4,
                live_visibility_updated_by_operator_id: null,
                live_visibility_updated_at: null,
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
                assembled_prompt_warning_threshold_chars: 32000,
                revision: 2,
              },
            ],
          };
        }
        return { rowCount: 0, rows: [] };
      }),
    };

    const context = await buildTaskContext(db as never, 'tenant-1', {
      id: 'task-brief',
      workflow_id: 'workflow-brief',
      activation_id: 'activation-brief',
      is_orchestrator_task: true,
      depends_on: [],
    });

    expect(((context as Record<string, any>).execution_brief ?? {}).current_focus).toEqual(
      expect.objectContaining({
        lifecycle: 'planned',
        stage_name: 'reproduce',
        next_expected_actor: 'Software Developer',
        next_expected_action: 'investigate',
      }),
    );
    expect(((context as Record<string, any>).execution_brief ?? {}).rendered_markdown).toContain(
      'Next expected actor: Software Developer',
    );
  });
});
