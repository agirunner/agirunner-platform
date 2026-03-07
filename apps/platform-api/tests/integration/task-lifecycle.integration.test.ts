import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AgentService } from '../../src/services/agent-service.js';
import { EventService } from '../../src/services/event-service.js';
import { WorkflowService } from '../../src/services/workflow-service.js';
import { TaskService } from '../../src/services/task-service.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

const tenantId = '00000000-0000-0000-0000-000000000001';

const testConfig = {
  AGENT_HEARTBEAT_GRACE_PERIOD_MS: 300000,
  AGENT_DEFAULT_HEARTBEAT_INTERVAL_SECONDS: 60,
  AGENT_KEY_EXPIRY_MS: 31536000000,
  AGENT_HEARTBEAT_TOLERANCE_MS: 2000,
  TASK_DEFAULT_TIMEOUT_MINUTES: 30,
  TASK_DEFAULT_AUTO_RETRY: false,
  TASK_DEFAULT_MAX_RETRIES: 0,
  TASK_CANCEL_SIGNAL_GRACE_PERIOD_MS: 60_000,
};

describe('task lifecycle integration', () => {
  let db: TestDatabase;
  let taskService: TaskService;
  let agentService: AgentService;
  let workflowService: WorkflowService;

  beforeAll(async () => {
    db = await startTestDatabase();
    const eventService = new EventService(db.pool);
    taskService = new TaskService(db.pool, eventService, testConfig);
    agentService = new AgentService(db.pool, eventService, testConfig);
    workflowService = new WorkflowService(db.pool, eventService, testConfig);
  });

  afterAll(async () => {
    await stopTestDatabase(db);
  });

  it('concurrent claim returns exactly one winner', async () => {
    const agentA = randomUUID();
    const agentB = randomUUID();

    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds)
       VALUES ($1,$3,'agent-a',ARRAY['typescript'],'idle',30), ($2,$3,'agent-b',ARRAY['typescript'],'idle',30)`,
      [agentA, agentB, tenantId],
    );

    const task = await db.pool.query(
      `INSERT INTO tasks (tenant_id, title, type, priority, state, capabilities_required)
       VALUES ($1, 'claim-me', 'code', 'high', 'ready', ARRAY['typescript'])
       RETURNING id`,
      [tenantId],
    );

    const identityA = { id: 'a', tenantId, scope: 'agent' as const, ownerType: 'agent', ownerId: agentA, keyPrefix: 'k1' };
    const identityB = { id: 'b', tenantId, scope: 'agent' as const, ownerType: 'agent', ownerId: agentB, keyPrefix: 'k2' };

    const [resA, resB] = await Promise.all([
      taskService.claimTask(identityA, { agent_id: agentA, capabilities: ['typescript'] }),
      taskService.claimTask(identityB, { agent_id: agentB, capabilities: ['typescript'] }),
    ]);

    const winners = [resA, resB].filter(Boolean);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.id).toBe(task.rows[0].id);
  });

  it('agent B cannot complete a task assigned to agent A', async () => {
    const agentA = randomUUID();
    const agentB = randomUUID();
    const taskId = randomUUID();

    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds, current_task_id)
       VALUES
       ($1,$3,'agent-owner',ARRAY['typescript'],'busy',30,$4),
       ($2,$3,'agent-intruder',ARRAY['typescript'],'active',30,NULL)`,
      [agentA, agentB, tenantId, taskId],
    );

    await db.pool.query(
      `INSERT INTO tasks (id, tenant_id, title, type, state, assigned_agent_id, started_at, claimed_at)
       VALUES ($1,$2,'secure-task','code','running',$3,now(),now())`,
      [taskId, tenantId, agentA],
    );

    await expect(
      taskService.completeTask(
        { id: 'intruder', tenantId, scope: 'agent', ownerType: 'agent', ownerId: agentB, keyPrefix: 'kb' },
        taskId,
        { output: { done: false } },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });

    const task = await db.pool.query('SELECT state FROM tasks WHERE tenant_id = $1 AND id = $2', [tenantId, taskId]);
    expect(task.rows[0].state).toBe('running');
  });

  it('completing a task unblocks dependent tasks', async () => {
    const agentId = randomUUID();
    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds)
       VALUES ($1,$2,'agent-dep',ARRAY['typescript'],'busy',30)`,
      [agentId, tenantId],
    );

    const a = await db.pool.query(
      `INSERT INTO tasks (tenant_id, title, type, state, assigned_agent_id)
       VALUES ($1,'A','code','running',$2)
       RETURNING id`,
      [tenantId, agentId],
    );

    const b = await db.pool.query(
      `INSERT INTO tasks (tenant_id, title, type, state, depends_on)
       VALUES ($1,'B','code','pending',ARRAY[$2]::uuid[])
       RETURNING id`,
      [tenantId, a.rows[0].id],
    );

    await db.pool.query('UPDATE agents SET current_task_id = $2 WHERE tenant_id = $1 AND id = $3', [tenantId, a.rows[0].id, agentId]);

    await taskService.completeTask(
      { id: 'sys', tenantId, scope: 'agent', ownerType: 'agent', ownerId: agentId, keyPrefix: 'k3' },
      a.rows[0].id,
      { output: { ok: true } },
    );

    const dependent = await db.pool.query('SELECT state FROM tasks WHERE tenant_id = $1 AND id = $2', [tenantId, b.rows[0].id]);
    expect(dependent.rows[0].state).toBe('ready');
  });

  it('dependency cascade A→B→C promotes readiness sequentially', async () => {
    const agentId = randomUUID();
    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds)
       VALUES ($1,$2,'agent-cascade',ARRAY['typescript'],'idle',30)`,
      [agentId, tenantId],
    );

    const taskA = await db.pool.query(
      `INSERT INTO tasks (tenant_id, title, type, state, capabilities_required)
       VALUES ($1,'A','code','ready',ARRAY['cascade'])
       RETURNING id`,
      [tenantId],
    );

    const taskB = await db.pool.query(
      `INSERT INTO tasks (tenant_id, title, type, state, depends_on, capabilities_required)
       VALUES ($1,'B','code','pending',ARRAY[$2]::uuid[],ARRAY['cascade'])
       RETURNING id`,
      [tenantId, taskA.rows[0].id],
    );

    const taskC = await db.pool.query(
      `INSERT INTO tasks (tenant_id, title, type, state, depends_on, capabilities_required)
       VALUES ($1,'C','code','pending',ARRAY[$2]::uuid[],ARRAY['cascade'])
       RETURNING id`,
      [tenantId, taskB.rows[0].id],
    );

    await db.pool.query(
      `UPDATE tasks
       SET state = 'running', assigned_agent_id = $3, claimed_at = now(), started_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, taskA.rows[0].id, agentId],
    );
    await db.pool.query('UPDATE agents SET current_task_id = $2, status = $3 WHERE tenant_id = $1 AND id = $4', [
      tenantId,
      taskA.rows[0].id,
      'busy',
      agentId,
    ]);

    await taskService.completeTask(
      { id: 'c3', tenantId, scope: 'agent', ownerType: 'agent', ownerId: agentId, keyPrefix: 'cc' },
      taskA.rows[0].id,
      { output: { stage: 'A-done' } },
    );

    const bAfterA = await db.pool.query('SELECT state FROM tasks WHERE tenant_id = $1 AND id = $2', [tenantId, taskB.rows[0].id]);
    const cAfterA = await db.pool.query('SELECT state FROM tasks WHERE tenant_id = $1 AND id = $2', [tenantId, taskC.rows[0].id]);
    expect(bAfterA.rows[0].state).toBe('ready');
    expect(cAfterA.rows[0].state).toBe('pending');

    await db.pool.query(
      `UPDATE tasks
       SET state = 'running', assigned_agent_id = $3, claimed_at = now(), started_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, taskB.rows[0].id, agentId],
    );
    await db.pool.query('UPDATE agents SET current_task_id = $2, status = $3 WHERE tenant_id = $1 AND id = $4', [
      tenantId,
      taskB.rows[0].id,
      'busy',
      agentId,
    ]);

    await taskService.completeTask(
      { id: 'c6', tenantId, scope: 'agent', ownerType: 'agent', ownerId: agentId, keyPrefix: 'cf' },
      taskB.rows[0].id,
      { output: { stage: 'B-done' } },
    );

    const cAfterB = await db.pool.query('SELECT state FROM tasks WHERE tenant_id = $1 AND id = $2', [tenantId, taskC.rows[0].id]);
    expect(cAfterB.rows[0].state).toBe('ready');
  });

  it('heartbeat timeout applies grace period before failing running tasks', async () => {
    const agentId = randomUUID();
    const taskId = randomUUID();
    const now = new Date();
    const lastHeartbeat = new Date(now.getTime() - 60_000);

    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds, last_heartbeat_at, current_task_id)
       VALUES ($1,$2,'agent-heartbeat',ARRAY['go'],'busy',10,$3,$4)`,
      [agentId, tenantId, lastHeartbeat, taskId],
    );

    await db.pool.query(
      `INSERT INTO tasks (id, tenant_id, title, type, state, assigned_agent_id, claimed_at)
       VALUES ($1,$2,'stale-task','code','claimed',$3,$4)`,
      [taskId, tenantId, agentId, new Date(now.getTime() - 60_000)],
    );

    await agentService.enforceHeartbeatTimeouts(now);

    const beforeGraceTask = await db.pool.query('SELECT state FROM tasks WHERE tenant_id = $1 AND id = $2', [tenantId, taskId]);
    expect(beforeGraceTask.rows[0].state).toBe('claimed');

    const afterGrace = new Date(lastHeartbeat.getTime() + 10 * 2_000 + 300_000 + 1_000);
    await agentService.enforceHeartbeatTimeouts(afterGrace);

    const [agent, task] = await Promise.all([
      db.pool.query('SELECT status, current_task_id FROM agents WHERE tenant_id = $1 AND id = $2', [tenantId, agentId]),
      db.pool.query('SELECT state, error FROM tasks WHERE tenant_id = $1 AND id = $2', [tenantId, taskId]),
    ]);

    expect(agent.rows[0].status).toBe('inactive');
    expect(agent.rows[0].current_task_id).toBeNull();
    expect(task.rows[0].state).toBe('failed');
    expect(task.rows[0].error.message).toContain('heartbeat timeout');
  });

  it('timeout monitor queues cancel signal first and force-fails after grace', async () => {
    const taskId = randomUUID();
    const agentId = randomUUID();
    const workerId = randomUUID();

    await db.pool.query(
      `INSERT INTO workers (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds)
       VALUES ($1,$2,'timeout-worker',ARRAY['python'],'busy',30)`,
      [workerId, tenantId],
    );

    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, worker_id, name, capabilities, status, heartbeat_interval_seconds, current_task_id)
       VALUES ($1,$2,$3,'agent-timeout',ARRAY['python'],'busy',30,$4)`,
      [agentId, tenantId, workerId, taskId],
    );

    await db.pool.query(
      `INSERT INTO tasks (
        id, tenant_id, title, type, state, assigned_agent_id, assigned_worker_id, started_at,
        timeout_minutes, auto_retry, max_retries, retry_count
      ) VALUES ($1,$2,'timeout-task','code','running',$3,$4,$5,1,true,2,0)`,
      [taskId, tenantId, agentId, workerId, new Date(Date.now() - 5 * 60_000)],
    );

    const firstPassTime = new Date();
    await taskService.failTimedOutTasks(firstPassTime);

    const [signal, taskAfterSignal] = await Promise.all([
      db.pool.query(
        `SELECT signal_type, task_id, delivered
         FROM worker_signals
         WHERE tenant_id = $1 AND worker_id = $2 AND task_id = $3`,
        [tenantId, workerId, taskId],
      ),
      db.pool.query('SELECT state, metadata FROM tasks WHERE tenant_id = $1 AND id = $2', [tenantId, taskId]),
    ]);

    expect(signal.rowCount).toBe(1);
    expect(signal.rows[0].signal_type).toBe('cancel_task');
    expect(taskAfterSignal.rows[0].state).toBe('running');
    expect(taskAfterSignal.rows[0].metadata.timeout_force_fail_at).toBeTruthy();

    await taskService.failTimedOutTasks(new Date(firstPassTime.getTime() + 61_000));

    const [failedTask, agent] = await Promise.all([
      db.pool.query('SELECT state, error, assigned_worker_id FROM tasks WHERE tenant_id = $1 AND id = $2', [tenantId, taskId]),
      db.pool.query('SELECT current_task_id FROM agents WHERE tenant_id = $1 AND id = $2', [tenantId, agentId]),
    ]);

    expect(failedTask.rows[0].state).toBe('failed');
    expect(failedTask.rows[0].error.message).toContain('timeout exceeded');
    expect(failedTask.rows[0].assigned_worker_id).toBeNull();
    expect(agent.rows[0].current_task_id).toBeNull();
  });

  it('cancel on running worker task queues cancel signal before terminal cancellation transition', async () => {
    const taskId = randomUUID();
    const agentId = randomUUID();
    const workerId = randomUUID();

    await db.pool.query(
      `INSERT INTO workers (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds)
       VALUES ($1,$2,'cancel-worker',ARRAY['typescript'],'busy',30)`,
      [workerId, tenantId],
    );

    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, worker_id, name, capabilities, status, heartbeat_interval_seconds, current_task_id)
       VALUES ($1,$2,$3,'cancel-agent',ARRAY['typescript'],'busy',30,$4)`,
      [agentId, tenantId, workerId, taskId],
    );

    await db.pool.query(
      `INSERT INTO tasks (id, tenant_id, title, type, state, assigned_agent_id, assigned_worker_id, started_at)
       VALUES ($1,$2,'cancel-me','code','running',$3,$4,now())`,
      [taskId, tenantId, agentId, workerId],
    );

    const adminIdentity = {
      id: 'admin',
      tenantId,
      scope: 'admin' as const,
      ownerType: 'user',
      ownerId: null,
      keyPrefix: 'admin',
    };

    const cancelResult = await taskService.cancelTask(adminIdentity, taskId);
    expect(cancelResult.state).toBe('cancelled');

    const [queuedSignal, taskAfterCancel] = await Promise.all([
      db.pool.query(
        `SELECT signal_type, delivered FROM worker_signals WHERE tenant_id = $1 AND worker_id = $2 AND task_id = $3`,
        [tenantId, workerId, taskId],
      ),
      db.pool.query('SELECT state, assigned_worker_id FROM tasks WHERE tenant_id = $1 AND id = $2', [tenantId, taskId]),
    ]);

    expect(queuedSignal.rowCount).toBe(1);
    expect(queuedSignal.rows[0].signal_type).toBe('cancel_task');
    expect(taskAfterCancel.rows[0].state).toBe('cancelled');
    expect(taskAfterCancel.rows[0].assigned_worker_id).toBeNull();
  });

  it('worker identity can start and complete task with rich payload fields', async () => {
    const taskId = randomUUID();
    const workerId = randomUUID();
    const agentId = randomUUID();

    await db.pool.query(
      `INSERT INTO workers (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds)
       VALUES ($1,$2,'worker-lifecycle',ARRAY['go'],'busy',30)`,
      [workerId, tenantId],
    );

    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, worker_id, name, capabilities, status, heartbeat_interval_seconds)
       VALUES ($1,$2,$3,'agent-lifecycle',ARRAY['go'],'busy',30)`,
      [agentId, tenantId, workerId],
    );

    await db.pool.query(
      `INSERT INTO tasks (id, tenant_id, title, type, state, assigned_agent_id, assigned_worker_id, claimed_at)
       VALUES ($1,$2,'worker-complete','code','claimed',$3,$4,now())`,
      [taskId, tenantId, agentId, workerId],
    );

    await db.pool.query('UPDATE workers SET current_task_id = $3 WHERE tenant_id = $1 AND id = $2', [
      tenantId,
      workerId,
      taskId,
    ]);
    await db.pool.query('UPDATE agents SET current_task_id = $3 WHERE tenant_id = $1 AND id = $2', [
      tenantId,
      agentId,
      taskId,
    ]);

    const workerIdentity = {
      id: 'worker-key',
      tenantId,
      scope: 'worker' as const,
      ownerType: 'worker',
      ownerId: workerId,
      keyPrefix: 'worker-key',
    };

    await taskService.startTask(workerIdentity, taskId, { agent_id: agentId });

    const completed = await taskService.completeTask(workerIdentity, taskId, {
      output: { ok: true },
      metrics: { duration_seconds: 12, verification_passed: true },
      git_info: { commit_hash: 'abc123' },
      verification: { passed: true, strategies_run: ['test_execution'] },
      agent_id: agentId,
    });

    expect(completed.state).toBe('completed');
    expect(completed.metrics).toMatchObject({ duration_seconds: 12 });
    expect(completed.git_info).toMatchObject({ commit_hash: 'abc123' });
    expect(completed.verification).toMatchObject({ passed: true });
  });

  it('invalid output schema transitions completion into output_pending_review', async () => {
    const taskId = randomUUID();
    const agentId = randomUUID();

    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds, current_task_id)
       VALUES ($1,$2,'schema-agent',ARRAY['typescript'],'busy',30,$3)`,
      [agentId, tenantId, taskId],
    );

    await db.pool.query(
      `INSERT INTO tasks (id, tenant_id, title, type, state, assigned_agent_id, started_at, role_config)
       VALUES ($1,$2,'schema-task','code','running',$3,now(),$4::jsonb)`,
      [
        taskId,
        tenantId,
        agentId,
        {
          output_schema: {
            type: 'object',
            required: ['summary'],
            properties: {
              summary: { type: 'string' },
            },
          },
        },
      ],
    );

    const result = await taskService.completeTask(
      { id: 'agent', tenantId, scope: 'agent', ownerType: 'agent', ownerId: agentId, keyPrefix: 'agent' },
      taskId,
      {
        output: { note: 'missing summary' },
        verification: { passed: true },
      },
    );

    expect(result.state).toBe('output_pending_review');

    const stored = await db.pool.query('SELECT output FROM tasks WHERE tenant_id = $1 AND id = $2', [tenantId, taskId]);
    expect(stored.rows[0].output).toMatchObject({ note: 'missing summary' });
  });

  it('registers workflow document outputs and injects them into downstream task context', async () => {
    const adminIdentity = {
      id: 'admin',
      tenantId,
      scope: 'admin' as const,
      ownerType: 'user',
      ownerId: null,
      keyPrefix: 'admin',
    };
    const project = await db.pool.query<{ id: string }>(
      `INSERT INTO projects (tenant_id, name, slug, current_spec_version)
       VALUES ($1,'docs-project','docs-project',1)
       RETURNING id`,
      [tenantId],
    );
    const projectId = project.rows[0].id;

    await db.pool.query(
      `INSERT INTO project_spec_versions (tenant_id, project_id, version, spec, created_by_type, created_by_id)
       VALUES ($1,$2,1,$3::jsonb,'admin','admin')`,
      [
        tenantId,
        projectId,
        JSON.stringify({
          documents: {
            design_brief: {
              source: 'repository',
              path: 'docs/design-brief.md',
            },
          },
        }),
      ],
    );

    const template = await db.pool.query<{ id: string }>(
      `INSERT INTO templates (tenant_id, name, slug, version, schema)
       VALUES ($1,'docs-template','docs-template',1,$2::jsonb)
       RETURNING id`,
      [
        tenantId,
        JSON.stringify({
          tasks: [
            { id: 'writer', title_template: 'Write docs', type: 'docs' },
            { id: 'reviewer', title_template: 'Review docs', type: 'review', depends_on: ['writer'] },
          ],
        }),
      ],
    );

    const workflow = await workflowService.createWorkflow(adminIdentity, {
      template_id: template.rows[0].id,
      project_id: projectId,
      name: 'docs-workflow',
    });

    const [writerTask, reviewerTask] = workflow.tasks as Array<Record<string, unknown>>;
    const agentId = randomUUID();
    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds, current_task_id)
       VALUES ($1,$2,'docs-agent',ARRAY['docs'],'busy',30,$3)`,
      [agentId, tenantId, writerTask.id],
    );
    await db.pool.query(
      `UPDATE tasks
          SET state = 'running',
              assigned_agent_id = $3,
              started_at = now(),
              claimed_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, writerTask.id, agentId],
    );

    await taskService.completeTask(
      {
        id: 'docs-agent-key',
        tenantId,
        scope: 'agent',
        ownerType: 'agent',
        ownerId: agentId,
        keyPrefix: 'da',
      },
      writerTask.id as string,
      {
        output: {
          summary: 'writer finished',
          documents: {
            implementation_notes: {
              source: 'repository',
              path: 'docs/implementation-notes.md',
              title: 'Implementation Notes',
            },
          },
        },
      },
    );

    const workflowDocuments = await db.pool.query(
      `SELECT logical_name, source, location
         FROM workflow_documents
        WHERE tenant_id = $1
          AND workflow_id = $2
        ORDER BY logical_name ASC`,
      [tenantId, workflow.id],
    );
    expect(workflowDocuments.rows).toEqual([
      {
        logical_name: 'implementation_notes',
        source: 'repository',
        location: 'docs/implementation-notes.md',
      },
    ]);

    const context = await taskService.getTaskContext(tenantId, reviewerTask.id as string, agentId);
    expect((context as Record<string, unknown>).documents).toEqual([
      expect.objectContaining({
        logical_name: 'design_brief',
        scope: 'project',
        source: 'repository',
        path: 'docs/design-brief.md',
      }),
      expect.objectContaining({
        logical_name: 'implementation_notes',
        scope: 'workflow',
        source: 'repository',
        path: 'docs/implementation-notes.md',
        title: 'Implementation Notes',
      }),
    ]);
  });
});
