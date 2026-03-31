import type {
  Agent,
  ApprovalQueue,
  ApiDataResponse,
  ApiListResponse,
  AuthTokenResponse,
  CreatePlaybookInput,
  CreateTaskInput,
  CreateWorkflowDocumentInput,
  CreateWorkflowInput,
  CreateWorkflowWorkItemInput,
  GetWorkflowWorkItemQuery,
  ListWorkflowWorkItemsQuery,
  UpdateWorkflowWorkItemInput,
  Playbook,
  PlatformEvent,
  Workflow,
  WorkflowActivation,
  WorkflowBoard,
  WorkflowStage,
  WorkflowWorkItem,
  Workspace,
  WorkspaceTimelineEntry,
  ResolvedDocumentReference,
  ResolvedWorkflowConfig,
  Task,
  TaskArtifactCatalogEntry,
  TaskMemory,
  TaskArtifact,
  UpdatePlaybookInput,
  UpdateWorkflowDocumentInput,
  Worker,
} from './types.js';
import type { ClientTransport, Query, RequestOptions } from './client/core.js';
import { exchangeApiKey, refreshSession } from './client/auth.js';
import {
  claimTask,
  completeTask,
  createTask,
  failTask,
  getTask,
  getTaskMemory,
  listTaskArtifactCatalog,
  listTaskArtifacts,
  listTasks,
  listWorkflowWorkItemEvents,
  listWorkflowWorkItemTasks,
  patchTaskMemory,
} from './client/tasks.js';
import {
  cancelWorkflow,
  createWorkflow,
  createWorkflowDocument,
  createWorkflowWorkItem,
  deleteWorkflowDocument,
  getResolvedWorkflowConfig,
  getWorkflow,
  getWorkflowBoard,
  getWorkflowWorkItem,
  listWorkflowActivations,
  listWorkflowDocuments,
  listWorkflowStages,
  listWorkflowWorkItems,
  listWorkflows,
  updateWorkflowDocument,
  updateWorkflowWorkItem,
} from './client/workflows.js';
import {
  createPlanningWorkflow,
  getWorkspace,
  getWorkspaceTimeline,
  listWorkspaces,
  patchWorkspaceMemory,
} from './client/workspaces.js';
import {
  archivePlaybook,
  createPlaybook,
  deletePlaybook,
  getPlaybook,
  listPlaybooks,
  replacePlaybook,
  restorePlaybook,
  updatePlaybook,
} from './client/playbooks.js';
import {
  getApprovalQueue,
  listAgents,
  listWorkers,
  paginate,
} from './client/admin.js';

export class PlatformApiError extends Error {
  readonly status: number;
  readonly responseBody: string;

  constructor(status: number, responseBody: string) {
    super(`HTTP ${status}: ${responseBody}`);
    this.name = 'PlatformApiError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

export interface PlatformClientOptions {
  baseUrl: string;
  accessToken?: string;
  fetcher?: typeof fetch;
}

export class PlatformApiClient {
  private readonly baseUrl: string;
  private accessToken?: string;
  private readonly fetcher: typeof fetch;
  private readonly transport: ClientTransport;

  constructor(options: PlatformClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.accessToken = options.accessToken;
    this.fetcher = options.fetcher ?? ((input, init) => globalThis.fetch(input, init));
    this.transport = {
      request: this.request.bind(this),
      withQuery: this.withQuery.bind(this),
    };
  }

  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  async exchangeApiKey(apiKey: string, persistentSession = true): Promise<AuthTokenResponse> {
    return exchangeApiKey(this.transport, apiKey, persistentSession);
  }

  async refreshSession(): Promise<{ token: string }> {
    return refreshSession(this.transport);
  }

  async listTasks(query: Query = {}): Promise<ApiListResponse<Task>> {
    return listTasks(this.transport, query);
  }

  async getTask(taskId: string): Promise<Task> {
    return getTask(this.transport, taskId);
  }

  async createTask(payload: CreateTaskInput): Promise<Task> {
    return createTask(this.transport, payload);
  }

  async claimTask(payload: {
    agent_id: string;
    worker_id?: string;
    routing_tags?: string[];
    workflow_id?: string;
    playbook_id?: string;
    include_context?: boolean;
  }): Promise<Task | null> {
    return claimTask(this.transport, payload);
  }

  async completeTask(taskId: string, output: unknown): Promise<Task> {
    return completeTask(this.transport, taskId, output);
  }

  async failTask(taskId: string, error: Record<string, unknown>): Promise<Task> {
    return failTask(this.transport, taskId, error);
  }

  async listWorkflows(query: Query = {}): Promise<ApiListResponse<Workflow>> {
    return listWorkflows(this.transport, query);
  }

  async getWorkflow(workflowId: string): Promise<Workflow> {
    return getWorkflow(this.transport, workflowId);
  }

  async getResolvedWorkflowConfig(
    workflowId: string,
    showLayers = false,
  ): Promise<ResolvedWorkflowConfig> {
    return getResolvedWorkflowConfig(this.transport, workflowId, showLayers);
  }

  async listWorkflowDocuments(workflowId: string): Promise<ResolvedDocumentReference[]> {
    return listWorkflowDocuments(this.transport, workflowId);
  }

  async createWorkflowDocument(
    workflowId: string,
    payload: CreateWorkflowDocumentInput,
  ): Promise<ResolvedDocumentReference> {
    return createWorkflowDocument(this.transport, workflowId, payload);
  }

  async updateWorkflowDocument(
    workflowId: string,
    logicalName: string,
    payload: UpdateWorkflowDocumentInput,
  ): Promise<ResolvedDocumentReference> {
    return updateWorkflowDocument(this.transport, workflowId, logicalName, payload);
  }

  async deleteWorkflowDocument(workflowId: string, logicalName: string): Promise<void> {
    return deleteWorkflowDocument(this.transport, workflowId, logicalName);
  }

  async createWorkflow(payload: CreateWorkflowInput): Promise<Workflow> {
    return createWorkflow(this.transport, payload);
  }

  async cancelWorkflow(workflowId: string): Promise<Workflow> {
    return cancelWorkflow(this.transport, workflowId);
  }

  async getWorkflowBoard(workflowId: string): Promise<WorkflowBoard> {
    return getWorkflowBoard(this.transport, workflowId);
  }

  async listWorkflowStages(workflowId: string): Promise<WorkflowStage[]> {
    return listWorkflowStages(this.transport, workflowId);
  }

  async listWorkflowWorkItems(
    workflowId: string,
    query: ListWorkflowWorkItemsQuery = {},
  ): Promise<WorkflowWorkItem[]> {
    return listWorkflowWorkItems(this.transport, workflowId, query);
  }

  async getWorkflowWorkItem(
    workflowId: string,
    workItemId: string,
    query: GetWorkflowWorkItemQuery = {},
  ): Promise<WorkflowWorkItem> {
    return getWorkflowWorkItem(this.transport, workflowId, workItemId, query);
  }

  async listWorkflowWorkItemTasks(workflowId: string, workItemId: string): Promise<Task[]> {
    return listWorkflowWorkItemTasks(this.transport, workflowId, workItemId);
  }

  async listWorkflowWorkItemEvents(
    workflowId: string,
    workItemId: string,
    limit = 100,
  ): Promise<PlatformEvent[]> {
    return listWorkflowWorkItemEvents(this.transport, workflowId, workItemId, limit);
  }

  async createWorkflowWorkItem(
    workflowId: string,
    payload: CreateWorkflowWorkItemInput,
  ): Promise<WorkflowWorkItem> {
    return createWorkflowWorkItem(this.transport, workflowId, payload);
  }

  async updateWorkflowWorkItem(
    workflowId: string,
    workItemId: string,
    payload: UpdateWorkflowWorkItemInput,
  ): Promise<WorkflowWorkItem> {
    return updateWorkflowWorkItem(this.transport, workflowId, workItemId, payload);
  }

  async listWorkflowActivations(workflowId: string): Promise<WorkflowActivation[]> {
    return listWorkflowActivations(this.transport, workflowId);
  }

  async listWorkspaces(query: Query = {}): Promise<ApiListResponse<Workspace>> {
    return listWorkspaces(this.transport, query);
  }

  async getWorkspace(workspaceId: string): Promise<Workspace> {
    return getWorkspace(this.transport, workspaceId);
  }

  async patchWorkspaceMemory(
    workspaceId: string,
    payload: { key: string; value: unknown },
  ): Promise<Workspace> {
    return patchWorkspaceMemory(this.transport, workspaceId, payload);
  }

  async getWorkspaceTimeline(workspaceId: string): Promise<WorkspaceTimelineEntry[]> {
    return getWorkspaceTimeline(this.transport, workspaceId);
  }

  async createPlanningWorkflow(
    workspaceId: string,
    payload: { brief: string; name?: string },
  ): Promise<Workflow> {
    return createPlanningWorkflow(this.transport, workspaceId, payload);
  }

  async listPlaybooks(): Promise<Playbook[]> {
    return listPlaybooks(this.transport);
  }

  async getPlaybook(playbookId: string): Promise<Playbook> {
    return getPlaybook(this.transport, playbookId);
  }

  async createPlaybook(payload: CreatePlaybookInput): Promise<Playbook> {
    return createPlaybook(this.transport, payload);
  }

  async updatePlaybook(playbookId: string, payload: UpdatePlaybookInput): Promise<Playbook> {
    return updatePlaybook(this.transport, playbookId, payload);
  }

  async replacePlaybook(playbookId: string, payload: CreatePlaybookInput): Promise<Playbook> {
    return replacePlaybook(this.transport, playbookId, payload);
  }

  async archivePlaybook(playbookId: string): Promise<Playbook> {
    return archivePlaybook(this.transport, playbookId);
  }

  async restorePlaybook(playbookId: string): Promise<Playbook> {
    return restorePlaybook(this.transport, playbookId);
  }

  async deletePlaybook(playbookId: string): Promise<{ id: string; deleted: true }> {
    return deletePlaybook(this.transport, playbookId);
  }

  async listTaskArtifacts(taskId: string): Promise<TaskArtifact[]> {
    return listTaskArtifacts(this.transport, taskId);
  }

  async getTaskMemory(taskId: string, key?: string): Promise<TaskMemory> {
    return getTaskMemory(this.transport, taskId, key);
  }

  async patchTaskMemory(
    taskId: string,
    payload: { key: string; value: unknown },
  ): Promise<Workspace> {
    return patchTaskMemory(this.transport, taskId, payload);
  }

  async listTaskArtifactCatalog(
    taskId: string,
    query: {
      task_id?: string;
      work_item_id?: string;
      name_prefix?: string;
      limit?: number;
    } = {},
  ): Promise<TaskArtifactCatalogEntry[]> {
    return listTaskArtifactCatalog(this.transport, taskId, query);
  }

  async getApprovalQueue(): Promise<ApprovalQueue> {
    return getApprovalQueue(this.transport);
  }

  async listWorkers(): Promise<Worker[]> {
    return listWorkers(this.transport);
  }

  async listAgents(): Promise<Agent[]> {
    return listAgents(this.transport);
  }

  async paginate<T>(
    fetchPage: (query: Query) => Promise<ApiListResponse<T>>,
    options: { perPage?: number; startPage?: number } = {},
  ): Promise<T[]> {
    return paginate(fetchPage, options);
  }

  private withQuery(path: string, query: Query): string {
    const search = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined) {
        search.set(key, String(value));
      }
    });

    const queryString = search.toString();
    return queryString.length > 0 ? `${path}?${queryString}` : path;
  }

  private async request<T>(
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const shouldIncludeAuth = options.includeAuth ?? true;
    const token = options.token ?? this.accessToken;

    const headers: Record<string, string> = {};

    if (shouldIncludeAuth && token) {
      headers.Authorization = `Bearer ${token}`;
    }

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: 'include',
    });

    if (options.allowNoContent && response.status === 204) {
      return response as T;
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new PlatformApiError(response.status, errorBody);
    }

    return (await response.json()) as T;
  }
}
