import type { DatabaseQueryable } from '../db/database.js';
import { DEFAULT_TENANT_ID } from '../db/seed.js';
import { RuntimeDefaultsService } from '../services/runtime-defaults-service.js';

const DEFAULT_MODEL_KEY = 'default_model_id';
const DEFAULT_MODEL_DESCRIPTION =
  'Default LLM model used when no role-specific assignment is configured';
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
  console.info(
    `[seed] Default model set to ${candidate.model_external_id} (${candidate.provider_name}).`,
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
    `SELECT m.id AS model_id, m.model_id AS model_external_id, p.name AS provider_name
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
          WHEN p.auth_mode = 'oauth' AND p.oauth_credentials IS NOT NULL THEN 0
          WHEN p.api_key_secret_ref IS NOT NULL THEN 1
          ELSE 2
        END,
        p.name ASC,
        m.model_id ASC
      LIMIT 1`,
    [DEFAULT_TENANT_ID],
  );
  return result.rows[0] ?? null;
}

export function supportedSeedModelPreference(): readonly string[] {
  return MODEL_PREFERENCE;
}
