export async function listPlaybooks(transport) {
    const response = await transport.request('/api/v1/playbooks');
    return response.data;
}
export async function getPlaybook(transport, playbookId) {
    const response = await transport.request(`/api/v1/playbooks/${playbookId}`);
    return response.data;
}
export async function createPlaybook(transport, payload) {
    const response = await transport.request('/api/v1/playbooks', {
        method: 'POST',
        body: payload,
    });
    return response.data;
}
export async function updatePlaybook(transport, playbookId, payload) {
    const response = await transport.request(`/api/v1/playbooks/${playbookId}`, {
        method: 'PATCH',
        body: payload,
    });
    return response.data;
}
export async function replacePlaybook(transport, playbookId, payload) {
    const response = await transport.request(`/api/v1/playbooks/${playbookId}`, {
        method: 'PUT',
        body: payload,
    });
    return response.data;
}
export async function archivePlaybook(transport, playbookId) {
    const response = await transport.request(`/api/v1/playbooks/${playbookId}/archive`, {
        method: 'PATCH',
        body: { archived: true },
    });
    return response.data;
}
export async function restorePlaybook(transport, playbookId) {
    const response = await transport.request(`/api/v1/playbooks/${playbookId}/archive`, {
        method: 'PATCH',
        body: { archived: false },
    });
    return response.data;
}
export async function deletePlaybook(transport, playbookId) {
    const response = await transport.request(`/api/v1/playbooks/${playbookId}`, {
        method: 'DELETE',
    });
    return response.data;
}
