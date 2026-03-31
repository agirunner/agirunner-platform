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
  it('injects board-driven workflow context when no stages are defined', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [
              {
                id: 'workflow-4',
                name: 'Ongoing workflow',
                lifecycle: 'ongoing',
                context: {},
                git_branch: null,
                parameters: {},
                resolved_config: {},
                instruction_config: {},
                metadata: {},
                playbook_id: 'playbook-4',
                playbook_name: 'Ops queue',
                playbook_outcome: 'Keep queue moving',
                playbook_definition: {
                  lifecycle: 'ongoing',
                  process_instructions: 'Triage incoming work and keep the queue moving.',
                  board: {
                    entry_column_id: 'inbox',
                    columns: [
                      { id: 'inbox', label: 'Inbox' },
                      { id: 'active', label: 'Active' },
                      { id: 'done', label: 'Done', is_terminal: true },
                    ],
                  },
                  stages: [],
                },
                workspace_spec_version: null,
              },
            ],
          };
        }
        if (sql.includes('SELECT DISTINCT wi.stage_name')) {
          return { rows: [] };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('AND id = $2')) {
          return {
            rows: [
              {
                id: 'wi-2',
                stage_name: null,

                column_id: 'active',
                title: 'Investigate alert',
                goal: 'Clear the incident',
                acceptance_criteria: [],
                owner_role: 'developer',
                next_expected_actor: null,
                next_expected_action: null,
                rework_count: 0,
                priority: 1,
                notes: null,
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const context = await buildTaskContext(db as never, 'tenant-1', {
      id: 'task-4',
      workflow_id: 'workflow-4',
      work_item_id: 'wi-2',
      role: 'developer',
      is_orchestrator_task: false,
      depends_on: [],
      role_config: { system_prompt: 'Role prompt' },
      input: { instructions: 'Investigate the incident.' },
    });

    const workflowLayer = ((context.instruction_layers as Record<string, any>).workflow ??
      {}) as Record<string, any>;
    expect(workflowLayer.content).toContain('## Workflow Mode: ongoing');
    expect(workflowLayer.content).toContain('## Progress Model');
    expect(workflowLayer.content).toContain('Stage-and-board driven');
    expect(workflowLayer.content).toContain(
      'Upload required artifacts before completion or escalation',
    );
    expect(workflowLayer.content).not.toContain('## Board Position');
    expect(((context as Record<string, any>).execution_brief ?? {}).current_focus).toEqual(
      expect.objectContaining({
        board_position: 'Active',
      }),
    );
  });

});
