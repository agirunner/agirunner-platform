import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

import { runMigrations } from '../../../src/db/migrations/run-migrations.js';
import { seedDefaultTenant } from '../../../src/db/seed.js';

export interface TestDatabase {
  container: StartedPostgreSqlContainer;
  pool: pg.Pool;
  databaseUrl: string;
}

export function isContainerRuntimeAvailable(): boolean {
  return [
    '/var/run/docker.sock',
    `${process.env.XDG_RUNTIME_DIR ?? ''}/docker.sock`,
    '/run/containerd/containerd.sock',
  ].some((candidate) => candidate.trim().length > 0 && fs.existsSync(candidate));
}

export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const databaseUrl = container.getConnectionUri();
  const pool = new pg.Pool({ connectionString: databaseUrl });

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.join(currentDir, '..', '..', '..', 'src', 'db', 'migrations');
  await runMigrations(pool, migrationsDir);
  await seedDefaultTenant(pool);

  return { container, pool, databaseUrl };
}

export async function stopTestDatabase(db: TestDatabase): Promise<void> {
  await db.pool.end();
  await db.container.stop();
}
