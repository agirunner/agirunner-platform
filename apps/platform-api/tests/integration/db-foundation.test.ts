import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

describe('db foundation', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase(db);
  });

  it('connects and applies baseline migrations', async () => {
    const enumCheck = await db.pool.query("SELECT COUNT(*)::int AS count FROM pg_type WHERE typname = 'task_state'");
    expect(enumCheck.rows[0].count).toBe(1);

    const tableCheck = await db.pool.query("SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_name = 'tasks'");
    expect(tableCheck.rows[0].count).toBe(1);
  });

  it('seeds the default tenant', async () => {
    const result = await db.pool.query("SELECT slug FROM tenants WHERE id = '00000000-0000-0000-0000-000000000001'");
    expect(result.rows[0].slug).toBe('default');
  });
});
