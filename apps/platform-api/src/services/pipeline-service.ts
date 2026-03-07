import type { ApiKeyIdentity } from '../auth/api-key.js';
import { buildArtifactStorageConfig } from '../content/storage-config.js';
import { createArtifactStorage } from '../content/storage-factory.js';
import type { DatabasePool } from '../db/database.js';
import { TenantScopedRepository } from '../db/tenant-scoped-repository.js';
import { ConflictError, NotFoundError } from '../errors/domain-errors.js';
import type { StoredWorkflowDefinition } from '../orchestration/workflow-model.js';
import { deriveWorkflowView, readWorkflowRuntimeState } from '../orchestration/workflow-runtime.js';
import { buildResolvedConfigView } from './config-hierarchy-service.js';
import { ArtifactRetentionService } from './artifact-retention-service.js';
import { PipelineCancellationService } from './pipeline-cancellation-service.js';
import { PipelineControlService } from './pipeline-control-service.js';
import { PipelineCreationService } from './pipeline-creation-service.js';
import { EventService } from './event-service.js';
import { PipelineStateService } from './pipeline-state-service.js';
import type { WorkerConnectionHub } from './worker-connection-hub.js';
import type {
  CreatePipelineInput,
  ListPipelineQuery,
  PipelineServiceConfig,
} from './pipeline-service.types.js';

export class PipelineService {
  private readonly creationService: PipelineCreationService;
  private readonly cancellationService: PipelineCancellationService;
  private readonly controlService: PipelineControlService;

  constructor(
    private readonly pool: DatabasePool,
    private readonly eventService: EventService,
    config: PipelineServiceConfig,
    connectionHub?: WorkerConnectionHub,
  ) {
    const artifactRetentionService = new ArtifactRetentionService(
      pool,
      createArtifactStorage(buildArtifactStorageConfig(config)),
    );
    const stateService = new PipelineStateService(pool, eventService, artifactRetentionService);
    this.creationService = new PipelineCreationService({
      pool,
      eventService,
      stateService,
      config,
    });
    this.cancellationService = new PipelineCancellationService({
      pool,
      eventService,
      stateService,
      cancelSignalGracePeriodMs: config.TASK_CANCEL_SIGNAL_GRACE_PERIOD_MS ?? 60_000,
      workerConnectionHub: connectionHub,
      getPipeline: this.getPipeline.bind(this),
    });
    this.controlService = new PipelineControlService(pool, eventService, stateService);
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
      meta: {
        total,
        page: query.page,
        per_page: query.per_page,
        pages: Math.ceil(total / query.per_page) || 1,
      },
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

    const metadata =
      pipeline.metadata && typeof pipeline.metadata === 'object' && !Array.isArray(pipeline.metadata)
        ? (pipeline.metadata as Record<string, unknown>)
        : {};
    const workflow =
      metadata.workflow && typeof metadata.workflow === 'object' && !Array.isArray(metadata.workflow)
        ? (metadata.workflow as StoredWorkflowDefinition)
        : null;
    return {
      ...pipeline,
      tasks,
      ...deriveWorkflowView(workflow, tasks, readWorkflowRuntimeState(metadata.workflow_runtime)),
    } as Record<string, unknown>;
  }

  async getResolvedConfig(tenantId: string, pipelineId: string, showLayers = false) {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const pipeline = await repo.findById<Record<string, unknown> & { tenant_id: string }>(
      'pipelines',
      'id, resolved_config, config_layers',
      pipelineId,
    );
    if (!pipeline) {
      throw new NotFoundError('Pipeline not found');
    }

    const resolved = ((pipeline.resolved_config ?? {}) as Record<string, unknown>) ?? {};
    const rawLayers = ((pipeline.config_layers ?? {}) as Record<string, unknown>) ?? {};
    const layers = {
      template: ((rawLayers.template ?? {}) as Record<string, unknown>) ?? {},
      project: ((rawLayers.project ?? {}) as Record<string, unknown>) ?? {},
      run: ((rawLayers.run ?? {}) as Record<string, unknown>) ?? {},
    };

    return {
      pipeline_id: pipelineId,
      resolved_config: buildResolvedConfigView(resolved, layers, showLayers),
      ...(showLayers ? { config_layers: layers } : {}),
    };
  }

  async deletePipeline(identity: ApiKeyIdentity, pipelineId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const pipelineResult = await client.query<{ state: string }>(
        'SELECT state FROM pipelines WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
        [identity.tenantId, pipelineId],
      );

      if (!pipelineResult.rowCount) {
        throw new NotFoundError('Pipeline not found');
      }

      const state = pipelineResult.rows[0].state;
      const terminalStates = new Set(['completed', 'failed', 'cancelled']);
      if (!terminalStates.has(state)) {
        throw new ConflictError('Only terminal pipelines can be deleted');
      }

      await client.query('DELETE FROM tasks WHERE tenant_id = $1 AND pipeline_id = $2', [
        identity.tenantId,
        pipelineId,
      ]);
      await client.query('DELETE FROM pipelines WHERE tenant_id = $1 AND id = $2', [
        identity.tenantId,
        pipelineId,
      ]);

      await this.eventService.emit(
        {
          tenantId: identity.tenantId,
          type: 'pipeline.deleted',
          entityType: 'pipeline',
          entityId: pipelineId,
          actorType: identity.scope,
          actorId: identity.keyPrefix,
          data: { previous_state: state },
        },
        client,
      );

      await client.query('COMMIT');
      return { id: pipelineId, deleted: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  cancelPipeline(identity: ApiKeyIdentity, pipelineId: string) {
    return this.cancellationService.cancelPipeline(identity, pipelineId);
  }

  pausePipeline(identity: ApiKeyIdentity, pipelineId: string) {
    return this.controlService.pausePipeline(identity, pipelineId);
  }

  resumePipeline(identity: ApiKeyIdentity, pipelineId: string) {
    return this.controlService.resumePipeline(identity, pipelineId);
  }

  manualReworkPipeline(identity: ApiKeyIdentity, pipelineId: string, feedback: string) {
    return this.controlService.manualReworkPipeline(identity, pipelineId, feedback);
  }

  actOnPhaseGate(
    identity: ApiKeyIdentity,
    pipelineId: string,
    phaseName: string,
    payload: { action: 'approve' | 'reject' | 'request_changes'; feedback?: string },
  ) {
    return this.controlService.actOnPhaseGate(identity, pipelineId, phaseName, payload);
  }

  cancelPhase(identity: ApiKeyIdentity, pipelineId: string, phaseName: string) {
    return this.controlService.cancelPhase(identity, pipelineId, phaseName);
  }
}
