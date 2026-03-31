export async function listTasks(transport, query = {}) {
    return transport.request(transport.withQuery('/api/v1/tasks', query));
}
export async function getTask(transport, taskId) {
    const response = await transport.request(`/api/v1/tasks/${taskId}`);
    return response.data;
}
export async function createTask(transport, payload) {
    const response = await transport.request('/api/v1/tasks', {
        method: 'POST',
        body: payload,
    });
    return response.data;
}
export async function claimTask(transport, payload) {
    const response = await transport.request('/api/v1/tasks/claim', {
        method: 'POST',
        body: payload,
        allowNoContent: true,
    });
    if (response instanceof Response) {
        return null;
    }
    return response.data;
}
export async function completeTask(transport, taskId, output) {
    const response = await transport.request(`/api/v1/tasks/${taskId}/complete`, {
        method: 'POST',
        body: { output },
    });
    return response.data;
}
export async function failTask(transport, taskId, error) {
    const response = await transport.request(`/api/v1/tasks/${taskId}/fail`, {
        method: 'POST',
        body: { error },
    });
    return response.data;
}
export async function listTaskArtifacts(transport, taskId) {
    const response = await transport.request(`/api/v1/tasks/${taskId}/artifacts`);
    return response.data;
}
export async function getTaskMemory(transport, taskId, key) {
    const path = key
        ? transport.withQuery(`/api/v1/tasks/${taskId}/memory`, { key })
        : `/api/v1/tasks/${taskId}/memory`;
    const response = await transport.request(path);
    return response.data;
}
export async function patchTaskMemory(transport, taskId, payload) {
    const response = await transport.request(`/api/v1/tasks/${taskId}/memory`, {
        method: 'PATCH',
        body: payload,
    });
    return response.data;
}
export async function listTaskArtifactCatalog(transport, taskId, query = {}) {
    const response = await transport.request(transport.withQuery(`/api/v1/tasks/${taskId}/artifact-catalog`, query));
    return response.data;
}
export async function listWorkflowWorkItemTasks(transport, workflowId, workItemId) {
    const response = await transport.request(`/api/v1/workflows/${workflowId}/work-items/${workItemId}/tasks`);
    return response.data;
}
export async function listWorkflowWorkItemEvents(transport, workflowId, workItemId, limit = 100) {
    const response = await transport.request(`/api/v1/workflows/${workflowId}/work-items/${workItemId}/events?limit=${limit}`);
    return response.data;
}
