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
        const response = await this.request('/api/v1/tasks', {
            method: 'POST',
            body: payload,
        });
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
    async createWorkflowDocument(workflowId, payload) {
        const response = await this.request(`/api/v1/workflows/${workflowId}/documents`, {
            method: 'POST',
            body: payload,
        });
        return response.data;
    }
    async updateWorkflowDocument(workflowId, logicalName, payload) {
        const response = await this.request(`/api/v1/workflows/${workflowId}/documents/${encodeURIComponent(logicalName)}`, {
            method: 'PATCH',
            body: payload,
        });
        return response.data;
    }
    async deleteWorkflowDocument(workflowId, logicalName) {
        await this.request(`/api/v1/workflows/${workflowId}/documents/${encodeURIComponent(logicalName)}`, {
            method: 'DELETE',
            allowNoContent: true,
        });
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
    async getWorkflowBoard(workflowId) {
        const response = await this.request(`/api/v1/workflows/${workflowId}/board`);
        return response.data;
    }
    async listWorkflowStages(workflowId) {
        const response = await this.request(`/api/v1/workflows/${workflowId}/stages`);
        return response.data;
    }
    async listWorkflowWorkItems(workflowId, query = {}) {
        const response = await this.request(this.withQuery(`/api/v1/workflows/${workflowId}/work-items`, query));
        return response.data;
    }
    async getWorkflowWorkItem(workflowId, workItemId, query = {}) {
        const response = await this.request(this.withQuery(`/api/v1/workflows/${workflowId}/work-items/${workItemId}`, query));
        return response.data;
    }
    async listWorkflowWorkItemTasks(workflowId, workItemId) {
        const response = await this.request(`/api/v1/workflows/${workflowId}/work-items/${workItemId}/tasks`);
        return response.data;
    }
    async listWorkflowWorkItemEvents(workflowId, workItemId, limit = 100) {
        const response = await this.request(`/api/v1/workflows/${workflowId}/work-items/${workItemId}/events?limit=${limit}`);
        return response.data;
    }
    async createWorkflowWorkItem(workflowId, payload) {
        const response = await this.request(`/api/v1/workflows/${workflowId}/work-items`, {
            method: 'POST',
            body: payload,
        });
        return response.data;
    }
    async updateWorkflowWorkItem(workflowId, workItemId, payload) {
        const response = await this.request(`/api/v1/workflows/${workflowId}/work-items/${workItemId}`, {
            method: 'PATCH',
            body: payload,
        });
        return response.data;
    }
    async listWorkflowActivations(workflowId) {
        const response = await this.request(`/api/v1/workflows/${workflowId}/activations`);
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
    async listPlaybooks() {
        const response = await this.request('/api/v1/playbooks');
        return response.data;
    }
    async getPlaybook(playbookId) {
        const response = await this.request(`/api/v1/playbooks/${playbookId}`);
        return response.data;
    }
    async createPlaybook(payload) {
        const response = await this.request('/api/v1/playbooks', {
            method: 'POST',
            body: payload,
        });
        return response.data;
    }
    async updatePlaybook(playbookId, payload) {
        const response = await this.request(`/api/v1/playbooks/${playbookId}`, {
            method: 'PATCH',
            body: payload,
        });
        return response.data;
    }
    async replacePlaybook(playbookId, payload) {
        const response = await this.request(`/api/v1/playbooks/${playbookId}`, {
            method: 'PUT',
            body: payload,
        });
        return response.data;
    }
    async archivePlaybook(playbookId) {
        const response = await this.request(`/api/v1/playbooks/${playbookId}/archive`, {
            method: 'PATCH',
            body: { archived: true },
        });
        return response.data;
    }
    async restorePlaybook(playbookId) {
        const response = await this.request(`/api/v1/playbooks/${playbookId}/archive`, {
            method: 'PATCH',
            body: { archived: false },
        });
        return response.data;
    }
    async deletePlaybook(playbookId) {
        const response = await this.request(`/api/v1/playbooks/${playbookId}`, {
            method: 'DELETE',
        });
        return response.data;
    }
    async listTaskArtifacts(taskId) {
        const response = await this.request(`/api/v1/tasks/${taskId}/artifacts`);
        return response.data;
    }
    async getTaskMemory(taskId, key) {
        const path = key
            ? this.withQuery(`/api/v1/tasks/${taskId}/memory`, { key })
            : `/api/v1/tasks/${taskId}/memory`;
        const response = await this.request(path);
        return response.data;
    }
    async patchTaskMemory(taskId, payload) {
        const response = await this.request(`/api/v1/tasks/${taskId}/memory`, {
            method: 'PATCH',
            body: payload,
        });
        return response.data;
    }
    async listTaskArtifactCatalog(taskId, query = {}) {
        const response = await this.request(this.withQuery(`/api/v1/tasks/${taskId}/artifact-catalog`, query));
        return response.data;
    }
    async getApprovalQueue() {
        const response = await this.request('/api/v1/approvals');
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
        const headers = {};
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
            return response;
        }
        if (!response.ok) {
            const errorBody = await response.text();
            throw new PlatformApiError(response.status, errorBody);
        }
        return (await response.json());
    }
}
