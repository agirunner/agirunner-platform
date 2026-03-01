import type {
  Agent,
  ApiDataResponse,
  ApiListResponse,
  AuthTokenResponse,
  CreateTaskInput,
  Pipeline,
  Task,
  Worker,
} from './types.js';

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
    this.fetcher = options.fetcher ?? fetch;
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

  async listWorkers(): Promise<Worker[]> {
    const response = await this.request<ApiDataResponse<Worker[]>>('/api/v1/workers');
    return response.data;
  }

  async listAgents(): Promise<Agent[]> {
    const response = await this.request<ApiDataResponse<Agent[]>>('/api/v1/agents');
    return response.data;
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
      throw new Error(`HTTP ${response.status}: ${errorBody}`);
    }

    return (await response.json()) as T;
  }
}
