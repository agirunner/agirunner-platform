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
  it('derives standard workflow current stage from open work items instead of stale stored stage status', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [
              {
                id: 'workflow-derivation',
                name: 'Derived workflow',
                lifecycle: 'planned',
                context: {},
                git_branch: 'main',
                parameters: {},
                resolved_config: {},
                instruction_config: {},
                metadata: {},
                playbook_id: 'playbook-derived',
                playbook_name: 'Derived playbook',
                playbook_outcome: 'Deliver the change',
                playbook_definition: {
                  lifecycle: 'planned',
                  stages: [
                    { name: 'design', goal: 'Design the work' },
                    { name: 'implementation', goal: 'Build the work' },
                  ],
                },
                workspace_spec_version: null,
              },
            ],
          };
        }
        if (sql.includes('SELECT DISTINCT wi.stage_name')) {
          return { rows: [{ stage_name: 'implementation' }] };
        }
        if (sql.includes('JOIN workflows w') && sql.includes('ORDER BY ws.position ASC')) {
          return {
            rows: [
              {
                id: 'stage-design',
                lifecycle: 'planned',
                name: 'design',
                position: 0,
                goal: 'Design the work',
                guidance: null,
                human_gate: false,
                status: 'active',
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: null,
                started_at: null,
                completed_at: null,
                open_work_item_count: 0,
                total_work_item_count: 1,
                first_work_item_at: null,
                last_completed_work_item_at: new Date('2026-03-16T00:00:00Z'),
              },
              {
                id: 'stage-implementation',
                lifecycle: 'planned',
                name: 'implementation',
                position: 1,
                goal: 'Build the work',
                guidance: null,
                human_gate: false,
                status: 'pending',
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: null,
                started_at: null,
                completed_at: null,
                open_work_item_count: 1,
                total_work_item_count: 1,
                first_work_item_at: new Date('2026-03-16T00:05:00Z'),
                last_completed_work_item_at: null,
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const context = await buildTaskContext(db as never, 'tenant-1', {
      id: 'task-derived',
      workflow_id: 'workflow-derivation',
      depends_on: [],
    });

    expect((context.workflow as Record<string, unknown>).active_stages).toEqual(['implementation']);
    expect((context.workflow as Record<string, unknown>).current_stage).toBe('implementation');
  });

});
