import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedConfigTables } from '../../src/bootstrap/seed.js';
import { DEFAULT_ADMIN_KEY_PREFIX, seedDefaultTenant } from '../../src/db/seed.js';
import { PlaybookRedesignResetService } from '../../src/services/redesign-reset-service.js';
import {
  isContainerRuntimeAvailable,
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from '../helpers/postgres.js';

const DEFAULT_ADMIN_API_KEY = 'ar_admin_def_playbook_redesign_reset_key';
const canRunIntegration = isContainerRuntimeAvailable();

describe.runIf(canRunIntegration)('resetPlaybookRedesignState', () => {
  let db: TestDatabase | null = null;

  beforeAll(async () => {
    db = await startTestDatabase();
  });

  afterAll(async () => {
    if (db) {
      await stopTestDatabase(db);
    }
  });

  it('preserves admin + model config while wiping and reseeding redesign state', async () => {
    expect(db).not.toBeNull();
    const pool = db!.pool;

    await seedDefaultTenant(pool, { DEFAULT_ADMIN_API_KEY } as NodeJS.ProcessEnv);
    await seedConfigTables(pool);

    const providerId = randomUUID();
    const modelId = randomUUID();
    const assignmentId = randomUUID();
    const customPlaybookId = randomUUID();
    const workflowId = randomUUID();
    const taskId = randomUUID();

    await pool.query(
      `INSERT INTO llm_providers (id, tenant_id, name, base_url, api_key_secret_ref)
       VALUES ($1, $2, 'OpenAI', 'https://api.openai.com/v1', 'secret://openai')`,
      [providerId, '00000000-0000-0000-0000-000000000001'],
    );
    await pool.query(
      `INSERT INTO llm_models (id, tenant_id, provider_id, model_id, context_window, max_output_tokens)
       VALUES ($1, $2, $3, 'gpt-5', 200000, 8192)`,
      [modelId, '00000000-0000-0000-0000-000000000001', providerId],
    );
    await pool.query(
      `INSERT INTO role_model_assignments (id, tenant_id, role_name, primary_model_id)
       VALUES ($1, $2, 'developer', $3)`,
      [assignmentId, '00000000-0000-0000-0000-000000000001', modelId],
    );
    await pool.query(
      `INSERT INTO api_keys (tenant_id, key_hash, key_lookup_hash, key_prefix, scope, owner_type, label, expires_at)
       VALUES ($1, 'hash', 'lookup', 'custom_key', 'admin', 'system', 'custom', NOW() + interval '1 day')`,
      ['00000000-0000-0000-0000-000000000001'],
    );
    await pool.query(
      `INSERT INTO playbooks (id, tenant_id, name, slug, outcome, lifecycle, version, definition, is_active)
       VALUES ($1, $2, 'Custom', 'custom-redesign-reset', 'Ship custom work', 'planned', 1, $3::jsonb, true)`,
      [
        customPlaybookId,
        '00000000-0000-0000-0000-000000000001',
        JSON.stringify({
          lifecycle: 'planned',
          process_instructions: 'Custom flow',
          board: { columns: [{ id: 'planned', label: 'Planned' }] },
          checkpoints: [],
        }),
      ],
    );
    await pool.query(
      `INSERT INTO workflows (id, tenant_id, playbook_id, playbook_version, name, state, lifecycle)
       VALUES ($1, $2, $3, 1, 'Custom workflow', 'active', 'planned')`,
      [workflowId, '00000000-0000-0000-0000-000000000001', customPlaybookId],
    );
    await pool.query(
      `INSERT INTO tasks (id, tenant_id, workflow_id, title, state)
       VALUES ($1, $2, $3, 'Custom task', 'pending')`,
      [taskId, '00000000-0000-0000-0000-000000000001', workflowId],
    );

    const service = new PlaybookRedesignResetService(pool as never);
    await service.reset({ DEFAULT_ADMIN_API_KEY } as NodeJS.ProcessEnv);

    const [
      apiKeys,
      providers,
      models,
      assignments,
      playbooks,
      workflows,
      tasks,
      prompts,
      roles,
    ] = await Promise.all([
      pool.query<{ key_prefix: string }>('SELECT key_prefix FROM api_keys ORDER BY key_prefix ASC'),
      pool.query<{ id: string }>('SELECT id FROM llm_providers ORDER BY id ASC'),
      pool.query<{ id: string }>('SELECT id FROM llm_models ORDER BY id ASC'),
      pool.query<{ id: string; role_name: string }>('SELECT id, role_name FROM role_model_assignments ORDER BY id ASC'),
      pool.query<{ slug: string }>('SELECT slug FROM playbooks ORDER BY slug ASC'),
      pool.query<{ id: string }>('SELECT id FROM workflows ORDER BY id ASC'),
      pool.query<{ id: string }>('SELECT id FROM tasks ORDER BY id ASC'),
      pool.query<{ content: string; prompt: string }>(
        `SELECT
            (SELECT content FROM platform_instructions WHERE tenant_id = $1) AS content,
            (SELECT prompt FROM orchestrator_config WHERE tenant_id = $1) AS prompt`,
        ['00000000-0000-0000-0000-000000000001'],
      ),
      pool.query<{ name: string }>('SELECT name FROM role_definitions ORDER BY name ASC'),
    ]);

    expect(apiKeys.rows).toEqual([{ key_prefix: DEFAULT_ADMIN_KEY_PREFIX }]);
    expect(providers.rows).toEqual([{ id: providerId }]);
    expect(models.rows).toEqual([{ id: modelId }]);
    expect(assignments.rows).toEqual([{ id: assignmentId, role_name: 'developer' }]);
    expect(playbooks.rows.some((row) => row.slug === 'custom-redesign-reset')).toBe(false);
    expect(workflows.rows).toHaveLength(0);
    expect(tasks.rows).toHaveLength(0);
    expect(prompts.rows[0]?.content?.length ?? 0).toBeGreaterThan(0);
    expect(prompts.rows[0]?.prompt?.length ?? 0).toBeGreaterThan(0);
    expect(roles.rows.length).toBeGreaterThan(0);
  }, 120_000);
});
