import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { NotFoundError } from '../errors/domain-errors.js';
import { PipelineCancellationService } from './pipeline-cancellation-service.js';
import { PipelineCreationService } from './pipeline-creation-service.js';
import { EventService } from './event-service.js';
import { PipelineStateService } from './pipeline-state-service.js';
import type { CreatePipelineInput, ListPipelineQuery, PipelineServiceConfig } from './pipeline-service.types.js';

export class PipelineService {
  private readonly creationService: PipelineCreationService;
  private readonly cancellationService: PipelineCancellationService;

  constructor(
    private readonly pool: DatabasePool,
    eventService: EventService,
    config: PipelineServiceConfig,
  ) {
    const stateService = new PipelineStateService(pool, eventService);
    this.creationService = new PipelineCreationService({ pool, eventService, stateService, config });
    this.cancellationService = new PipelineCancellationService({
      pool,
      eventService,
      stateService,
      getPipeline: this.getPipeline.bind(this),
    });
  }

  createPipeline(identity: ApiKeyIdentity, input: CreatePipelineInput) {
    return this.creationService.createPipeline(identity, input);
  }

  async listPipelines(tenantId: string, query: ListPipelineQuery) {
    const where: string[] = ['tenant_id = $1'];
    const values: unknown[] = [tenantId];

    const exactFilters: Array<[string | undefined, string]> = [
      [query.project_id, 'project_id'],
      [query.template_id, 'template_id'],
    ];
    for (const [filter, column] of exactFilters) {
      if (!filter) continue;
      values.push(filter);
      where.push(`${column} = $${values.length}`);
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
      `SELECT * FROM pipelines WHERE ${whereClause} ORDER BY created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );

    const total = Number(totalRes.rows[0].total);
    return {
      data: dataRes.rows,
      meta: { total, page: query.page, per_page: query.per_page, pages: Math.ceil(total / query.per_page) || 1 },
    };
  }

  async getPipeline(tenantId: string, pipelineId: string) {
    const [pipelineRes, tasksRes] = await Promise.all([
      this.pool.query('SELECT * FROM pipelines WHERE tenant_id = $1 AND id = $2', [tenantId, pipelineId]),
      this.pool.query('SELECT * FROM tasks WHERE tenant_id = $1 AND pipeline_id = $2 ORDER BY created_at ASC', [tenantId, pipelineId]),
    ]);

    if (!pipelineRes.rowCount) throw new NotFoundError('Pipeline not found');
    return { ...pipelineRes.rows[0], tasks: tasksRes.rows };
  }

  cancelPipeline(identity: ApiKeyIdentity, pipelineId: string) {
    return this.cancellationService.cancelPipeline(identity, pipelineId);
  }
}
