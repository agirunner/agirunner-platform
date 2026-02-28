import type { Pool } from 'pg';

import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { AppEnv } from '../config/schema.js';
import { ConflictError, NotFoundError } from '../errors/domain-errors.js';
import { validateTemplateSchema } from '../orchestration/pipeline-engine.js';
import { resolveTemplateVariables } from '../orchestration/template-variables.js';
import { EventService } from './event-service.js';
import { buildTemplateTaskIdMap, insertTaskFromTemplate, loadTemplateOrThrow } from './pipeline-instantiation.js';
import { PipelineStateService } from './pipeline-state-service.js';

interface CreatePipelineInput {
  template_id: string;
  project_id?: string;
  name: string;
  parameters?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

interface ListPipelineQuery {
  project_id?: string;
  state?: string;
  template_id?: string;
  page: number;
  per_page: number;
}

type PipelineServiceConfig = Pick<
  AppEnv,
  'TASK_DEFAULT_TIMEOUT_MINUTES' | 'TASK_DEFAULT_AUTO_RETRY' | 'TASK_DEFAULT_MAX_RETRIES'
>;

export class PipelineService {
  private readonly stateService: PipelineStateService;

  constructor(
    private readonly pool: Pool,
    private readonly eventService: EventService,
    private readonly config: PipelineServiceConfig,
  ) {
    this.stateService = new PipelineStateService(pool, eventService);
  }

  async createPipeline(identity: ApiKeyIdentity, input: CreatePipelineInput) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const template = await loadTemplateOrThrow(identity.tenantId, input.template_id, client);
      const schema = validateTemplateSchema(template.schema as unknown);

      if (input.project_id) {
        const project = await client.query('SELECT id FROM projects WHERE tenant_id = $1 AND id = $2', [identity.tenantId, input.project_id]);
        if (!project.rowCount) {
          throw new NotFoundError('Project not found');
        }
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

      const createdTasks = [] as Record<string, unknown>[];
      for (const task of schema.tasks) {
        const createdTask = await insertTaskFromTemplate({
          tenantId: identity.tenantId,
          pipelineId: pipeline.id as string,
          projectId: input.project_id,
          task,
          parameters,
          taskIdMap,
          client,
          config: this.config,
        });
        createdTasks.push(createdTask);

        await this.eventService.emit(
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

      await this.eventService.emit(
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
            task_count: createdTasks.length,
          },
        },
        client,
      );

      const state = await this.stateService.recomputePipelineState(identity.tenantId, pipeline.id as string, client, {
        actorType: identity.scope,
        actorId: identity.keyPrefix,
      });

      await client.query('COMMIT');

      return {
        ...pipeline,
        state,
        tasks: createdTasks,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listPipelines(tenantId: string, query: ListPipelineQuery) {
    const where: string[] = ['tenant_id = $1'];
    const values: unknown[] = [tenantId];

    if (query.project_id) {
      values.push(query.project_id);
      where.push(`project_id = $${values.length}`);
    }
    if (query.template_id) {
      values.push(query.template_id);
      where.push(`template_id = $${values.length}`);
    }
    if (query.state) {
      values.push(query.state.split(','));
      where.push(`state = ANY($${values.length}::pipeline_state[])`);
    }

    const whereClause = where.join(' AND ');
    const totalRes = await this.pool.query(`SELECT COUNT(*)::int AS total FROM pipelines WHERE ${whereClause}`, values);
    const offset = (query.page - 1) * query.per_page;

    values.push(query.per_page, offset);
    const dataRes = await this.pool.query(
      `SELECT * FROM pipelines
       WHERE ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );

    const total = Number(totalRes.rows[0].total);
    return {
      data: dataRes.rows,
      meta: {
        total,
        page: query.page,
        per_page: query.per_page,
        pages: Math.ceil(total / query.per_page) || 1,
      },
    };
  }

  async getPipeline(tenantId: string, pipelineId: string) {
    const [pipelineRes, tasksRes] = await Promise.all([
      this.pool.query('SELECT * FROM pipelines WHERE tenant_id = $1 AND id = $2', [tenantId, pipelineId]),
      this.pool.query('SELECT * FROM tasks WHERE tenant_id = $1 AND pipeline_id = $2 ORDER BY created_at ASC', [tenantId, pipelineId]),
    ]);

    if (!pipelineRes.rowCount) {
      throw new NotFoundError('Pipeline not found');
    }

    return {
      ...pipelineRes.rows[0],
      tasks: tasksRes.rows,
    };
  }

  async cancelPipeline(identity: ApiKeyIdentity, pipelineId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const pipelineRes = await client.query('SELECT * FROM pipelines WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [
        identity.tenantId,
        pipelineId,
      ]);

      if (!pipelineRes.rowCount) {
        throw new NotFoundError('Pipeline not found');
      }

      const pipeline = pipelineRes.rows[0];
      if (pipeline.state === 'completed' || pipeline.state === 'failed' || pipeline.state === 'cancelled') {
        throw new ConflictError('Pipeline is already terminal');
      }

      const cancellableStates = ['pending', 'ready', 'claimed', 'running', 'awaiting_approval', 'output_pending_review', 'failed'];
      const updatedTasks = await client.query(
        `UPDATE tasks
         SET state = 'cancelled',
             state_changed_at = now(),
             assigned_agent_id = NULL,
             assigned_worker_id = NULL,
             claimed_at = NULL,
             started_at = NULL
         WHERE tenant_id = $1
           AND pipeline_id = $2
           AND state = ANY($3::task_state[])
         RETURNING id`,
        [identity.tenantId, pipelineId, cancellableStates],
      );

      await client.query(
        `UPDATE agents
         SET current_task_id = NULL,
             status = (CASE WHEN status = 'inactive' THEN 'inactive' ELSE 'idle' END)::agent_status
         WHERE tenant_id = $1
           AND current_task_id = ANY($2::uuid[])`,
        [
          identity.tenantId,
          updatedTasks.rows.length > 0 ? updatedTasks.rows.map((row) => row.id as string) : ['00000000-0000-0000-0000-000000000000'],
        ],
      );

      const state = await this.stateService.recomputePipelineState(identity.tenantId, pipelineId, client, {
        actorType: identity.scope,
        actorId: identity.keyPrefix,
      });

      await this.eventService.emit(
        {
          tenantId: identity.tenantId,
          type: 'pipeline.cancelled',
          entityType: 'pipeline',
          entityId: pipelineId,
          actorType: identity.scope,
          actorId: identity.keyPrefix,
          data: { cancelled_tasks: updatedTasks.rowCount },
        },
        client,
      );

      await client.query('COMMIT');
      return this.getPipeline(identity.tenantId, pipelineId).then((result) => ({ ...result, state }));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
