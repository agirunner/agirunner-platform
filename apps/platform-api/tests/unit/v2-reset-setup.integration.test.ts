import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BUILT_IN_PLAYBOOKS } from '../../src/catalogs/built-in-playbooks.js';
import { loadBuiltInRolesConfig } from '../../src/catalogs/built-in-roles.js';
import { runMigrations } from '../../src/db/migrations/run-migrations.js';
import { seedDefaultTenant } from '../../src/db/seed.js';
import { seedConfigTables } from '../../src/bootstrap/seed.js';
import { resetPlaybookRedesignState } from '../../src/bootstrap/seed.js';
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

    const runtimeTimingDefaults = await pool.query<{ config_key: string; config_value: string }>(
      `SELECT config_key, config_value
         FROM runtime_defaults
        WHERE tenant_id = $1
          AND config_key IN (
            'api.events_heartbeat_seconds',
            'workspace.clone_max_retries',
            'workspace.clone_backoff_base_seconds',
            'workspace.snapshot_interval',
            'pool.refresh_interval_seconds',
            'container.max_reuse_age_seconds',
            'container.max_reuse_tasks'
          )
        ORDER BY config_key ASC`,
      ['00000000-0000-0000-0000-000000000001'],
    );
    expect(runtimeTimingDefaults.rows).toEqual([
      { config_key: 'api.events_heartbeat_seconds', config_value: '10' },
      { config_key: 'container.max_reuse_age_seconds', config_value: '1800' },
      { config_key: 'container.max_reuse_tasks', config_value: '10' },
      { config_key: 'pool.refresh_interval_seconds', config_value: '300' },
      { config_key: 'workspace.clone_backoff_base_seconds', config_value: '1' },
      { config_key: 'workspace.clone_max_retries', config_value: '3' },
      { config_key: 'workspace.snapshot_interval', config_value: '1' },
    ]);

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

  it('preserves admin key and explicit llm page defaults while rebuilding redesign-owned state', async () => {
    expect(db).not.toBeNull();
    const pool = db!.pool;

    await seedDefaultTenant(pool, { DEFAULT_ADMIN_API_KEY } as NodeJS.ProcessEnv);
    await seedConfigTables(pool);

    await pool.query(
      `INSERT INTO llm_providers (id, tenant_id, name, base_url, api_key_secret_ref, auth_mode, created_at, updated_at)
       VALUES ('10000000-0000-0000-0000-000000000001', $1, 'Test Provider', 'https://api.openai.com/v1', 'secret://test-provider', 'api_key', now(), now())`,
      ['00000000-0000-0000-0000-000000000001'],
    );
    await pool.query(
      `INSERT INTO llm_models (id, tenant_id, provider_id, model_id, created_at)
       VALUES ('20000000-0000-0000-0000-000000000001', $1, '10000000-0000-0000-0000-000000000001', 'gpt-test', now())`,
      ['00000000-0000-0000-0000-000000000001'],
    );
    await pool.query(
      `INSERT INTO role_model_assignments (id, tenant_id, role_name, primary_model_id, created_at, updated_at)
       VALUES ('30000000-0000-0000-0000-000000000001', $1, 'developer', '20000000-0000-0000-0000-000000000001', now(), now())`,
      ['00000000-0000-0000-0000-000000000001'],
    );
    await pool.query(
      `INSERT INTO runtime_defaults (tenant_id, config_key, config_value, config_type, description)
       VALUES
        ($1, 'default_model_id', '20000000-0000-0000-0000-000000000001', 'string', 'Configured on the LLM Providers page'),
        ($1, 'default_reasoning_config', $2, 'string', 'Configured on the LLM Providers page')`,
      ['00000000-0000-0000-0000-000000000001', JSON.stringify({ reasoning_effort: 'low' })],
    );
    await pool.query(
      `INSERT INTO workspaces (tenant_id, id, name, slug)
       VALUES ($1, '40000000-0000-0000-0000-000000000001', 'Reset Me', 'reset-me')`,
      ['00000000-0000-0000-0000-000000000001'],
    );

    await resetPlaybookRedesignState(pool);
    await seedDefaultTenant(pool, { DEFAULT_ADMIN_API_KEY } as NodeJS.ProcessEnv);
    await seedConfigTables(pool);

    const [
      providerCount,
      modelCount,
      assignmentCount,
      defaultRows,
      workspaceCount,
      playbookCount,
      promptCount,
      apiKeyCount,
      developerRole,
    ] = await Promise.all([
      pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM llm_providers'),
      pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM llm_models'),
      pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM role_model_assignments'),
      pool.query<{ config_key: string; config_value: string }>(
        `SELECT config_key, config_value
             FROM runtime_defaults
            WHERE config_key IN ('agent.max_iterations', 'default_model_id', 'default_reasoning_config')
            ORDER BY config_key ASC`,
      ),
      pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM workspaces'),
      pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM playbooks'),
      pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM platform_instructions'),
      pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM api_keys'),
      pool.query<{ escalation_target: string | null; max_escalation_depth: number }>(
        `SELECT escalation_target, max_escalation_depth
             FROM role_definitions
            WHERE tenant_id = $1
              AND name = 'developer'`,
        ['00000000-0000-0000-0000-000000000001'],
      ),
    ]);

    expect(Number(providerCount.rows[0]?.count ?? '0')).toBe(1);
    expect(Number(modelCount.rows[0]?.count ?? '0')).toBe(1);
    expect(Number(assignmentCount.rows[0]?.count ?? '0')).toBe(1);
    expect(defaultRows.rows).toEqual([
      { config_key: 'agent.max_iterations', config_value: '100' },
      { config_key: 'default_model_id', config_value: '20000000-0000-0000-0000-000000000001' },
      {
        config_key: 'default_reasoning_config',
        config_value: JSON.stringify({ reasoning_effort: 'low' }),
      },
    ]);
    expect(Number(workspaceCount.rows[0]?.count ?? '0')).toBe(0);
    expect(Number(playbookCount.rows[0]?.count ?? '0')).toBe(BUILT_IN_PLAYBOOKS.length);
    expect(Number(promptCount.rows[0]?.count ?? '0')).toBe(1);
    expect(Number(apiKeyCount.rows[0]?.count ?? '0')).toBeGreaterThan(0);
    expect(developerRole.rows).toEqual([{ escalation_target: 'human', max_escalation_depth: 5 }]);
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
    pool.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations ORDER BY filename ASC',
    ),
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
  ] = await Promise.all([
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
