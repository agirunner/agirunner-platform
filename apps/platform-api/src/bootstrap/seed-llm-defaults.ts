import type { DatabaseQueryable } from '../db/database.js';
import { DEFAULT_TENANT_ID } from '../db/seed.js';
import { RuntimeDefaultsService } from '../services/runtime-defaults-service.js';

const DEFAULT_MODEL_KEY = 'default_model_id';
const DEFAULT_MODEL_DESCRIPTION =
  'Default LLM model used when no role-specific assignment is configured';
const DEFAULT_REASONING_KEY = 'default_reasoning_config';
const DEFAULT_REASONING_DESCRIPTION =
  'Default reasoning configuration used when no role-specific assignment is configured';
const MODEL_PREFERENCE = [
  'gpt-5.4',
  'gpt-5.3-codex',
  'gpt-5-codex-mini',
  'gpt-5',
  'gpt-5-mini',
] as const;

interface CandidateModelRow {
  model_id: string;
  model_external_id: string;
  provider_name: string;
  auth_mode: string;
  reasoning_config: Record<string, unknown> | null;
}

export async function seedDefaultModelAssignment(db: DatabaseQueryable): Promise<void> {
  const defaultsService = new RuntimeDefaultsService(db);
  const existing = await defaultsService.getByKey(DEFAULT_TENANT_ID, DEFAULT_MODEL_KEY);
  const currentModelId = existing?.config_value?.trim() ?? '';
  if (currentModelId && (await isUsableModel(db, currentModelId))) {
    return;
  }

  const candidate = await selectPreferredModel(db);
  if (!candidate) {
    return;
  }

  await defaultsService.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: DEFAULT_MODEL_KEY,
    configValue: candidate.model_id,
    configType: 'string',
    description: DEFAULT_MODEL_DESCRIPTION,
  });
  const seededReasoningConfig = buildSeedReasoningConfig(candidate.reasoning_config);
  if (seededReasoningConfig) {
    await defaultsService.upsertDefault(DEFAULT_TENANT_ID, {
      configKey: DEFAULT_REASONING_KEY,
      configValue: JSON.stringify(seededReasoningConfig),
      configType: 'string',
      description: DEFAULT_REASONING_DESCRIPTION,
    });
  } else {
    await db.query(
      `DELETE FROM runtime_defaults
        WHERE tenant_id = $1
          AND config_key = $2`,
      [DEFAULT_TENANT_ID, DEFAULT_REASONING_KEY],
    );
  }
  console.info(
    `[seed] Default model set to ${candidate.model_external_id} (${candidate.provider_name}, ${candidate.auth_mode}).`,
  );
}

async function isUsableModel(db: DatabaseQueryable, modelId: string): Promise<boolean> {
  const result = await db.query(
    `SELECT 1
       FROM llm_models m
       JOIN llm_providers p ON p.id = m.provider_id
      WHERE m.tenant_id = $1
        AND m.id = $2
        AND m.is_enabled = true
        AND p.is_enabled = true
        AND (p.api_key_secret_ref IS NOT NULL OR p.oauth_credentials IS NOT NULL)
      LIMIT 1`,
    [DEFAULT_TENANT_ID, modelId],
  );
  return (result.rowCount ?? 0) > 0;
}

async function selectPreferredModel(
  db: DatabaseQueryable,
): Promise<CandidateModelRow | null> {
  const result = await db.query<CandidateModelRow>(
    `SELECT
        m.id AS model_id,
        m.model_id AS model_external_id,
        p.name AS provider_name,
        p.auth_mode AS auth_mode,
        m.reasoning_config AS reasoning_config
       FROM llm_models m
       JOIN llm_providers p ON p.id = m.provider_id
      WHERE m.tenant_id = $1
        AND m.is_enabled = true
        AND p.is_enabled = true
        AND (p.api_key_secret_ref IS NOT NULL OR p.oauth_credentials IS NOT NULL)
      ORDER BY
        CASE m.model_id
          WHEN 'gpt-5.4' THEN 0
          WHEN 'gpt-5.3-codex' THEN 1
          WHEN 'gpt-5-codex-mini' THEN 2
          WHEN 'gpt-5' THEN 3
          WHEN 'gpt-5-mini' THEN 4
          ELSE 100
        END,
        CASE
          WHEN lower(p.name) = 'openai' AND p.auth_mode = 'api_key' AND p.api_key_secret_ref IS NOT NULL THEN 0
          WHEN p.auth_mode = 'api_key' AND p.api_key_secret_ref IS NOT NULL THEN 1
          WHEN p.auth_mode = 'oauth' AND p.oauth_credentials IS NOT NULL THEN 2
          ELSE 3
        END,
        p.name ASC,
        m.model_id ASC
      LIMIT 1`,
    [DEFAULT_TENANT_ID],
  );
  return result.rows[0] ?? null;
}

function buildSeedReasoningConfig(
  schema: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!schema) {
    return null;
  }
  const type = typeof schema.type === 'string' ? schema.type : '';
  if (!type) {
    return null;
  }
  const options = Array.isArray(schema.options)
    ? schema.options.filter((option): option is string => typeof option === 'string')
    : [];
  if (options.includes('medium')) {
    return { [type]: 'medium' };
  }
  if (schema.default !== undefined && schema.default !== null) {
    return { [type]: schema.default };
  }
  return null;
}

export function supportedSeedModelPreference(): readonly string[] {
  return MODEL_PREFERENCE;
}
