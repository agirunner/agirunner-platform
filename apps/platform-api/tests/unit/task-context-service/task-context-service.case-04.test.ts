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
  it('omits record_operator_update from specialist live visibility context', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [
              {
                id: 'workflow-live-specialist',
                name: 'Live specialist workflow',
                lifecycle: 'planned',
                context: {},
                git_branch: 'main',
                parameters: {},
                resolved_config: {},
                instruction_config: {},
                metadata: {},
                playbook_id: 'playbook-live-specialist',
                playbook_name: 'Live specialist playbook',
                playbook_outcome: 'Ship work',
                playbook_definition: {
                  lifecycle: 'planned',
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
        if (sql.includes('SELECT id,') && sql.includes('live_visibility_mode_override')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'workflow-live-specialist',
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
      id: 'task-live-specialist',
      workflow_id: 'workflow-live-specialist',
      is_orchestrator_task: false,
      work_item_id: 'wi-live-specialist',
      depends_on: [],
    });

    expect((context.workflow as Record<string, any>).live_visibility).toEqual(
      expect.objectContaining({
        mode: 'enhanced',
        source_kind: 'specialist',
        workflow_id: 'workflow-live-specialist',
        work_item_id: 'wi-live-specialist',
        task_id: 'task-live-specialist',
        execution_context_id: 'task-live-specialist',
        record_operator_brief_tool: 'record_operator_brief',
      }),
    );
  });

});
