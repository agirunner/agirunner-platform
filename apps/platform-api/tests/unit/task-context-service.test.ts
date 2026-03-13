import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/document-reference-service.js', () => ({
  listTaskDocuments: vi.fn(async () => []),
}));

vi.mock('../../src/services/orchestrator-task-context.js', () => ({
  buildOrchestratorTaskContext: vi.fn(async () => null),
}));

import { buildTaskContext } from '../../src/services/task-context-service.js';

describe('buildTaskContext active stage semantics', () => {
  it('keeps continuous workflow active stages work-item driven', async () => {
    const queries: string[] = [];
    const db = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [{
              id: 'workflow-1',
              name: 'Continuous workflow',
              lifecycle: 'continuous',
              context: {},
              git_branch: 'main',
              parameters: {},
              resolved_config: {},
              instruction_config: {},
              metadata: {},
              playbook_id: 'playbook-1',
              playbook_name: 'Continuous playbook',
              playbook_outcome: 'Ship changes',
              playbook_definition: {
                lifecycle: 'continuous',
                stages: [
                  { name: 'build', goal: 'Build changes' },
                  { name: 'review', goal: 'Review changes' },
                ],
              },
              project_spec_version: null,
            }],
          };
        }
        if (sql.includes('SELECT DISTINCT wi.stage_name')) {
          return { rows: [{ stage_name: 'build' }] };
        }
        return { rows: [] };
      }),
    };

    const context = await buildTaskContext(db as never, 'tenant-1', {
      id: 'task-1',
      workflow_id: 'workflow-1',
      depends_on: [],
    });

    expect((context.workflow as Record<string, unknown>).active_stages).toEqual(['build']);
    expect(context.workflow).not.toHaveProperty('current_stage');
    expect(
      queries.some(
        (sql) => sql.includes('FROM workflow_stages') && sql.includes('ORDER BY position ASC'),
      ),
    ).toBe(false);
  });

  it('keeps standard workflow current stage and gate-aware active stages', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [{
              id: 'workflow-2',
              name: 'Standard workflow',
              lifecycle: 'standard',
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
                lifecycle: 'standard',
                stages: [
                  { name: 'design', goal: 'Design work' },
                  { name: 'review', goal: 'Review work' },
                ],
              },
              project_spec_version: null,
            }],
          };
        }
        if (sql.includes('SELECT DISTINCT stage_name')) {
          return { rows: [{ stage_name: 'review' }] };
        }
        if (sql.includes('FROM workflow_stages') && sql.includes('ORDER BY position ASC')) {
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
