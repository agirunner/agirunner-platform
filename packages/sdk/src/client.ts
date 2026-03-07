import type {
  Agent,
  ApiDataResponse,
  ApiListResponse,
  AuthTokenResponse,
  CreateTaskInput,
  Pipeline,
  Project,
  ProjectTimelineEntry,
  ResolvedDocumentReference,
  ResolvedPipelineConfig,
  Task,
  TaskArtifact,
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
    const response = await this.request<ApiDataResponse<{ token: string }>>('/api/v1/auth/refresh', {
      method: 'POST',
      includeAuth: false,
    });
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
    const response = await this.request<ApiDataResponse<Task>>('/api/v1/tasks', { method: 'POST', body: payload });
    return response.data;
  }

  async claimTask(payload: {
    agent_id: string;
    worker_id?: string;
    capabilities?: string[];
    pipeline_id?: string;
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

  async listPipelines(query: Query = {}): Promise<ApiListResponse<Pipeline>> {
    return this.request<ApiListResponse<Pipeline>>(this.withQuery('/api/v1/pipelines', query));
  }

  async getPipeline(pipelineId: string): Promise<Pipeline> {
    const response = await this.request<ApiDataResponse<Pipeline>>(`/api/v1/pipelines/${pipelineId}`);
    return response.data;
  }

  async getResolvedPipelineConfig(
    pipelineId: string,
    showLayers = false,
  ): Promise<ResolvedPipelineConfig> {
    const suffix = showLayers ? '?show_layers=true' : '';
    const response = await this.request<ApiDataResponse<ResolvedPipelineConfig>>(
      `/api/v1/pipelines/${pipelineId}/config/resolved${suffix}`,
    );
    return response.data;
  }

  async listPipelineDocuments(pipelineId: string): Promise<ResolvedDocumentReference[]> {
    const response = await this.request<ApiDataResponse<ResolvedDocumentReference[]>>(
      `/api/v1/pipelines/${pipelineId}/documents`,
    );
    return response.data;
  }

  async createPipeline(payload: {
    template_id: string;
    name: string;
    project_id?: string;
    parameters?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): Promise<Pipeline> {
    const response = await this.request<ApiDataResponse<Pipeline>>('/api/v1/pipelines', {
      method: 'POST',
      body: payload,
    });
    return response.data;
  }

  async cancelPipeline(pipelineId: string): Promise<Pipeline> {
    const response = await this.request<ApiDataResponse<Pipeline>>(`/api/v1/pipelines/${pipelineId}/cancel`, {
      method: 'POST',
    });
    return response.data;
  }

  async actOnPhaseGate(
    pipelineId: string,
    phaseName: string,
    payload: {
      action: 'approve' | 'reject' | 'request_changes';
      feedback?: string;
      override_input?: Record<string, unknown>;
    },
  ): Promise<Pipeline> {
    const response = await this.request<ApiDataResponse<Pipeline>>(
      `/api/v1/pipelines/${pipelineId}/phases/${phaseName}/gate`,
      {
        method: 'POST',
        body: payload,
      },
    );
    return response.data;
  }

  async cancelPhase(pipelineId: string, phaseName: string): Promise<Pipeline> {
    const response = await this.request<ApiDataResponse<Pipeline>>(
      `/api/v1/pipelines/${pipelineId}/phases/${phaseName}/cancel`,
      {
        method: 'POST',
      },
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
    const response = await this.request<ApiDataResponse<Project>>(`/api/v1/projects/${projectId}/memory`, {
      method: 'PATCH',
      body: payload,
    });
    return response.data;
  }

  async getProjectTimeline(projectId: string): Promise<ProjectTimelineEntry[]> {
    const response = await this.request<ApiDataResponse<ProjectTimelineEntry[]>>(
      `/api/v1/projects/${projectId}/timeline`,
    );
    return response.data;
  }

  async createPlanningPipeline(
    projectId: string,
    payload: { brief: string; name?: string },
  ): Promise<Pipeline> {
    const response = await this.request<ApiDataResponse<Pipeline>>(
      `/api/v1/projects/${projectId}/planning-pipeline`,
      {
        method: 'POST',
        body: payload,
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
      method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
      body?: unknown;
      token?: string;
      includeAuth?: boolean;
      allowNoContent?: boolean;
    } = {},
  ): Promise<T> {
    const shouldIncludeAuth = options.includeAuth ?? true;
    const token = options.token ?? this.accessToken;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (shouldIncludeAuth && token) {
      headers.Authorization = `Bearer ${token}`;
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
