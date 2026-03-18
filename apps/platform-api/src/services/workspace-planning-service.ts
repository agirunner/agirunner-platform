import type { ApiKeyIdentity } from '../auth/api-key.js';
import {
  BUILT_IN_PLAYBOOKS,
  WORKSPACE_PLANNING_PLAYBOOK_SLUG,
} from '../catalogs/built-in-playbooks.js';
import type { DatabasePool } from '../db/database.js';
import { NotFoundError } from '../errors/domain-errors.js';
import { WorkflowService } from './workflow-service.js';

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
    const playbookId = await this.ensurePlanningPlaybook(identity.tenantId);

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

  private async ensurePlanningPlaybook(tenantId: string): Promise<string> {
    const existing = await this.pool.query(
      `SELECT id
         FROM playbooks
        WHERE tenant_id = $1
          AND slug = $2
          AND is_active = true
        ORDER BY version DESC, created_at DESC
        LIMIT 1`,
      [tenantId, WORKSPACE_PLANNING_PLAYBOOK_SLUG],
    );
    if (existing.rowCount) {
      return String(existing.rows[0].id);
    }

    const builtIn = BUILT_IN_PLAYBOOKS.find(
      (playbook) => playbook.slug === WORKSPACE_PLANNING_PLAYBOOK_SLUG,
    );
    if (!builtIn) {
      throw new NotFoundError('Built-in planning playbook is not configured');
    }

    const created = await this.pool.query(
      `INSERT INTO playbooks (
         tenant_id, name, slug, description, outcome, lifecycle, version, definition, is_active
       ) VALUES (
         $1, $2, $3, $4, $5, $6, 1, $7, true
       )
       RETURNING id`,
      [
        tenantId,
        builtIn.name,
        builtIn.slug,
        builtIn.description,
        builtIn.outcome,
        builtIn.lifecycle,
        builtIn.definition,
      ],
    );

    return String(created.rows[0].id);
  }
}
