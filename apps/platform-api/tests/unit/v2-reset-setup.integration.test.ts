import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BUILT_IN_PLAYBOOKS } from '../../src/catalogs/built-in-playbooks.js';
import { loadBuiltInRolesConfig } from '../../src/catalogs/built-in-roles.js';
import { runMigrations } from '../../src/db/migrations/run-migrations.js';
import { seedDefaultTenant } from '../../src/db/seed.js';
import { seedConfigTables } from '../../src/bootstrap/seed.js';
import {
  isContainerRuntimeAvailable,
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from '../helpers/postgres.js';

const DEFAULT_ADMIN_API_KEY = 'ar_admin_def_reset_suite_contract_key';
const canRunIntegration = isContainerRuntimeAvailable();

describe.runIf(canRunIntegration)('v2 reset/setup integration', () => {
  let db: TestDatabase | null = null;

  beforeAll(async () => {
    db = await startTestDatabase();
  });

  afterAll(async () => {
    if (db) {
      await stopTestDatabase(db);
    }
  });

  it('recreates the V2 schema and seeded state deterministically after a destructive reset', async () => {
    expect(db).not.toBeNull();
    const pool = db!.pool;

    await seedDefaultTenant(pool, { DEFAULT_ADMIN_API_KEY } as NodeJS.ProcessEnv);
    await seedConfigTables(pool);
    const initialSnapshot = await captureSeedSnapshot(pool);
    expect(initialSnapshot.migrations).not.toContain('0010_drop_templates.sql');

    await pool.query('DROP SCHEMA public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await pool.query('GRANT ALL ON SCHEMA public TO public');

    await runMigrations(pool, migrationsDirFromTest());
    await seedDefaultTenant(pool, { DEFAULT_ADMIN_API_KEY } as NodeJS.ProcessEnv);
    await seedConfigTables(pool);
    const rebuiltSnapshot = await captureSeedSnapshot(pool);
    expect(rebuiltSnapshot.migrations).not.toContain('0010_drop_templates.sql');

    expect(rebuiltSnapshot).toEqual(initialSnapshot);
  }, 120_000);
});

async function captureSeedSnapshot(pool: TestDatabase['pool']) {
  const [roles, playbooks, defaults, users, apiKeys, migrations, legacySchema] = await Promise.all([
    pool.query<{ name: string }>('SELECT name FROM role_definitions ORDER BY name ASC'),
    pool.query<{ slug: string; lifecycle: string; version: number }>(
      'SELECT slug, lifecycle, version FROM playbooks ORDER BY slug ASC',
    ),
    pool.query<{ config_key: string; config_value: string }>(
      'SELECT config_key, config_value FROM runtime_defaults ORDER BY config_key ASC',
    ),
    pool.query<{ email: string; role: string }>('SELECT email, role FROM users ORDER BY email ASC'),
    pool.query<{ key_prefix: string; scope: string; label: string; is_revoked: boolean }>(
      `SELECT key_prefix, scope, label, is_revoked
         FROM api_keys
        ORDER BY key_prefix ASC`,
    ),
    pool.query<{ filename: string }>('SELECT filename FROM schema_migrations ORDER BY filename ASC'),
    captureLegacySchemaState(pool),
  ]);

  return {
    role_names: roles.rows.map((row) => row.name),
    expected_role_names: Object.keys(loadBuiltInRolesConfig().roles).sort(),
    playbooks: playbooks.rows.map((row) => ({
      slug: row.slug,
      lifecycle: row.lifecycle,
      version: Number(row.version),
    })),
    expected_playbooks: BUILT_IN_PLAYBOOKS.map((playbook) => ({
      slug: playbook.slug,
      lifecycle: playbook.lifecycle,
      version: 1,
    })).sort((left, right) => left.slug.localeCompare(right.slug)),
    runtime_defaults: defaults.rows.map((row) => ({
      config_key: row.config_key,
      config_value: row.config_value,
    })),
    users: users.rows,
    api_keys: apiKeys.rows,
    migrations: migrations.rows.map((row) => row.filename),
    legacy_schema: legacySchema,
  };
}

async function captureLegacySchemaState(pool: TestDatabase['pool']) {
  const [
    templateTable,
    workflowTemplateColumns,
    runtimeTemplateColumn,
    fleetTemplateColumn,
    workflowPhaseColumn,
    templateEventEntity,
    webhookTaskTriggerTable,
    webhookTaskTriggerInvocationTable,
  ] =
    await Promise.all([
      pool.query<{ regclass: string | null }>(
        `SELECT to_regclass('public.templates')::text AS regclass`,
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'workflows'
            AND column_name IN ('template_id', 'template_version')`,
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'runtime_heartbeats'
            AND column_name = 'template_id'`,
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'fleet_events'
            AND column_name = 'template_id'`,
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'execution_logs'
            AND column_name = 'workflow_phase'`,
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM pg_type t
           JOIN pg_enum e
             ON e.enumtypid = t.oid
          WHERE t.typname = 'event_entity_type'
            AND e.enumlabel = 'template'`,
      ),
      pool.query<{ regclass: string | null }>(
        `SELECT to_regclass('public.webhook_task_triggers')::text AS regclass`,
      ),
      pool.query<{ regclass: string | null }>(
        `SELECT to_regclass('public.webhook_task_trigger_invocations')::text AS regclass`,
      ),
    ]);

  return {
    templates_table: templateTable.rows[0]?.regclass ?? null,
    workflows_template_columns: Number(workflowTemplateColumns.rows[0]?.count ?? '0'),
    runtime_heartbeats_template_column: Number(runtimeTemplateColumn.rows[0]?.count ?? '0'),
    fleet_events_template_column: Number(fleetTemplateColumn.rows[0]?.count ?? '0'),
    execution_logs_workflow_phase_column: Number(workflowPhaseColumn.rows[0]?.count ?? '0'),
    event_entity_type_template_value: Number(templateEventEntity.rows[0]?.count ?? '0'),
    webhook_task_triggers_table: webhookTaskTriggerTable.rows[0]?.regclass ?? null,
    webhook_task_trigger_invocations_table:
      webhookTaskTriggerInvocationTable.rows[0]?.regclass ?? null,
  };
}

function migrationsDirFromTest() {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.join(currentDir, '..', '..', 'src', 'db', 'migrations');
}
