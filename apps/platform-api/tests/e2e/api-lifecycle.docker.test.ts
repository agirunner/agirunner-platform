import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';

import bcrypt from 'bcryptjs';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

const shouldRun = process.env.RUN_DOCKER_E2E === 'true';
const describeIf = shouldRun ? describe : describe.skip;

const workerKey = 'ab_worker_docker_compose_worker_key_1234567890';
const agentKey = 'ab_agent_docker_compose_agent_key_1234567890';
const tenantId = '00000000-0000-0000-0000-000000000001';

describeIf('docker-compose API lifecycle', () => {
  beforeAll(async () => {
    execSync('docker compose up -d postgres platform-api', { stdio: 'inherit' });

    const db = new Client({
      connectionString: process.env.DATABASE_URL ?? 'postgresql://agentbaton:agentbaton@localhost:5432/agentbaton',
    });

    await db.connect();
    await db.query('DELETE FROM api_keys');

    await db.query(
      `INSERT INTO api_keys (tenant_id, key_hash, key_prefix, scope, owner_type, owner_id, label, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '1 day')`,
      [tenantId, await bcrypt.hash(workerKey, 10), workerKey.slice(0, 12), 'worker', 'system', null, 'docker worker'],
    );

    await db.query(
      `INSERT INTO api_keys (tenant_id, key_hash, key_prefix, scope, owner_type, owner_id, label, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '1 day')`,
      [tenantId, await bcrypt.hash(agentKey, 10), agentKey.slice(0, 12), 'agent', 'system', null, 'docker agent'],
    );

    await db.end();
  }, 120000);

  afterAll(() => {
    execSync('docker compose down', { stdio: 'inherit' });
  });

  it('runs create -> claim -> complete lifecycle', async () => {
    const createdTask = await fetch('http://localhost:8080/api/v1/tasks', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${workerKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: `Lifecycle task ${randomUUID()}`,
        type: 'code',
      }),
    }).then((response) => response.json());

    expect(createdTask.data.id).toBeDefined();

    const registeredAgent = await fetch('http://localhost:8080/api/v1/agents/register', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${agentKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `E2E Agent ${randomUUID()}`,
        capabilities: [],
      }),
    }).then((response) => response.json());

    const agentId = String(registeredAgent.data.id);

    const claimed = await fetch('http://localhost:8080/api/v1/tasks/claim', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${agentKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        agent_id: agentId,
        capabilities: [],
      }),
    }).then((response) => response.json());

    expect(claimed.data.id).toBe(createdTask.data.id);

    await fetch(`http://localhost:8080/api/v1/tasks/${createdTask.data.id}/start`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${agentKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ agent_id: agentId }),
    });

    const completed = await fetch(`http://localhost:8080/api/v1/tasks/${createdTask.data.id}/complete`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${agentKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ output: { ok: true } }),
    }).then((response) => response.json());

    expect(completed.data.state).toBe('completed');
  }, 120000);
});
