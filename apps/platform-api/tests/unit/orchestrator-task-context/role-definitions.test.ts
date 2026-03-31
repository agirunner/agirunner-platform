import { describe, expect, it, vi } from 'vitest';

import { buildOrchestratorTaskContext } from '../../../src/services/orchestrator-task-context/orchestrator-task-context.js';

describe('buildOrchestratorTaskContext', () => {
  it('adds dynamic playbook role definitions with names and descriptions', async () => {
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflows w')) {
          return {
            rows: [{
              id: 'workflow-1',
              name: 'Workflow One',
              lifecycle: 'planned',
              metadata: {},
              playbook_name: 'Linear Flow',
              playbook_outcome: 'Ship work',
              playbook_definition: {
                board: { columns: [{ id: 'planned', label: 'Planned' }] },
                roles: ['product-manager', 'architect', 'reviewer'],
                stages: [{ name: 'requirements', goal: 'Define the work' }],
              },
            }],
          };
        }
        if (sql.includes('FROM role_definitions')) {
          expect(params?.[1]).toEqual(['product-manager', 'architect', 'reviewer']);
          return {
            rows: [
              { name: 'product-manager', description: 'Owns scope and acceptance.' },
              { name: 'architect', description: 'Designs the technical approach.' },
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

    expect(context?.workflow.role_definitions).toEqual([
      {
        name: 'product-manager',
        description: 'Owns scope and acceptance.',
      },
      {
        name: 'architect',
        description: 'Designs the technical approach.',
      },
      {
        name: 'reviewer',
        description: null,
      },
    ]);
  });
});
