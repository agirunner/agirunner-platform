import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabasePool } from '../../db/database.js';
import { NotFoundError } from '../../errors/domain-errors.js';
import { WorkflowService } from '../workflow-service/workflow-service.js';

export class WorkspacePlanningService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly workflowService: WorkflowService,
  ) {}

  async createPlanningWorkflow(
    identity: ApiKeyIdentity,
    workspaceId: string,
    payload: { brief: string; name?: string },
  ) {
    const workspaceResult = await this.pool.query(
      'SELECT * FROM workspaces WHERE tenant_id = $1 AND id = $2',
      [identity.tenantId, workspaceId],
    );
    if (!workspaceResult.rowCount) {
      throw new NotFoundError('Workspace not found');
    }

    const workspace = workspaceResult.rows[0] as Record<string, unknown>;
    const playbookId = await this.loadConfiguredPlanningPlaybookId(identity.tenantId, workspace);

    await this.pool.query(
      `UPDATE workspaces
          SET settings = settings || $3::jsonb,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [
        identity.tenantId,
        workspaceId,
        {
          workspace_brief: payload.brief,
          workspace_brief_updated_at: new Date().toISOString(),
        },
      ],
    );

    return this.workflowService.createWorkflow(identity, {
      playbook_id: playbookId,
      workspace_id: workspaceId,
      name: payload.name ?? `Planning: ${String(workspace.name)}`,
      parameters: {
        workspace_name: String(workspace.name),
        workspace_brief: payload.brief,
        workspace_id: workspaceId,
      },
      metadata: {
        planning_workflow: true,
      },
    });
  }

  private async loadConfiguredPlanningPlaybookId(
    tenantId: string,
    workspace: Record<string, unknown>,
  ): Promise<string> {
    const workspaceSettings = asRecord(workspace.settings);
    const configuredPlaybookId = readString(workspaceSettings.planning_playbook_id);
    if (!configuredPlaybookId) {
      throw new NotFoundError('Workspace planning playbook is not configured');
    }

    const existing = await this.pool.query(
      `SELECT id
         FROM playbooks
        WHERE tenant_id = $1
          AND id = $2
          AND is_active = true
        LIMIT 1`,
      [tenantId, configuredPlaybookId],
    );
    if (existing.rowCount) {
      return String(existing.rows[0].id);
    }

    throw new NotFoundError(`Workspace planning playbook '${configuredPlaybookId}' was not found`);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
