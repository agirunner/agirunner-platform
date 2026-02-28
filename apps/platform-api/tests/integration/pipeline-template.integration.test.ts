import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EventService } from '../../src/services/event-service.js';
import { PipelineService } from '../../src/services/pipeline-service.js';
import { TaskService } from '../../src/services/task-service.js';
import { TemplateService } from '../../src/services/template-service.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

const tenantId = '00000000-0000-0000-0000-000000000001';

const testConfig = {
  TASK_DEFAULT_TIMEOUT_MINUTES: 30,
  TASK_DEFAULT_AUTO_RETRY: false,
  TASK_DEFAULT_MAX_RETRIES: 0,
};

describe('pipeline/template integration', () => {
  let db: TestDatabase;
  let templateService: TemplateService;
  let pipelineService: PipelineService;
  let taskService: TaskService;

  const adminIdentity = {
    id: 'admin',
    tenantId,
    scope: 'admin' as const,
    ownerType: 'user',
    ownerId: null,
    keyPrefix: 'admin',
  };

  beforeAll(async () => {
    db = await startTestDatabase();
    const eventService = new EventService(db.pool);
    templateService = new TemplateService(db.pool, eventService);
    pipelineService = new PipelineService(db.pool, eventService, testConfig);
    taskService = new TaskService(db.pool, eventService, testConfig);
  });

  afterAll(async () => {
    await stopTestDatabase(db);
  });

  it('creates template then instantiates pipeline with dependency graph and variables', async () => {
    const template = await templateService.createTemplate(adminIdentity, {
      name: 'Simple Build',
      slug: 'simple-build',
      schema: {
        variables: [{ name: 'feature', type: 'string' }],
        metadata: { owner: 'qa' },
        tasks: [
          { id: 'analysis', title_template: 'Analyze ${feature}', type: 'analysis' },
          { id: 'implement', title_template: 'Implement ${feature}', type: 'code', depends_on: ['analysis'] },
        ],
      },
    });

    const pipeline = await pipelineService.createPipeline(adminIdentity, {
      template_id: template.id as string,
      name: 'Pipeline A',
      parameters: { feature: 'login' },
    });

    expect(pipeline.tasks).toHaveLength(2);
    const [analysis, implement] = pipeline.tasks as Array<Record<string, unknown>>;

    expect(analysis.title).toBe('Analyze login');
    expect(analysis.state).toBe('ready');
    expect(implement.title).toBe('Implement login');
    expect(implement.state).toBe('pending');
    expect((implement.depends_on as string[])[0]).toBe(analysis.id);
  });

  it('unblocks dependents and derives pipeline state after task completion', async () => {
    const template = await templateService.createTemplate(adminIdentity, {
      name: 'State Derivation',
      slug: 'state-derivation',
      schema: {
        tasks: [
          { id: 'a', title_template: 'A', type: 'code' },
          { id: 'b', title_template: 'B', type: 'test', depends_on: ['a'] },
        ],
      },
    });

    const pipeline = await pipelineService.createPipeline(adminIdentity, {
      template_id: template.id as string,
      name: 'Pipeline B',
    });

    const tasks = pipeline.tasks as Array<Record<string, unknown>>;
    const taskA = tasks.find((task) => task.role === 'a')!;
    const taskB = tasks.find((task) => task.role === 'b')!;

    const agentId = randomUUID();
    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds, current_task_id)
       VALUES ($1,$2,'agent-pipeline',ARRAY['typescript'],'busy',30,$3)`,
      [agentId, tenantId, taskA.id],
    );

    await db.pool.query(
      `UPDATE tasks
       SET state = 'running', assigned_agent_id = $3, claimed_at = now(), started_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, taskA.id, agentId],
    );

    await taskService.completeTask(
      { id: 'agent', tenantId, scope: 'agent', ownerType: 'agent', ownerId: agentId, keyPrefix: 'agent' },
      taskA.id as string,
      { output: { done: true } },
    );

    const refreshedB = await db.pool.query('SELECT state FROM tasks WHERE tenant_id = $1 AND id = $2', [tenantId, taskB.id]);
    expect(refreshedB.rows[0].state).toBe('ready');

    const pipelineState = await db.pool.query('SELECT state FROM pipelines WHERE tenant_id = $1 AND id = $2', [tenantId, pipeline.id]);
    expect(pipelineState.rows[0].state).toBe('pending');
  });

  it('derives failed pipeline state immediately when any task fails', async () => {
    const template = await templateService.createTemplate(adminIdentity, {
      name: 'Immediate Fail Template',
      slug: 'immediate-fail-template',
      schema: {
        tasks: [
          { id: 'a', title_template: 'A', type: 'code' },
          { id: 'b', title_template: 'B', type: 'test' },
          { id: 'c', title_template: 'C', type: 'review' },
        ],
      },
    });

    const pipeline = await pipelineService.createPipeline(adminIdentity, {
      template_id: template.id as string,
      name: 'Pipeline Failed Early',
    });

    const [taskA, taskB] = pipeline.tasks as Array<Record<string, unknown>>;

    const agentA = randomUUID();
    const agentB = randomUUID();
    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds, current_task_id)
       VALUES
         ($1,$3,'agent-a',ARRAY['typescript'],'busy',30,$2),
         ($4,$3,'agent-b',ARRAY['typescript'],'busy',30,$5)`,
      [agentA, taskA.id, tenantId, agentB, taskB.id],
    );

    await db.pool.query(
      `UPDATE tasks
       SET state = 'running',
           assigned_agent_id = CASE WHEN id = $2 THEN $4::uuid WHEN id = $3 THEN $5::uuid END,
           claimed_at = now(),
           started_at = now()
       WHERE tenant_id = $1
         AND id = ANY($6::uuid[])`,
      [tenantId, taskA.id, taskB.id, agentA, agentB, [taskA.id, taskB.id]],
    );

    await taskService.failTask(
      { id: 'agent', tenantId, scope: 'agent', ownerType: 'agent', ownerId: agentA, keyPrefix: 'agent' },
      taskA.id as string,
      { error: { message: 'boom' } },
    );

    const pipelineState = await db.pool.query('SELECT state FROM pipelines WHERE tenant_id = $1 AND id = $2', [tenantId, pipeline.id]);
    expect(pipelineState.rows[0].state).toBe('failed');

    const remainingTaskState = await db.pool.query('SELECT state FROM tasks WHERE tenant_id = $1 AND id = $2', [tenantId, taskB.id]);
    expect(remainingTaskState.rows[0].state).toBe('running');
  });

  it('cancels pipeline and cascades cancellation to all non-completed tasks', async () => {
    const template = await templateService.createTemplate(adminIdentity, {
      name: 'Cancellation Template',
      slug: 'cancel-template',
      schema: {
        tasks: [
          { id: 'a', title_template: 'A', type: 'code' },
          { id: 'b', title_template: 'B', type: 'review' },
          { id: 'c', title_template: 'C', type: 'test' },
          { id: 'd', title_template: 'D', type: 'analysis' },
        ],
      },
    });

    const pipeline = await pipelineService.createPipeline(adminIdentity, {
      template_id: template.id as string,
      name: 'Pipeline C',
    });

    const [taskA, taskB, taskC, taskD] = pipeline.tasks as Array<Record<string, unknown>>;

    await db.pool.query(
      `UPDATE tasks
       SET state = CASE
         WHEN id = $3 THEN 'completed'::task_state
         WHEN id = $4 THEN 'running'::task_state
         WHEN id = $5 THEN 'failed'::task_state
         ELSE 'pending'::task_state
       END
       WHERE tenant_id = $1
         AND pipeline_id = $2`,
      [tenantId, pipeline.id, taskA.id, taskB.id, taskC.id],
    );

    const cancelled = await pipelineService.cancelPipeline(adminIdentity, pipeline.id as string);
    expect(cancelled.state).toBe('failed');

    const taskStates = await db.pool.query(
      'SELECT id, state FROM tasks WHERE tenant_id = $1 AND pipeline_id = $2 ORDER BY created_at ASC',
      [tenantId, pipeline.id],
    );

    const byId = new Map(taskStates.rows.map((row) => [row.id as string, row.state as string]));
    expect(byId.get(taskA.id as string)).toBe('completed');
    expect(byId.get(taskB.id as string)).toBe('cancelled');
    expect(byId.get(taskC.id as string)).toBe('cancelled');
    expect(byId.get(taskD.id as string)).toBe('cancelled');
  });

  it('creates a new immutable template version on update and uses latest version for new pipelines', async () => {
    const templateV1 = await templateService.createTemplate(adminIdentity, {
      name: 'Versioned Template',
      slug: 'versioned-template',
      schema: {
        tasks: [{ id: 'impl', title_template: 'Implement v1', type: 'code' }],
      },
    });

    const templateV2 = await templateService.updateTemplate(adminIdentity, templateV1.id as string, {
      description: 'v2 description',
      schema: {
        tasks: [{ id: 'impl', title_template: 'Implement v2', type: 'code' }],
      },
    });

    expect(templateV2.id).not.toBe(templateV1.id);
    expect(templateV2.version).toBe(2);

    const v1Reloaded = await templateService.getTemplate(tenantId, templateV1.id as string);
    expect(v1Reloaded.version).toBe(1);
    expect(v1Reloaded.description).toBeNull();
    expect((v1Reloaded.schema as { tasks: Array<{ title_template: string }> }).tasks[0].title_template).toBe('Implement v1');

    const pipeline = await pipelineService.createPipeline(adminIdentity, {
      template_id: templateV1.id as string,
      name: 'Pipeline Uses Latest Template',
    });

    expect(pipeline.template_id).toBe(templateV2.id);
    expect(pipeline.template_version).toBe(2);

    const [task] = pipeline.tasks as Array<Record<string, unknown>>;
    expect(task.title).toBe('Implement v2');
  });
});
