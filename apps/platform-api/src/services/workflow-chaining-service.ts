import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { ConflictError, NotFoundError } from '../errors/domain-errors.js';
import { WorkflowService } from './workflow-service.js';
import { ProjectTimelineService } from './project-timeline-service.js';

export class WorkflowChainingService {
  private readonly projectTimelineService: ProjectTimelineService;

  constructor(
    private readonly pool: DatabasePool,
    private readonly workflowService: WorkflowService,
  ) {
    this.projectTimelineService = new ProjectTimelineService(pool);
  }

  async chainWorkflowFromSuggestedPlan(
    identity: ApiKeyIdentity,
    sourceWorkflowId: string,
    payload: { name?: string },
  ) {
    const workflowResult = await this.pool.query(
      'SELECT * FROM workflows WHERE tenant_id = $1 AND id = $2',
      [identity.tenantId, sourceWorkflowId],
    );
    if (!workflowResult.rowCount) {
      throw new NotFoundError('Workflow not found');
    }
    const sourceWorkflow = workflowResult.rows[0] as Record<string, unknown>;
    if (!sourceWorkflow.project_id) {
      throw new ConflictError('Workflow chaining requires a project-scoped workflow');
    }

    const taskResult = await this.pool.query(
      `SELECT output
         FROM tasks
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND output IS NOT NULL
        ORDER BY completed_at DESC NULLS LAST, updated_at DESC
        LIMIT 1`,
      [identity.tenantId, sourceWorkflowId],
    );
    const output = asRecord(taskResult.rows[0]?.output);
    const suggestedPlan = asRecord(output.suggested_plan);
    const templateRef = suggestedPlan.template;
    const parameters = asRecord(suggestedPlan.parameters);
    if (typeof templateRef !== 'string' || templateRef.trim().length === 0) {
      throw new ConflictError('Workflow output does not include a suggested plan template');
    }

    const templateId = await this.resolveTemplateId(identity.tenantId, templateRef);
    const nextWorkflow = await this.workflowService.createWorkflow(identity, {
      template_id: templateId,
      project_id: String(sourceWorkflow.project_id),
      name: payload.name ?? `${String(sourceWorkflow.name)} follow-up`,
      parameters,
      metadata: {
        chain_source_workflow_id: sourceWorkflowId,
        chain_origin: 'suggested_plan',
      },
    });

    const sourceMetadata = asRecord(sourceWorkflow.metadata);
    const childWorkflowIds = Array.isArray(sourceMetadata.child_workflow_ids)
      ? [...(sourceMetadata.child_workflow_ids as unknown[]), nextWorkflow.id]
      : [nextWorkflow.id];
    await this.pool.query(
      `UPDATE workflows
          SET metadata = metadata || $3::jsonb,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [
        identity.tenantId,
        sourceWorkflowId,
        {
          child_workflow_ids: childWorkflowIds,
          latest_chained_workflow_id: nextWorkflow.id,
        },
      ],
    );
    if (isTerminalWorkflowState(sourceWorkflow.state)) {
      await this.projectTimelineService.recordWorkflowTerminalState(
        identity.tenantId,
        sourceWorkflowId,
      );
    }

    return nextWorkflow;
  }

  private async resolveTemplateId(tenantId: string, templateRef: string) {
    const byId = await this.pool.query(
      `SELECT id
         FROM templates
        WHERE tenant_id = $1
          AND id::text = $2
          AND deleted_at IS NULL
        LIMIT 1`,
      [tenantId, templateRef],
    );
    if (byId.rowCount) {
      return String(byId.rows[0].id);
    }

    const bySlug = await this.pool.query(
      `SELECT id
         FROM templates
        WHERE tenant_id = $1
          AND slug = $2
          AND deleted_at IS NULL
        ORDER BY version DESC, created_at DESC
        LIMIT 1`,
      [tenantId, templateRef],
    );
    if (!bySlug.rowCount) {
      throw new NotFoundError('Suggested plan template not found');
    }
    return String(bySlug.rows[0].id);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function isTerminalWorkflowState(value: unknown) {
  return value === 'completed' || value === 'failed' || value === 'cancelled';
}
