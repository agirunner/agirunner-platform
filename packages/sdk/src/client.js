export class PlatformApiError extends Error {
    status;
    responseBody;
    constructor(status, responseBody) {
        super(`HTTP ${status}: ${responseBody}`);
        this.name = 'PlatformApiError';
        this.status = status;
        this.responseBody = responseBody;
    }
}
export class PlatformApiClient {
    baseUrl;
    accessToken;
    fetcher;
    constructor(options) {
        this.baseUrl = options.baseUrl.replace(/\/$/, '');
        this.accessToken = options.accessToken;
        this.fetcher = options.fetcher ?? ((input, init) => globalThis.fetch(input, init));
    }
    setAccessToken(token) {
        this.accessToken = token;
    }
    async exchangeApiKey(apiKey) {
        const response = await this.request('/api/v1/auth/token', {
            method: 'POST',
            body: { api_key: apiKey },
            includeAuth: false,
        });
        return response.data;
    }
    async refreshSession() {
        const response = await this.request('/api/v1/auth/refresh', {
            method: 'POST',
            includeAuth: false,
        });
        return response.data;
    }
    async listTasks(query = {}) {
        return this.request(this.withQuery('/api/v1/tasks', query));
    }
    async getTask(taskId) {
        const response = await this.request(`/api/v1/tasks/${taskId}`);
        return response.data;
    }
    async createTask(payload) {
        const response = await this.request('/api/v1/tasks', { method: 'POST', body: payload });
        return response.data;
    }
    async claimTask(payload) {
        const response = await this.request('/api/v1/tasks/claim', {
            method: 'POST',
            body: payload,
            allowNoContent: true,
        });
        if (response instanceof Response) {
            return null;
        }
        return response.data;
    }
    async completeTask(taskId, output) {
        const response = await this.request(`/api/v1/tasks/${taskId}/complete`, {
            method: 'POST',
            body: { output },
        });
        return response.data;
    }
    async failTask(taskId, error) {
        const response = await this.request(`/api/v1/tasks/${taskId}/fail`, {
            method: 'POST',
            body: { error },
        });
        return response.data;
    }
    async listWorkflows(query = {}) {
        return this.request(this.withQuery('/api/v1/workflows', query));
    }
    async getWorkflow(workflowId) {
        const response = await this.request(`/api/v1/workflows/${workflowId}`);
        return response.data;
    }
    async getResolvedWorkflowConfig(workflowId, showLayers = false) {
        const suffix = showLayers ? '?show_layers=true' : '';
        const response = await this.request(`/api/v1/workflows/${workflowId}/config/resolved${suffix}`);
        return response.data;
    }
    async listWorkflowDocuments(workflowId) {
        const response = await this.request(`/api/v1/workflows/${workflowId}/documents`);
        return response.data;
    }
    async createWorkflow(payload) {
        const response = await this.request('/api/v1/workflows', {
            method: 'POST',
            body: payload,
        });
        return response.data;
    }
    async cancelWorkflow(workflowId) {
        const response = await this.request(`/api/v1/workflows/${workflowId}/cancel`, {
            method: 'POST',
        });
        return response.data;
    }
    async actOnPhaseGate(workflowId, phaseName, payload) {
        const response = await this.request(`/api/v1/workflows/${workflowId}/phases/${phaseName}/gate`, {
            method: 'POST',
            body: payload,
        });
        return response.data;
    }
    async cancelPhase(workflowId, phaseName) {
        const response = await this.request(`/api/v1/workflows/${workflowId}/phases/${phaseName}/cancel`, {
            method: 'POST',
        });
        return response.data;
    }
    async listProjects(query = {}) {
        return this.request(this.withQuery('/api/v1/projects', query));
    }
    async getProject(projectId) {
        const response = await this.request(`/api/v1/projects/${projectId}`);
        return response.data;
    }
    async patchProjectMemory(projectId, payload) {
        const response = await this.request(`/api/v1/projects/${projectId}/memory`, {
            method: 'PATCH',
            body: payload,
        });
        return response.data;
    }
    async getProjectTimeline(projectId) {
        const response = await this.request(`/api/v1/projects/${projectId}/timeline`);
        return response.data;
    }
    async createPlanningWorkflow(projectId, payload) {
        const response = await this.request(`/api/v1/projects/${projectId}/planning-workflow`, {
            method: 'POST',
            body: payload,
        });
        return response.data;
    }
    async listTaskArtifacts(taskId) {
        const response = await this.request(`/api/v1/tasks/${taskId}/artifacts`);
        return response.data;
    }
    async listWorkers() {
        const response = await this.request('/api/v1/workers');
        return response.data;
    }
    async listAgents() {
        const response = await this.request('/api/v1/agents');
        return response.data;
    }
    async paginate(fetchPage, options = {}) {
        const perPage = options.perPage ?? 50;
        let page = options.startPage ?? 1;
        const all = [];
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
    withQuery(path, query) {
        const search = new URLSearchParams();
        Object.entries(query).forEach(([key, value]) => {
            if (value !== undefined) {
                search.set(key, String(value));
            }
        });
        const queryString = search.toString();
        return queryString.length > 0 ? `${path}?${queryString}` : path;
    }
    async request(path, options = {}) {
        const shouldIncludeAuth = options.includeAuth ?? true;
        const token = options.token ?? this.accessToken;
        const headers = {
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
            return response;
        }
        if (!response.ok) {
            const errorBody = await response.text();
            throw new PlatformApiError(response.status, errorBody);
        }
        return (await response.json());
    }
}
