import { describe, expect, it, vi } from 'vitest';

import { parsePlaybookDefinition } from '../../../src/orchestration/playbook-model.js';
import { assertSuccessorCheckpointReady } from '../../../src/services/work-item-service/mutation-successor.js';

describe('assertSuccessorCheckpointReady', () => {
  it('does not let the current predecessor orchestrator task block successor readiness', async () => {
    const definition = parsePlaybookDefinition({
      roles: ['orchestrator', 'developer'],
      lifecycle: 'planned',
      board: {
        columns: [
          { id: 'planned', label: 'Planned' },
          { id: 'done', label: 'Done', is_terminal: true },
        ],
      },
      stages: [
        { name: 'reproduce', goal: 'Reproduce the bug.' },
        { name: 'implement', goal: 'Implement the fix.' },
      ],
    });

    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('latest_handoff_completion')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-reproduce']);
          return {
            rowCount: 1,
            rows: [{
              id: 'work-item-reproduce',
              title: 'Reproduce timeout bug',
              stage_name: 'reproduce',
              completed_at: null,
              blocked_state: null,
              blocked_reason: null,
              escalation_status: null,
              gate_status: 'not_requested',
              next_expected_actor: null,
              next_expected_action: null,
              latest_handoff_completion: 'full',
              latest_handoff_resolution: null,
            }],
          };
        }

        if (sql.includes('FROM tasks') && sql.includes("state NOT IN ('completed', 'failed', 'cancelled')")) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-reproduce']);
          const excludesOrchestratorTasks =
            sql.includes('is_orchestrator_task = FALSE')
            || sql.includes('COALESCE(is_orchestrator_task, FALSE) = FALSE');
          return excludesOrchestratorTasks
            ? { rowCount: 0, rows: [] }
            : { rowCount: 1, rows: [{ state: 'in_progress', count: 1 }] };
        }

        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };

    await expect(
      assertSuccessorCheckpointReady(
        'tenant-1',
        'workflow-1',
        definition,
        'implement',
        'work-item-reproduce',
        client as never,
      ),
    ).resolves.toBeUndefined();
  });
});
