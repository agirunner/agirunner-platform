import type {
  ApiDataResponse,
  ApiListResponse,
  PlatformEvent,
  Task,
  TaskArtifact,
  TaskArtifactCatalogEntry,
  TaskMemory,
  CreateTaskInput,
  Workspace,
} from '../types.js';
import type { ClientTransport, Query } from './core.js';

export async function listTasks(
  transport: ClientTransport,
  query: Query = {},
): Promise<ApiListResponse<Task>> {
  return transport.request<ApiListResponse<Task>>(transport.withQuery('/api/v1/tasks', query));
}

export async function getTask(transport: ClientTransport, taskId: string): Promise<Task> {
  const response = await transport.request<ApiDataResponse<Task>>(`/api/v1/tasks/${taskId}`);
  return response.data;
}

export async function createTask(
  transport: ClientTransport,
  payload: CreateTaskInput,
): Promise<Task> {
  const response = await transport.request<ApiDataResponse<Task>>('/api/v1/tasks', {
    method: 'POST',
    body: payload,
  });
  return response.data;
}

export async function claimTask(
  transport: ClientTransport,
  payload: {
    agent_id: string;
    worker_id?: string;
    routing_tags?: string[];
    workflow_id?: string;
    playbook_id?: string;
    include_context?: boolean;
  },
): Promise<Task | null> {
  const response = await transport.request<Response | ApiDataResponse<Task>>('/api/v1/tasks/claim', {
    method: 'POST',
    body: payload,
    allowNoContent: true,
  });

  if (response instanceof Response) {
    return null;
  }

  return response.data;
}

export async function completeTask(
  transport: ClientTransport,
  taskId: string,
  output: unknown,
): Promise<Task> {
  const response = await transport.request<ApiDataResponse<Task>>(`/api/v1/tasks/${taskId}/complete`, {
    method: 'POST',
    body: { output },
  });
  return response.data;
}

export async function failTask(
  transport: ClientTransport,
  taskId: string,
  error: Record<string, unknown>,
): Promise<Task> {
  const response = await transport.request<ApiDataResponse<Task>>(`/api/v1/tasks/${taskId}/fail`, {
    method: 'POST',
    body: { error },
  });
  return response.data;
}

export async function listTaskArtifacts(
  transport: ClientTransport,
  taskId: string,
): Promise<TaskArtifact[]> {
  const response = await transport.request<ApiDataResponse<TaskArtifact[]>>(
    `/api/v1/tasks/${taskId}/artifacts`,
  );
  return response.data;
}

export async function getTaskMemory(
  transport: ClientTransport,
  taskId: string,
  key?: string,
): Promise<TaskMemory> {
  const path = key
    ? transport.withQuery(`/api/v1/tasks/${taskId}/memory`, { key })
    : `/api/v1/tasks/${taskId}/memory`;
  const response = await transport.request<ApiDataResponse<TaskMemory>>(path);
  return response.data;
}

export async function patchTaskMemory(
  transport: ClientTransport,
  taskId: string,
  payload: { key: string; value: unknown },
): Promise<Workspace> {
  const response = await transport.request<ApiDataResponse<Workspace>>(`/api/v1/tasks/${taskId}/memory`, {
    method: 'PATCH',
    body: payload,
  });
  return response.data;
}

export async function listTaskArtifactCatalog(
  transport: ClientTransport,
  taskId: string,
  query: {
    task_id?: string;
    work_item_id?: string;
    name_prefix?: string;
    limit?: number;
  } = {},
): Promise<TaskArtifactCatalogEntry[]> {
  const response = await transport.request<ApiDataResponse<TaskArtifactCatalogEntry[]>>(
    transport.withQuery(`/api/v1/tasks/${taskId}/artifact-catalog`, query),
  );
  return response.data;
}

export async function listWorkflowWorkItemTasks(
  transport: ClientTransport,
  workflowId: string,
  workItemId: string,
): Promise<Task[]> {
  const response = await transport.request<ApiDataResponse<Task[]>>(
    `/api/v1/workflows/${workflowId}/work-items/${workItemId}/tasks`,
  );
  return response.data;
}

export async function listWorkflowWorkItemEvents(
  transport: ClientTransport,
  workflowId: string,
  workItemId: string,
  limit = 100,
): Promise<PlatformEvent[]> {
  const response = await transport.request<ApiDataResponse<PlatformEvent[]>>(
    `/api/v1/workflows/${workflowId}/work-items/${workItemId}/events?limit=${limit}`,
  );
  return response.data;
}
