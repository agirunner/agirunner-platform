import type pg from 'pg';

import { DEFAULT_ADMIN_KEY_PREFIX, DEFAULT_TENANT_ID } from '../../db/seed.js';
import { PRESERVED_LLM_RUNTIME_DEFAULT_KEYS, REDESIGN_RESET_PRESERVED_TABLES } from './constants.js';

async function deleteNonLlmRuntimeDefaults(db: pg.Pool): Promise<void> {
  await db.query(
    `DELETE FROM runtime_defaults
      WHERE tenant_id = $1
        AND config_key <> ALL($2::text[])`,
    [DEFAULT_TENANT_ID, [...PRESERVED_LLM_RUNTIME_DEFAULT_KEYS]],
  );
}

export async function resetPlaybookRedesignState(pool: pg.Pool): Promise<void> {
  await pool.query(
    `DELETE FROM api_keys
      WHERE tenant_id = $1
        AND key_prefix <> $2`,
    [DEFAULT_TENANT_ID, DEFAULT_ADMIN_KEY_PREFIX],
  );

  const result = await pool.query<{ tablename: string }>(
    `SELECT tablename
       FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename ASC`,
  );

  const tablesToReset = result.rows
    .map((row: { tablename: string }) => row.tablename)
    .filter((tableName: string) => !REDESIGN_RESET_PRESERVED_TABLES.has(tableName));

  if (tablesToReset.length === 0) {
    await deleteNonLlmRuntimeDefaults(pool);
    return;
  }

  const qualifiedTables = tablesToReset
    .map((tableName: string) => `"public"."${tableName}"`)
    .join(', ');
  await pool.query(`TRUNCATE TABLE ${qualifiedTables} RESTART IDENTITY CASCADE`);
  await deleteNonLlmRuntimeDefaults(pool);
}
