import type {
  Agent,
  ApprovalQueue,
  ApiDataResponse,
  ApiListResponse,
  Worker,
} from '../types.js';
import type { ClientTransport, Query } from './core.js';

export async function getApprovalQueue(transport: ClientTransport): Promise<ApprovalQueue> {
  const response = await transport.request<ApiDataResponse<ApprovalQueue>>('/api/v1/approvals');
  return response.data;
}

export async function listWorkers(transport: ClientTransport): Promise<Worker[]> {
  const response = await transport.request<ApiDataResponse<Worker[]>>('/api/v1/workers');
  return response.data;
}

export async function listAgents(transport: ClientTransport): Promise<Agent[]> {
  const response = await transport.request<ApiDataResponse<Agent[]>>('/api/v1/agents');
  return response.data;
}

export async function paginate<T>(
  fetchPage: (query: Query) => Promise<ApiListResponse<T>>,
  options: { perPage?: number; startPage?: number } = {},
): Promise<T[]> {
  const perPage = options.perPage ?? 50;
  let page = options.startPage ?? 1;
  const all: T[] = [];

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
