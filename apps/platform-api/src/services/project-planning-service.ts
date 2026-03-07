import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { NotFoundError } from '../errors/domain-errors.js';
import { validateTemplateSchema } from '../orchestration/workflow-engine.js';
import { WorkflowService } from './workflow-service.js';

const PROJECT_PLANNING_TEMPLATE_SLUG = 'project-planning';

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
    const templateId = await this.ensurePlanningTemplate(identity.tenantId);

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
      template_id: templateId,
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

  private async ensurePlanningTemplate(tenantId: string): Promise<string> {
    const existing = await this.pool.query(
      `SELECT id
         FROM templates
        WHERE tenant_id = $1
          AND slug = $2
          AND is_built_in = true
          AND deleted_at IS NULL
        ORDER BY version DESC, created_at DESC
        LIMIT 1`,
      [tenantId, PROJECT_PLANNING_TEMPLATE_SLUG],
    );
    if (existing.rowCount) {
      return String(existing.rows[0].id);
    }

    const schema = validateTemplateSchema({
      variables: [
        { name: 'project_name', type: 'string', required: true },
        { name: 'project_brief', type: 'string', required: true },
        { name: 'project_id', type: 'string', required: true },
      ],
      tasks: [
        {
          id: 'plan_project',
          title_template: 'Plan {{project_name}}',
          type: 'orchestration',
          role: 'orchestrator',
          input_template: {
            project_id: '{{project_id}}',
            project_name: '{{project_name}}',
            project_brief: '{{project_brief}}',
          },
          metadata: {
            planning_task: true,
          },
        },
      ],
      workflow: {
        phases: [
          {
            name: 'planning',
            gate: 'manual',
            tasks: ['plan_project'],
          },
        ],
      },
    });

    const created = await this.pool.query(
      `INSERT INTO templates (
         tenant_id, name, slug, description, version, is_built_in, is_published, schema
       ) VALUES (
         $1, $2, $3, $4, 1, true, true, $5
       )
       RETURNING id`,
      [
        tenantId,
        'Project Planning',
        PROJECT_PLANNING_TEMPLATE_SLUG,
        'Built-in planning workflow template',
        schema,
      ],
    );

    return String(created.rows[0].id);
  }
}
