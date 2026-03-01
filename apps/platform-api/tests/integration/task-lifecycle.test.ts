import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EventService } from '../../src/services/event-service.js';
import { TaskService } from '../../src/services/task-service.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

const tenantId = '00000000-0000-0000-0000-000000000001';

const config = {
  TASK_DEFAULT_TIMEOUT_MINUTES: 30,
  TASK_DEFAULT_AUTO_RETRY: false,
  TASK_DEFAULT_MAX_RETRIES: 0,
};

describe('task lifecycle bulk coverage', () => {
  let db: TestDatabase;
  let taskService: TaskService;

  const admin = { id: 'admin', tenantId, scope: 'admin' as const, ownerType: 'user', ownerId: null, keyPrefix: 'admin' };

  beforeAll(async () => {
    db = await startTestDatabase();
    taskService = new TaskService(db.pool, new EventService(db.pool), config);
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

  it('covers FR-012a/FR-025/FR-026 one claimed task per agent and priority FIFO matching', async () => {
    const agentId = randomUUID();
    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds)
       VALUES ($1,$2,'claim-agent',ARRAY['python'],'idle',30)`,
      [agentId, tenantId],
    );

    const capability = `python-${randomUUID()}`;
    const pipelineId = randomUUID();
    await db.pool.query(`INSERT INTO pipelines (id, tenant_id, name) VALUES ($1,$2,'claim-scope')`, [pipelineId, tenantId]);

    const low = await taskService.createTask(
      { ...admin, scope: 'worker', keyPrefix: 'worker-7' },
      { title: 'low', type: 'code', priority: 'low', capabilities_required: [capability], pipeline_id: pipelineId },
    );
    const high = await taskService.createTask(
      { ...admin, scope: 'worker', keyPrefix: 'worker-8' },
      { title: 'high', type: 'code', priority: 'high', capabilities_required: [capability], pipeline_id: pipelineId },
    );

    const identity = { id: 'agent-key', tenantId, scope: 'agent' as const, ownerType: 'agent', ownerId: agentId, keyPrefix: 'agent-3' };
    const first = await taskService.claimTask(identity, { agent_id: agentId, capabilities: [capability], pipeline_id: pipelineId });
    expect(first?.id).toBe(high.id);

    await expect(taskService.claimTask(identity, { agent_id: agentId, capabilities: [capability], pipeline_id: pipelineId })).rejects.toMatchObject({ statusCode: 409 });

    await taskService.startTask(identity, first!.id as string, { agent_id: agentId });
    await taskService.completeTask(identity, first!.id as string, { output: { ok: true } });

    const second = await taskService.claimTask(identity, { agent_id: agentId, capabilities: [capability], pipeline_id: pipelineId });
    expect(second?.id).toBe(low.id);
  });

  it('covers FR-019/FR-048 retry behavior and FR-SM-003/FR-SM-007 audit events emitted', async () => {
    const agentId = randomUUID();
    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds)
       VALUES ($1,$2,'retry-agent',ARRAY['go'],'idle',30)`,
      [agentId, tenantId],
    );

    const capability = `go-${randomUUID()}`;
    const pipelineId = randomUUID();
    await db.pool.query(`INSERT INTO pipelines (id, tenant_id, name) VALUES ($1,$2,'retry-scope')`, [pipelineId, tenantId]);

    const task = await taskService.createTask(
      { ...admin, scope: 'worker', keyPrefix: 'worker-9' },
      { title: 'retry', type: 'code', capabilities_required: [capability], auto_retry: true, max_retries: 2, pipeline_id: pipelineId },
    );

    const identity = { id: 'agent-key', tenantId, scope: 'agent' as const, ownerType: 'agent', ownerId: agentId, keyPrefix: 'agent-4' };
    await taskService.claimTask(identity, { agent_id: agentId, capabilities: [capability], pipeline_id: pipelineId });
    await taskService.startTask(identity, task.id as string, { agent_id: agentId });
    const retried = await taskService.failTask(identity, task.id as string, { error: { message: 'boom' } });
    expect(retried.state).toBe('ready');
    expect(retried.retry_count).toBe(1);

    const failed = await db.pool.query('SELECT type, data FROM events WHERE tenant_id = $1 AND entity_id = $2 ORDER BY created_at ASC', [tenantId, task.id]);
    expect(failed.rows.some((row) => row.type === 'task.state_changed')).toBe(true);
  });
});
