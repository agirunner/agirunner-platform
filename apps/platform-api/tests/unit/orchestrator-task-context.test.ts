import { describe, expect, it, vi } from 'vitest';

import { buildOrchestratorTaskContext } from '../../src/services/orchestrator-task-context.js';

describe('buildOrchestratorTaskContext', () => {
  it('derives active stages from open work items for continuous workflows', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflows w')) {
          return {
            rows: [{
              id: 'workflow-1',
              name: 'Workflow One',
              lifecycle: 'continuous',
              current_stage: 'legacy-stage',
              metadata: {},
              playbook_name: 'Continuous Flow',
              playbook_outcome: 'Ship work',
              playbook_definition: {},
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items')) {
          return {
            rows: [
              { id: 'wi-1', stage_name: 'triage', completed_at: null },
              { id: 'wi-2', stage_name: 'implementation', completed_at: null },
              { id: 'wi-3', stage_name: 'triage', completed_at: null },
              { id: 'wi-4', stage_name: 'done', completed_at: '2026-03-11T00:00:00.000Z' },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const context = await buildOrchestratorTaskContext(db as never, 'tenant-1', {
      id: 'task-1',
      workflow_id: 'workflow-1',
      is_orchestrator_task: true,
    });

    expect(context?.workflow).toEqual(
      expect.objectContaining({
        lifecycle: 'continuous',
        active_stages: ['triage', 'implementation'],
      }),
    );
    expect(context?.workflow).not.toHaveProperty('current_stage');
  });
});
