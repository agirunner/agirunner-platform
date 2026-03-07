import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EventService } from '../../src/services/event-service.js';
import { WorkflowService } from '../../src/services/workflow-service.js';
import { TaskService } from '../../src/services/task-service.js';
import { TemplateService } from '../../src/services/template-service.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

const tenantId = '00000000-0000-0000-0000-000000000001';

const config = {
  TASK_DEFAULT_TIMEOUT_MINUTES: 30,
  TASK_MAX_SUBTASK_DEPTH: 3,
  TASK_MAX_SUBTASKS_PER_PARENT: 2,
  TASK_DEFAULT_AUTO_RETRY: false,
  TASK_DEFAULT_MAX_RETRIES: 0,
};

describe('task lifecycle bulk coverage', () => {
  let db: TestDatabase;
  let taskService: TaskService;
  let templateService: TemplateService;
  let workflowService: WorkflowService;

  const admin = { id: 'admin', tenantId, scope: 'admin' as const, ownerType: 'user', ownerId: null, keyPrefix: 'admin' };

  beforeAll(async () => {
    db = await startTestDatabase();
    const eventService = new EventService(db.pool);
    taskService = new TaskService(db.pool, eventService, config);
    templateService = new TemplateService(db.pool, eventService);
    workflowService = new WorkflowService(db.pool, eventService, config);
  });

  afterAll(async () => {
    await stopTestDatabase(db);
  });

  it('covers FR-001/FR-005/FR-006/FR-007/FR-SM-001/FR-SM-002 canonical transitions and invalid transition rejection', async () => {
    const agentId = randomUUID();
    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds)
       VALUES ($1,$2,'sm-agent',ARRAY['ts'],'idle',30)`,
      [agentId, tenantId],
    );

    const created = await taskService.createTask(
      { ...admin, scope: 'worker', keyPrefix: 'worker' },
      { title: 'lifecycle', type: 'code', capabilities_required: ['ts'] },
    );
    expect(created.state).toBe('ready');

    const claimed = await taskService.claimTask(
      { id: 'agent-key', tenantId, scope: 'agent', ownerType: 'agent', ownerId: agentId, keyPrefix: 'agent' },
      { agent_id: agentId, capabilities: ['ts'] },
    );
    expect(claimed?.state).toBe('claimed');

    const running = await taskService.startTask(
      { id: 'agent-key', tenantId, scope: 'agent', ownerType: 'agent', ownerId: agentId, keyPrefix: 'agent' },
      created.id as string,
      { agent_id: agentId },
    );
    expect(running.state).toBe('running');

    const completed = await taskService.completeTask(
      { id: 'agent-key', tenantId, scope: 'agent', ownerType: 'agent', ownerId: agentId, keyPrefix: 'agent' },
      created.id as string,
      { output: { done: true } },
    );
    expect(completed.state).toBe('completed');

    await expect(taskService.cancelTask(admin, created.id as string)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('covers FR-002/FR-003/FR-004/FR-013 dependency promotion and approval gate', async () => {
    const agentId = randomUUID();
    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds)
       VALUES ($1,$2,'dep-agent',ARRAY['ts'],'idle',30)`,
      [agentId, tenantId],
    );

    const upstream = await taskService.createTask(
      { ...admin, scope: 'worker', keyPrefix: 'worker-2' },
      { title: 'upstream', type: 'code', capabilities_required: ['ts'] },
    );
    const dependentReady = await taskService.createTask(
      { ...admin, scope: 'worker', keyPrefix: 'worker-3' },
      { title: 'dependent-ready', type: 'test', depends_on: [upstream.id as string] },
    );
    const dependentApproval = await taskService.createTask(
      { ...admin, scope: 'worker', keyPrefix: 'worker-4' },
      { title: 'dependent-approval', type: 'review', depends_on: [upstream.id as string], requires_approval: true },
    );

    expect(dependentReady.state).toBe('pending');
    expect(dependentApproval.state).toBe('pending');

    await taskService.claimTask(
      { id: 'agent-key', tenantId, scope: 'agent', ownerType: 'agent', ownerId: agentId, keyPrefix: 'agent-2' },
      { agent_id: agentId, capabilities: ['ts'] },
    );
    await taskService.startTask(
      { id: 'agent-key', tenantId, scope: 'agent', ownerType: 'agent', ownerId: agentId, keyPrefix: 'agent-2' },
      upstream.id as string,
      { agent_id: agentId },
    );
    await taskService.completeTask(
      { id: 'agent-key', tenantId, scope: 'agent', ownerType: 'agent', ownerId: agentId, keyPrefix: 'agent-2' },
      upstream.id as string,
      { output: { ok: true } },
    );

    const [readyReloaded, approvalReloaded] = (await Promise.all([
      taskService.getTask(tenantId, dependentReady.id as string),
      taskService.getTask(tenantId, dependentApproval.id as string),
    ])) as Array<Record<string, unknown>>;

    expect(readyReloaded.state).toBe('ready');
    expect(approvalReloaded.state).toBe('awaiting_approval');

    const approved = (await taskService.approveTask(admin, dependentApproval.id as string)) as Record<string, unknown>;
    expect(approved.state).toBe('ready');
  });

  it('covers FR-008/FR-009/FR-010/FR-205 task fields, json payloads, parent references and parent filtering', async () => {
    const payload = { nested: { values: [1, 2, 3], flag: true }, text: 'x'.repeat(1024) };
    const parent = await taskService.createTask(
      { ...admin, scope: 'worker', keyPrefix: 'worker-5' },
      { title: 'parent', type: 'code', input: payload },
    );
    const child = await taskService.createTask(
      { ...admin, scope: 'worker', keyPrefix: 'worker-6' },
      { title: 'child', type: 'test', parent_id: parent.id as string, input: payload },
    );

    expect(parent.id).toBeTypeOf('string');
    expect(parent.input).toEqual(payload);
    expect(child.parent_id).toBe(parent.id);

    const listed = await taskService.listTasks(tenantId, { page: 1, per_page: 10, parent_id: parent.id as string });
    expect((listed.data as Array<Record<string, unknown>>).map((row) => row.id)).toContain(child.id);
  });

  it('enforces configured sub-task depth and per-parent count limits', async () => {
    const root = await taskService.createTask(
      { ...admin, scope: 'worker', keyPrefix: 'worker-depth-1' },
      { title: 'root', type: 'code' },
    );
    const childA = await taskService.createTask(
      { ...admin, scope: 'worker', keyPrefix: 'worker-depth-2' },
      { title: 'child-a', type: 'code', parent_id: root.id as string },
    );
    await taskService.createTask(
      { ...admin, scope: 'worker', keyPrefix: 'worker-depth-3' },
      { title: 'child-b', type: 'code', parent_id: root.id as string },
    );

    await expect(
      taskService.createTask(
        { ...admin, scope: 'worker', keyPrefix: 'worker-depth-4' },
        { title: 'child-c', type: 'code', parent_id: root.id as string },
      ),
    ).rejects.toMatchObject({ statusCode: 400 });

    const grandchild = await taskService.createTask(
      { ...admin, scope: 'worker', keyPrefix: 'worker-depth-5' },
      { title: 'grandchild', type: 'code', parent_id: childA.id as string },
    );
    expect(grandchild.parent_id).toBe(childA.id);

    await expect(
      taskService.createTask(
        { ...admin, scope: 'worker', keyPrefix: 'worker-depth-6' },
        { title: 'great-grandchild', type: 'code', parent_id: grandchild.id as string },
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('allows delegated sub-task creation only when an active orchestrator grant exists', async () => {
    const ownerAgentId = randomUUID();
    const delegatedAgentId = randomUUID();
    const workflowId = randomUUID();
    const parentTaskId = randomUUID();

    await db.pool.query(
      `INSERT INTO workflows (id, tenant_id, name, state)
       VALUES ($1,$2,'grant-scope','active')`,
      [workflowId, tenantId],
    );
    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds)
       VALUES ($1,$2,'owner-agent',ARRAY['coordination'],'idle',30),
              ($3,$2,'delegated-agent',ARRAY['coordination'],'idle',30)`,
      [ownerAgentId, tenantId, delegatedAgentId],
    );
    await db.pool.query(
      `INSERT INTO tasks (id, tenant_id, workflow_id, title, type, state, assigned_agent_id)
       VALUES ($1,$2,$3,'parent','code','running',$4)`,
      [parentTaskId, tenantId, workflowId, ownerAgentId],
    );

    const delegatedIdentity = {
      id: 'delegated',
      tenantId,
      scope: 'agent' as const,
      ownerType: 'agent',
      ownerId: delegatedAgentId,
      keyPrefix: 'delegated',
    };

    await expect(
      taskService.createTask(delegatedIdentity, {
        title: 'child-without-grant',
        type: 'code',
        parent_id: parentTaskId,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });

    await db.pool.query(
      `INSERT INTO orchestrator_grants (tenant_id, agent_id, workflow_id, permissions)
       VALUES ($1,$2,$3,$4::text[])`,
      [tenantId, delegatedAgentId, workflowId, ['create_subtasks']],
    );

    const created = await taskService.createTask(delegatedIdentity, {
      title: 'child-with-grant',
      type: 'code',
      parent_id: parentTaskId,
    });

    expect(created.parent_id).toBe(parentTaskId);
    expect(created.workflow_id).toBe(workflowId);
  });

  it('covers FR-012a/FR-025/FR-026 one claimed task per agent and priority FIFO matching', async () => {
    const agentId = randomUUID();
    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds)
       VALUES ($1,$2,'claim-agent',ARRAY['python'],'idle',30)`,
      [agentId, tenantId],
    );

    const capability = `python-${randomUUID()}`;
    const workflowId = randomUUID();
    await db.pool.query(`INSERT INTO workflows (id, tenant_id, name) VALUES ($1,$2,'claim-scope')`, [workflowId, tenantId]);

    const low = await taskService.createTask(
      { ...admin, scope: 'worker', keyPrefix: 'worker-7' },
      { title: 'low', type: 'code', priority: 'low', capabilities_required: [capability], workflow_id: workflowId },
    );
    const high = await taskService.createTask(
      { ...admin, scope: 'worker', keyPrefix: 'worker-8' },
      { title: 'high', type: 'code', priority: 'high', capabilities_required: [capability], workflow_id: workflowId },
    );

    const identity = { id: 'agent-key', tenantId, scope: 'agent' as const, ownerType: 'agent', ownerId: agentId, keyPrefix: 'agent-3' };
    const first = await taskService.claimTask(identity, { agent_id: agentId, capabilities: [capability], workflow_id: workflowId });
    expect(first?.id).toBe(high.id);

    await expect(taskService.claimTask(identity, { agent_id: agentId, capabilities: [capability], workflow_id: workflowId })).rejects.toMatchObject({ statusCode: 409 });

    await taskService.startTask(identity, first!.id as string, { agent_id: agentId });
    await taskService.completeTask(identity, first!.id as string, { output: { ok: true } });

    const second = await taskService.claimTask(identity, { agent_id: agentId, capabilities: [capability], workflow_id: workflowId });
    expect(second?.id).toBe(low.id);
  });

  it('rejects worker-context claims when agent belongs to a different worker', async () => {
    const workerAId = randomUUID();
    const workerBId = randomUUID();
    const workerAAgentId = randomUUID();
    const workerBAgentId = randomUUID();
    const capability = `worker-claim-${randomUUID()}`;

    await db.pool.query(
      `INSERT INTO workers (id, tenant_id, name, capabilities, status)
       VALUES ($1, $2, 'worker-a', ARRAY[$3], 'online'),
              ($4, $2, 'worker-b', ARRAY[$3], 'online')`,
      [workerAId, tenantId, capability, workerBId],
    );

    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, worker_id, name, capabilities, status, heartbeat_interval_seconds)
       VALUES ($1,$2,$3,'worker-a-agent',ARRAY[$5],'idle',30),
              ($4,$2,$6,'worker-b-agent',ARRAY[$5],'idle',30)`,
      [workerAAgentId, tenantId, workerAId, workerBAgentId, capability, workerBId],
    );

    const task = await taskService.createTask(
      { ...admin, scope: 'worker', ownerId: workerAId, keyPrefix: 'worker-a-key' },
      { title: 'worker-agent-authz', type: 'code', capabilities_required: [capability] },
    );

    const workerIdentity = {
      id: 'worker-a-key',
      tenantId,
      scope: 'worker' as const,
      ownerType: 'worker',
      ownerId: workerAId,
      keyPrefix: 'worker-a-key',
    };

    await expect(
      taskService.claimTask(workerIdentity, {
        agent_id: workerBAgentId,
        worker_id: workerAId,
        capabilities: [capability],
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });

    const [taskState, workerAAgentState, workerBAgentState] = await Promise.all([
      db.pool.query('SELECT state, assigned_agent_id, assigned_worker_id FROM tasks WHERE tenant_id = $1 AND id = $2', [
        tenantId,
        task.id,
      ]),
      db.pool.query('SELECT status, current_task_id FROM agents WHERE tenant_id = $1 AND id = $2', [tenantId, workerAAgentId]),
      db.pool.query('SELECT status, current_task_id FROM agents WHERE tenant_id = $1 AND id = $2', [tenantId, workerBAgentId]),
    ]);

    expect(taskState.rows[0].state).toBe('ready');
    expect(taskState.rows[0].assigned_agent_id).toBeNull();
    expect(taskState.rows[0].assigned_worker_id).toBeNull();

    expect(workerAAgentState.rows[0].status).toBe('idle');
    expect(workerAAgentState.rows[0].current_task_id).toBeNull();
    expect(workerBAgentState.rows[0].status).toBe('idle');
    expect(workerBAgentState.rows[0].current_task_id).toBeNull();
  });

  it('covers FR-019/FR-048 retry behavior and FR-SM-003/FR-SM-007 audit events emitted', async () => {
    const agentId = randomUUID();
    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds)
       VALUES ($1,$2,'retry-agent',ARRAY['go'],'idle',30)`,
      [agentId, tenantId],
    );

    const capability = `go-${randomUUID()}`;
    const workflowId = randomUUID();
    await db.pool.query(`INSERT INTO workflows (id, tenant_id, name) VALUES ($1,$2,'retry-scope')`, [workflowId, tenantId]);

    const task = await taskService.createTask(
      { ...admin, scope: 'worker', keyPrefix: 'worker-9' },
      { title: 'retry', type: 'code', capabilities_required: [capability], auto_retry: true, max_retries: 2, workflow_id: workflowId },
    );

    const identity = { id: 'agent-key', tenantId, scope: 'agent' as const, ownerType: 'agent', ownerId: agentId, keyPrefix: 'agent-4' };
    await taskService.claimTask(identity, { agent_id: agentId, capabilities: [capability], workflow_id: workflowId });
    await taskService.startTask(identity, task.id as string, { agent_id: agentId });
    const retried = await taskService.failTask(identity, task.id as string, { error: { message: 'boom' } });
    expect(retried.state).toBe('ready');
    expect(retried.retry_count).toBe(1);

    const failed = await db.pool.query('SELECT type, data FROM events WHERE tenant_id = $1 AND entity_id = $2 ORDER BY created_at ASC', [tenantId, task.id]);
    expect(failed.rows.some((row) => row.type === 'task.state_changed')).toBe(true);
  });

  it('schedules policy-based retry with backoff and releases it on the next claim attempt', async () => {
    const agentId = randomUUID();
    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds)
       VALUES ($1,$2,'policy-retry-agent',ARRAY['ts'],'idle',30)`,
      [agentId, tenantId],
    );

    const capability = `ts-${randomUUID()}`;
    const workflowId = randomUUID();
    await db.pool.query(`INSERT INTO workflows (id, tenant_id, name) VALUES ($1,$2,'policy-retry-scope')`, [workflowId, tenantId]);

    const task = await taskService.createTask(
      { ...admin, scope: 'worker', keyPrefix: 'worker-10' },
      {
        title: 'policy retry',
        type: 'code',
        capabilities_required: [capability],
        workflow_id: workflowId,
        retry_policy: {
          max_attempts: 2,
          backoff_strategy: 'fixed',
          initial_backoff_seconds: 0,
          retryable_categories: ['timeout'],
        },
      },
    );

    const identity = { id: 'agent-key', tenantId, scope: 'agent' as const, ownerType: 'agent', ownerId: agentId, keyPrefix: 'agent-5' };
    await taskService.claimTask(identity, { agent_id: agentId, capabilities: [capability], workflow_id: workflowId });
    await taskService.startTask(identity, task.id as string, { agent_id: agentId });
    const retried = await taskService.failTask(identity, task.id as string, {
      error: { category: 'timeout', message: 'slow' },
    });
    expect(retried.state).toBe('pending');

    const released = await taskService.claimTask(identity, {
      agent_id: agentId,
      capabilities: [capability],
      workflow_id: workflowId,
      include_context: false,
    });
    expect(released?.id).toBe(task.id);

    const events = await db.pool.query(
      'SELECT type FROM events WHERE tenant_id = $1 AND entity_id = $2 ORDER BY created_at ASC',
      [tenantId, task.id],
    );
    expect(events.rows.some((row) => row.type === 'task.retry_scheduled')).toBe(true);
  });

  it('creates an inline escalation task and keeps the workflow non-terminal while escalation is pending', async () => {
    const agentId = randomUUID();
    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds)
       VALUES ($1,$2,'escalation-agent',ARRAY['go'],'idle',30)`,
      [agentId, tenantId],
    );

    const template = await templateService.createTemplate(admin, {
      name: 'inline-escalation-template',
      slug: `inline-escalation-${Date.now()}`,
      schema: {
        lifecycle: {
          escalation: {
            role: 'orchestrator',
            task_type: 'orchestration',
            title_template: 'Escalation: {{task_title}}',
          },
        },
        tasks: [{ id: 'compile', title_template: 'Compile', type: 'code', capabilities_required: ['go'] }],
      },
    });

    const workflow = await workflowService.createWorkflow(admin, {
      template_id: template.id as string,
      name: 'inline escalation workflow',
    });

    const [task] = workflow.tasks as Array<Record<string, unknown>>;
    const identity = { id: 'agent-key', tenantId, scope: 'agent' as const, ownerType: 'agent', ownerId: agentId, keyPrefix: 'agent-6' };
    await taskService.claimTask(identity, { agent_id: agentId, capabilities: ['go'], workflow_id: workflow.id as string });
    await taskService.startTask(identity, task.id as string, { agent_id: agentId });
    await taskService.failTask(identity, task.id as string, {
      error: { category: 'validation_error', message: 'bad input', recoverable: false },
    });

    const escalationTasks = await db.pool.query(
      `SELECT title, type, role, input, metadata
         FROM tasks
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND metadata->>'escalation_source_task_id' = $3`,
      [tenantId, workflow.id, task.id],
    );
    expect(escalationTasks.rowCount).toBe(1);
    expect(escalationTasks.rows[0].title).toBe('Escalation: Compile');
    expect(escalationTasks.rows[0].role).toBe('orchestrator');

    const workflowState = await db.pool.query(
      'SELECT state FROM workflows WHERE tenant_id = $1 AND id = $2',
      [tenantId, workflow.id],
    );
    expect(workflowState.rows[0].state).toBe('paused');
  });
});
