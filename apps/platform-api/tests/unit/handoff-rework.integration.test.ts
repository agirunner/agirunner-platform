import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HandoffService } from '../../src/services/handoff-service.js';
import {
  TEST_IDENTITY as identity,
  createV2Harness,
} from '../helpers/v2-harness.js';
import {
  isContainerRuntimeAvailable,
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from '../helpers/postgres.js';

describe('handoff rework integration', () => {
  let db: TestDatabase;
  let harness: ReturnType<typeof createV2Harness>;
  let canRunIntegration = true;

  beforeAll(async () => {
    if (!isContainerRuntimeAvailable()) {
      canRunIntegration = false;
      return;
    }
    try {
      db = await startTestDatabase();
    } catch {
      canRunIntegration = false;
      return;
    }

    harness = createV2Harness(db, { WORKFLOW_ACTIVATION_DELAY_MS: 0 });
    await harness.roleDefinitionService.createRole(identity.tenantId, {
      name: 'developer',
      description: 'Implements workflow tasks in integration tests.',
      systemPrompt: 'You are a developer.',
      allowedTools: [],
      capabilities: ['coding'],
      isActive: true,
    });
    await harness.roleDefinitionService.createRole(identity.tenantId, {
      name: 'reviewer',
      description: 'Reviews workflow tasks in integration tests.',
      systemPrompt: 'You are a reviewer.',
      allowedTools: [],
      capabilities: ['review'],
      isActive: true,
    });
  }, 120_000);

  afterAll(async () => {
    if (db) {
      await stopTestDatabase(db);
    }
  });

  it('persists a new handoff when the same task is reworked and completed again', async (context) => {
    if (!canRunIntegration) {
      context.skip();
    }

    const playbook = await harness.playbookService.createPlaybook(identity.tenantId, {
      name: 'Handoff Rework Flow',
      outcome: 'Retain handoff history across rework iterations.',
      definition: {
        process_instructions: 'Developer implements. Reviewer reviews and may request rework.',
        lifecycle: 'ongoing',
        roles: ['developer', 'reviewer'],
        board: {
          entry_column_id: 'planned',
          columns: [
            { id: 'planned', label: 'Planned' },
            { id: 'active', label: 'Active' },
            { id: 'done', label: 'Done', is_terminal: true },
          ],
        },
        stages: [{ name: 'implementation', goal: 'Deliver the implementation.' }],
        handoff_rules: [
          { from_role: 'developer', to_role: 'reviewer', required: true },
        ],
      },
    });

    const workflow = await harness.workflowService.createWorkflow(identity, {
      playbook_id: String(playbook.id),
      name: 'Handoff Rework Run',
    });
    const workItem = await harness.workflowService.createWorkflowWorkItem(identity, String(workflow.id), {
      request_id: 'wi-handoff-rework',
      title: 'Build hello world',
      goal: 'Deliver a hello world implementation.',
      stage_name: 'implementation',
      column_id: 'active',
      owner_role: 'developer',
    });
    const task = await harness.taskService.createTask(identity, {
      request_id: 'task-handoff-rework',
      title: 'Implement hello world',
      description: 'Create the hello world implementation.',
      work_item_id: String(workItem.id),
      stage_name: 'implementation',
      role: 'developer',
    });

    const handoffService = new HandoffService(db.pool);

    const firstHandoff = await handoffService.submitTaskHandoff(identity.tenantId, String(task.id), {
      request_id: 'handoff-iteration-0',
      summary: 'Initial hello world implementation completed.',
      completion: 'full',
      remaining_items: ['Address reviewer feedback if needed'],
    });

    await db.pool.query(
      `UPDATE tasks
          SET rework_count = 1
        WHERE tenant_id = $1
          AND id = $2`,
      [identity.tenantId, String(task.id)],
    );

    const secondHandoff = await handoffService.submitTaskHandoff(identity.tenantId, String(task.id), {
      request_id: 'handoff-iteration-1',
      summary: 'Hello world implementation updated after review feedback.',
      completion: 'full',
      remaining_items: ['Ready for reviewer re-check'],
    });

    const handoffRows = await db.pool.query<{
      id: string;
      task_rework_count: number;
      summary: string;
      sequence: number;
    }>(
      `SELECT id, task_rework_count, summary, sequence
         FROM task_handoffs
        WHERE tenant_id = $1
          AND task_id = $2
        ORDER BY task_rework_count ASC, sequence ASC`,
      [identity.tenantId, String(task.id)],
    );

    expect(firstHandoff.id).not.toBe(secondHandoff.id);
    expect(handoffRows.rows).toEqual([
      expect.objectContaining({
        id: firstHandoff.id,
        task_rework_count: 0,
        summary: 'Initial hello world implementation completed.',
        sequence: 0,
      }),
      expect.objectContaining({
        id: secondHandoff.id,
        task_rework_count: 1,
        summary: 'Hello world implementation updated after review feedback.',
        sequence: 1,
      }),
    ]);
  }, 120_000);
});
