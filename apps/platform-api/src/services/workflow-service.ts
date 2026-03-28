import type { ApiKeyIdentity } from '../auth/api-key.js';
import { buildArtifactStorageConfig } from '../content/storage-config.js';
import { createArtifactStorage } from '../content/storage-factory.js';
import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { TenantScopedRepository } from '../db/tenant-scoped-repository.js';
import { ConflictError, NotFoundError } from '../errors/domain-errors.js';
import { parsePlaybookDefinition } from '../orchestration/playbook-model.js';
import { buildResolvedConfigView } from './config-hierarchy-service.js';
import { ArtifactRetentionService } from './artifact-retention-service.js';
import { WorkflowActivationService } from './workflow-activation-service.js';
import { WorkflowActivationDispatchService } from './workflow-activation-dispatch-service.js';
import { WorkflowBudgetService } from './workflow-budget-service.js';
import { WorkflowCancellationService } from './workflow-cancellation-service.js';
import { WorkflowControlService } from './workflow-control-service.js';
import { WorkflowCreationService } from './workflow-creation-service.js';
import { EventService } from './event-service.js';
import { ModelCatalogService } from './model-catalog-service.js';
import {
  PlaybookWorkflowControlService,
  type AdvanceStageInput,
  type CompleteWorkflowInput,
  type ResolveWorkflowWorkItemEscalationInput,
  type StageGateDecisionInput,
  type StageGateRequestInput,
  type UpdateWorkflowWorkItemInput,
} from './playbook-workflow-control-service.js';
import type { TaskService } from './task-service.js';
import {
  WorkItemService,
  type GetWorkflowWorkItemInput,
  type GroupedWorkItemReadModel,
  type ListWorkflowWorkItemsInput,
  type WorkItemReadModel,
} from './work-item-service.js';
import {
  deriveWorkflowStageProjection,
} from './workflow-stage-projection.js';
import {
  isActiveStageStatus,
  WorkflowStageService,
  type WorkflowStageResponse,
} from './workflow-stage-service.js';
import { WorkflowStateService } from './workflow-state-service.js';
import { WorkspaceTimelineService } from './workspace-timeline-service.js';
import { sanitizeSecretLikeRecord, sanitizeSecretLikeValue } from './secret-redaction.js';
import { buildWorkflowReadColumns } from './workflow-read-columns.js';
import { readTaskCancelSignalGracePeriodMs } from './platform-timing-defaults.js';
import type { LogService } from '../logging/log-service.js';
import type { WorkerConnectionHub } from './worker-connection-hub.js';
import type { WorkflowInputPacketService } from './workflow-input-packet-service.js';
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
  private readonly workspaceTimelineService: WorkspaceTimelineService;
  private readonly activationService: WorkflowActivationService;
  private readonly activationDispatchService: WorkflowActivationDispatchService;
  private readonly budgetService: WorkflowBudgetService;
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
    taskService?: Pick<TaskService, 'requestTaskChanges'>,
    workflowInputPacketService?: Pick<WorkflowInputPacketService, 'createWorkflowInputPacket'>,
  ) {
    this.workspaceTimelineService = new WorkspaceTimelineService(pool);
    this.modelCatalogService = new ModelCatalogService(pool);
    const artifactRetentionService = new ArtifactRetentionService(
      pool,
      createArtifactStorage(buildArtifactStorageConfig(config)),
    );
    const stateService = new WorkflowStateService(
      pool,
      eventService,
      artifactRetentionService,
      this.workspaceTimelineService,
      logService,
    );
    this.activationService = new WorkflowActivationService(pool, eventService);
    this.activationDispatchService = new WorkflowActivationDispatchService({
      pool,
      eventService,
      config,
    });
    this.budgetService = new WorkflowBudgetService(
      pool,
      eventService,
      {
        WORKFLOW_BUDGET_WARNING_RATIO: config.WORKFLOW_BUDGET_WARNING_RATIO,
      },
      this.activationService,
      this.activationDispatchService,
    );
    this.stageService = new WorkflowStageService(pool);
    this.creationService = new WorkflowCreationService({
      pool,
      eventService,
      stateService,
      activationService: this.activationService,
      activationDispatchService: this.activationDispatchService,
      stageService: this.stageService,
      modelCatalogService: this.modelCatalogService,
      inputPacketService: workflowInputPacketService,
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
      subjectTaskChangeService: taskService,
    });
    this.cancellationService = new WorkflowCancellationService({
      pool,
      eventService,
      stateService,
      resolveCancelSignalGracePeriodMs: async (tenantId: string) =>
        readTaskCancelSignalGracePeriodMs(pool, tenantId),
      workerConnectionHub: connectionHub,
      getWorkflow: this.getWorkflow.bind(this),
    });
    this.controlService = new WorkflowControlService(pool, eventService, stateService);
  }

  createWorkflow(identity: ApiKeyIdentity, input: CreateWorkflowInput) {
    return this.creationService.createWorkflow(identity, input);
  }

  getWorkflowBudget(tenantId: string, workflowId: string, client?: DatabaseClient) {
    return this.budgetService.getBudgetSnapshot(tenantId, workflowId, client);
  }

  evaluateWorkflowBudget(tenantId: string, workflowId: string, client?: DatabaseClient) {
    return this.budgetService.evaluatePolicy(tenantId, workflowId, client);
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
      [query.workspace_id, 'w.workspace_id'],
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
        `SELECT ${buildWorkflowReadColumns('w', { includeCurrentStage: false })},
                p.name AS workspace_name,
                pb.name AS playbook_name,
                pb.definition AS playbook_definition,
                COALESCE(task_counts.task_counts, '{}'::jsonb) AS task_counts,
                CASE
                  WHEN w.lifecycle = 'planned'
                  THEN stage_summary.current_stage_name
                  ELSE NULL
                END AS current_stage,
                CASE
                  WHEN w.playbook_id IS NULL THEN NULL
                  ELSE jsonb_build_object(
                    'total_work_items', COALESCE(work_item_summary.total_work_items, 0),
                    'open_work_item_count', COALESCE(work_item_summary.open_work_item_count, 0),
                    'blocked_work_item_count', COALESCE(work_item_summary.blocked_work_item_count, 0),
                    'completed_work_item_count', COALESCE(work_item_summary.completed_work_item_count, 0),
                    'active_stage_count', CASE
                      WHEN w.lifecycle = 'ongoing'
                      THEN COALESCE(work_item_summary.active_stage_count, 0)
                      ELSE COALESCE(stage_summary.active_stage_count, COALESCE(work_item_summary.active_stage_count, 0))
                    END,
                    'awaiting_gate_count', COALESCE(stage_summary.awaiting_gate_count, 0),
                    'active_stage_names', CASE
                      WHEN w.lifecycle = 'ongoing'
                      THEN COALESCE(to_jsonb(work_item_summary.active_stage_names), '[]'::jsonb)
                      ELSE COALESCE(to_jsonb(stage_summary.active_stage_names), '[]'::jsonb)
                    END
                  )
                END AS work_item_summary
           FROM workflows w
           LEFT JOIN workspaces p
             ON p.tenant_id = w.tenant_id
            AND p.id = w.workspace_id
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
                    COUNT(*) FILTER (WHERE completed_at IS NULL AND blocked_state = 'blocked')::int AS blocked_work_item_count,
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
                    )::int AS active_stage_count,
                    (
                      SELECT ws_active.name
                        FROM workflow_stages ws_active
                       WHERE ws_active.tenant_id = w.tenant_id
                         AND ws_active.workflow_id = w.id
                         AND ws_active.status IN ('active', 'awaiting_gate', 'blocked')
                       ORDER BY ws_active.position ASC
                       LIMIT 1
                    ) AS current_stage_name
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

    const workflowsWithBlockedSummary = await this.attachBlockedWorkItemCounts(tenantId, rows.rows);
    const workflowsWithRelations = await this.attachWorkflowRelations(tenantId, workflowsWithBlockedSummary);
    return {
      data: workflowsWithRelations.map((workflow) => normalizeWorkflowReadModel(sanitizeWorkflowReadModel(workflow))),
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
      buildWorkflowReadColumns(undefined, { includeCurrentStage: false }),
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
      const [workItems, activations, workflowStages, playbookDefinition] = await Promise.all([
        this.workItemService.listWorkflowWorkItems(tenantId, workflowId),
        this.activationService.listWorkflowActivations(tenantId, workflowId),
        this.stageService.listStages(tenantId, workflowId),
        this.loadPlaybookDefinition(tenantId, String(workflowRow.playbook_id)),
      ]);
      const workflowWithRelations = await this.attachWorkflowRelations(tenantId, [workflowRow]);
      const workflowReadModel = {
        ...asRecord(workflowWithRelations[0]),
        playbook_definition: playbookDefinition,
      };
      const terminalColumns = readTerminalColumns(playbookDefinition);
      const projection = deriveWorkflowStageProjection({
        lifecycle: workflowRow.lifecycle === 'ongoing' ? 'ongoing' : 'planned',
        stageRows: workflowStages,
        openWorkItemStageNames: Array.from(
          new Set(
            workItems
              .filter((item) => isBoardItemOpen(item, terminalColumns))
              .map((item) => String(item.stage_name)),
          ),
        ),
        definition: playbookDefinition,
      });
      const normalizedWorkflow = normalizeWorkflowReadModel(
        sanitizeWorkflowReadModel(workflowReadModel),
        buildWorkflowWorkItemSummary(workItems, workflowStages, terminalColumns),
      );
      return {
        ...normalizedWorkflow,
        ...(workflowRow.lifecycle !== 'ongoing'
          ? {
              current_stage: projection.currentStage,
            }
          : {}),
        tasks: tasks.map((task) => sanitizeTaskReadModel(task)),
        work_items: workItems,
        activations,
        workflow_stages: workflowStages,
        active_stages: projection.activeStages,
      } as Record<string, unknown>;
    }
    const workflowWithRelations = await this.attachWorkflowRelations(tenantId, [workflowRow]);
    return {
      ...normalizeWorkflowReadModel(sanitizeWorkflowReadModel(workflowWithRelations[0])),
      tasks: tasks.map((task) => sanitizeTaskReadModel(task)),
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
      const parentId = asOptionalString(metadata.parent_workflow_id);
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

  private async attachBlockedWorkItemCounts(
    tenantId: string,
    workflows: Array<Record<string, unknown> & { tenant_id: string }>,
  ) {
    if (workflows.length === 0) {
      return workflows;
    }

    const workflowIds = workflows.map((workflow) => String(workflow.id));
    const blockedCounts = await this.loadBlockedWorkItemCounts(tenantId, workflowIds);

    return workflows.map((workflow) => {
      const blockedWorkItemCount = blockedCounts.get(String(workflow.id)) ?? 0;
      const workItemSummary = asRecord(workflow.work_item_summary);
      if (Object.keys(workItemSummary).length === 0) {
        return workflow;
      }
      return {
        ...workflow,
        work_item_summary: {
          ...workItemSummary,
          blocked_work_item_count: blockedWorkItemCount,
        },
      };
    });
  }

  private async loadBlockedWorkItemCounts(tenantId: string, workflowIds: string[]) {
    if (workflowIds.length === 0) {
      return new Map<string, number>();
    }

    const result = await this.pool.query<{ workflow_id: string; blocked_work_item_count: number }>(
      `SELECT wi.workflow_id,
              COUNT(*) FILTER (
                WHERE wi.completed_at IS NULL
                  AND (
                    COALESCE(assessment_rollup.blocking_assessment_count, 0) > 0
                    OR COALESCE(latest_gate.gate_status, '') IN ('changes_requested', 'rejected')
                  )
              )::int AS blocked_work_item_count
         FROM workflow_work_items wi
         JOIN workflows w
           ON w.tenant_id = wi.tenant_id
          AND w.id = wi.workflow_id
         LEFT JOIN workflow_stages ws
           ON ws.tenant_id = wi.tenant_id
          AND ws.workflow_id = wi.workflow_id
          AND ws.name = wi.stage_name
         LEFT JOIN LATERAL (
           SELECT th.task_id AS subject_task_id,
                  th.role AS subject_role,
                  NULLIF(COALESCE(NULLIF(th.role_data->>'subject_revision', '')::int, 0), 0) AS subject_revision
             FROM task_handoffs th
            WHERE th.tenant_id = wi.tenant_id
              AND th.workflow_id = wi.workflow_id
              AND th.work_item_id = wi.id
              AND COALESCE(th.role_data->>'task_kind', 'delivery') = 'delivery'
              AND th.completion = 'full'
            ORDER BY th.sequence DESC, th.created_at DESC
            LIMIT 1
         ) latest_delivery ON true
         LEFT JOIN LATERAL (
           SELECT COUNT(*) FILTER (
                    WHERE latest_assessment.decision_state IN ('request_changes', 'rejected')
                  )::int AS blocking_assessment_count
             FROM (
               SELECT DISTINCT ON (assessment_task.role)
                      assessment_task.role,
                      COALESCE(latest_assessment_handoff.decision_state, latest_assessment_handoff.resolution) AS decision_state
                 FROM tasks assessment_task
                 LEFT JOIN LATERAL (
                   SELECT th.decision_state,
                          th.resolution
                     FROM task_handoffs th
                    WHERE th.tenant_id = assessment_task.tenant_id
                      AND th.workflow_id = assessment_task.workflow_id
                      AND th.task_id = assessment_task.id
                    ORDER BY th.sequence DESC, th.created_at DESC
                    LIMIT 1
                 ) latest_assessment_handoff ON true
                WHERE assessment_task.tenant_id = wi.tenant_id
                  AND assessment_task.workflow_id = wi.workflow_id
                  AND COALESCE(assessment_task.metadata->>'task_kind', '') = 'assessment'
                  AND COALESCE(assessment_task.metadata->>'subject_task_id', '') = COALESCE(latest_delivery.subject_task_id::text, '')
                  AND COALESCE(NULLIF(assessment_task.metadata->>'subject_revision', '')::int, -1) = COALESCE(latest_delivery.subject_revision, -1)
                ORDER BY assessment_task.role,
                         assessment_task.created_at DESC,
                         assessment_task.id DESC
             ) latest_assessment
         ) assessment_rollup ON latest_delivery.subject_task_id IS NOT NULL
         LEFT JOIN LATERAL (
           SELECT g.status AS gate_status
             FROM workflow_stage_gates g
            WHERE g.tenant_id = wi.tenant_id
              AND g.workflow_id = wi.workflow_id
              AND g.stage_id = ws.id
            ORDER BY g.requested_at DESC, g.created_at DESC
            LIMIT 1
         ) latest_gate ON true
        WHERE wi.tenant_id = $1
          AND wi.workflow_id = ANY($2::uuid[])
        GROUP BY wi.workflow_id`,
      [tenantId, workflowIds],
    );

    return new Map(
      result.rows.map((row) => [String(row.workflow_id), Number(row.blocked_work_item_count ?? 0)]),
    );
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
      playbook: sanitizeWorkflowConfigView((rawLayers.playbook ?? {}) as Record<string, unknown>),
      workspace: sanitizeWorkflowConfigView((rawLayers.workspace ?? {}) as Record<string, unknown>),
      run: sanitizeWorkflowConfigView((rawLayers.run ?? {}) as Record<string, unknown>),
    };

    return {
      workflow_id: workflowId,
      resolved_config: buildResolvedConfigView(sanitizeWorkflowConfigView(resolved), layers, showLayers),
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
    client?: DatabaseClient,
  ) {
    return this.playbookControlService.updateWorkItem(identity, workflowId, workItemId, input, client);
  }

  resolveWorkflowWorkItemEscalation(
    identity: ApiKeyIdentity,
    workflowId: string,
    workItemId: string,
    input: ResolveWorkflowWorkItemEscalationInput,
    client?: DatabaseClient,
  ) {
    return this.playbookControlService.resolveWorkItemEscalation(
      identity,
      workflowId,
      workItemId,
      input,
      client,
    );
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
      ? (workflow.workflow_stages as WorkflowStageResponse[])
      : [];
    const terminalColumns = new Set(
      definition.board.columns
        .filter((column) => Boolean(column.is_terminal))
        .map((column) => String(column.id)),
    );
    const boardWorkItems = annotateBoardWorkItems(workItems, terminalColumns);
    const stageSummary = buildBoardStageSummary(
      String(workflow.lifecycle ?? 'planned'),
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

  getWorkspaceTimeline(tenantId: string, workspaceId: string) {
    return this.workspaceTimelineService.getWorkspaceTimeline(tenantId, workspaceId);
  }

  private async loadPlaybookDefinition(tenantId: string, playbookId: string): Promise<Record<string, unknown>> {
    const result = await this.pool.query<{ definition: Record<string, unknown> }>(
      `SELECT definition
         FROM playbooks
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, playbookId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Playbook workflow not found');
    }
    return result.rows[0].definition ?? {};
  }
}

function buildWorkflowRelations(
  metadata: Record<string, unknown>,
  relatedById: Map<string, Record<string, unknown>>,
) {
  const parentId = asOptionalString(metadata.parent_workflow_id);
  const childIds = readWorkflowIdArray(metadata.child_workflow_ids);
  const parent = parentId ? toWorkflowRelationRef(parentId, relatedById.get(parentId)) : null;
  const children = childIds.map((childId) => toWorkflowRelationRef(childId, relatedById.get(childId)));

  return {
    parent,
    children,
    latest_child_workflow_id: asOptionalString(metadata.latest_child_workflow_id) ?? null,
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
  const orderedSummary = normalizeWorkflowWorkItemSummary(
    detailSummary ?? asRecord(workflow.work_item_summary),
    workflow.playbook_definition,
  );
  if (workflow.lifecycle !== 'ongoing') {
    const { playbook_definition: _playbookDefinition, ...rest } = workflow;
    return rest;
  }

  const { current_stage: _currentStage, playbook_definition: _playbookDefinition, ...rest } = workflow;
  return {
    ...rest,
    ...(orderedSummary ? { work_item_summary: orderedSummary } : {}),
    active_stages: orderedSummary?.active_stage_names ?? [],
  };
}

function sanitizeWorkflowReadModel(workflow: Record<string, unknown>) {
  return {
    ...workflow,
    metadata: sanitizeWorkflowMetadata(workflow.metadata),
    context: sanitizeWorkflowContext(workflow.context),
    parameters: sanitizeWorkflowParameters(workflow.parameters),
    resolved_config: sanitizeWorkflowConfigView(workflow.resolved_config),
    config_layers: sanitizeWorkflowConfigLayers(workflow.config_layers),
  };
}

function sanitizeTaskReadModel(task: Record<string, unknown>) {
  return {
    ...task,
    input: sanitizeTaskPayload(task.input),
    context: sanitizeTaskPayload(task.context),
    output: sanitizeTaskPayload(task.output),
    error: sanitizeTaskPayload(task.error),
    role_config: sanitizeTaskPayload(task.role_config),
    environment: sanitizeTaskPayload(task.environment),
    resource_bindings: sanitizeTaskPayload(task.resource_bindings),
    metrics: sanitizeTaskPayload(task.metrics),
    git_info: sanitizeTaskPayload(task.git_info),
    metadata: sanitizeTaskPayload(task.metadata),
  };
}

function sanitizeWorkflowMetadata(value: unknown) {
  return sanitizeSecretLikeRecord(value, {
    redactionValue: 'redacted://workflow-metadata-secret',
    allowSecretReferences: false,
  });
}

function sanitizeWorkflowContext(value: unknown) {
  return sanitizeSecretLikeRecord(value, {
    redactionValue: 'redacted://workflow-context-secret',
    allowSecretReferences: false,
  });
}

function sanitizeWorkflowParameters(value: unknown) {
  return sanitizeSecretLikeRecord(value, {
    redactionValue: 'redacted://workflow-parameters-secret',
    allowSecretReferences: false,
  });
}

function sanitizeWorkflowConfigView(value: unknown) {
  return sanitizeSecretLikeRecord(value, {
    redactionValue: 'redacted://workflow-config-secret',
    allowSecretReferences: false,
  });
}

function sanitizeWorkflowConfigLayers(value: unknown) {
  return sanitizeSecretLikeRecord(value, {
    redactionValue: 'redacted://workflow-config-secret',
    allowSecretReferences: false,
  });
}

function sanitizeTaskPayload(value: unknown) {
  return sanitizeSecretLikeValue(value, {
    redactionValue: 'redacted://task-secret',
    allowSecretReferences: false,
  });
}

function normalizeWorkflowWorkItemSummary(
  value: unknown,
  definition: unknown,
): WorkflowWorkItemSummary | null {
  const summary = asRecord(value);
  if (Object.keys(summary).length === 0) {
    return null;
  }
  const activeStageNames = orderStageNamesByDefinition(uniqueStageNames(summary.active_stage_names), definition);
  return {
    total_work_items: readCount(summary.total_work_items),
    open_work_item_count: readCount(summary.open_work_item_count),
    blocked_work_item_count: readCount(summary.blocked_work_item_count),
    completed_work_item_count: readCount(summary.completed_work_item_count),
    active_stage_count: activeStageNames.length,
    awaiting_gate_count: readCount(summary.awaiting_gate_count),
    active_stage_names: activeStageNames,
  };
}

function orderStageNamesByDefinition(stageNames: string[], definition: unknown): string[] {
  if (stageNames.length <= 1) {
    return stageNames;
  }
  const stageOrder = readPlaybookStageOrder(definition);
  if (stageOrder.length === 0) {
    return stageNames;
  }
  const remaining = new Set(stageNames);
  const ordered: string[] = [];

  for (const stageName of stageOrder) {
    if (!remaining.has(stageName)) {
      continue;
    }
    ordered.push(stageName);
    remaining.delete(stageName);
  }
  for (const stageName of stageNames) {
    if (!remaining.has(stageName)) {
      continue;
    }
    ordered.push(stageName);
    remaining.delete(stageName);
  }
  return ordered;
}

function readPlaybookStageOrder(definition: unknown): string[] {
  try {
    return parsePlaybookDefinition(definition).stages.map((stage) => stage.name);
  } catch {
    return [];
  }
}

function buildWorkflowWorkItemSummary(
  workItems: Array<Record<string, unknown>>,
  workflowStages: Array<Pick<WorkflowStageResponse, 'name' | 'position' | 'gate_status'>>,
  terminalColumns: Set<string>,
): WorkflowWorkItemSummary {
  const totalWorkItems = workItems.length;
  const openWorkItems = workItems.filter((item) => isBoardItemOpen(item, terminalColumns));
  const blockedWorkItemCount = openWorkItems.filter((item) => isBlockedBoardItem(item)).length;
  const activeStageNames = orderStageNames(
    uniqueStageNames(openWorkItems.map((item) => item.stage_name)),
    workflowStages,
  );
  const awaitingGateCount = workflowStages.filter((stage) => stage.gate_status === 'awaiting_approval').length;
  return {
    total_work_items: totalWorkItems,
    open_work_item_count: openWorkItems.length,
    blocked_work_item_count: blockedWorkItemCount,
    completed_work_item_count: totalWorkItems - openWorkItems.length,
    active_stage_count: activeStageNames.length,
    awaiting_gate_count: awaitingGateCount,
    active_stage_names: activeStageNames,
  };
}

function isBlockedBoardItem(item: Record<string, unknown>) {
  if (item.completed_at != null) {
    return false;
  }
  const blockedState = asOptionalString(item.blocked_state);
  if (blockedState === 'blocked') {
    return true;
  }
  const assessmentStatus = asOptionalString(item.assessment_status);
  if (assessmentStatus === 'blocked') {
    return true;
  }
  const gateStatus = asOptionalString(item.gate_status);
  return gateStatus === 'blocked' || gateStatus === 'changes_requested' || gateStatus === 'rejected';
}

function readTerminalColumns(definition: unknown): Set<string> {
  try {
    const parsed = parsePlaybookDefinition(definition);
    return new Set(
      parsed.board.columns
        .filter((column) => Boolean(column.is_terminal))
        .map((column) => String(column.id)),
    );
  } catch {
    return new Set<string>();
  }
}

function isBoardItemOpen(item: Record<string, unknown>, terminalColumns: Set<string>): boolean {
  return !isCompletedBoardChild(item, terminalColumns);
}

function orderStageNames(
  stageNames: string[],
  workflowStages: Array<Pick<WorkflowStageResponse, 'name'>>,
): string[] {
  const orderedStageNames = workflowStages.map((stage) => stage.name).filter(Boolean);
  const remaining = new Set(stageNames);
  const ordered: string[] = [];

  for (const stageName of orderedStageNames) {
    if (!remaining.has(stageName)) {
      continue;
    }
    ordered.push(stageName);
    remaining.delete(stageName);
  }

  for (const stageName of stageNames) {
    if (!remaining.has(stageName)) {
      continue;
    }
    ordered.push(stageName);
    remaining.delete(stageName);
  }

  return ordered;
}

function buildBoardStageSummary(
  lifecycle: string,
  stageDefinitions: Array<{ name: string; goal: string }>,
  workflowStages: WorkflowStageResponse[],
  workItems: Array<Record<string, unknown>>,
  terminalColumns: Set<string>,
) {
  const stageNames = new Set<string>();
  if (lifecycle !== 'ongoing') {
    for (const stage of stageDefinitions) {
      stageNames.add(stage.name);
    }
  }
  for (const stage of workflowStages) {
    stageNames.add(stage.name);
  }
  for (const item of workItems) {
    const stageName = asOptionalString(item.stage_name);
    if (stageName) {
      stageNames.add(stageName);
    }
  }

  const workflowStageByName = new Map(workflowStages.map((stage) => [stage.name, stage]));
  const orderedStageNames =
    lifecycle === 'ongoing'
      ? orderStageNames(Array.from(stageNames), workflowStages)
      : Array.from(stageNames);
  return orderedStageNames.map((stageName) => {
    const definition = stageDefinitions.find((stage) => stage.name === stageName);
    const workflowStage = workflowStageByName.get(stageName);
    const stageItems = workItems.filter((item) => item.stage_name === stageName);
    const fallbackCompletedCount = stageItems.filter((item) =>
      isCompletedBoardChild(item, terminalColumns),
    ).length;
    const fallbackOpenCount = stageItems.length - fallbackCompletedCount;
    const workItemCount = workflowStage?.total_work_item_count ?? stageItems.length;
    const openCount = workflowStage?.open_work_item_count ?? fallbackOpenCount;
    const completedCount = Math.max(workItemCount - openCount, 0);
    const status = workflowStage?.status ?? 'pending';
    return {
      name: stageName,
      goal: definition?.goal ?? workflowStage?.goal ?? '',
      status,
      is_active: workflowStage?.is_active ?? isActiveStageStatus(status),
      gate_status: workflowStage?.gate_status ?? 'not_requested',
      work_item_count: workItemCount,
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
