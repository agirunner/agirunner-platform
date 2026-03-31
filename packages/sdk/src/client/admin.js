export async function getApprovalQueue(transport) {
    const response = await transport.request('/api/v1/approvals');
    return response.data;
}
export async function listWorkers(transport) {
    const response = await transport.request('/api/v1/workers');
    return response.data;
}
export async function listAgents(transport) {
    const response = await transport.request('/api/v1/agents');
    return response.data;
}
export async function paginate(fetchPage, options = {}) {
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
