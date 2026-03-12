import type { ApiKeyIdentity } from '../auth/api-key.js';
import {
  BUILT_IN_PLAYBOOKS,
  PROJECT_PLANNING_PLAYBOOK_SLUG,
} from '../catalogs/built-in-playbooks.js';
import type { DatabasePool } from '../db/database.js';
import { NotFoundError } from '../errors/domain-errors.js';
import { WorkflowService } from './workflow-service.js';

export class ProjectPlanningService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly workflowService: WorkflowService,
  ) {}

  async createPlanningWorkflow(
    identity: ApiKeyIdentity,
    projectId: string,
    payload: { brief: string; name?: string },
  ) {
    const projectResult = await this.pool.query(
      'SELECT * FROM projects WHERE tenant_id = $1 AND id = $2',
      [identity.tenantId, projectId],
    );
    if (!projectResult.rowCount) {
      throw new NotFoundError('Project not found');
    }

    const project = projectResult.rows[0] as Record<string, unknown>;
    const playbookId = await this.ensurePlanningPlaybook(identity.tenantId);

    await this.pool.query(
      `UPDATE projects
          SET settings = settings || $3::jsonb,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [
        identity.tenantId,
        projectId,
        {
          project_brief: payload.brief,
          project_brief_updated_at: new Date().toISOString(),
        },
      ],
    );

    return this.workflowService.createWorkflow(identity, {
      playbook_id: playbookId,
      project_id: projectId,
      name: payload.name ?? `Planning: ${String(project.name)}`,
      parameters: {
        project_name: String(project.name),
        project_brief: payload.brief,
        project_id: projectId,
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
      [tenantId, PROJECT_PLANNING_PLAYBOOK_SLUG],
    );
    if (existing.rowCount) {
      return String(existing.rows[0].id);
    }

    const builtIn = BUILT_IN_PLAYBOOKS.find(
      (playbook) => playbook.slug === PROJECT_PLANNING_PLAYBOOK_SLUG,
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
