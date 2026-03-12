import type { ApiKeyIdentity } from '../auth/api-key.js';
import { buildArtifactStorageConfig } from '../content/storage-config.js';
import { createArtifactStorage } from '../content/storage-factory.js';
import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { TenantScopedRepository } from '../db/tenant-scoped-repository.js';
import { ConflictError, NotFoundError } from '../errors/domain-errors.js';
import { buildResolvedConfigView } from './config-hierarchy-service.js';
import { ArtifactRetentionService } from './artifact-retention-service.js';
import { WorkflowActivationService } from './workflow-activation-service.js';
import { WorkflowActivationDispatchService } from './workflow-activation-dispatch-service.js';
import { WorkflowCancellationService } from './workflow-cancellation-service.js';
import { WorkflowControlService } from './workflow-control-service.js';
import { WorkflowCreationService } from './workflow-creation-service.js';
import { EventService } from './event-service.js';
import { ModelCatalogService } from './model-catalog-service.js';
import {
  PlaybookWorkflowControlService,
  type AdvanceStageInput,
  type CompleteWorkflowInput,
  type StageGateDecisionInput,
  type StageGateRequestInput,
  type UpdateWorkflowWorkItemInput,
} from './playbook-workflow-control-service.js';
import {
  WorkItemService,
  type GetWorkflowWorkItemInput,
  type GroupedWorkItemReadModel,
  type ListWorkflowWorkItemsInput,
  type WorkItemReadModel,
} from './work-item-service.js';
import { WorkflowStageService } from './workflow-stage-service.js';
import { WorkflowStateService } from './workflow-state-service.js';
import { ProjectTimelineService } from './project-timeline-service.js';
import type { LogService } from '../logging/log-service.js';
import type { WorkerConnectionHub } from './worker-connection-hub.js';
import type {
  CreateWorkflowInput,
  ListWorkflowQuery,
  WorkflowServiceConfig,
  WorkflowWorkItemSummary,
} from './workflow-service.types.js';

export class WorkflowService {
  private readonly creationService: WorkflowCreationService;
  private readonly cancellationService: WorkflowCancellationService;
  private readonly controlService: WorkflowControlService;
  private readonly projectTimelineService: ProjectTimelineService;
  private readonly activationService: WorkflowActivationService;
  private readonly activationDispatchService: WorkflowActivationDispatchService;
  private readonly workItemService: WorkItemService;
  private readonly stageService: WorkflowStageService;
  private readonly playbookControlService: PlaybookWorkflowControlService;
  private readonly modelCatalogService: ModelCatalogService;

  constructor(
    private readonly pool: DatabasePool,
    private readonly eventService: EventService,
    config: WorkflowServiceConfig,
    connectionHub?: WorkerConnectionHub,
    logService?: LogService,
  ) {
    const workflowActivationDelayMs = config.WORKFLOW_ACTIVATION_DELAY_MS ?? 10_000;
    const workflowActivationStaleAfterMs = config.WORKFLOW_ACTIVATION_STALE_AFTER_MS ?? 300_000;
    this.projectTimelineService = new ProjectTimelineService(pool);
    this.modelCatalogService = new ModelCatalogService(pool);
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
    this.activationService = new WorkflowActivationService(pool, eventService);
    this.activationDispatchService = new WorkflowActivationDispatchService({
      pool,
      eventService,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: config.TASK_DEFAULT_TIMEOUT_MINUTES,
        WORKFLOW_ACTIVATION_DELAY_MS: workflowActivationDelayMs,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: workflowActivationStaleAfterMs,
      },
    });
    this.stageService = new WorkflowStageService(pool);
    this.creationService = new WorkflowCreationService({
      pool,
      eventService,
      stateService,
      activationService: this.activationService,
      activationDispatchService: this.activationDispatchService,
      stageService: this.stageService,
      modelCatalogService: this.modelCatalogService,
    });
    this.workItemService = new WorkItemService(
      pool,
      eventService,
      this.activationService,
      this.activationDispatchService,
    );
    this.playbookControlService = new PlaybookWorkflowControlService({
      pool,
      eventService,
      stateService,
      activationService: this.activationService,
      activationDispatchService: this.activationDispatchService,
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

  async getEffectiveModel(tenantId: string, workflowId: string) {
    return {
      workflow_id: workflowId,
      ...(await this.modelCatalogService.resolveEffectiveModel(tenantId, { workflowId })),
    };
  }

  async listWorkflows(tenantId: string, query: ListWorkflowQuery) {
    const conditions: string[] = [];
    const values: unknown[] = [tenantId];

    const exactFilters: Array<[string | undefined, string]> = [
      [query.project_id, 'w.project_id'],
      [query.playbook_id, 'w.playbook_id'],
    ];
    for (const [filter, column] of exactFilters) {
      if (!filter) continue;
      values.push(filter);
      conditions.push(`${column} = $${values.length}`);
    }

    if (query.state) {
      values.push(query.state.split(','));
      conditions.push(`w.state = ANY($${values.length}::workflow_state[])`);
    }

    const offset = (query.page - 1) * query.per_page;
    const whereClause = ['w.tenant_id = $1', ...conditions].join(' AND ');
    const limitPlaceholder = values.length + 1;
    const offsetPlaceholder = values.length + 2;

    const [total, rows] = await Promise.all([
      this.pool
        .query<{ total: string }>(
          `SELECT COUNT(*)::int AS total
             FROM workflows w
            WHERE ${whereClause}`,
          values,
        )
        .then((result) => Number(result.rows[0]?.total ?? '0')),
      this.pool.query<Record<string, unknown> & { tenant_id: string }>(
        `SELECT w.*,
                p.name AS project_name,
                pb.name AS playbook_name,
                COALESCE(task_counts.task_counts, '{}'::jsonb) AS task_counts,
                CASE
                  WHEN w.playbook_id IS NULL THEN NULL
                  ELSE jsonb_build_object(
                    'total_work_items', COALESCE(work_item_summary.total_work_items, 0),
                    'open_work_item_count', COALESCE(work_item_summary.open_work_item_count, 0),
                    'completed_work_item_count', COALESCE(work_item_summary.completed_work_item_count, 0),
                    'active_stage_count', COALESCE(stage_summary.active_stage_count, COALESCE(work_item_summary.active_stage_count, 0)),
                    'awaiting_gate_count', COALESCE(stage_summary.awaiting_gate_count, 0),
                    'active_stage_names', COALESCE(to_jsonb(stage_summary.active_stage_names), '[]'::jsonb)
                  )
                END AS work_item_summary
           FROM workflows w
           LEFT JOIN projects p
             ON p.tenant_id = w.tenant_id
            AND p.id = w.project_id
           LEFT JOIN playbooks pb
             ON pb.tenant_id = w.tenant_id
            AND pb.id = w.playbook_id
           LEFT JOIN LATERAL (
             SELECT jsonb_object_agg(task_state.state, task_state.total) AS task_counts
               FROM (
                 SELECT state::text AS state, COUNT(*)::int AS total
                   FROM tasks
                  WHERE tenant_id = w.tenant_id
                    AND workflow_id = w.id
                  GROUP BY state
               ) AS task_state
           ) AS task_counts
             ON true
           LEFT JOIN LATERAL (
             SELECT COUNT(*)::int AS total_work_items,
                    COUNT(*) FILTER (WHERE completed_at IS NULL)::int AS open_work_item_count,
                    COUNT(*) FILTER (WHERE completed_at IS NOT NULL)::int AS completed_work_item_count,
                    COUNT(DISTINCT stage_name) FILTER (WHERE completed_at IS NULL)::int AS active_stage_count,
                    ARRAY_REMOVE(
                      ARRAY_AGG(DISTINCT stage_name) FILTER (WHERE completed_at IS NULL),
                      NULL
                    ) AS active_stage_names
               FROM workflow_work_items wi
              WHERE wi.tenant_id = w.tenant_id
                AND wi.workflow_id = w.id
           ) AS work_item_summary
             ON true
           LEFT JOIN LATERAL (
             SELECT COUNT(*) FILTER (
                      WHERE gate_status = 'awaiting_approval'
                    )::int AS awaiting_gate_count,
                    ARRAY(
                      SELECT DISTINCT stage_name
                        FROM unnest(
                          COALESCE(work_item_summary.active_stage_names, '{}'::text[]) ||
                          COALESCE(
                            ARRAY_REMOVE(
                              ARRAY_AGG(DISTINCT ws.name) FILTER (
                                WHERE ws.gate_status IN ('awaiting_approval', 'changes_requested', 'rejected')
                              ),
                              NULL
                            ),
                            '{}'::text[]
                          )
                        ) AS stage_name
                       WHERE stage_name IS NOT NULL
                       ORDER BY stage_name
                    ) AS active_stage_names,
                    COALESCE(
                      cardinality(
                        ARRAY(
                          SELECT DISTINCT stage_name
                            FROM unnest(
                              COALESCE(work_item_summary.active_stage_names, '{}'::text[]) ||
                              COALESCE(
                                ARRAY_REMOVE(
                                  ARRAY_AGG(DISTINCT ws.name) FILTER (
                                    WHERE ws.gate_status IN ('awaiting_approval', 'changes_requested', 'rejected')
                                  ),
                                  NULL
                                ),
                                '{}'::text[]
                              )
                            ) AS stage_name
                           WHERE stage_name IS NOT NULL
                        )
                      ),
                      0
                    )::int AS active_stage_count
               FROM workflow_stages ws
              WHERE ws.tenant_id = w.tenant_id
                AND ws.workflow_id = w.id
           ) AS stage_summary
             ON true
          WHERE ${whereClause}
          ORDER BY w.created_at DESC
          LIMIT $${limitPlaceholder}
         OFFSET $${offsetPlaceholder}`,
        [...values, query.per_page, offset],
      ),
    ]);

    const workflowsWithRelations = await this.attachWorkflowRelations(tenantId, rows.rows);
    return {
      data: workflowsWithRelations.map((workflow) => normalizeWorkflowReadModel(workflow)),
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

    const isPlaybookWorkflow = Boolean(workflowRow.playbook_id);
    if (isPlaybookWorkflow) {
      const [workItems, activations, workflowStages] = await Promise.all([
        this.workItemService.listWorkflowWorkItems(tenantId, workflowId),
        this.activationService.listWorkflowActivations(tenantId, workflowId),
        this.stageService.listStages(tenantId, workflowId),
      ]);
      const activeStages = Array.from(
        new Set(
          workItems
            .filter((item) => item.completed_at == null)
            .map((item) => String(item.stage_name)),
        ),
      );
      const workflowWithRelations = await this.attachWorkflowRelations(tenantId, [workflowRow]);
      const normalizedWorkflow = normalizeWorkflowReadModel(
        workflowWithRelations[0],
        buildWorkflowWorkItemSummary(workItems, workflowStages),
      );
      return {
        ...normalizedWorkflow,
        tasks,
        work_items: workItems,
        activations,
        workflow_stages: workflowStages,
        active_stages: normalizedWorkflow.active_stages ?? activeStages,
      } as Record<string, unknown>;
    }
    const workflowWithRelations = await this.attachWorkflowRelations(tenantId, [workflowRow]);
    return {
      ...normalizeWorkflowReadModel(workflowWithRelations[0]),
      tasks,
    } as Record<string, unknown>;
  }

  private async attachWorkflowRelations(
    tenantId: string,
    workflows: Array<Record<string, unknown> & { tenant_id: string }>,
  ) {
    if (workflows.length === 0) {
      return workflows;
    }

    const parentIds = new Set<string>();
    const childIds = new Set<string>();
    const metadataByWorkflowId = new Map<string, Record<string, unknown>>();

    for (const workflow of workflows) {
      const metadata = asRecord(workflow.metadata);
      metadataByWorkflowId.set(String(workflow.id), metadata);
      const parentId = asOptionalString(metadata.chain_source_workflow_id);
      if (parentId) {
        parentIds.add(parentId);
      }
      for (const childId of readWorkflowIdArray(metadata.child_workflow_ids)) {
        childIds.add(childId);
      }
    }

    const referencedIds = Array.from(new Set([...parentIds, ...childIds]));
    const relatedById = new Map<string, Record<string, unknown>>();
    if (referencedIds.length > 0) {
      const relatedRes = await this.pool.query<Record<string, unknown>>(
        `SELECT w.id,
                w.name,
                w.state,
                w.playbook_id,
                w.created_at,
                w.started_at,
                w.completed_at,
                pb.name AS playbook_name
           FROM workflows w
           LEFT JOIN playbooks pb
             ON pb.tenant_id = w.tenant_id
            AND pb.id = w.playbook_id
          WHERE w.tenant_id = $1
            AND w.id = ANY($2::uuid[])`,
        [tenantId, referencedIds],
      );
      for (const row of relatedRes.rows) {
        relatedById.set(String(row.id), row);
      }
    }

    return workflows.map((workflow) => {
      const metadata = metadataByWorkflowId.get(String(workflow.id)) ?? {};
      return {
        ...workflow,
        workflow_relations: buildWorkflowRelations(metadata, relatedById),
      };
    });
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

  listWorkflowWorkItems(
    tenantId: string,
    workflowId: string,
    input: ListWorkflowWorkItemsInput = {},
  ): Promise<WorkItemReadModel[] | GroupedWorkItemReadModel[]> {
    if (input.grouped) {
      return this.workItemService.listWorkflowWorkItems(tenantId, workflowId, {
        ...input,
        grouped: true,
      });
    }
    const { grouped: _grouped, ...ungroupedInput } = input;
    return this.workItemService.listWorkflowWorkItems(tenantId, workflowId, ungroupedInput);
  }

  getWorkflowWorkItem(
    tenantId: string,
    workflowId: string,
    workItemId: string,
    input?: GetWorkflowWorkItemInput,
  ): Promise<WorkItemReadModel | GroupedWorkItemReadModel> {
    if (input?.include_children) {
      return this.workItemService.getWorkflowWorkItem(tenantId, workflowId, workItemId, {
        include_children: true,
      });
    }
    return this.workItemService.getWorkflowWorkItem(tenantId, workflowId, workItemId, {});
  }

  listWorkflowWorkItemTasks(tenantId: string, workflowId: string, workItemId: string) {
    return this.workItemService.listWorkItemTasks(tenantId, workflowId, workItemId);
  }

  listWorkflowWorkItemEvents(
    tenantId: string,
    workflowId: string,
    workItemId: string,
    limit: number,
  ) {
    return this.workItemService.listWorkItemEvents(tenantId, workflowId, workItemId, limit);
  }

  getWorkflowWorkItemMemory(tenantId: string, workflowId: string, workItemId: string) {
    return this.workItemService.getWorkItemMemory(tenantId, workflowId, workItemId);
  }

  getWorkflowWorkItemMemoryHistory(
    tenantId: string,
    workflowId: string,
    workItemId: string,
    limit: number,
  ) {
    return this.workItemService.getWorkItemMemoryHistory(tenantId, workflowId, workItemId, limit);
  }

  createWorkflowWorkItem(
    identity: ApiKeyIdentity,
    workflowId: string,
    input: Parameters<WorkItemService['createWorkItem']>[2],
    client?: DatabaseClient,
  ) {
    return this.workItemService.createWorkItem(identity, workflowId, input, client);
  }

  updateWorkflowWorkItem(
    identity: ApiKeyIdentity,
    workflowId: string,
    workItemId: string,
    input: UpdateWorkflowWorkItemInput,
  ) {
    return this.playbookControlService.updateWorkItem(identity, workflowId, workItemId, input);
  }

  listWorkflowStages(tenantId: string, workflowId: string) {
    return this.stageService.listStages(tenantId, workflowId);
  }

  requestStageGateApproval(
    identity: ApiKeyIdentity,
    workflowId: string,
    stageName: string,
    input: StageGateRequestInput,
  ) {
    return this.playbookControlService.requestStageGateApproval(
      identity,
      workflowId,
      stageName,
      input,
    );
  }

  actOnStageGate(
    identity: ApiKeyIdentity,
    workflowId: string,
    stageName: string,
    input: StageGateDecisionInput,
  ) {
    return this.playbookControlService.actOnStageGate(identity, workflowId, stageName, input);
  }

  advanceWorkflowStage(
    identity: ApiKeyIdentity,
    workflowId: string,
    stageName: string,
    input: AdvanceStageInput,
  ) {
    return this.playbookControlService.advanceStage(identity, workflowId, stageName, input);
  }

  completePlaybookWorkflow(
    identity: ApiKeyIdentity,
    workflowId: string,
    input: CompleteWorkflowInput,
  ) {
    return this.playbookControlService.completeWorkflow(identity, workflowId, input);
  }

  async getWorkflowBoard(tenantId: string, workflowId: string) {
    const workflow = await this.getWorkflow(tenantId, workflowId);
    if (!workflow.playbook_id) {
      throw new ConflictError('Board view is only available for playbook workflows');
    }
    const playbook = await this.pool.query<{ definition: Record<string, unknown> }>(
      `SELECT p.definition
         FROM workflows w
         JOIN playbooks p
           ON p.tenant_id = w.tenant_id
          AND p.id = w.playbook_id
        WHERE w.tenant_id = $1
          AND w.id = $2`,
      [tenantId, workflowId],
    );
    if (!playbook.rowCount) {
      throw new NotFoundError('Playbook workflow not found');
    }
    const definition = playbook.rows[0].definition as {
      board: { columns: Array<Record<string, unknown>> };
      stages?: Array<{ name: string; goal: string }>;
    };
    const workItems = (workflow.work_items as Record<string, unknown>[]) ?? [];
    const workflowStages = Array.isArray(workflow.workflow_stages)
      ? (workflow.workflow_stages as Record<string, unknown>[])
      : [];
    const terminalColumns = new Set(
      definition.board.columns
        .filter((column) => Boolean(column.is_terminal))
        .map((column) => String(column.id)),
    );
    const boardWorkItems = annotateBoardWorkItems(workItems, terminalColumns);
    const stageSummary = buildBoardStageSummary(
      definition.stages ?? [],
      workflowStages,
      boardWorkItems,
      terminalColumns,
    );
    const workItemSummary = asRecord(workflow.work_item_summary);
    return {
      columns: definition.board.columns,
      work_items: boardWorkItems,
      active_stages: Array.isArray(workflow.active_stages) ? workflow.active_stages : [],
      awaiting_gate_count: readCount(workItemSummary.awaiting_gate_count),
      stage_summary: stageSummary,
    };
  }

  getProjectTimeline(tenantId: string, projectId: string) {
    return this.projectTimelineService.getProjectTimeline(tenantId, projectId);
  }
}

function buildWorkflowRelations(
  metadata: Record<string, unknown>,
  relatedById: Map<string, Record<string, unknown>>,
) {
  const parentId = asOptionalString(metadata.chain_source_workflow_id);
  const childIds = readWorkflowIdArray(metadata.child_workflow_ids);
  const parent = parentId ? toWorkflowRelationRef(parentId, relatedById.get(parentId)) : null;
  const children = childIds.map((childId) => toWorkflowRelationRef(childId, relatedById.get(childId)));

  return {
    parent,
    children,
    latest_child_workflow_id: asOptionalString(metadata.latest_chained_workflow_id) ?? null,
    child_status_counts: {
      total: children.length,
      active: children.filter((child) => child.state === 'pending' || child.state === 'active' || child.state === 'paused').length,
      completed: children.filter((child) => child.state === 'completed').length,
      failed: children.filter((child) => child.state === 'failed').length,
      cancelled: children.filter((child) => child.state === 'cancelled').length,
    },
  };
}

function annotateBoardWorkItems(
  workItems: Array<Record<string, unknown>>,
  terminalColumns: Set<string>,
) {
  const childCounts = new Map<string, { total: number; completed: number }>();

  for (const item of workItems) {
    const parentId = asOptionalString(item.parent_work_item_id);
    if (!parentId) {
      continue;
    }
    const current = childCounts.get(parentId) ?? { total: 0, completed: 0 };
    current.total += 1;
    if (isCompletedBoardChild(item, terminalColumns)) {
      current.completed += 1;
    }
    childCounts.set(parentId, current);
  }

  return workItems.map((item) => {
    const counts = childCounts.get(String(item.id));
    if (!counts) {
      return item;
    }
    return {
      ...item,
      children_count: counts.total,
      children_completed: counts.completed,
      is_milestone: counts.total > 0,
    };
  });
}

function toWorkflowRelationRef(workflowId: string, row?: Record<string, unknown>) {
  return {
    workflow_id: workflowId,
    name: asOptionalString(row?.name) ?? null,
    state: asOptionalString(row?.state) ?? 'unknown',
    playbook_id: asOptionalString(row?.playbook_id) ?? null,
    playbook_name: asOptionalString(row?.playbook_name) ?? null,
    created_at: row?.created_at ?? null,
    started_at: row?.started_at ?? null,
    completed_at: row?.completed_at ?? null,
    is_terminal: ['completed', 'failed', 'cancelled'].includes(asOptionalString(row?.state) ?? ''),
    link: `/workflows/${workflowId}`,
  };
}

function readWorkflowIdArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isCompletedBoardChild(
  item: Record<string, unknown>,
  terminalColumns: Set<string>,
) {
  const columnId = asOptionalString(item.column_id);
  if (columnId && terminalColumns.has(columnId)) {
    return true;
  }
  return item.completed_at != null;
}

function normalizeWorkflowReadModel(
  workflow: Record<string, unknown>,
  detailSummary?: WorkflowWorkItemSummary,
) {
  if (workflow.lifecycle !== 'continuous') {
    return workflow;
  }

  const workItemSummary = normalizeWorkflowWorkItemSummary(
    detailSummary ?? asRecord(workflow.work_item_summary),
  );

  const { current_stage: _currentStage, ...rest } = workflow;
  return {
    ...rest,
    ...(workItemSummary ? { work_item_summary: workItemSummary } : {}),
    active_stages: workItemSummary?.active_stage_names ?? [],
  };
}

function normalizeWorkflowWorkItemSummary(value: unknown): WorkflowWorkItemSummary | null {
  const summary = asRecord(value);
  if (Object.keys(summary).length === 0) {
    return null;
  }
  const activeStageNames = uniqueStageNames(summary.active_stage_names);
  return {
    total_work_items: readCount(summary.total_work_items),
    open_work_item_count: readCount(summary.open_work_item_count),
    completed_work_item_count: readCount(summary.completed_work_item_count),
    active_stage_count: activeStageNames.length,
    awaiting_gate_count: readCount(summary.awaiting_gate_count),
    active_stage_names: activeStageNames,
  };
}

function buildWorkflowWorkItemSummary(
  workItems: Array<Record<string, unknown>>,
  workflowStages: Array<Record<string, unknown>>,
): WorkflowWorkItemSummary {
  const totalWorkItems = workItems.length;
  const openWorkItems = workItems.filter((item) => item.completed_at == null);
  const gateActiveStages = workflowStages
    .filter((stage) => isActiveContinuousGateState(stage.gate_status))
    .map((stage) => stage.name);
  const activeStageNames = uniqueStageNames([
    ...openWorkItems.map((item) => item.stage_name),
    ...gateActiveStages,
  ]);
  const awaitingGateCount = workflowStages.filter((stage) => stage.gate_status === 'awaiting_approval').length;
  return {
    total_work_items: totalWorkItems,
    open_work_item_count: openWorkItems.length,
    completed_work_item_count: totalWorkItems - openWorkItems.length,
    active_stage_count: activeStageNames.length,
    awaiting_gate_count: awaitingGateCount,
    active_stage_names: activeStageNames,
  };
}

function buildBoardStageSummary(
  stageDefinitions: Array<{ name: string; goal: string }>,
  workflowStages: Array<Record<string, unknown>>,
  workItems: Array<Record<string, unknown>>,
  terminalColumns: Set<string>,
) {
  const stageNames = new Set<string>();
  for (const stage of stageDefinitions) {
    stageNames.add(stage.name);
  }
  for (const stage of workflowStages) {
    if (typeof stage.name === 'string' && stage.name.length > 0) {
      stageNames.add(stage.name);
    }
  }

  return Array.from(stageNames).map((stageName) => {
    const definition = stageDefinitions.find((stage) => stage.name === stageName);
    const workflowStage = workflowStages.find((stage) => stage.name === stageName);
    const stageItems = workItems.filter((item) => item.stage_name === stageName);
    const completedCount = stageItems.filter((item) => terminalColumns.has(String(item.column_id))).length;
    const openCount = stageItems.length - completedCount;
    const status = typeof workflowStage?.status === 'string' ? workflowStage.status : 'pending';
    return {
      name: stageName,
      goal: definition?.goal ?? String(workflowStage?.goal ?? ''),
      status,
      is_active: isActiveStageStatus(status),
      gate_status:
        typeof workflowStage?.gate_status === 'string' ? workflowStage.gate_status : 'not_requested',
      work_item_count: stageItems.length,
      open_work_item_count: openCount,
      completed_count: completedCount,
    };
  });
}

function uniqueStageNames(values: unknown): string[] {
  const entries = Array.isArray(values) ? values : [];
  return Array.from(
    new Set(
      entries.filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  );
}

function readCount(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function isActiveStageStatus(status: unknown) {
  return status === 'active' || status === 'awaiting_gate' || status === 'blocked';
}

function isActiveContinuousGateState(gateStatus: unknown) {
  return gateStatus === 'awaiting_approval' || gateStatus === 'changes_requested' || gateStatus === 'rejected';
}
