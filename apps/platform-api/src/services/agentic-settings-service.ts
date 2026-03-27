import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabaseQueryable } from '../db/database.js';
import { ConflictError } from '../errors/domain-errors.js';
import { resolveOperatorRecordActorId } from './operator-record-authorship.js';
import { sanitizeWorkflowLiveVisibilityMode } from './workflow-operator-record-sanitization.js';

interface AgenticSettingsRow {
  tenant_id: string;
  live_visibility_mode_default: 'standard' | 'enhanced';
  revision: number;
  updated_by_operator_id: string | null;
  updated_at: Date | null;
}

export interface AgenticSettingsRecord {
  live_visibility_mode_default: 'standard' | 'enhanced';
  scope: 'tenant';
  revision: number;
  updated_by_operator_id: string | null;
  updated_at: string | null;
}

export interface UpdateAgenticSettingsInput {
  liveVisibilityModeDefault: 'standard' | 'enhanced';
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
              revision = revision + 1,
              updated_by_operator_id = $2,
              updated_at = now()
        WHERE tenant_id = $3
      RETURNING tenant_id, live_visibility_mode_default, revision, updated_by_operator_id, updated_at`,
      [
        sanitizeWorkflowLiveVisibilityMode(input.liveVisibilityModeDefault),
        resolveOperatorRecordActorId(identity),
        identity.tenantId,
      ],
    );
    return toAgenticSettingsRecord(result.rows[0]);
  }

  private async readOrCreateSettingsRow(tenantId: string): Promise<AgenticSettingsRow> {
    const existing = await this.pool.query<AgenticSettingsRow>(
      `SELECT tenant_id, live_visibility_mode_default, revision, updated_by_operator_id, updated_at
         FROM agentic_settings
        WHERE tenant_id = $1`,
      [tenantId],
    );
    if (existing.rowCount) {
      return existing.rows[0];
    }

    const inserted = await this.pool.query<AgenticSettingsRow>(
      `INSERT INTO agentic_settings
         (tenant_id, live_visibility_mode_default, revision, updated_by_operator_id, updated_at)
       VALUES ($1, 'enhanced', 0, NULL, NULL)
       ON CONFLICT (tenant_id) DO UPDATE
         SET tenant_id = EXCLUDED.tenant_id
      RETURNING tenant_id, live_visibility_mode_default, revision, updated_by_operator_id, updated_at`,
      [tenantId],
    );
    return inserted.rows[0];
  }
}

function toAgenticSettingsRecord(row: AgenticSettingsRow): AgenticSettingsRecord {
  return {
    live_visibility_mode_default: row.live_visibility_mode_default,
    scope: 'tenant',
    revision: row.revision,
    updated_by_operator_id: row.updated_by_operator_id,
    updated_at: row.updated_at?.toISOString() ?? null,
  };
}
