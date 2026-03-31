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
  it('keeps standard workflow current stage and gate-aware active stages', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [
              {
                id: 'workflow-2',
                name: 'Standard workflow',
                lifecycle: 'planned',
                context: {},
                git_branch: 'release',
                parameters: {},
                resolved_config: {},
                instruction_config: {},
                metadata: {},
                playbook_id: 'playbook-2',
                playbook_name: 'Standard playbook',
                playbook_outcome: 'Ship milestone',
                playbook_definition: {
                  lifecycle: 'planned',
                  stages: [
                    { name: 'design', goal: 'Design work' },
                    { name: 'review', goal: 'Review work' },
                  ],
                },
                workspace_spec_version: null,
              },
            ],
          };
        }
        if (sql.includes('SELECT DISTINCT wi.stage_name')) {
          return { rows: [{ stage_name: 'review' }] };
        }
        if (sql.includes('FROM workflow_stages') && sql.includes('ORDER BY ws.position ASC')) {
          return {
            rows: [
              {
                id: 'stage-1',
                name: 'design',
                position: 0,
                goal: 'Design work',
                guidance: null,
                human_gate: false,
                status: 'completed',
                is_active: false,
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: null,
                started_at: null,
                completed_at: null,
                open_work_item_count: 0,
                total_work_item_count: 0,
              },
              {
                id: 'stage-2',
                name: 'review',
                position: 1,
                goal: 'Review work',
                guidance: null,
                human_gate: true,
                status: 'active',
                is_active: true,
                gate_status: 'awaiting_approval',
                iteration_count: 0,
                summary: null,
                started_at: null,
                completed_at: null,
                open_work_item_count: 0,
                total_work_item_count: 0,
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const context = await buildTaskContext(db as never, 'tenant-1', {
      id: 'task-2',
      workflow_id: 'workflow-2',
      depends_on: [],
    });

    expect((context.workflow as Record<string, unknown>).active_stages).toEqual(['review']);
    expect((context.workflow as Record<string, unknown>).current_stage).toBe('review');
  });

});
