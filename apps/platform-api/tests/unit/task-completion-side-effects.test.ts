import { describe, expect, it } from 'vitest';

import { applyTaskCompletionSideEffects } from '../../src/services/task-completion-side-effects.js';
import {
  createClient,
  createCompletionTask,
  createContinuityService,
  createEventService,
  createIdentity,
} from './task-completion-side-effects/helpers.js';

describe('task completion dependency resolution', () => {
  it('releases dependency-blocked tasks directly into ready without legacy approval gating', async () => {
    const eventService = createEventService();
    const client = createClient(async (sql: string, params?: unknown[]) => {
      if (sql.includes("FROM tasks\n     WHERE tenant_id = $1 AND state = 'pending'")) {
        expect(sql).not.toContain('requires_approval');
        return {
          rowCount: 1,
          rows: [{
            id: 'task-dependent',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            state: 'pending',
            is_orchestrator_task: false,
            depends_on: ['task-complete'],
          }],
        };
      }
      if (sql.includes("SELECT 1 FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[])")) {
        expect(params).toEqual(['tenant-1', ['task-complete']]);
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('UPDATE tasks SET state = $3')) {
        expect(params).toEqual(['tenant-1', 'task-dependent', 'ready']);
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('SELECT playbook_id FROM workflows')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });

    await applyTaskCompletionSideEffects(
      eventService as never,
      undefined,
      createContinuityService() as never,
      createIdentity() as never,
      createCompletionTask({
        id: 'task-complete',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        metadata: {},
      }) as never,
      client as never,
    );

    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.state_changed',
        entityId: 'task-dependent',
        actorId: 'dependency_resolver',
        data: expect.objectContaining({
          from_state: 'pending',
          to_state: 'ready',
        }),
      }),
      client,
    );
  });
});
