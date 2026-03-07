import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EventService } from '../../src/services/event-service.js';
import { WorkflowService } from '../../src/services/workflow-service.js';
import { TaskService } from '../../src/services/task-service.js';
import { TemplateService } from '../../src/services/template-service.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

const tenantId = '00000000-0000-0000-0000-000000000001';

const testConfig = {
  TASK_DEFAULT_TIMEOUT_MINUTES: 30,
  TASK_DEFAULT_AUTO_RETRY: false,
  TASK_DEFAULT_MAX_RETRIES: 0,
};

describe('workflow/template integration', () => {
  let db: TestDatabase;
  let templateService: TemplateService;
  let workflowService: WorkflowService;
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
    workflowService = new WorkflowService(db.pool, eventService, testConfig);
    taskService = new TaskService(db.pool, eventService, testConfig);
  });

  afterAll(async () => {
    await stopTestDatabase(db);
  });

  it('creates template then instantiates workflow with dependency graph and variables', async () => {
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

    const workflow = await workflowService.createWorkflow(adminIdentity, {
      template_id: template.id as string,
      name: 'Workflow A',
      parameters: { feature: 'login' },
    });

    expect(workflow.tasks).toHaveLength(2);
    const [analysis, implement] = workflow.tasks as Array<Record<string, unknown>>;

    expect(analysis.title).toBe('Analyze login');
    expect(analysis.state).toBe('ready');
    expect(implement.title).toBe('Implement login');
    expect(implement.state).toBe('pending');
    expect((implement.depends_on as string[])[0]).toBe(analysis.id);
  });

  it('unblocks dependents and derives workflow state after task completion', async () => {
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

    const workflow = await workflowService.createWorkflow(adminIdentity, {
      template_id: template.id as string,
      name: 'Workflow B',
    });

    const tasks = workflow.tasks as Array<Record<string, unknown>>;
    const taskA = tasks.find((task) => task.role === 'a')!;
    const taskB = tasks.find((task) => task.role === 'b')!;

    const agentId = randomUUID();
    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds, current_task_id)
       VALUES ($1,$2,'agent-workflow',ARRAY['typescript'],'busy',30,$3)`,
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

    const workflowState = await db.pool.query('SELECT state FROM workflows WHERE tenant_id = $1 AND id = $2', [tenantId, workflow.id]);
    expect(workflowState.rows[0].state).toBe('pending');
  });

  it('derives failed workflow state immediately when any task fails', async () => {
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

    const workflow = await workflowService.createWorkflow(adminIdentity, {
      template_id: template.id as string,
      name: 'Workflow Failed Early',
    });

    const [taskA, taskB] = workflow.tasks as Array<Record<string, unknown>>;

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

    const workflowState = await db.pool.query('SELECT state FROM workflows WHERE tenant_id = $1 AND id = $2', [tenantId, workflow.id]);
    expect(workflowState.rows[0].state).toBe('failed');

    const remainingTaskState = await db.pool.query('SELECT state FROM tasks WHERE tenant_id = $1 AND id = $2', [tenantId, taskB.id]);
    expect(remainingTaskState.rows[0].state).toBe('running');
  });

  it('requests graceful cancellation, then finalizes after grace for running tasks', async () => {
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

    const workflow = await workflowService.createWorkflow(adminIdentity, {
      template_id: template.id as string,
      name: 'Workflow C',
    });

    const [taskA, taskB, taskC, taskD] = workflow.tasks as Array<Record<string, unknown>>;
    const workerId = randomUUID();
    await db.pool.query(
      `INSERT INTO workers (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds)
       VALUES ($1,$2,'cancel-worker',ARRAY['typescript'],'busy',30)`,
      [workerId, tenantId],
    );

    await db.pool.query(
      `UPDATE tasks
       SET state = CASE
         WHEN id = $3 THEN 'completed'::task_state
         WHEN id = $4 THEN 'running'::task_state
         WHEN id = $5 THEN 'failed'::task_state
         ELSE 'pending'::task_state
       END
       WHERE tenant_id = $1
         AND workflow_id = $2`,
      [tenantId, workflow.id, taskA.id, taskB.id, taskC.id],
    );
    await db.pool.query(
      `UPDATE tasks
         SET assigned_worker_id = $3
       WHERE tenant_id = $1
         AND id = $2`,
      [tenantId, taskB.id, workerId],
    );

    const cancelled = await workflowService.cancelWorkflow(adminIdentity, workflow.id as string);
    expect(cancelled.state).toBe('paused');

    const taskStates = await db.pool.query(
      'SELECT id, state, metadata FROM tasks WHERE tenant_id = $1 AND workflow_id = $2 ORDER BY created_at ASC',
      [tenantId, workflow.id],
    );

    const byId = new Map(taskStates.rows.map((row) => [row.id as string, row.state as string]));
    expect(byId.get(taskA.id as string)).toBe('completed');
    expect(byId.get(taskB.id as string)).toBe('running');
    expect(byId.get(taskC.id as string)).toBe('cancelled');
    expect(byId.get(taskD.id as string)).toBe('cancelled');

    const signalledTask = taskStates.rows.find((row) => row.id === taskB.id) as Record<string, unknown>;
    expect((signalledTask.metadata as Record<string, unknown>).workflow_cancel_requested_at).toBeTypeOf('string');

    await taskService.finalizeGracefulWorkflowCancellations(
      new Date(Date.now() + 61_000),
    );

    const finalizedTasks = await db.pool.query(
      'SELECT id, state FROM tasks WHERE tenant_id = $1 AND workflow_id = $2 ORDER BY created_at ASC',
      [tenantId, workflow.id],
    );
    const finalizedById = new Map(finalizedTasks.rows.map((row) => [row.id as string, row.state as string]));
    expect(finalizedById.get(taskB.id as string)).toBe('cancelled');

    const finalWorkflowState = await db.pool.query(
      'SELECT state FROM workflows WHERE tenant_id = $1 AND id = $2',
      [tenantId, workflow.id],
    );
    expect(finalWorkflowState.rows[0].state).toBe('cancelled');
  });

  it('instantiates template with optional parameters and defaults', async () => {
    const template = await templateService.createTemplate(adminIdentity, {
      name: 'Optional Params Template',
      slug: 'optional-params-template',
      schema: {
        variables: [
          { name: 'feature', type: 'string', required: true },
          { name: 'lang', type: 'string', default: 'typescript' },
          { name: 'maxFiles', type: 'number', default: 5 },
        ],
        tasks: [
          {
            id: 'impl',
            title_template: 'Implement ${feature} in ${lang}',
            type: 'code',
            input_template: { limit: '${maxFiles}' },
          },
        ],
      },
    });

    const workflow = await workflowService.createWorkflow(adminIdentity, {
      template_id: template.id as string,
      name: 'Optional Parameter Workflow',
      parameters: { feature: 'auth-refresh' },
    });

    const [task] = workflow.tasks as Array<Record<string, unknown>>;
    expect(task.title).toBe('Implement auth-refresh in typescript');
    expect(task.input).toEqual({ limit: '5' });
  });

  it('activates later workflow phases only after prior phase completion and exposes phase status', async () => {
    const template = await templateService.createTemplate(adminIdentity, {
      name: 'Workflow Phase Template',
      slug: `workflow-phase-${Date.now()}`,
      schema: {
        tasks: [
          { id: 'spec', title_template: 'Spec', type: 'docs', capabilities_required: ['workflow'] },
          { id: 'build', title_template: 'Build', type: 'code', capabilities_required: ['workflow'] },
          { id: 'review', title_template: 'Review', type: 'review', capabilities_required: ['workflow'] },
        ],
        workflow: {
          phases: [
            { name: 'plan', tasks: ['spec'] },
            { name: 'deliver', tasks: ['build', 'review'], parallel: false },
          ],
        },
      },
    });

    const workflow = await workflowService.createWorkflow(adminIdentity, {
      template_id: template.id as string,
      name: 'Workflow phase workflow',
    });

    const createdTasks = workflow.tasks as Array<Record<string, unknown>>;
    const specTask = createdTasks.find((task) => task.role === 'spec')!;
    const buildTask = createdTasks.find((task) => task.role === 'build')!;
    const reviewTask = createdTasks.find((task) => task.role === 'review')!;

    expect(specTask.state).toBe('ready');
    expect(buildTask.state).toBe('pending');
    expect(reviewTask.state).toBe('pending');

    const agentId = randomUUID();
    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds)
       VALUES ($1,$2,'workflow-agent',ARRAY['workflow'],'idle',30)`,
      [agentId, tenantId],
    );

    const identity = {
      id: 'workflow-agent',
      tenantId,
      scope: 'agent' as const,
      ownerType: 'agent',
      ownerId: agentId,
      keyPrefix: 'workflow-agent',
    };

    await taskService.claimTask(identity, {
      agent_id: agentId,
      capabilities: ['workflow'],
      workflow_id: workflow.id as string,
    });
    await taskService.startTask(identity, specTask.id as string, { agent_id: agentId });
    await taskService.completeTask(identity, specTask.id as string, { output: { ok: true } });

    const refreshedWorkflow = await workflowService.getWorkflow(tenantId, workflow.id as string);
    const phaseMap = new Map(
      ((refreshedWorkflow.phases ?? []) as Array<Record<string, unknown>>).map((phase) => [
        String(phase.name),
        phase,
      ]),
    );

    expect(refreshedWorkflow.current_phase).toBe('deliver');
    expect(phaseMap.get('plan')?.status).toBe('completed');
    expect(phaseMap.get('deliver')?.status).toBe('active');

    const refreshedTasks = refreshedWorkflow.tasks as Array<Record<string, unknown>>;
    expect(refreshedTasks.find((task) => task.id === buildTask.id)?.state).toBe('ready');
    expect(refreshedTasks.find((task) => task.id === reviewTask.id)?.state).toBe('pending');
  });

  it('creates a new immutable template version on update and uses latest version for new workflows', async () => {
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

    const v1Reloaded = (await templateService.getTemplate(tenantId, templateV1.id as string)) as Record<string, unknown>;
    expect(v1Reloaded.version).toBe(1);
    expect(v1Reloaded.description).toBeNull();
    expect((v1Reloaded.schema as { tasks: Array<{ title_template: string }> }).tasks[0].title_template).toBe('Implement v1');

    const workflow = await workflowService.createWorkflow(adminIdentity, {
      template_id: templateV1.id as string,
      name: 'Workflow Uses Latest Template',
    });

    expect(workflow.template_id).toBe(templateV2.id);
    expect(workflow.template_version).toBe(2);

    const [task] = workflow.tasks as Array<Record<string, unknown>>;
    expect(task.title).toBe('Implement v2');
  });
});
