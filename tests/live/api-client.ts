/**
 * Typed HTTP client for the Platform API used by live test scenarios.
 *
 * Wraps fetch with auth headers, error handling, and typed responses.
 * Designed for test harness use — not a general-purpose SDK.
 */

// ---------------------------------------------------------------------------
// Response types (mirrors API surface, not exhaustive)
// ---------------------------------------------------------------------------

export interface ApiTemplate {
  id: string;
  name: string;
  slug: string;
  schema: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ApiTask {
  id: string;
  state: string;
  type: string;
  title: string;
  role?: string;
  pipeline_id?: string;
  output?: Record<string, unknown>;
  error?: Record<string, unknown>;
  depends_on?: string[];
  retry_count?: number;
  capabilities_required?: string[];
  assigned_agent_id?: string;
  assigned_worker_id?: string;
  [key: string]: unknown;
}

export interface ApiPipeline {
  id: string;
  state: string;
  template_id: string;
  name: string;
  tasks?: ApiTask[];
  [key: string]: unknown;
}

export interface ApiWorker {
  // register response fields
  worker_id?: string;
  worker_api_key?: string;
  websocket_url?: string;
  heartbeat_interval_seconds?: number;

  // list/get response fields
  id?: string;
  name?: string;
  status?: string;
  connection_mode?: string;
  runtime_type?: string;
  capabilities?: string[];

  [key: string]: unknown;
}

export interface ApiAgent {
  id: string;
  name?: string;
  worker_id?: string | null;
  capabilities?: string[];
  status?: string;
  api_key?: string;
  [key: string]: unknown;
}

export interface ApiListResponse<T> {
  data: T[];
  meta: { total: number; page: number; per_page: number; pages: number };
}

export interface ApiTenant {
  id: string;
  name: string;
  api_key: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class LiveApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  // -- Templates --

  async createTemplate(body: {
    name: string;
    slug: string;
    description?: string;
    schema: Record<string, unknown>;
  }): Promise<ApiTemplate> {
    return this.post<ApiTemplate>('/api/v1/templates', body);
  }

  async getTemplate(id: string): Promise<ApiTemplate> {
    return this.get<ApiTemplate>(`/api/v1/templates/${id}`);
  }

  // -- Pipelines --

  async createPipeline(body: {
    template_id: string;
    name: string;
    parameters?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): Promise<ApiPipeline> {
    return this.post<ApiPipeline>('/api/v1/pipelines', body);
  }

  async getPipeline(id: string): Promise<ApiPipeline> {
    return this.get<ApiPipeline>(`/api/v1/pipelines/${id}`);
  }

  async cancelPipeline(id: string): Promise<ApiPipeline> {
    return this.post<ApiPipeline>(`/api/v1/pipelines/${id}/cancel`, {});
  }

  // -- Tasks --

  async createTask(body: {
    title: string;
    type: string;
    description?: string;
    pipeline_id?: string;
    depends_on?: string[];
    capabilities_required?: string[];
    role?: string;
    input?: Record<string, unknown>;
    requires_approval?: boolean;
    priority?: string;
  }): Promise<ApiTask> {
    return this.post<ApiTask>('/api/v1/tasks', body);
  }

  async getTask(id: string): Promise<ApiTask> {
    return this.get<ApiTask>(`/api/v1/tasks/${id}`);
  }

  async listTasks(query?: Record<string, string>): Promise<ApiListResponse<ApiTask>> {
    const qs = query ? '?' + new URLSearchParams(query).toString() : '';
    return this.getRaw<ApiListResponse<ApiTask>>(`/api/v1/tasks${qs}`);
  }

  async claimTask(body: {
    agent_id: string;
    worker_id?: string;
    capabilities?: string[];
    pipeline_id?: string;
  }): Promise<ApiTask | null> {
    const res = await fetch(`${this.baseUrl}/api/v1/tasks/claim`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (res.status === 204) return null;
    if (!res.ok) throw await this.apiError(res);
    const payload = (await res.json()) as { data: ApiTask };
    return payload.data;
  }

  async startTask(id: string, body: { agent_id?: string }): Promise<ApiTask> {
    const res = await fetch(`${this.baseUrl}/api/v1/tasks/${id}/start`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const payload = (await res.json()) as { data: ApiTask };
      return payload.data;
    }

    // Some environments may return INVALID_STATE_TRANSITION when start is
    // issued immediately after claim while the task is still observed as
    // "ready". Treat this as a non-fatal race and continue with current state.
    if (res.status === 409) {
      const text = await res.text().catch(() => '');
      if (text.includes('INVALID_STATE_TRANSITION') && text.includes("'ready' to 'running'")) {
        return this.getTask(id);
      }
      throw new Error(`API ${res.url} returned ${res.status}: ${text}`);
    }

    throw await this.apiError(res);
  }

  async completeTask(id: string, output: unknown): Promise<ApiTask> {
    return this.post<ApiTask>(`/api/v1/tasks/${id}/complete`, { output });
  }

  async failTask(id: string, error: Record<string, unknown>): Promise<ApiTask> {
    return this.post<ApiTask>(`/api/v1/tasks/${id}/fail`, { error });
  }

  async retryTask(id: string): Promise<ApiTask> {
    return this.post<ApiTask>(`/api/v1/tasks/${id}/retry`, {});
  }

  async cancelTask(id: string): Promise<ApiTask> {
    return this.post<ApiTask>(`/api/v1/tasks/${id}/cancel`, {});
  }

  async approveTask(id: string): Promise<ApiTask> {
    return this.post<ApiTask>(`/api/v1/tasks/${id}/approve`, {});
  }

  // -- Workers --

  async registerWorker(body: {
    name: string;
    capabilities?: string[];
    connection_mode?: string;
    runtime_type?: string;
    heartbeat_interval_seconds?: number;
  }): Promise<ApiWorker> {
    const res = await fetch(`${this.baseUrl}/api/v1/workers/register`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await this.apiError(res);
    // Worker register returns flat (not wrapped in {data:})
    const payload = (await res.json()) as ApiWorker | { data: ApiWorker };
    return 'worker_id' in payload ? payload : (payload as { data: ApiWorker }).data;
  }

  async listWorkers(): Promise<ApiWorker[]> {
    const res = await this.getRaw<{ data: ApiWorker[] }>('/api/v1/workers');
    return res.data;
  }

  async deleteWorker(id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/v1/workers/${id}`, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
      },
    });
    if (!res.ok && res.status !== 204) throw await this.apiError(res);
  }

  // -- Webhooks --

  async registerWebhook(body: {
    url: string;
    event_types?: string[];
    secret?: string;
  }): Promise<Record<string, unknown>> {
    return this.post<Record<string, unknown>>('/api/v1/webhooks', body);
  }

  async listWebhooks(): Promise<Array<Record<string, unknown>>> {
    const payload = await this.getRaw<{ data: Array<Record<string, unknown>> }>('/api/v1/webhooks');
    return payload.data;
  }

  async deleteWebhook(id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/v1/webhooks/${id}`, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
      },
    });
    if (!res.ok && res.status !== 204) throw await this.apiError(res);
  }

  async heartbeat(
    workerId: string,
    body: { status?: string; current_task_id?: string | null },
  ): Promise<unknown> {
    return this.post(`/api/v1/workers/${workerId}/heartbeat`, body);
  }

  // -- Agents --

  async registerAgent(body: {
    name: string;
    capabilities?: string[];
    worker_id: string;
  }): Promise<ApiAgent> {
    return this.post<ApiAgent>('/api/v1/agents/register', body);
  }

  async listAgents(): Promise<ApiAgent[]> {
    const res = await this.getRaw<{ data: ApiAgent[] }>('/api/v1/agents');
    return res.data;
  }

  // -- Events (SSE) --

  async openEventStream(
    query?: Record<string, string>,
  ): Promise<{ reader: ReadableStreamDefaultReader<Uint8Array>; abort: () => void }> {
    const qs = query ? '?' + new URLSearchParams(query).toString() : '';
    const controller = new AbortController();
    const res = await fetch(`${this.baseUrl}/api/v1/events/stream${qs}`, {
      headers: { ...this.headers(), accept: 'text/event-stream' },
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`SSE connect failed: ${res.status}`);
    }
    return { reader: res.body.getReader(), abort: () => controller.abort() };
  }

  // -- Raw health --

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  // -- Internal helpers --

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.apiKey}`,
      'content-type': 'application/json',
    };
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, { headers: this.headers() });
    if (!res.ok) throw await this.apiError(res);
    const payload = (await res.json()) as { data: T };
    return payload.data;
  }

  private async getRaw<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, { headers: this.headers() });
    if (!res.ok) throw await this.apiError(res);
    return (await res.json()) as T;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await this.apiError(res);
    const payload = (await res.json()) as { data: T };
    return payload.data;
  }

  private async apiError(res: Response): Promise<Error> {
    const text = await res.text().catch(() => '');
    return new Error(`API ${res.url} returned ${res.status}: ${text}`);
  }
}
