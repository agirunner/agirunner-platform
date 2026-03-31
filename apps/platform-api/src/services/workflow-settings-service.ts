import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabaseQueryable } from '../db/database.js';
import { ConflictError, NotFoundError } from '../errors/domain-errors.js';
import { resolveOperatorRecordActorId } from './operator-record-authorship.js';
import { sanitizeOptionalWorkflowLiveVisibilityMode } from './workflow-operator/workflow-operator-record-sanitization.js';

interface WorkflowSettingsRow {
  id: string;
  live_visibility_mode_override: 'standard' | 'enhanced' | null;
  live_visibility_revision: number;
  live_visibility_updated_by_operator_id: string | null;
  live_visibility_updated_at: Date | null;
}

interface AgenticSettingsRow {
  live_visibility_mode_default: 'standard' | 'enhanced';
  revision: number;
}

export interface WorkflowSettingsRecord {
  workflow_id: string;
  effective_live_visibility_mode: 'standard' | 'enhanced';
  workflow_live_visibility_mode_override: 'standard' | 'enhanced' | null;
  source: 'agentic_settings' | 'workflow_override';
  revision: number;
  updated_by_operator_id: string | null;
  updated_at: string | null;
}

export interface UpdateWorkflowSettingsInput {
  liveVisibilityMode: 'standard' | 'enhanced' | null;
  settingsRevision: number;
}

export class WorkflowSettingsService {
  constructor(private readonly pool: DatabaseQueryable) {}

  async getWorkflowSettings(tenantId: string, workflowId: string): Promise<WorkflowSettingsRecord> {
    const workflow = await this.readWorkflow(tenantId, workflowId);
    const tenantSettings = await this.readOrCreateTenantSettings(tenantId);
    return toWorkflowSettingsRecord(workflow, tenantSettings);
  }

  async updateWorkflowSettings(
    identity: ApiKeyIdentity,
    workflowId: string,
    input: UpdateWorkflowSettingsInput,
  ): Promise<WorkflowSettingsRecord> {
    const workflow = await this.readWorkflow(identity.tenantId, workflowId);
    if (workflow.live_visibility_revision !== input.settingsRevision) {
      throw new ConflictError('Workflow settings revision is stale');
    }

    const updated = await this.pool.query<WorkflowSettingsRow>(
      `UPDATE workflows
          SET live_visibility_mode_override = $1,
              live_visibility_revision = live_visibility_revision + 1,
              live_visibility_updated_by_operator_id = $2,
              live_visibility_updated_at = now(),
              updated_at = now()
        WHERE tenant_id = $3
          AND id = $4
      RETURNING id, live_visibility_mode_override, live_visibility_revision, live_visibility_updated_by_operator_id, live_visibility_updated_at`,
      [
        sanitizeOptionalWorkflowLiveVisibilityMode(input.liveVisibilityMode),
        resolveOperatorRecordActorId(identity),
        identity.tenantId,
        workflowId,
      ],
    );
    const tenantSettings = await this.readOrCreateTenantSettings(identity.tenantId);
    return toWorkflowSettingsRecord(updated.rows[0], tenantSettings);
  }

  private async readWorkflow(tenantId: string, workflowId: string): Promise<WorkflowSettingsRow> {
    const result = await this.pool.query<WorkflowSettingsRow>(
      `SELECT id,
              live_visibility_mode_override,
              live_visibility_revision,
              live_visibility_updated_by_operator_id,
              live_visibility_updated_at
         FROM workflows
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, workflowId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Workflow not found');
    }
    return result.rows[0];
  }

  private async readOrCreateTenantSettings(tenantId: string): Promise<AgenticSettingsRow> {
    const existing = await this.pool.query<AgenticSettingsRow>(
      `SELECT live_visibility_mode_default, revision
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
      RETURNING live_visibility_mode_default, revision`,
      [tenantId],
    );
    return inserted.rows[0];
  }
}

function toWorkflowSettingsRecord(
  workflow: WorkflowSettingsRow,
  tenantSettings: AgenticSettingsRow,
): WorkflowSettingsRecord {
  const override = workflow.live_visibility_mode_override;
  return {
    workflow_id: workflow.id,
    effective_live_visibility_mode: override ?? tenantSettings.live_visibility_mode_default,
    workflow_live_visibility_mode_override: override,
    source: override ? 'workflow_override' : 'agentic_settings',
    revision: workflow.live_visibility_revision,
    updated_by_operator_id: workflow.live_visibility_updated_by_operator_id,
    updated_at: workflow.live_visibility_updated_at?.toISOString() ?? null,
  };
}
