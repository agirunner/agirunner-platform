import type {
  ApiDataResponse,
  ApiListResponse,
  Workspace,
  WorkspaceTimelineEntry,
  Workflow,
} from '../types.js';
import type { ClientTransport, Query } from './core.js';

export async function listWorkspaces(
  transport: ClientTransport,
  query: Query = {},
): Promise<ApiListResponse<Workspace>> {
  return transport.request<ApiListResponse<Workspace>>(transport.withQuery('/api/v1/workspaces', query));
}

export async function getWorkspace(
  transport: ClientTransport,
  workspaceId: string,
): Promise<Workspace> {
  const response = await transport.request<ApiDataResponse<Workspace>>(`/api/v1/workspaces/${workspaceId}`);
  return response.data;
}

export async function patchWorkspaceMemory(
  transport: ClientTransport,
  workspaceId: string,
  payload: { key: string; value: unknown },
): Promise<Workspace> {
  const response = await transport.request<ApiDataResponse<Workspace>>(
    `/api/v1/workspaces/${workspaceId}/memory`,
    {
      method: 'PATCH',
      body: payload,
    },
  );
  return response.data;
}

export async function getWorkspaceTimeline(
  transport: ClientTransport,
  workspaceId: string,
): Promise<WorkspaceTimelineEntry[]> {
  const response = await transport.request<ApiDataResponse<WorkspaceTimelineEntry[]>>(
    `/api/v1/workspaces/${workspaceId}/timeline`,
  );
  return response.data;
}

export async function createPlanningWorkflow(
  transport: ClientTransport,
  workspaceId: string,
  payload: { brief: string; name?: string },
): Promise<Workflow> {
  const response = await transport.request<ApiDataResponse<Workflow>>(
    `/api/v1/workspaces/${workspaceId}/planning-workflow`,
    {
      method: 'POST',
      body: payload,
    },
  );
  return response.data;
}
