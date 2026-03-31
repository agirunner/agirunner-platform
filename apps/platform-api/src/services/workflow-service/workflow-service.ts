import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { ArtifactStorageAdapter } from '../../content/artifact-storage.js';
import { buildArtifactStorageConfig } from '../../content/storage-config.js';
import { createArtifactStorage } from '../../content/storage-factory.js';
import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import { ArtifactRetentionService } from '../artifacts/artifact-retention-service.js';
import { DestructiveDeleteService } from '../destructive-delete/destructive-delete-service.js';
import { WorkflowActivationService } from '../workflow-activation/workflow-activation-service.js';
import { WorkflowActivationDispatchService } from '../workflow-activation-dispatch/workflow-activation-dispatch-service.js';
import { WorkflowBudgetService } from '../workflow-budget-service.js';
import { WorkflowCancellationService } from '../workflow-cancellation-service.js';
import { WorkflowControlService } from '../workflow-control-service.js';
import { WorkflowCreationService } from './workflow-creation-service.js';
import { WorkflowDeliverableService } from '../workflow-deliverables/workflow-deliverable-service.js';
import { EventService } from '../event/event-service.js';
import {
  PlaybookWorkflowControlService,
  type AdvanceStageInput,
  type CompleteWorkflowInput,
  type ResolveWorkflowWorkItemEscalationInput,
  type StageGateDecisionInput,
  type StageGateRequestInput,
  type UpdateWorkflowWorkItemInput,
} from '../playbook-workflow-control/playbook-workflow-control-service.js';
import type { TaskService } from '../task/task-service.js';
import {
  type CreateWorkflowWorkItemEnvelopeInput,
  WorkflowAddWorkService,
} from '../workflow-add-work-service.js';
import { WorkItemService } from '../work-item-service/work-item-service.js';
import type {
  GetWorkflowWorkItemInput,
  GroupedWorkItemReadModel,
  ListWorkflowWorkItemsInput,
  WorkItemReadModel,
} from '../work-item-service/types.js';
import { WorkflowStageService } from '../workflow-stage/workflow-stage-service.js';
import { WorkflowStateService } from '../workflow-state-service.js';
import { WorkflowWorkItemControlService } from '../workflow-work-item-control-service.js';
import { WorkspaceTimelineService } from '../workspace/timeline/workspace-timeline-service.js';
import { readTaskCancelSignalGracePeriodMs } from '../platform-config/platform-timing-defaults.js';
import { deleteWorkflow as deleteWorkflowRecord } from './workflow-delete-service.js';
import {
  getWorkflow as getWorkflowRecord,
  getWorkflowBoard as getWorkflowBoardRecord,
  listWorkflows as listWorkflowRecords,
  type WorkflowQueryDependencies,
} from './workflow-query-service.js';
import type { LogService } from '../../logging/log-service.js';
import type { WorkerConnectionHub } from '../workers/worker-connection-hub.js';
import type { WorkflowInputPacketService } from '../workflow-input-packet-service.js';
import type {
  CreateWorkflowInput,
  ListWorkflowQuery,
  WorkflowServiceConfig,
} from './workflow-service.types.js';

export class WorkflowService {
  private readonly artifactStorage: ArtifactStorageAdapter;
  private readonly creationService: WorkflowCreationService;
  private readonly cancellationService: WorkflowCancellationService;
  private readonly controlService: WorkflowControlService;
  private readonly workspaceTimelineService: WorkspaceTimelineService;
  private readonly activationService: WorkflowActivationService;
  private readonly activationDispatchService: WorkflowActivationDispatchService;
  private readonly budgetService: WorkflowBudgetService;
  private readonly workItemService: WorkItemService;
  private readonly workItemControlService: WorkflowWorkItemControlService;
  private readonly stageService: WorkflowStageService;
  private readonly playbookControlService: PlaybookWorkflowControlService;
  private readonly addWorkService: WorkflowAddWorkService;
  private readonly destructiveDeleteService: Pick<DestructiveDeleteService, 'deleteWorkflowsPermanently'>;

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
    this.artifactStorage = createArtifactStorage(buildArtifactStorageConfig(config));
    const artifactRetentionService = new ArtifactRetentionService(pool, this.artifactStorage);
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
      inputPacketService: workflowInputPacketService,
    });
    this.workItemService = new WorkItemService(
      pool,
      eventService,
      this.activationService,
      this.activationDispatchService,
    );
    this.workItemControlService = new WorkflowWorkItemControlService({
      pool,
      eventService,
      stateService,
      resolveCancelSignalGracePeriodMs: async (tenantId: string) =>
        readTaskCancelSignalGracePeriodMs(pool, tenantId),
      workerConnectionHub: connectionHub,
      getWorkflowWorkItem: (tenantId, workflowId, workItemId) =>
        this.workItemService.getWorkflowWorkItem(tenantId, workflowId, workItemId),
    });
    this.addWorkService = new WorkflowAddWorkService({
      pool,
      workItemService: this.workItemService,
      activationService: this.activationService,
      activationDispatchService: this.activationDispatchService,
      inputPacketService: workflowInputPacketService,
    });
    this.playbookControlService = new PlaybookWorkflowControlService({
      pool,
      eventService,
      stateService,
      activationService: this.activationService,
      activationDispatchService: this.activationDispatchService,
      subjectTaskChangeService: taskService,
      workflowDeliverableService: new WorkflowDeliverableService(pool),
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
    this.controlService = new WorkflowControlService(pool, eventService, stateService, {
      resolveCancelSignalGracePeriodMs: async (tenantId: string) =>
        readTaskCancelSignalGracePeriodMs(pool, tenantId),
      workerConnectionHub: connectionHub,
    });
    this.destructiveDeleteService = new DestructiveDeleteService(pool, {
      cancelWorkflow: this.cancelWorkflow.bind(this),
      artifactStorage: this.artifactStorage,
    });
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

  listWorkflows(tenantId: string, query: ListWorkflowQuery) {
    return listWorkflowRecords(this.pool, tenantId, query);
  }

  getWorkflow(tenantId: string, workflowId: string) {
    return getWorkflowRecord(this.buildQueryDependencies(), tenantId, workflowId);
  }

  deleteWorkflow(identity: ApiKeyIdentity, workflowId: string) {
    return deleteWorkflowRecord({
      artifactStorage: this.artifactStorage,
      eventService: this.eventService,
      identity,
      pool: this.pool,
      workflowId,
    });
  }

  deleteWorkflowsPermanently(identity: ApiKeyIdentity, workflowIds: string[]) {
    return this.destructiveDeleteService.deleteWorkflowsPermanently(identity, workflowIds);
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

  pauseWorkflowWorkItem(identity: ApiKeyIdentity, workflowId: string, workItemId: string) {
    return this.workItemControlService.pauseWorkflowWorkItem(identity, workflowId, workItemId);
  }

  resumeWorkflowWorkItem(identity: ApiKeyIdentity, workflowId: string, workItemId: string) {
    return this.workItemControlService.resumeWorkflowWorkItem(identity, workflowId, workItemId);
  }

  cancelWorkflowWorkItem(identity: ApiKeyIdentity, workflowId: string, workItemId: string) {
    return this.workItemControlService.cancelWorkflowWorkItem(identity, workflowId, workItemId);
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
    input: CreateWorkflowWorkItemEnvelopeInput,
    client?: DatabaseClient,
  ) {
    return this.addWorkService.createWorkItem(identity, workflowId, input, client);
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

  getWorkflowBoard(tenantId: string, workflowId: string) {
    return getWorkflowBoardRecord(this.buildQueryDependencies(), tenantId, workflowId);
  }

  getWorkspaceTimeline(tenantId: string, workspaceId: string) {
    return this.workspaceTimelineService.getWorkspaceTimeline(tenantId, workspaceId);
  }

  private buildQueryDependencies(): WorkflowQueryDependencies {
    return {
      activationService: this.activationService,
      pool: this.pool,
      stageService: this.stageService,
      workItemService: this.workItemService,
    };
  }
}
