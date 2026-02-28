import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { NotFoundError } from '../errors/domain-errors.js';
import { validateTemplateSchema } from '../orchestration/pipeline-engine.js';
import { resolveTemplateVariables } from '../orchestration/template-variables.js';
import { buildTemplateTaskIdMap, insertTaskFromTemplate, loadTemplateOrThrow } from './pipeline-instantiation.js';
import type { CreatePipelineInput, PipelineServiceConfig } from './pipeline-service.types.js';
import { EventService } from './event-service.js';
import { PipelineStateService } from './pipeline-state-service.js';

interface PipelineCreationDeps {
  pool: DatabasePool;
  eventService: EventService;
  stateService: PipelineStateService;
  config: PipelineServiceConfig;
}

export class PipelineCreationService {
  constructor(private readonly deps: PipelineCreationDeps) {}

  async createPipeline(identity: ApiKeyIdentity, input: CreatePipelineInput) {
    const client = await this.deps.pool.connect();
    try {
      await client.query('BEGIN');

      const template = await loadTemplateOrThrow(identity.tenantId, input.template_id, client);
      const schema = validateTemplateSchema(template.schema as unknown);

      if (input.project_id) {
        const project = await client.query('SELECT id FROM projects WHERE tenant_id = $1 AND id = $2', [identity.tenantId, input.project_id]);
        if (!project.rowCount) throw new NotFoundError('Project not found');
      }

      const parameters = resolveTemplateVariables(schema.variables, input.parameters);
      const pipelineRes = await client.query(
        `INSERT INTO pipelines (tenant_id, project_id, template_id, template_version, name, parameters, metadata, state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')
         RETURNING *`,
        [identity.tenantId, input.project_id ?? null, template.id, template.version, input.name, parameters, input.metadata ?? {}],
      );

      const pipeline = pipelineRes.rows[0];
      const taskIdMap = buildTemplateTaskIdMap(schema.tasks);
      const createdTasks: Record<string, unknown>[] = [];

      for (const task of schema.tasks) {
        const createdTask = await insertTaskFromTemplate({
          tenantId: identity.tenantId,
          pipelineId: pipeline.id as string,
          projectId: input.project_id,
          task,
          parameters,
          taskIdMap,
          client,
          config: this.deps.config,
        });
        createdTasks.push(createdTask);
        await this.deps.eventService.emit(
          {
            tenantId: identity.tenantId,
            type: 'task.created',
            entityType: 'task',
            entityId: createdTask.id as string,
            actorType: identity.scope,
            actorId: identity.keyPrefix,
            data: { pipeline_id: pipeline.id, role: createdTask.role, state: createdTask.state },
          },
          client,
        );
      }

      await this.deps.eventService.emit(
        {
          tenantId: identity.tenantId,
          type: 'pipeline.created',
          entityType: 'pipeline',
          entityId: pipeline.id as string,
          actorType: identity.scope,
          actorId: identity.keyPrefix,
          data: { template_id: template.id, template_version: template.version, task_count: createdTasks.length },
        },
        client,
      );

      const state = await this.deps.stateService.recomputePipelineState(identity.tenantId, pipeline.id as string, client, {
        actorType: identity.scope,
        actorId: identity.keyPrefix,
      });

      await client.query('COMMIT');
      return { ...pipeline, state, tasks: createdTasks };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
