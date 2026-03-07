import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { ConflictError, NotFoundError } from '../errors/domain-errors.js';
import { PipelineService } from './pipeline-service.js';
import { ProjectTimelineService } from './project-timeline-service.js';

export class PipelineChainingService {
  private readonly projectTimelineService: ProjectTimelineService;

  constructor(
    private readonly pool: DatabasePool,
    private readonly pipelineService: PipelineService,
  ) {
    this.projectTimelineService = new ProjectTimelineService(pool);
  }

  async chainPipelineFromSuggestedPlan(
    identity: ApiKeyIdentity,
    sourcePipelineId: string,
    payload: { name?: string },
  ) {
    const pipelineResult = await this.pool.query(
      'SELECT * FROM pipelines WHERE tenant_id = $1 AND id = $2',
      [identity.tenantId, sourcePipelineId],
    );
    if (!pipelineResult.rowCount) {
      throw new NotFoundError('Pipeline not found');
    }
    const sourcePipeline = pipelineResult.rows[0] as Record<string, unknown>;
    if (!sourcePipeline.project_id) {
      throw new ConflictError('Pipeline chaining requires a project-scoped pipeline');
    }

    const taskResult = await this.pool.query(
      `SELECT output
         FROM tasks
        WHERE tenant_id = $1
          AND pipeline_id = $2
          AND output IS NOT NULL
        ORDER BY completed_at DESC NULLS LAST, updated_at DESC
        LIMIT 1`,
      [identity.tenantId, sourcePipelineId],
    );
    const output = asRecord(taskResult.rows[0]?.output);
    const suggestedPlan = asRecord(output.suggested_plan);
    const templateRef = suggestedPlan.template;
    const parameters = asRecord(suggestedPlan.parameters);
    if (typeof templateRef !== 'string' || templateRef.trim().length === 0) {
      throw new ConflictError('Pipeline output does not include a suggested plan template');
    }

    const templateId = await this.resolveTemplateId(identity.tenantId, templateRef);
    const nextPipeline = await this.pipelineService.createPipeline(identity, {
      template_id: templateId,
      project_id: String(sourcePipeline.project_id),
      name: payload.name ?? `${String(sourcePipeline.name)} follow-up`,
      parameters,
      metadata: {
        chain_source_pipeline_id: sourcePipelineId,
        chain_origin: 'suggested_plan',
      },
    });

    const sourceMetadata = asRecord(sourcePipeline.metadata);
    const childPipelineIds = Array.isArray(sourceMetadata.child_pipeline_ids)
      ? [...(sourceMetadata.child_pipeline_ids as unknown[]), nextPipeline.id]
      : [nextPipeline.id];
    await this.pool.query(
      `UPDATE pipelines
          SET metadata = metadata || $3::jsonb,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [
        identity.tenantId,
        sourcePipelineId,
        {
          child_pipeline_ids: childPipelineIds,
          latest_chained_pipeline_id: nextPipeline.id,
        },
      ],
    );
    if (isTerminalPipelineState(sourcePipeline.state)) {
      await this.projectTimelineService.recordPipelineTerminalState(
        identity.tenantId,
        sourcePipelineId,
      );
    }

    return nextPipeline;
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

function isTerminalPipelineState(value: unknown) {
  return value === 'completed' || value === 'failed' || value === 'cancelled';
}
