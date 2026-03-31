import type {
  ApiDataResponse,
  ApiListResponse,
  CreateWorkflowDocumentInput,
  CreateWorkflowInput,
  CreateWorkflowWorkItemInput,
  GetWorkflowWorkItemQuery,
  ListWorkflowWorkItemsQuery,
  ResolvedDocumentReference,
  ResolvedWorkflowConfig,
  UpdateWorkflowDocumentInput,
  UpdateWorkflowWorkItemInput,
  Workflow,
  WorkflowActivation,
  WorkflowBoard,
  WorkflowStage,
  WorkflowWorkItem,
} from '../types.js';
import type { ClientTransport, Query } from './core.js';

export async function listWorkflows(
  transport: ClientTransport,
  query: Query = {},
): Promise<ApiListResponse<Workflow>> {
  return transport.request<ApiListResponse<Workflow>>(transport.withQuery('/api/v1/workflows', query));
}

export async function getWorkflow(
  transport: ClientTransport,
  workflowId: string,
): Promise<Workflow> {
  const response = await transport.request<ApiDataResponse<Workflow>>(`/api/v1/workflows/${workflowId}`);
  return response.data;
}

export async function getResolvedWorkflowConfig(
  transport: ClientTransport,
  workflowId: string,
  showLayers = false,
): Promise<ResolvedWorkflowConfig> {
  const suffix = showLayers ? '?show_layers=true' : '';
  const response = await transport.request<ApiDataResponse<ResolvedWorkflowConfig>>(
    `/api/v1/workflows/${workflowId}/config/resolved${suffix}`,
  );
  return response.data;
}

export async function listWorkflowDocuments(
  transport: ClientTransport,
  workflowId: string,
): Promise<ResolvedDocumentReference[]> {
  const response = await transport.request<ApiDataResponse<ResolvedDocumentReference[]>>(
    `/api/v1/workflows/${workflowId}/documents`,
  );
  return response.data;
}

export async function createWorkflowDocument(
  transport: ClientTransport,
  workflowId: string,
  payload: CreateWorkflowDocumentInput,
): Promise<ResolvedDocumentReference> {
  const response = await transport.request<ApiDataResponse<ResolvedDocumentReference>>(
    `/api/v1/workflows/${workflowId}/documents`,
    {
      method: 'POST',
      body: payload,
    },
  );
  return response.data;
}

export async function updateWorkflowDocument(
  transport: ClientTransport,
  workflowId: string,
  logicalName: string,
  payload: UpdateWorkflowDocumentInput,
): Promise<ResolvedDocumentReference> {
  const response = await transport.request<ApiDataResponse<ResolvedDocumentReference>>(
    `/api/v1/workflows/${workflowId}/documents/${encodeURIComponent(logicalName)}`,
    {
      method: 'PATCH',
      body: payload,
    },
  );
  return response.data;
}

export async function deleteWorkflowDocument(
  transport: ClientTransport,
  workflowId: string,
  logicalName: string,
): Promise<void> {
  await transport.request<Response>(
    `/api/v1/workflows/${workflowId}/documents/${encodeURIComponent(logicalName)}`,
    {
      method: 'DELETE',
      allowNoContent: true,
    },
  );
}

export async function createWorkflow(
  transport: ClientTransport,
  payload: CreateWorkflowInput,
): Promise<Workflow> {
  const response = await transport.request<ApiDataResponse<Workflow>>('/api/v1/workflows', {
    method: 'POST',
    body: payload,
  });
  return response.data;
}

export async function cancelWorkflow(
  transport: ClientTransport,
  workflowId: string,
): Promise<Workflow> {
  const response = await transport.request<ApiDataResponse<Workflow>>(
    `/api/v1/workflows/${workflowId}/cancel`,
    {
      method: 'POST',
    },
  );
  return response.data;
}

export async function getWorkflowBoard(
  transport: ClientTransport,
  workflowId: string,
): Promise<WorkflowBoard> {
  const response = await transport.request<ApiDataResponse<WorkflowBoard>>(
    `/api/v1/workflows/${workflowId}/board`,
  );
  return response.data;
}

export async function listWorkflowStages(
  transport: ClientTransport,
  workflowId: string,
): Promise<WorkflowStage[]> {
  const response = await transport.request<ApiDataResponse<WorkflowStage[]>>(
    `/api/v1/workflows/${workflowId}/stages`,
  );
  return response.data;
}

export async function listWorkflowWorkItems(
  transport: ClientTransport,
  workflowId: string,
  query: ListWorkflowWorkItemsQuery = {},
): Promise<WorkflowWorkItem[]> {
  const response = await transport.request<ApiDataResponse<WorkflowWorkItem[]>>(
    transport.withQuery(`/api/v1/workflows/${workflowId}/work-items`, query as Query),
  );
  return response.data;
}

export async function getWorkflowWorkItem(
  transport: ClientTransport,
  workflowId: string,
  workItemId: string,
  query: GetWorkflowWorkItemQuery = {},
): Promise<WorkflowWorkItem> {
  const response = await transport.request<ApiDataResponse<WorkflowWorkItem>>(
    transport.withQuery(`/api/v1/workflows/${workflowId}/work-items/${workItemId}`, query as Query),
  );
  return response.data;
}

export async function createWorkflowWorkItem(
  transport: ClientTransport,
  workflowId: string,
  payload: CreateWorkflowWorkItemInput,
): Promise<WorkflowWorkItem> {
  const response = await transport.request<ApiDataResponse<WorkflowWorkItem>>(
    `/api/v1/workflows/${workflowId}/work-items`,
    {
      method: 'POST',
      body: payload,
    },
  );
  return response.data;
}

export async function updateWorkflowWorkItem(
  transport: ClientTransport,
  workflowId: string,
  workItemId: string,
  payload: UpdateWorkflowWorkItemInput,
): Promise<WorkflowWorkItem> {
  const response = await transport.request<ApiDataResponse<WorkflowWorkItem>>(
    `/api/v1/workflows/${workflowId}/work-items/${workItemId}`,
    {
      method: 'PATCH',
      body: payload,
    },
  );
  return response.data;
}

export async function listWorkflowActivations(
  transport: ClientTransport,
  workflowId: string,
): Promise<WorkflowActivation[]> {
  const response = await transport.request<ApiDataResponse<WorkflowActivation[]>>(
    `/api/v1/workflows/${workflowId}/activations`,
  );
  return response.data;
}
