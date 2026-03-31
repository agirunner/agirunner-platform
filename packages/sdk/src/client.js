import { exchangeApiKey, refreshSession } from './client/auth.js';
import { claimTask, completeTask, createTask, failTask, getTask, getTaskMemory, listTaskArtifactCatalog, listTaskArtifacts, listTasks, listWorkflowWorkItemEvents, listWorkflowWorkItemTasks, patchTaskMemory, } from './client/tasks.js';
import { cancelWorkflow, createWorkflow, createWorkflowDocument, createWorkflowWorkItem, deleteWorkflowDocument, getResolvedWorkflowConfig, getWorkflow, getWorkflowBoard, getWorkflowWorkItem, listWorkflowActivations, listWorkflowDocuments, listWorkflowStages, listWorkflowWorkItems, listWorkflows, updateWorkflowDocument, updateWorkflowWorkItem, } from './client/workflows.js';
import { createPlanningWorkflow, getWorkspace, getWorkspaceTimeline, listWorkspaces, patchWorkspaceMemory, } from './client/workspaces.js';
import { archivePlaybook, createPlaybook, deletePlaybook, getPlaybook, listPlaybooks, replacePlaybook, restorePlaybook, updatePlaybook, } from './client/playbooks.js';
import { getApprovalQueue, listAgents, listWorkers, paginate, } from './client/admin.js';
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
    transport;
    constructor(options) {
        this.baseUrl = options.baseUrl.replace(/\/$/, '');
        this.accessToken = options.accessToken;
        this.fetcher = options.fetcher ?? ((input, init) => globalThis.fetch(input, init));
        this.transport = {
            request: this.request.bind(this),
            withQuery: this.withQuery.bind(this),
        };
    }
    setAccessToken(token) {
        this.accessToken = token;
    }
    async exchangeApiKey(apiKey, persistentSession = true) {
        return exchangeApiKey(this.transport, apiKey, persistentSession);
    }
    async refreshSession() {
        return refreshSession(this.transport);
    }
    async listTasks(query = {}) {
        return listTasks(this.transport, query);
    }
    async getTask(taskId) {
        return getTask(this.transport, taskId);
    }
    async createTask(payload) {
        return createTask(this.transport, payload);
    }
    async claimTask(payload) {
        return claimTask(this.transport, payload);
    }
    async completeTask(taskId, output) {
        return completeTask(this.transport, taskId, output);
    }
    async failTask(taskId, error) {
        return failTask(this.transport, taskId, error);
    }
    async listWorkflows(query = {}) {
        return listWorkflows(this.transport, query);
    }
    async getWorkflow(workflowId) {
        return getWorkflow(this.transport, workflowId);
    }
    async getResolvedWorkflowConfig(workflowId, showLayers = false) {
        return getResolvedWorkflowConfig(this.transport, workflowId, showLayers);
    }
    async listWorkflowDocuments(workflowId) {
        return listWorkflowDocuments(this.transport, workflowId);
    }
    async createWorkflowDocument(workflowId, payload) {
        return createWorkflowDocument(this.transport, workflowId, payload);
    }
    async updateWorkflowDocument(workflowId, logicalName, payload) {
        return updateWorkflowDocument(this.transport, workflowId, logicalName, payload);
    }
    async deleteWorkflowDocument(workflowId, logicalName) {
        return deleteWorkflowDocument(this.transport, workflowId, logicalName);
    }
    async createWorkflow(payload) {
        return createWorkflow(this.transport, payload);
    }
    async cancelWorkflow(workflowId) {
        return cancelWorkflow(this.transport, workflowId);
    }
    async getWorkflowBoard(workflowId) {
        return getWorkflowBoard(this.transport, workflowId);
    }
    async listWorkflowStages(workflowId) {
        return listWorkflowStages(this.transport, workflowId);
    }
    async listWorkflowWorkItems(workflowId, query = {}) {
        return listWorkflowWorkItems(this.transport, workflowId, query);
    }
    async getWorkflowWorkItem(workflowId, workItemId, query = {}) {
        return getWorkflowWorkItem(this.transport, workflowId, workItemId, query);
    }
    async listWorkflowWorkItemTasks(workflowId, workItemId) {
        return listWorkflowWorkItemTasks(this.transport, workflowId, workItemId);
    }
    async listWorkflowWorkItemEvents(workflowId, workItemId, limit = 100) {
        return listWorkflowWorkItemEvents(this.transport, workflowId, workItemId, limit);
    }
    async createWorkflowWorkItem(workflowId, payload) {
        return createWorkflowWorkItem(this.transport, workflowId, payload);
    }
    async updateWorkflowWorkItem(workflowId, workItemId, payload) {
        return updateWorkflowWorkItem(this.transport, workflowId, workItemId, payload);
    }
    async listWorkflowActivations(workflowId) {
        return listWorkflowActivations(this.transport, workflowId);
    }
    async listWorkspaces(query = {}) {
        return listWorkspaces(this.transport, query);
    }
    async getWorkspace(workspaceId) {
        return getWorkspace(this.transport, workspaceId);
    }
    async patchWorkspaceMemory(workspaceId, payload) {
        return patchWorkspaceMemory(this.transport, workspaceId, payload);
    }
    async getWorkspaceTimeline(workspaceId) {
        return getWorkspaceTimeline(this.transport, workspaceId);
    }
    async createPlanningWorkflow(workspaceId, payload) {
        return createPlanningWorkflow(this.transport, workspaceId, payload);
    }
    async listPlaybooks() {
        return listPlaybooks(this.transport);
    }
    async getPlaybook(playbookId) {
        return getPlaybook(this.transport, playbookId);
    }
    async createPlaybook(payload) {
        return createPlaybook(this.transport, payload);
    }
    async updatePlaybook(playbookId, payload) {
        return updatePlaybook(this.transport, playbookId, payload);
    }
    async replacePlaybook(playbookId, payload) {
        return replacePlaybook(this.transport, playbookId, payload);
    }
    async archivePlaybook(playbookId) {
        return archivePlaybook(this.transport, playbookId);
    }
    async restorePlaybook(playbookId) {
        return restorePlaybook(this.transport, playbookId);
    }
    async deletePlaybook(playbookId) {
        return deletePlaybook(this.transport, playbookId);
    }
    async listTaskArtifacts(taskId) {
        return listTaskArtifacts(this.transport, taskId);
    }
    async getTaskMemory(taskId, key) {
        return getTaskMemory(this.transport, taskId, key);
    }
    async patchTaskMemory(taskId, payload) {
        return patchTaskMemory(this.transport, taskId, payload);
    }
    async listTaskArtifactCatalog(taskId, query = {}) {
        return listTaskArtifactCatalog(this.transport, taskId, query);
    }
    async getApprovalQueue() {
        return getApprovalQueue(this.transport);
    }
    async listWorkers() {
        return listWorkers(this.transport);
    }
    async listAgents() {
        return listAgents(this.transport);
    }
    async paginate(fetchPage, options = {}) {
        return paginate(fetchPage, options);
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
