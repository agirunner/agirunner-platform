import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedDefaultTenant } from '../../src/db/seed.js';
import { seedConfigTables } from '../../src/bootstrap/seed.js';
import {
  isContainerRuntimeAvailable,
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from '../helpers/postgres.js';

const DEFAULT_ADMIN_API_KEY = 'ar_admin_def_seed_llm_defaults_key';
const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';
const canRunIntegration = isContainerRuntimeAvailable();

describe.runIf(canRunIntegration)('seedConfigTables LLM defaults integration', () => {
  let db: TestDatabase | null = null;

  beforeAll(async () => {
    db = await startTestDatabase();
  });

  afterAll(async () => {
    if (db) {
      await stopTestDatabase(db);
    }
  });

  it('does not invent a system default when operators have not configured one', async () => {
    expect(db).not.toBeNull();
    const pool = db!.pool;

    await seedDefaultTenant(pool, { DEFAULT_ADMIN_API_KEY } as NodeJS.ProcessEnv);

    const apiKeyProviderId = randomUUID();
    const oauthProviderId = randomUUID();
    const gpt41ModelId = randomUUID();
    const apiKeyGpt54ModelId = randomUUID();
    const oauthGpt54ModelId = randomUUID();
    const gpt54ReasoningSchema = {
      type: 'reasoning_effort',
      options: ['none', 'low', 'medium', 'high', 'xhigh'],
      default: 'none',
    };

    await pool.query(
      `INSERT INTO llm_providers
        (id, tenant_id, name, base_url, api_key_secret_ref, auth_mode, is_enabled)
       VALUES
        ($1, $2, 'OpenAI', 'https://api.openai.com/v1', 'secret://openai', 'api_key', true),
        ($3, $2, 'OpenAI (Subscription)', 'https://chatgpt.com/backend-api', NULL, 'oauth', true)`,
      [apiKeyProviderId, DEFAULT_TENANT_ID, oauthProviderId],
    );
    await pool.query(
      `UPDATE llm_providers
          SET oauth_credentials = '{"access_token":"secret://oauth"}'::jsonb
        WHERE id = $1`,
      [oauthProviderId],
    );

    await pool.query(
      `INSERT INTO llm_models
        (id, tenant_id, provider_id, model_id, is_enabled, endpoint_type, reasoning_config)
       VALUES
        ($1, $4, $2, 'gpt-4.1', true, 'chat-completions', NULL),
        ($3, $4, $2, 'gpt-5.4', true, 'responses', $5::jsonb),
        ($6, $4, $7, 'gpt-5.4', true, 'responses', $5::jsonb)`,
      [
        gpt41ModelId,
        apiKeyProviderId,
        apiKeyGpt54ModelId,
        DEFAULT_TENANT_ID,
        JSON.stringify(gpt54ReasoningSchema),
        oauthGpt54ModelId,
        oauthProviderId,
      ],
    );

    await seedConfigTables(pool);

    const defaults = await pool.query<{ config_key: string; config_value: string }>(
      `SELECT config_key, config_value
         FROM runtime_defaults
        WHERE tenant_id = $1
          AND config_key IN ('default_model_id', 'default_reasoning_config')
        ORDER BY config_key ASC`,
      [DEFAULT_TENANT_ID],
    );

    expect(defaults.rows).toEqual([]);
  }, 120_000);

  it('seeds authoritative orchestrator, runtime, and execution container defaults', async () => {
    expect(db).not.toBeNull();
    const pool = db!.pool;

    await seedDefaultTenant(pool, { DEFAULT_ADMIN_API_KEY } as NodeJS.ProcessEnv);
    await seedConfigTables(pool);

    const defaults = await pool.query<{ config_key: string; config_value: string }>(
      `SELECT config_key, config_value
         FROM runtime_defaults
        WHERE tenant_id = $1
          AND config_key IN (
            'specialist_runtime_default_cpu',
            'specialist_runtime_default_memory',
            'specialist_execution_default_cpu',
            'specialist_execution_default_memory'
          )
        ORDER BY config_key ASC`,
      [DEFAULT_TENANT_ID],
    );

    expect(defaults.rows).toEqual([
      { config_key: 'specialist_execution_default_cpu', config_value: '2' },
      { config_key: 'specialist_execution_default_memory', config_value: '512m' },
      { config_key: 'specialist_runtime_default_cpu', config_value: '2' },
      { config_key: 'specialist_runtime_default_memory', config_value: '256m' },
    ]);

    const orchestrator = await pool.query<{ cpu_limit: string; memory_limit: string }>(
      `SELECT cpu_limit, memory_limit
         FROM worker_desired_state
        WHERE tenant_id = $1
          AND worker_name = 'orchestrator-primary'
        LIMIT 1`,
      [DEFAULT_TENANT_ID],
    );

    expect(orchestrator.rows).toEqual([{ cpu_limit: '2', memory_limit: '256m' }]);
  }, 120_000);
});
