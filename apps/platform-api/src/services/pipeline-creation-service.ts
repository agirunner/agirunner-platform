import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { NotFoundError } from '../errors/domain-errors.js';
import { validateTemplateSchema } from '../orchestration/pipeline-engine.js';
import { resolveTemplateVariables } from '../orchestration/template-variables.js';
import { deriveWorkflowView } from '../orchestration/workflow-model.js';
import { resolveInstructionConfig, resolvePipelineConfig } from './config-hierarchy-service.js';
import {
  buildStoredPipelineWorkflow,
  buildTemplateTaskIdMap,
  insertTaskFromTemplate,
  loadTemplateOrThrow,
} from './pipeline-instantiation.js';
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
      let projectSpecVersion: number | null = null;
      let projectSpec: Record<string, unknown> = {};

      if (input.project_id) {
        const project = await client.query<{ id: string; current_spec_version: number }>(
          'SELECT id, current_spec_version FROM projects WHERE tenant_id = $1 AND id = $2',
          [identity.tenantId, input.project_id],
        );
        if (!project.rowCount) throw new NotFoundError('Project not found');
        projectSpecVersion = project.rows[0].current_spec_version;

        if (projectSpecVersion > 0) {
          const specResult = await client.query<{ spec: Record<string, unknown> }>(
            `SELECT spec
               FROM project_spec_versions
              WHERE tenant_id = $1 AND project_id = $2 AND version = $3`,
            [identity.tenantId, input.project_id, projectSpecVersion],
          );
          projectSpec = (specResult.rows[0]?.spec ?? {}) as Record<string, unknown>;
        }
      }

      const parameters = resolveTemplateVariables(schema.variables, input.parameters);
      const templateSchema = template.schema as Record<string, unknown>;
      const resolvedConfig = resolvePipelineConfig(
        templateSchema,
        projectSpec,
        input.config_overrides ?? {},
      );
      const instructionConfig = resolveInstructionConfig(
        templateSchema,
        input.instruction_config,
      );
      const taskIdMap = buildTemplateTaskIdMap(schema.tasks);
      const storedWorkflow = buildStoredPipelineWorkflow(schema, taskIdMap);
      const pipelineMetadata = {
        ...(input.metadata ?? {}),
        workflow: storedWorkflow,
      };
      const pipelineRes = await client.query(
        `INSERT INTO pipelines (
            tenant_id, project_id, template_id, template_version, project_spec_version,
            name, parameters, metadata, resolved_config, config_layers, instruction_config, state
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending')
         RETURNING *`,
        [
          identity.tenantId,
          input.project_id ?? null,
          template.id,
          template.version,
          projectSpecVersion,
          input.name,
          parameters,
          pipelineMetadata,
          resolvedConfig.resolved,
          resolvedConfig.layers,
          instructionConfig,
        ],
      );

      const pipeline = pipelineRes.rows[0];
      const createdTasks: Record<string, unknown>[] = [];
      const dependencyMap = new Map(
        schema.tasks.map((task) => [task.id, [...(task.depends_on ?? [])]]),
      );

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
          pipelineLifecycle: schema.lifecycle,
          storedWorkflow,
          dependencyMap,
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
          data: {
            template_id: template.id,
            template_version: template.version,
            project_spec_version: projectSpecVersion,
            task_count: createdTasks.length,
          },
        },
        client,
      );

      const workflowView = deriveWorkflowView(storedWorkflow, createdTasks);
      const initialPhase = workflowView.current_phase ?? storedWorkflow.phases[0]?.name ?? null;
      if (initialPhase) {
        await this.deps.eventService.emit(
          {
            tenantId: identity.tenantId,
            type: 'phase.started',
            entityType: 'pipeline',
            entityId: pipeline.id as string,
            actorType: identity.scope,
            actorId: identity.keyPrefix,
            data: {
              pipeline_id: pipeline.id,
              phase_name: initialPhase,
              timestamp: new Date().toISOString(),
            },
          },
          client,
        );
      }

      const state = await this.deps.stateService.recomputePipelineState(identity.tenantId, pipeline.id as string, client, {
        actorType: identity.scope,
        actorId: identity.keyPrefix,
      });

      await client.query('COMMIT');
      return { ...pipeline, state, tasks: createdTasks, ...workflowView };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
