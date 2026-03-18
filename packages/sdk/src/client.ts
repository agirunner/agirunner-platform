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
  Project,
  ProjectTimelineEntry,
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

type Query = Record<string, string | number | boolean | undefined>;

export class PlatformApiClient {
  private readonly baseUrl: string;
  private accessToken?: string;
  private readonly fetcher: typeof fetch;

  constructor(options: PlatformClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.accessToken = options.accessToken;
    this.fetcher = options.fetcher ?? ((input, init) => globalThis.fetch(input, init));
  }

  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  async exchangeApiKey(apiKey: string): Promise<AuthTokenResponse> {
    const response = await this.request<ApiDataResponse<AuthTokenResponse>>('/api/v1/auth/token', {
      method: 'POST',
      body: { api_key: apiKey },
      includeAuth: false,
    });
    return response.data;
  }

  async refreshSession(): Promise<{ token: string }> {
    const response = await this.request<ApiDataResponse<{ token: string }>>(
      '/api/v1/auth/refresh',
      {
        method: 'POST',
        includeAuth: false,
      },
    );
    return response.data;
  }

  async listTasks(query: Query = {}): Promise<ApiListResponse<Task>> {
    return this.request<ApiListResponse<Task>>(this.withQuery('/api/v1/tasks', query));
  }

  async getTask(taskId: string): Promise<Task> {
    const response = await this.request<ApiDataResponse<Task>>(`/api/v1/tasks/${taskId}`);
    return response.data;
  }

  async createTask(payload: CreateTaskInput): Promise<Task> {
    const response = await this.request<ApiDataResponse<Task>>('/api/v1/tasks', {
      method: 'POST',
      body: payload,
    });
    return response.data;
  }

  async claimTask(payload: {
    agent_id: string;
    worker_id?: string;
    capabilities?: string[];
    workflow_id?: string;
    include_context?: boolean;
  }): Promise<Task | null> {
    const response = await this.request<Response | ApiDataResponse<Task>>('/api/v1/tasks/claim', {
      method: 'POST',
      body: payload,
      allowNoContent: true,
    });

    if (response instanceof Response) {
      return null;
    }

    return response.data;
  }

  async completeTask(taskId: string, output: unknown): Promise<Task> {
    const response = await this.request<ApiDataResponse<Task>>(`/api/v1/tasks/${taskId}/complete`, {
      method: 'POST',
      body: { output },
    });
    return response.data;
  }

  async failTask(taskId: string, error: Record<string, unknown>): Promise<Task> {
    const response = await this.request<ApiDataResponse<Task>>(`/api/v1/tasks/${taskId}/fail`, {
      method: 'POST',
      body: { error },
    });
    return response.data;
  }

  async listWorkflows(query: Query = {}): Promise<ApiListResponse<Workflow>> {
    return this.request<ApiListResponse<Workflow>>(this.withQuery('/api/v1/workflows', query));
  }

  async getWorkflow(workflowId: string): Promise<Workflow> {
    const response = await this.request<ApiDataResponse<Workflow>>(
      `/api/v1/workflows/${workflowId}`,
    );
    return response.data;
  }

  async getResolvedWorkflowConfig(
    workflowId: string,
    showLayers = false,
  ): Promise<ResolvedWorkflowConfig> {
    const suffix = showLayers ? '?show_layers=true' : '';
    const response = await this.request<ApiDataResponse<ResolvedWorkflowConfig>>(
      `/api/v1/workflows/${workflowId}/config/resolved${suffix}`,
    );
    return response.data;
  }

  async listWorkflowDocuments(workflowId: string): Promise<ResolvedDocumentReference[]> {
    const response = await this.request<ApiDataResponse<ResolvedDocumentReference[]>>(
      `/api/v1/workflows/${workflowId}/documents`,
    );
    return response.data;
  }

  async createWorkflowDocument(
    workflowId: string,
    payload: CreateWorkflowDocumentInput,
  ): Promise<ResolvedDocumentReference> {
    const response = await this.request<ApiDataResponse<ResolvedDocumentReference>>(
      `/api/v1/workflows/${workflowId}/documents`,
      {
        method: 'POST',
        body: payload,
      },
    );
    return response.data;
  }

  async updateWorkflowDocument(
    workflowId: string,
    logicalName: string,
    payload: UpdateWorkflowDocumentInput,
  ): Promise<ResolvedDocumentReference> {
    const response = await this.request<ApiDataResponse<ResolvedDocumentReference>>(
      `/api/v1/workflows/${workflowId}/documents/${encodeURIComponent(logicalName)}`,
      {
        method: 'PATCH',
        body: payload,
      },
    );
    return response.data;
  }

  async deleteWorkflowDocument(workflowId: string, logicalName: string): Promise<void> {
    await this.request<Response>(
      `/api/v1/workflows/${workflowId}/documents/${encodeURIComponent(logicalName)}`,
      {
        method: 'DELETE',
        allowNoContent: true,
      },
    );
  }

  async createWorkflow(payload: CreateWorkflowInput): Promise<Workflow> {
    const response = await this.request<ApiDataResponse<Workflow>>('/api/v1/workflows', {
      method: 'POST',
      body: payload,
    });
    return response.data;
  }

  async cancelWorkflow(workflowId: string): Promise<Workflow> {
    const response = await this.request<ApiDataResponse<Workflow>>(
      `/api/v1/workflows/${workflowId}/cancel`,
      {
        method: 'POST',
      },
    );
    return response.data;
  }

  async getWorkflowBoard(workflowId: string): Promise<WorkflowBoard> {
    const response = await this.request<ApiDataResponse<WorkflowBoard>>(
      `/api/v1/workflows/${workflowId}/board`,
    );
    return response.data;
  }

  async listWorkflowStages(workflowId: string): Promise<WorkflowStage[]> {
    const response = await this.request<ApiDataResponse<WorkflowStage[]>>(
      `/api/v1/workflows/${workflowId}/stages`,
    );
    return response.data;
  }

  async listWorkflowWorkItems(
    workflowId: string,
    query: ListWorkflowWorkItemsQuery = {},
  ): Promise<WorkflowWorkItem[]> {
    const response = await this.request<ApiDataResponse<WorkflowWorkItem[]>>(
      this.withQuery(`/api/v1/workflows/${workflowId}/work-items`, query as Query),
    );
    return response.data;
  }

  async getWorkflowWorkItem(
    workflowId: string,
    workItemId: string,
    query: GetWorkflowWorkItemQuery = {},
  ): Promise<WorkflowWorkItem> {
    const response = await this.request<ApiDataResponse<WorkflowWorkItem>>(
      this.withQuery(`/api/v1/workflows/${workflowId}/work-items/${workItemId}`, query as Query),
    );
    return response.data;
  }

  async listWorkflowWorkItemTasks(workflowId: string, workItemId: string): Promise<Task[]> {
    const response = await this.request<ApiDataResponse<Task[]>>(
      `/api/v1/workflows/${workflowId}/work-items/${workItemId}/tasks`,
    );
    return response.data;
  }

  async listWorkflowWorkItemEvents(
    workflowId: string,
    workItemId: string,
    limit = 100,
  ): Promise<PlatformEvent[]> {
    const response = await this.request<ApiDataResponse<PlatformEvent[]>>(
      `/api/v1/workflows/${workflowId}/work-items/${workItemId}/events?limit=${limit}`,
    );
    return response.data;
  }

  async createWorkflowWorkItem(
    workflowId: string,
    payload: CreateWorkflowWorkItemInput,
  ): Promise<WorkflowWorkItem> {
    const response = await this.request<ApiDataResponse<WorkflowWorkItem>>(
      `/api/v1/workflows/${workflowId}/work-items`,
      {
        method: 'POST',
        body: payload,
      },
    );
    return response.data;
  }

  async updateWorkflowWorkItem(
    workflowId: string,
    workItemId: string,
    payload: UpdateWorkflowWorkItemInput,
  ): Promise<WorkflowWorkItem> {
    const response = await this.request<ApiDataResponse<WorkflowWorkItem>>(
      `/api/v1/workflows/${workflowId}/work-items/${workItemId}`,
      {
        method: 'PATCH',
        body: payload,
      },
    );
    return response.data;
  }

  async listWorkflowActivations(workflowId: string): Promise<WorkflowActivation[]> {
    const response = await this.request<ApiDataResponse<WorkflowActivation[]>>(
      `/api/v1/workflows/${workflowId}/activations`,
    );
    return response.data;
  }

  async listProjects(query: Query = {}): Promise<ApiListResponse<Project>> {
    return this.request<ApiListResponse<Project>>(this.withQuery('/api/v1/projects', query));
  }

  async getProject(projectId: string): Promise<Project> {
    const response = await this.request<ApiDataResponse<Project>>(`/api/v1/projects/${projectId}`);
    return response.data;
  }

  async patchProjectMemory(
    projectId: string,
    payload: { key: string; value: unknown },
  ): Promise<Project> {
    const response = await this.request<ApiDataResponse<Project>>(
      `/api/v1/projects/${projectId}/memory`,
      {
        method: 'PATCH',
        body: payload,
      },
    );
    return response.data;
  }

  async getProjectTimeline(projectId: string): Promise<ProjectTimelineEntry[]> {
    const response = await this.request<ApiDataResponse<ProjectTimelineEntry[]>>(
      `/api/v1/projects/${projectId}/timeline`,
    );
    return response.data;
  }

  async createPlanningWorkflow(
    projectId: string,
    payload: { brief: string; name?: string },
  ): Promise<Workflow> {
    const response = await this.request<ApiDataResponse<Workflow>>(
      `/api/v1/projects/${projectId}/planning-workflow`,
      {
        method: 'POST',
        body: payload,
      },
    );
    return response.data;
  }

  async listPlaybooks(): Promise<Playbook[]> {
    const response = await this.request<ApiDataResponse<Playbook[]>>('/api/v1/playbooks');
    return response.data;
  }

  async getPlaybook(playbookId: string): Promise<Playbook> {
    const response = await this.request<ApiDataResponse<Playbook>>(
      `/api/v1/playbooks/${playbookId}`,
    );
    return response.data;
  }

  async createPlaybook(payload: CreatePlaybookInput): Promise<Playbook> {
    const response = await this.request<ApiDataResponse<Playbook>>('/api/v1/playbooks', {
      method: 'POST',
      body: payload,
    });
    return response.data;
  }

  async updatePlaybook(playbookId: string, payload: UpdatePlaybookInput): Promise<Playbook> {
    const response = await this.request<ApiDataResponse<Playbook>>(
      `/api/v1/playbooks/${playbookId}`,
      {
        method: 'PATCH',
        body: payload,
      },
    );
    return response.data;
  }

  async replacePlaybook(playbookId: string, payload: CreatePlaybookInput): Promise<Playbook> {
    const response = await this.request<ApiDataResponse<Playbook>>(
      `/api/v1/playbooks/${playbookId}`,
      {
        method: 'PUT',
        body: payload,
      },
    );
    return response.data;
  }

  async archivePlaybook(playbookId: string): Promise<Playbook> {
    const response = await this.request<ApiDataResponse<Playbook>>(
      `/api/v1/playbooks/${playbookId}/archive`,
      {
        method: 'PATCH',
        body: { archived: true },
      },
    );
    return response.data;
  }

  async restorePlaybook(playbookId: string): Promise<Playbook> {
    const response = await this.request<ApiDataResponse<Playbook>>(
      `/api/v1/playbooks/${playbookId}/archive`,
      {
        method: 'PATCH',
        body: { archived: false },
      },
    );
    return response.data;
  }

  async deletePlaybook(playbookId: string): Promise<{ id: string; deleted: true }> {
    const response = await this.request<ApiDataResponse<{ id: string; deleted: true }>>(
      `/api/v1/playbooks/${playbookId}`,
      {
        method: 'DELETE',
      },
    );
    return response.data;
  }

  async listTaskArtifacts(taskId: string): Promise<TaskArtifact[]> {
    const response = await this.request<ApiDataResponse<TaskArtifact[]>>(
      `/api/v1/tasks/${taskId}/artifacts`,
    );
    return response.data;
  }

  async getTaskMemory(taskId: string, key?: string): Promise<TaskMemory> {
    const path = key
      ? this.withQuery(`/api/v1/tasks/${taskId}/memory`, { key })
      : `/api/v1/tasks/${taskId}/memory`;
    const response = await this.request<ApiDataResponse<TaskMemory>>(path);
    return response.data;
  }

  async patchTaskMemory(
    taskId: string,
    payload: { key: string; value: unknown },
  ): Promise<Project> {
    const response = await this.request<ApiDataResponse<Project>>(
      `/api/v1/tasks/${taskId}/memory`,
      {
        method: 'PATCH',
        body: payload,
      },
    );
    return response.data;
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
    const response = await this.request<ApiDataResponse<TaskArtifactCatalogEntry[]>>(
      this.withQuery(`/api/v1/tasks/${taskId}/artifact-catalog`, query),
    );
    return response.data;
  }

  async getApprovalQueue(): Promise<ApprovalQueue> {
    const response = await this.request<ApiDataResponse<ApprovalQueue>>('/api/v1/approvals');
    return response.data;
  }

  async listWorkers(): Promise<Worker[]> {
    const response = await this.request<ApiDataResponse<Worker[]>>('/api/v1/workers');
    return response.data;
  }

  async listAgents(): Promise<Agent[]> {
    const response = await this.request<ApiDataResponse<Agent[]>>('/api/v1/agents');
    return response.data;
  }

  async paginate<T>(
    fetchPage: (query: Query) => Promise<ApiListResponse<T>>,
    options: { perPage?: number; startPage?: number } = {},
  ): Promise<T[]> {
    const perPage = options.perPage ?? 50;
    let page = options.startPage ?? 1;
    const all: T[] = [];

    while (true) {
      const response = await fetchPage({ page, per_page: perPage });
      all.push(...response.data);

      const totalPages = Number(response.pagination?.total_pages ?? page);
      if (page >= totalPages || response.data.length === 0) {
        break;
      }

      page += 1;
    }

    return all;
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
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      body?: unknown;
      token?: string;
      includeAuth?: boolean;
      allowNoContent?: boolean;
    } = {},
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
