import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiKey } from '../../src/auth/api-key.js';
import { buildApp } from '../../src/bootstrap/app.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

const tenantId = '00000000-0000-0000-0000-000000000001';

describe('task git endpoint integration (FR-055)', () => {
  let db: TestDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let agentKey: string;

  beforeAll(async () => {
    db = await startTestDatabase();

    process.env.NODE_ENV = 'test';
    process.env.PORT = '8081';
    process.env.DATABASE_URL = db.databaseUrl;
    process.env.JWT_SECRET = 'x'.repeat(64);
    process.env.LOG_LEVEL = 'error';
    process.env.RATE_LIMIT_MAX_PER_MINUTE = '100';

    agentKey = (
      await createApiKey(db.pool, {
        tenantId,
        scope: 'agent',
        ownerType: 'agent',
        expiresAt: new Date(Date.now() + 86_400_000),
      })
    ).apiKey;

    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await stopTestDatabase(db);
  });

  it('returns git activity details for a task', async () => {
    const id = randomUUID();

    await db.pool.query(
      `INSERT INTO tasks (id, tenant_id, title, type, state, git_info)
       VALUES ($1,$2,'git-task','code','ready',$3::jsonb)`,
      [
        id,
        tenantId,
        JSON.stringify({
          linked_prs: [{ id: 42, provider: 'gitea' }],
          branches: ['feature/fr-055'],
          ci_status: { state: 'pending' },
          merge_history: [{ sha: 'abc123' }],
        }),
      ],
    );

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${id}/git`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        linked_prs: [{ id: 42, provider: 'gitea' }],
        branches: ['feature/fr-055'],
        ci_status: { state: 'pending' },
        merge_history: [{ sha: 'abc123' }],
        raw: {
          linked_prs: [{ id: 42, provider: 'gitea' }],
          branches: ['feature/fr-055'],
          ci_status: { state: 'pending' },
          merge_history: [{ sha: 'abc123' }],
        },
      },
    });
  });

  it('returns 404 when task is missing', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${randomUUID()}/git`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(response.statusCode).toBe(404);
  });
});
