export async function listWorkflows(transport, query = {}) {
    return transport.request(transport.withQuery('/api/v1/workflows', query));
}
export async function getWorkflow(transport, workflowId) {
    const response = await transport.request(`/api/v1/workflows/${workflowId}`);
    return response.data;
}
export async function getResolvedWorkflowConfig(transport, workflowId, showLayers = false) {
    const suffix = showLayers ? '?show_layers=true' : '';
    const response = await transport.request(`/api/v1/workflows/${workflowId}/config/resolved${suffix}`);
    return response.data;
}
export async function listWorkflowDocuments(transport, workflowId) {
    const response = await transport.request(`/api/v1/workflows/${workflowId}/documents`);
    return response.data;
}
export async function createWorkflowDocument(transport, workflowId, payload) {
    const response = await transport.request(`/api/v1/workflows/${workflowId}/documents`, {
        method: 'POST',
        body: payload,
    });
    return response.data;
}
export async function updateWorkflowDocument(transport, workflowId, logicalName, payload) {
    const response = await transport.request(`/api/v1/workflows/${workflowId}/documents/${encodeURIComponent(logicalName)}`, {
        method: 'PATCH',
        body: payload,
    });
    return response.data;
}
export async function deleteWorkflowDocument(transport, workflowId, logicalName) {
    await transport.request(`/api/v1/workflows/${workflowId}/documents/${encodeURIComponent(logicalName)}`, {
        method: 'DELETE',
        allowNoContent: true,
    });
}
export async function createWorkflow(transport, payload) {
    const response = await transport.request('/api/v1/workflows', {
        method: 'POST',
        body: payload,
    });
    return response.data;
}
export async function cancelWorkflow(transport, workflowId) {
    const response = await transport.request(`/api/v1/workflows/${workflowId}/cancel`, {
        method: 'POST',
    });
    return response.data;
}
export async function getWorkflowBoard(transport, workflowId) {
    const response = await transport.request(`/api/v1/workflows/${workflowId}/board`);
    return response.data;
}
export async function listWorkflowStages(transport, workflowId) {
    const response = await transport.request(`/api/v1/workflows/${workflowId}/stages`);
    return response.data;
}
export async function listWorkflowWorkItems(transport, workflowId, query = {}) {
    const response = await transport.request(transport.withQuery(`/api/v1/workflows/${workflowId}/work-items`, query));
    return response.data;
}
export async function getWorkflowWorkItem(transport, workflowId, workItemId, query = {}) {
    const response = await transport.request(transport.withQuery(`/api/v1/workflows/${workflowId}/work-items/${workItemId}`, query));
    return response.data;
}
export async function createWorkflowWorkItem(transport, workflowId, payload) {
    const response = await transport.request(`/api/v1/workflows/${workflowId}/work-items`, {
        method: 'POST',
        body: payload,
    });
    return response.data;
}
export async function updateWorkflowWorkItem(transport, workflowId, workItemId, payload) {
    const response = await transport.request(`/api/v1/workflows/${workflowId}/work-items/${workItemId}`, {
        method: 'PATCH',
        body: payload,
    });
    return response.data;
}
export async function listWorkflowActivations(transport, workflowId) {
    const response = await transport.request(`/api/v1/workflows/${workflowId}/activations`);
    return response.data;
}
