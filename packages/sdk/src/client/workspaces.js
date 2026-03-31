export async function listWorkspaces(transport, query = {}) {
    return transport.request(transport.withQuery('/api/v1/workspaces', query));
}
export async function getWorkspace(transport, workspaceId) {
    const response = await transport.request(`/api/v1/workspaces/${workspaceId}`);
    return response.data;
}
export async function patchWorkspaceMemory(transport, workspaceId, payload) {
    const response = await transport.request(`/api/v1/workspaces/${workspaceId}/memory`, {
        method: 'PATCH',
        body: payload,
    });
    return response.data;
}
export async function getWorkspaceTimeline(transport, workspaceId) {
    const response = await transport.request(`/api/v1/workspaces/${workspaceId}/timeline`);
    return response.data;
}
export async function createPlanningWorkflow(transport, workspaceId, payload) {
    const response = await transport.request(`/api/v1/workspaces/${workspaceId}/planning-workflow`, {
        method: 'POST',
        body: payload,
    });
    return response.data;
}
