import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { TenantScopedRepository } from '../db/tenant-scoped-repository.js';
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
    const repo = new TenantScopedRepository(this.pool, tenantId);

    // Extra conditions beyond tenant_id (always prepended by the repository).
    // Placeholder numbering starts at $2.
    const conditions: string[] = [];
    const values: unknown[] = [];

    const exactFilters: Array<[string | undefined, string]> = [
      [query.project_id, 'project_id'],
      [query.template_id, 'template_id'],
    ];
    for (const [filter, column] of exactFilters) {
      if (!filter) continue;
      values.push(filter);
      conditions.push(`${column} = $${values.length + 1}`);
    }

    if (query.state) {
      values.push(query.state.split(','));
      conditions.push(`state = ANY($${values.length + 1}::pipeline_state[])`);
    }

    const offset = (query.page - 1) * query.per_page;

    const [total, rows] = await Promise.all([
      repo.count('pipelines', conditions, values),
      repo.findAllPaginated<Record<string, unknown> & { tenant_id: string }>(
        'pipelines',
        '*',
        conditions,
        values,
        'created_at DESC',
        query.per_page,
        offset,
      ),
    ]);

    return {
      data: rows,
      meta: { total, page: query.page, per_page: query.per_page, pages: Math.ceil(total / query.per_page) || 1 },
    };
  }

  async getPipeline(tenantId: string, pipelineId: string) {
    const repo = new TenantScopedRepository(this.pool, tenantId);

    const pipeline = await repo.findById<Record<string, unknown> & { tenant_id: string }>(
      'pipelines',
      '*',
      pipelineId,
    );
    if (!pipeline) throw new NotFoundError('Pipeline not found');

    const tasksRepo = new TenantScopedRepository(this.pool, tenantId);
    const tasks = await tasksRepo.findAllPaginated<Record<string, unknown> & { tenant_id: string }>(
      'tasks',
      '*',
      ['pipeline_id = $2'],
      [pipelineId],
      'created_at ASC',
      1000,
      0,
    );

    return { ...pipeline, tasks } as Record<string, unknown>;
  }

  cancelPipeline(identity: ApiKeyIdentity, pipelineId: string) {
    return this.cancellationService.cancelPipeline(identity, pipelineId);
  }
}
