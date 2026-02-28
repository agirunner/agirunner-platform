import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AgentService } from '../../src/services/agent-service.js';
import { EventService } from '../../src/services/event-service.js';
import { TaskService } from '../../src/services/task-service.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

const tenantId = '00000000-0000-0000-0000-000000000001';

describe('task lifecycle integration', () => {
  let db: TestDatabase;
  let taskService: TaskService;
  let agentService: AgentService;

  beforeAll(async () => {
    db = await startTestDatabase();
    const eventService = new EventService(db.pool);
    taskService = new TaskService(db.pool, eventService);
    agentService = new AgentService(db.pool, eventService);
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

  it('timed out task auto-retries when configured', async () => {
    const taskId = randomUUID();
    const agentId = randomUUID();
    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds)
       VALUES ($1,$2,'agent-timeout',ARRAY['python'],'busy',30)`,
      [agentId, tenantId],
    );

    await db.pool.query(
      `INSERT INTO tasks (
        id, tenant_id, title, type, state, assigned_agent_id, claimed_at,
        timeout_minutes, auto_retry, max_retries, retry_count
      ) VALUES ($1,$2,'timeout-task','code','claimed',$3,$4,1,true,2,0)`,
      [taskId, tenantId, agentId, new Date(Date.now() - 5 * 60_000)],
    );

    await db.pool.query('UPDATE agents SET current_task_id = $2 WHERE tenant_id = $1 AND id = $3', [tenantId, taskId, agentId]);

    await taskService.failTimedOutTasks(new Date());

    const task = await db.pool.query('SELECT state, retry_count FROM tasks WHERE tenant_id = $1 AND id = $2', [tenantId, taskId]);
    expect(task.rows[0].state).toBe('ready');
    expect(task.rows[0].retry_count).toBe(1);
  });
});
