import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import type { EventService } from '../event-service.js';
import type { WorkflowActivationDispatchService } from '../workflow-activation-dispatch-service.js';
import type { WorkflowActivationService } from '../workflow-activation/workflow-activation-service.js';
import { WorkspaceMemoryScopeService } from '../workspace-memory-scope-service.js';
import { createWorkItem } from './mutation.js';
import {
  getWorkItemMemory,
  getWorkItemMemoryHistory,
  getWorkflowWorkItem,
  listWorkItemEvents,
  listWorkItemTasks,
  listWorkflowWorkItems,
} from './query.js';
import type {
  CreateWorkItemInput,
  CreateWorkItemOptions,
  GetWorkflowWorkItemInput,
  GroupedWorkItemReadModel,
  ListWorkflowWorkItemsInput,
  WorkItemReadModel,
  WorkItemServiceDependencies,
} from './types.js';

export class WorkItemService {
  private readonly deps: WorkItemServiceDependencies;

  constructor(
    pool: DatabasePool,
    private readonly eventService: EventService,
    private readonly activationService: WorkflowActivationService,
    private readonly activationDispatchService: WorkflowActivationDispatchService,
  ) {
    this.deps = {
      pool,
      eventService,
      activationService,
      activationDispatchService,
      memoryScopeService: new WorkspaceMemoryScopeService(pool),
    };
  }

  async listWorkflowWorkItems(
    tenantId: string,
    workflowId: string,
    input: ListWorkflowWorkItemsInput = {},
  ): Promise<WorkItemReadModel[] | GroupedWorkItemReadModel[]> {
    return listWorkflowWorkItems(this.deps, tenantId, workflowId, input);
  }

  async getWorkflowWorkItem(
    tenantId: string,
    workflowId: string,
    workItemId: string,
    input: GetWorkflowWorkItemInput = {},
  ): Promise<WorkItemReadModel | GroupedWorkItemReadModel> {
    return getWorkflowWorkItem(this.deps, tenantId, workflowId, workItemId, input);
  }

  async listWorkItemTasks(tenantId: string, workflowId: string, workItemId: string) {
    return listWorkItemTasks(this.deps, tenantId, workflowId, workItemId);
  }

  async listWorkItemEvents(
    tenantId: string,
    workflowId: string,
    workItemId: string,
    limit: number,
  ): Promise<Array<Record<string, unknown>>> {
    return listWorkItemEvents(this.deps, tenantId, workflowId, workItemId, limit);
  }

  async getWorkItemMemory(
    tenantId: string,
    workflowId: string,
    workItemId: string,
  ): Promise<{ entries: unknown[] }> {
    return getWorkItemMemory(this.deps, tenantId, workflowId, workItemId);
  }

  async getWorkItemMemoryHistory(
    tenantId: string,
    workflowId: string,
    workItemId: string,
    limit: number,
  ): Promise<{ history: unknown[] }> {
    return getWorkItemMemoryHistory(this.deps, tenantId, workflowId, workItemId, limit);
  }

  async createWorkItem(
    identity: ApiKeyIdentity,
    workflowId: string,
    input: CreateWorkItemInput,
    externalClient?: DatabaseClient,
    options: CreateWorkItemOptions = {},
  ): Promise<WorkItemReadModel> {
    return createWorkItem(this.deps, identity, workflowId, input, externalClient, options);
  }
}
