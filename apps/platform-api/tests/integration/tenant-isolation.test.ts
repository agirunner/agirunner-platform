import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiKey, verifyApiKey } from '../../src/auth/api-key.js';
import { EventService } from '../../src/services/event-service.js';
import { EventStreamService } from '../../src/services/event-stream-service.js';
import { TaskService } from '../../src/services/task-service.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

const tenantA = '00000000-0000-0000-0000-000000000001';
const tenantB = '00000000-0000-0000-0000-000000000002';

const config = {
  TASK_DEFAULT_TIMEOUT_MINUTES: 30,
  TASK_DEFAULT_AUTO_RETRY: false,
  TASK_DEFAULT_MAX_RETRIES: 0,
};

describe('tenant isolation bulk coverage', () => {
  let db: TestDatabase;
  let taskService: TaskService;
  let eventService: EventService;

  beforeAll(async () => {
    db = await startTestDatabase();
    await db.pool.query(`INSERT INTO tenants (id, name, slug, is_active) VALUES ($1,'Tenant B','tenant-b',true)`, [tenantB]);
    eventService = new EventService(db.pool);
    taskService = new TaskService(db.pool, eventService, config);
  });

  afterAll(async () => {
    await stopTestDatabase(db);
  });

  it('covers FR-149/FR-150/FR-151/FR-152 tenant-scoped writes and reads', async () => {
    const workerA = { id: 'w-a', tenantId: tenantA, scope: 'worker' as const, ownerType: 'worker', ownerId: null, keyPrefix: 'wa' };
    const workerB = { id: 'w-b', tenantId: tenantB, scope: 'worker' as const, ownerType: 'worker', ownerId: null, keyPrefix: 'wb' };

    const taskA = await taskService.createTask(workerA, { title: 'A', type: 'code' });
    await taskService.createTask(workerB, { title: 'B', type: 'code' });

    const listedA = await taskService.listTasks(tenantA, { page: 1, per_page: 50 });
    expect((listedA.data as Array<Record<string, unknown>>).map((task) => task.id)).toContain(taskA.id);
    expect((listedA.data as Array<Record<string, unknown>>).some((task) => task.title === 'B')).toBe(false);

    await expect(taskService.getTask(tenantA, randomUUID())).rejects.toMatchObject({ statusCode: 404 });
  });

  it('covers FR-153/FR-154 API keys remain tenant-scoped identities', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const adminA = await createApiKey(db.pool, { tenantId: tenantA, scope: 'admin', ownerType: 'user', expiresAt });
    const agentB = await createApiKey(db.pool, { tenantId: tenantB, scope: 'agent', ownerType: 'agent', ownerId: randomUUID(), expiresAt });

    const [adminIdentity, agentIdentity] = await Promise.all([verifyApiKey(db.pool, adminA.apiKey), verifyApiKey(db.pool, agentB.apiKey)]);
    expect(adminIdentity.tenantId).toBe(tenantA);
    expect(adminIdentity.scope).toBe('admin');
    expect(agentIdentity.tenantId).toBe(tenantB);
    expect(agentIdentity.scope).toBe('agent');
  });

  it('covers FR-155 event stream tenant isolation', async () => {
    const stream = new EventStreamService(db.pool);
    await stream.start();

    const seenA: string[] = [];
    const seenB: string[] = [];

    const unsubA = stream.subscribe(tenantA, {}, (event) => seenA.push(event.tenant_id));
    const unsubB = stream.subscribe(tenantB, {}, (event) => seenB.push(event.tenant_id));

    await eventService.emit({
      tenantId: tenantA,
      type: 'task.created',
      entityType: 'task',
      entityId: randomUUID(),
      actorType: 'system',
      actorId: 'a',
      data: {},
    });
    await eventService.emit({
      tenantId: tenantB,
      type: 'task.created',
      entityType: 'task',
      entityId: randomUUID(),
      actorType: 'system',
      actorId: 'b',
      data: {},
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(seenA.every((tenantId) => tenantId === tenantA)).toBe(true);
    expect(seenB.every((tenantId) => tenantId === tenantB)).toBe(true);

    unsubA();
    unsubB();
    await stream.stop();
  });

  it('covers FR-158/FR-159/FR-160 tenant deactivation blocks key auth', async () => {
    const key = await createApiKey(db.pool, {
      tenantId: tenantB,
      scope: 'admin',
      ownerType: 'user',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const activeIdentity = await verifyApiKey(db.pool, key.apiKey);
    expect(activeIdentity.tenantId).toBe(tenantB);

    await db.pool.query('UPDATE tenants SET is_active = false WHERE id = $1', [tenantB]);
    await expect(verifyApiKey(db.pool, key.apiKey)).rejects.toMatchObject({ statusCode: 401 });
  });
});
