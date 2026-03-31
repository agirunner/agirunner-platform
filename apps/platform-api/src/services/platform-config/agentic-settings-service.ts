import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseQueryable } from '../../db/database.js';
import { ConflictError, ValidationError } from '../../errors/domain-errors.js';
import { resolveOperatorRecordActorId } from '../operator-record-authorship.js';
import { sanitizeWorkflowLiveVisibilityMode } from '../workflow-operator/workflow-operator-record-sanitization.js';

const DEFAULT_ASSEMBLED_PROMPT_WARNING_THRESHOLD_CHARS = 32_000;

interface AgenticSettingsRow {
  tenant_id: string;
  live_visibility_mode_default: 'standard' | 'enhanced';
  assembled_prompt_warning_threshold_chars: number;
  revision: number;
  updated_by_operator_id: string | null;
  updated_at: Date | null;
}

export interface AgenticSettingsRecord {
  live_visibility_mode_default: 'standard' | 'enhanced';
  assembled_prompt_warning_threshold_chars: number;
  scope: 'tenant';
  revision: number;
  updated_by_operator_id: string | null;
  updated_at: string | null;
}

export interface UpdateAgenticSettingsInput {
  liveVisibilityModeDefault?: 'standard' | 'enhanced';
  assembledPromptWarningThresholdChars?: number;
  settingsRevision: number;
}

export class AgenticSettingsService {
  constructor(private readonly pool: DatabaseQueryable) {}

  async getSettings(tenantId: string): Promise<AgenticSettingsRecord> {
    const row = await this.readOrCreateSettingsRow(tenantId);
    return toAgenticSettingsRecord(row);
  }

  async updateSettings(
    identity: ApiKeyIdentity,
    input: UpdateAgenticSettingsInput,
  ): Promise<AgenticSettingsRecord> {
    const current = await this.readOrCreateSettingsRow(identity.tenantId);
    if (current.revision !== input.settingsRevision) {
      throw new ConflictError('Agentic settings revision is stale');
    }

    const result = await this.pool.query<AgenticSettingsRow>(
      `UPDATE agentic_settings
          SET live_visibility_mode_default = $1,
              assembled_prompt_warning_threshold_chars = $2,
              revision = revision + 1,
              updated_by_operator_id = $3,
              updated_at = now()
        WHERE tenant_id = $4
      RETURNING tenant_id, live_visibility_mode_default, assembled_prompt_warning_threshold_chars, revision, updated_by_operator_id, updated_at`,
      [
        input.liveVisibilityModeDefault === undefined
          ? current.live_visibility_mode_default
          : sanitizeWorkflowLiveVisibilityMode(input.liveVisibilityModeDefault),
        input.assembledPromptWarningThresholdChars === undefined
          ? current.assembled_prompt_warning_threshold_chars
          : sanitizeAssembledPromptWarningThreshold(input.assembledPromptWarningThresholdChars),
        resolveOperatorRecordActorId(identity),
        identity.tenantId,
      ],
    );
    return toAgenticSettingsRecord(result.rows[0]);
  }

  private async readOrCreateSettingsRow(tenantId: string): Promise<AgenticSettingsRow> {
    const existing = await this.pool.query<AgenticSettingsRow>(
      `SELECT tenant_id,
              live_visibility_mode_default,
              assembled_prompt_warning_threshold_chars,
              revision,
              updated_by_operator_id,
              updated_at
         FROM agentic_settings
        WHERE tenant_id = $1`,
      [tenantId],
    );
    if (existing.rowCount) {
      return existing.rows[0];
    }

    const inserted = await this.pool.query<AgenticSettingsRow>(
      `INSERT INTO agentic_settings
         (tenant_id, live_visibility_mode_default, assembled_prompt_warning_threshold_chars, revision, updated_by_operator_id, updated_at)
       VALUES ($1, 'enhanced', $2, 0, NULL, NULL)
       ON CONFLICT (tenant_id) DO UPDATE
         SET tenant_id = EXCLUDED.tenant_id
      RETURNING tenant_id, live_visibility_mode_default, assembled_prompt_warning_threshold_chars, revision, updated_by_operator_id, updated_at`,
      [tenantId, DEFAULT_ASSEMBLED_PROMPT_WARNING_THRESHOLD_CHARS],
    );
    return inserted.rows[0];
  }
}

function toAgenticSettingsRecord(row: AgenticSettingsRow): AgenticSettingsRecord {
  return {
    live_visibility_mode_default: row.live_visibility_mode_default,
    assembled_prompt_warning_threshold_chars: row.assembled_prompt_warning_threshold_chars,
    scope: 'tenant',
    revision: row.revision,
    updated_by_operator_id: row.updated_by_operator_id,
    updated_at: row.updated_at?.toISOString() ?? null,
  };
}

function sanitizeAssembledPromptWarningThreshold(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new ValidationError(
      'assembled_prompt_warning_threshold_chars must be a positive integer',
    );
  }
  return value;
}
