import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/services/document-reference-service.js', () => ({
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
  it('injects the effective live visibility contract into workflow context', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [
              {
                id: 'workflow-live',
                name: 'Live workflow',
                lifecycle: 'planned',
                context: {},
                git_branch: 'main',
                parameters: {},
                resolved_config: {},
                instruction_config: {},
                metadata: {},
                playbook_id: 'playbook-live',
                playbook_name: 'Live playbook',
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
                id: 'workflow-live',
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
      id: 'task-live',
      workflow_id: 'workflow-live',
      activation_id: 'activation-live',
      is_orchestrator_task: true,
      depends_on: [],
    });

    expect((context.workflow as Record<string, any>).live_visibility).toEqual(
      expect.objectContaining({
        mode: 'enhanced',
        source: 'agentic_settings',
        workflow_id: 'workflow-live',
        execution_context_id: 'activation-live',
        source_kind: 'orchestrator',
        record_operator_brief_tool: 'record_operator_brief',
        turn_update_scope: null,
        operator_brief_request_id_prefix: 'operator-brief:activation-live:',
      }),
    );
    expect(((context as Record<string, any>).execution_brief ?? {}).operator_visibility).toEqual(
      expect.objectContaining({
        mode: 'enhanced',
        execution_context_id: 'activation-live',
        source_kind: 'orchestrator',
      }),
    );
    expect((context as Record<string, any>).agentic_settings).toEqual({
      assembled_prompt_warning_threshold_chars: 32000,
    });
  });

});
