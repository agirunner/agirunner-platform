import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HandoffService } from '../../../../src/services/handoff-service.js';
import { RuntimeDefaultsService } from '../../../../src/services/runtime-defaults/runtime-defaults-service.js';
import {
  TEST_IDENTITY as identity,
  createV2Harness,
} from './v2-harness.js';
import {
  isContainerRuntimeAvailable,
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from '../../db/postgres.js';

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
    const runtimeDefaultsService = new RuntimeDefaultsService(db.pool);
    for (const [configKey, configValue] of [
      ['tasks.default_timeout_minutes', '30'],
      ['agent.max_iterations', '10'],
      ['agent.llm_max_retries', '5'],
      ['platform.workflow_activation_delay_ms', '10000'],
      ['platform.workflow_activation_heartbeat_interval_ms', '1800000'],
      ['platform.workflow_activation_stale_after_ms', '300000'],
      ['platform.task_cancel_signal_grace_period_ms', '60000'],
      ['platform.worker_dispatch_ack_timeout_ms', '15000'],
      ['platform.worker_default_heartbeat_interval_seconds', '30'],
      ['platform.worker_offline_grace_period_ms', '300000'],
      ['platform.worker_offline_threshold_multiplier', '2'],
      ['platform.worker_degraded_threshold_multiplier', '1'],
      ['platform.worker_key_expiry_ms', '60000'],
      ['platform.agent_default_heartbeat_interval_seconds', '30'],
      ['platform.agent_heartbeat_grace_period_ms', '300000'],
      ['platform.agent_heartbeat_threshold_multiplier', '2'],
      ['platform.agent_key_expiry_ms', '60000'],
    ] as const) {
      await runtimeDefaultsService.createDefault(identity.tenantId, {
        configKey,
        configValue,
        configType: 'number',
      });
    }
    await harness.roleDefinitionService.createRole(identity.tenantId, {
      name: 'developer',
      description: 'Implements workflow tasks in integration tests.',
      systemPrompt: 'You are a developer.',
      allowedTools: [],
      isActive: true,
    });
    await harness.roleDefinitionService.createRole(identity.tenantId, {
      name: 'reviewer',
      description: 'Reviews workflow tasks in integration tests.',
      systemPrompt: 'You are a reviewer.',
      allowedTools: [],
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

  it('reuses the current rework handoff when an active task retries with a stale earlier-attempt request id', async (context) => {
    if (!canRunIntegration) {
      context.skip();
    }

    const playbook = await harness.playbookService.createPlaybook(identity.tenantId, {
      name: 'Handoff Reuse Flow',
      outcome: 'Prefer the current rework handoff over stale earlier-attempt retries.',
      definition: {
        process_instructions: 'Developer implements and may retry handoffs after rework.',
        lifecycle: 'ongoing',
        roles: ['developer'],
        board: {
          entry_column_id: 'planned',
          columns: [
            { id: 'planned', label: 'Planned' },
            { id: 'active', label: 'Active' },
            { id: 'done', label: 'Done', is_terminal: true },
          ],
        },
        stages: [{ name: 'implementation', goal: 'Deliver the implementation.' }],
      },
    });

    const workflow = await harness.workflowService.createWorkflow(identity, {
      playbook_id: String(playbook.id),
      name: 'Handoff Reuse Run',
    });
    const workItem = await harness.workflowService.createWorkflowWorkItem(identity, String(workflow.id), {
      request_id: 'wi-handoff-reuse',
      title: 'Build hello world again',
      goal: 'Deliver a hello world implementation with retries.',
      stage_name: 'implementation',
      column_id: 'active',
      owner_role: 'developer',
    });
    const task = await harness.taskService.createTask(identity, {
      request_id: 'task-handoff-reuse',
      title: 'Implement hello world with retries',
      description: 'Create the hello world implementation.',
      work_item_id: String(workItem.id),
      stage_name: 'implementation',
      role: 'developer',
    });

    const handoffService = new HandoffService(db.pool);

    await db.pool.query(
      `UPDATE tasks
          SET rework_count = 2,
              state = 'in_progress'
        WHERE tenant_id = $1
          AND id = $2`,
      [identity.tenantId, String(task.id)],
    );
    const priorAttempt = await handoffService.submitTaskHandoff(identity.tenantId, String(task.id), {
      request_id: 'handoff-r2',
      task_rework_count: 2,
      summary: 'Revision 2 implementation completed.',
      completion: 'full',
    });

    await db.pool.query(
      `UPDATE tasks
          SET rework_count = 3,
              state = 'in_progress'
        WHERE tenant_id = $1
          AND id = $2`,
      [identity.tenantId, String(task.id)],
    );
    const currentAttempt = await handoffService.submitTaskHandoff(identity.tenantId, String(task.id), {
      request_id: 'handoff-r3',
      task_rework_count: 3,
      summary: 'Revision 3 implementation completed.',
      completion: 'full',
    });

    const replayed = await handoffService.submitTaskHandoff(identity.tenantId, String(task.id), {
      request_id: 'handoff-r2',
      task_rework_count: 3,
      summary: 'Stale retry should reuse revision 3 handoff.',
      completion: 'full',
    });

    const handoffRows = await db.pool.query<{
      id: string;
      task_rework_count: number;
      request_id: string | null;
      summary: string;
    }>(
      `SELECT id, task_rework_count, request_id, summary
         FROM task_handoffs
        WHERE tenant_id = $1
          AND task_id = $2
        ORDER BY task_rework_count ASC`,
      [identity.tenantId, String(task.id)],
    );

    expect(priorAttempt.request_id).toBe('handoff-r2');
    expect(currentAttempt.request_id).toBe('handoff-r3');
    expect(replayed).toEqual(expect.objectContaining({
      id: currentAttempt.id,
      request_id: 'handoff-r3',
      summary: 'Revision 3 implementation completed.',
    }));
    expect(handoffRows.rows).toEqual([
      expect.objectContaining({
        id: priorAttempt.id,
        task_rework_count: 2,
        request_id: 'handoff-r2',
        summary: 'Revision 2 implementation completed.',
      }),
      expect.objectContaining({
        id: currentAttempt.id,
        task_rework_count: 3,
        request_id: 'handoff-r3',
        summary: 'Revision 3 implementation completed.',
      }),
    ]);
  }, 120_000);
});
