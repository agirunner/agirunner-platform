import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from './schema/index.js';

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl });
}

export function createDb(pool: pg.Pool) {
  return drizzle(pool, { schema });
}

export type PlatformDb = ReturnType<typeof createDb>;
