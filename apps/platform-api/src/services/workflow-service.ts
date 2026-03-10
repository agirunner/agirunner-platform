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
import { WorkflowCancellationService } from './workflow-cancellation-service.js';
import { WorkflowControlService } from './workflow-control-service.js';
import { WorkflowCreationService } from './workflow-creation-service.js';
import { EventService } from './event-service.js';
import { WorkflowStateService } from './workflow-state-service.js';
import { ProjectTimelineService } from './project-timeline-service.js';
import type { LogService } from '../logging/log-service.js';
import type { WorkerConnectionHub } from './worker-connection-hub.js';
import type {
  CreateWorkflowInput,
  ListWorkflowQuery,
  WorkflowServiceConfig,
} from './workflow-service.types.js';

export class WorkflowService {
  private readonly creationService: WorkflowCreationService;
  private readonly cancellationService: WorkflowCancellationService;
  private readonly controlService: WorkflowControlService;
  private readonly projectTimelineService: ProjectTimelineService;

  constructor(
    private readonly pool: DatabasePool,
    private readonly eventService: EventService,
    config: WorkflowServiceConfig,
    connectionHub?: WorkerConnectionHub,
    logService?: LogService,
  ) {
    this.projectTimelineService = new ProjectTimelineService(pool);
    const artifactRetentionService = new ArtifactRetentionService(
      pool,
      createArtifactStorage(buildArtifactStorageConfig(config)),
    );
    const stateService = new WorkflowStateService(
      pool,
      eventService,
      artifactRetentionService,
      this.projectTimelineService,
      logService,
    );
    this.creationService = new WorkflowCreationService({
      pool,
      eventService,
      stateService,
      config,
    });
    this.cancellationService = new WorkflowCancellationService({
      pool,
      eventService,
      stateService,
      cancelSignalGracePeriodMs: config.TASK_CANCEL_SIGNAL_GRACE_PERIOD_MS ?? 60_000,
      workerConnectionHub: connectionHub,
      getWorkflow: this.getWorkflow.bind(this),
    });
    this.controlService = new WorkflowControlService(pool, eventService, stateService);
  }

  createWorkflow(identity: ApiKeyIdentity, input: CreateWorkflowInput) {
    return this.creationService.createWorkflow(identity, input);
  }

  async listWorkflows(tenantId: string, query: ListWorkflowQuery) {
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
      conditions.push(`state = ANY($${values.length + 1}::workflow_state[])`);
    }

    const offset = (query.page - 1) * query.per_page;

    const [total, rows] = await Promise.all([
      repo.count('workflows', conditions, values),
      repo.findAllPaginated<Record<string, unknown> & { tenant_id: string }>(
        'workflows',
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

  async getWorkflow(tenantId: string, workflowId: string) {
    const repo = new TenantScopedRepository(this.pool, tenantId);

    const workflowRow = await repo.findById<Record<string, unknown> & { tenant_id: string }>(
      'workflows',
      '*',
      workflowId,
    );
    if (!workflowRow) throw new NotFoundError('Workflow not found');

    const tasksRepo = new TenantScopedRepository(this.pool, tenantId);
    const tasks = await tasksRepo.findAllPaginated<Record<string, unknown> & { tenant_id: string }>(
      'tasks',
      '*',
      ['workflow_id = $2'],
      [workflowId],
      'created_at ASC',
      1000,
      0,
    );

    const metadata =
      workflowRow.metadata && typeof workflowRow.metadata === 'object' && !Array.isArray(workflowRow.metadata)
        ? (workflowRow.metadata as Record<string, unknown>)
        : {};
    const workflowDef =
      metadata.workflow && typeof metadata.workflow === 'object' && !Array.isArray(metadata.workflow)
        ? (metadata.workflow as StoredWorkflowDefinition)
        : null;
    return {
      ...workflowRow,
      tasks,
      ...deriveWorkflowView(workflowDef, tasks, readWorkflowRuntimeState(metadata.workflow_runtime)),
    } as Record<string, unknown>;
  }

  async getResolvedConfig(tenantId: string, workflowId: string, showLayers = false) {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const workflow = await repo.findById<Record<string, unknown> & { tenant_id: string }>(
      'workflows',
      'id, resolved_config, config_layers',
      workflowId,
    );
    if (!workflow) {
      throw new NotFoundError('Workflow not found');
    }

    const resolved = ((workflow.resolved_config ?? {}) as Record<string, unknown>) ?? {};
    const rawLayers = ((workflow.config_layers ?? {}) as Record<string, unknown>) ?? {};
    const layers = {
      template: ((rawLayers.template ?? {}) as Record<string, unknown>) ?? {},
      project: ((rawLayers.project ?? {}) as Record<string, unknown>) ?? {},
      run: ((rawLayers.run ?? {}) as Record<string, unknown>) ?? {},
    };

    return {
      workflow_id: workflowId,
      resolved_config: buildResolvedConfigView(resolved, layers, showLayers),
      ...(showLayers ? { config_layers: layers } : {}),
    };
  }

  async deleteWorkflow(identity: ApiKeyIdentity, workflowId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const workflowResult = await client.query<{ state: string }>(
        'SELECT state FROM workflows WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
        [identity.tenantId, workflowId],
      );

      if (!workflowResult.rowCount) {
        throw new NotFoundError('Workflow not found');
      }

      const state = workflowResult.rows[0].state;
      const terminalStates = new Set(['completed', 'failed', 'cancelled']);
      if (!terminalStates.has(state)) {
        throw new ConflictError('Only terminal workflows can be deleted');
      }

      await client.query('DELETE FROM tasks WHERE tenant_id = $1 AND workflow_id = $2', [
        identity.tenantId,
        workflowId,
      ]);
      await client.query('DELETE FROM workflows WHERE tenant_id = $1 AND id = $2', [
        identity.tenantId,
        workflowId,
      ]);

      await this.eventService.emit(
        {
          tenantId: identity.tenantId,
          type: 'workflow.deleted',
          entityType: 'workflow',
          entityId: workflowId,
          actorType: identity.scope,
          actorId: identity.keyPrefix,
          data: { previous_state: state },
        },
        client,
      );

      await client.query('COMMIT');
      return { id: workflowId, deleted: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  cancelWorkflow(identity: ApiKeyIdentity, workflowId: string) {
    return this.cancellationService.cancelWorkflow(identity, workflowId);
  }

  pauseWorkflow(identity: ApiKeyIdentity, workflowId: string) {
    return this.controlService.pauseWorkflow(identity, workflowId);
  }

  resumeWorkflow(identity: ApiKeyIdentity, workflowId: string) {
    return this.controlService.resumeWorkflow(identity, workflowId);
  }

  manualReworkWorkflow(identity: ApiKeyIdentity, workflowId: string, feedback: string) {
    return this.controlService.manualReworkWorkflow(identity, workflowId, feedback);
  }

  actOnPhaseGate(
    identity: ApiKeyIdentity,
    workflowId: string,
    phaseName: string,
    payload: {
      action: 'approve' | 'reject' | 'request_changes';
      feedback?: string;
      override_input?: Record<string, unknown>;
    },
  ) {
    return this.controlService.actOnPhaseGate(identity, workflowId, phaseName, payload);
  }

  cancelPhase(identity: ApiKeyIdentity, workflowId: string, phaseName: string) {
    return this.controlService.cancelPhase(identity, workflowId, phaseName);
  }

  getProjectTimeline(tenantId: string, projectId: string) {
    return this.projectTimelineService.getProjectTimeline(tenantId, projectId);
  }
}
