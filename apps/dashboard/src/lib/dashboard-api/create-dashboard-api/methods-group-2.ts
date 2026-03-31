import type * as Contracts from '../contracts.js';
import { clearSession, readSession, writeSession } from '../../session.js';

import {
  buildMissionControlQuery,
  buildQueryString,
  buildRequestBodyWithRequestId,
  createRequestId,
  readContentDispositionFileName,
} from '../create-dashboard-api.request.js';
import { buildSearchResults, extractDataResult, extractListResult } from '../create-dashboard-api.search.js';
import type { DashboardApiMethodContext } from './method-context.js';

export function createDashboardApiMethodsGroup2(
  context: DashboardApiMethodContext,
): Partial<Contracts.DashboardApi> {
  const {
    baseUrl,
    client,
    defaultManualWorkflowActivationEventType,
    normalizeEventPage,
    requestBinary,
    requestData,
    requestFetch,
    requestJson,
    requestTaskEscalationResolution,
    requestWorkflowControlAction,
    requestWorkflowWorkItemAction,
    requestWorkflowWorkItemTaskAction,
    withRefresh,
  } = context;

  return {
getWorkflowWorkItem: (workflowId, workItemId) =>
  withRefresh(() =>
    requestData<Contracts.DashboardWorkflowWorkItemRecord>(
      `/api/v1/workflows/${workflowId}/work-items/${workItemId}`,
      {
        method: 'GET',
      },
    ),
  ),
listWorkflowWorkItemTasks: (workflowId, workItemId) =>
  withRefresh(() =>
    requestData<Record<string, unknown>[]>(
      `/api/v1/workflows/${workflowId}/work-items/${workItemId}/tasks`,
      {
        method: 'GET',
      },
    ),
  ),
listWorkflowWorkItemEvents: (workflowId, workItemId, limit = 100) =>
  withRefresh(() =>
    requestData<Contracts.DashboardEventRecord[]>(
      `/api/v1/workflows/${workflowId}/work-items/${workItemId}/events?limit=${limit}`,
      {
        method: 'GET',
      },
    ),
  ),
listWorkflowWorkItemHandoffs: (workflowId, workItemId) =>
  withRefresh(() =>
    requestData<Contracts.DashboardTaskHandoffRecord[]>(
      `/api/v1/workflows/${workflowId}/work-items/${workItemId}/handoffs`,
      {
        method: 'GET',
      },
    ),
  ),
getLatestWorkflowWorkItemHandoff: (workflowId, workItemId) =>
  withRefresh(() =>
    requestData<Contracts.DashboardTaskHandoffRecord | null>(
      `/api/v1/workflows/${workflowId}/work-items/${workItemId}/handoffs/latest`,
      {
        method: 'GET',
      },
    ),
  ),
getWorkflowWorkItemMemory: (workflowId, workItemId) =>
  withRefresh(() =>
    requestData<{ entries: Contracts.DashboardWorkItemMemoryEntry[] }>(
      `/api/v1/workflows/${workflowId}/work-items/${workItemId}/memory`,
      {
        method: 'GET',
      },
    ),
  ),
getWorkflowWorkItemMemoryHistory: (workflowId, workItemId, limit = 100) =>
  withRefresh(() =>
    requestData<{ history: Contracts.DashboardWorkItemMemoryHistoryEntry[] }>(
      `/api/v1/workflows/${workflowId}/work-items/${workItemId}/memory/history?limit=${limit}`,
      {
        method: 'GET',
      },
    ),
  ),
listWorkflowActivations: (workflowId) =>
  withRefresh(() =>
    requestData<Contracts.DashboardWorkflowActivationRecord[]>(
      `/api/v1/workflows/${workflowId}/activations`,
      { method: 'GET' },
    ),
  ),
enqueueWorkflowActivation: (workflowId, payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardWorkflowActivationRecord>(
      `/api/v1/workflows/${workflowId}/activations`,
      {
        method: 'POST',
        body: buildRequestBodyWithRequestId({
          ...payload,
          event_type:
            typeof payload.event_type === 'string' && payload.event_type.trim().length > 0
              ? payload.event_type
              : defaultManualWorkflowActivationEventType,
        }),
      },
    ),
  ),
listWorkflowEvents: (workflowId, filters) =>
  withRefresh(async () =>
    normalizeEventPage(
      await requestJson<{
        data: Contracts.DashboardEventRecord[];
        meta?: { has_more?: boolean; next_after?: string | number | null };
      }>(`/api/v1/workflows/${workflowId}/events${buildQueryString(filters)}`, {
        method: 'GET',
      }),
    ),
  ),
listWorkflowDocuments: (workflowId) =>
  withRefresh(() =>
    requestData<Contracts.DashboardResolvedDocumentReference[]>(
      `/api/v1/workflows/${workflowId}/documents`,
      { method: 'GET' },
    ),
  ),
createWorkflowDocument: (workflowId, payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardResolvedDocumentReference>(
      `/api/v1/workflows/${workflowId}/documents`,
      {
        method: 'POST',
        body: buildRequestBodyWithRequestId(payload as unknown as Record<string, unknown>),
      },
    ),
  ),
updateWorkflowDocument: (workflowId, logicalName, payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardResolvedDocumentReference>(
      `/api/v1/workflows/${workflowId}/documents/${encodeURIComponent(logicalName)}`,
      {
        method: 'PATCH',
        body: buildRequestBodyWithRequestId(payload as Record<string, unknown>),
      },
    ),
  ),
deleteWorkflowDocument: (workflowId, logicalName) =>
  withRefresh(() =>
    requestJson<Record<string, never>>(
      `/api/v1/workflows/${workflowId}/documents/${encodeURIComponent(logicalName)}${buildQueryString({ request_id: createRequestId() })}`,
      {
        method: 'DELETE',
      },
    ).then(() => undefined),
  ),
listPlaybooks: () =>
  withRefresh(async () => ({
    data: (await client.listPlaybooks()) as Contracts.DashboardPlaybookRecord[],
  })),
getPlaybook: (playbookId) =>
  withRefresh(() => client.getPlaybook(playbookId) as Promise<Contracts.DashboardPlaybookRecord>),
createPlaybook: (payload) =>
  withRefresh(
    () => client.createPlaybook(payload as never) as Promise<Contracts.DashboardPlaybookRecord>,
  ),
updatePlaybook: (playbookId, payload) =>
  withRefresh(
    () =>
      client.updatePlaybook(playbookId, payload as never) as Promise<Contracts.DashboardPlaybookRecord>,
  ),
archivePlaybook: (playbookId) =>
  withRefresh(() => client.archivePlaybook(playbookId) as Promise<Contracts.DashboardPlaybookRecord>),
restorePlaybook: (playbookId) =>
  withRefresh(() => client.restorePlaybook(playbookId) as Promise<Contracts.DashboardPlaybookRecord>),
deletePlaybook: (playbookId) =>
  withRefresh(() => client.deletePlaybook(playbookId).then(() => undefined)),
getPlaybookDeleteImpact: (playbookId) =>
  withRefresh(() =>
    requestData<Contracts.DashboardPlaybookDeleteImpact>(
      `/api/v1/playbooks/${playbookId}/delete-impact`,
      {
        method: 'GET',
      },
    ),
  ),
deletePlaybookPermanently: (playbookId) =>
  withRefresh(async () => {
    await requestJson(`/api/v1/playbooks/${playbookId}/permanent`, { method: 'DELETE' });
  }),
listLlmProviders: () =>
  withRefresh(() =>
    requestData<Contracts.DashboardLlmProviderRecord[]>('/api/v1/config/llm/providers', {
      method: 'GET',
    }),
  ),
listLlmModels: () =>
  withRefresh(() =>
    requestData<Contracts.DashboardLlmModelRecord[]>('/api/v1/config/llm/models', {
      method: 'GET',
    }),
  ),
createWorkflow: (payload) =>
  withRefresh(
    () => client.createWorkflow(payload as never) as Promise<Contracts.DashboardWorkflowRecord>,
  ),
createWorkflowWorkItem: (workflowId, payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardWorkflowWorkItemRecord>(`/api/v1/workflows/${workflowId}/work-items`, {
      body: buildRequestBodyWithRequestId(payload as Record<string, unknown>),
    }),
  ),
updateWorkflowWorkItem: (workflowId, workItemId, payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardWorkflowWorkItemRecord>(
      `/api/v1/workflows/${workflowId}/work-items/${workItemId}`,
      {
        method: 'PATCH',
        body: buildRequestBodyWithRequestId(payload as Record<string, unknown>),
      },
    ),
  ),
retryWorkflowWorkItem: (workflowId, workItemId, payload = {}) =>
  withRefresh(() => requestWorkflowWorkItemAction(workflowId, workItemId, 'retry', payload)),
skipWorkflowWorkItem: (workflowId, workItemId, payload) =>
  withRefresh(() => requestWorkflowWorkItemAction(workflowId, workItemId, 'skip', payload)),
reassignWorkflowWorkItemTask: (workflowId, workItemId, taskId, payload) =>
  withRefresh(() =>
    requestWorkflowWorkItemTaskAction(workflowId, workItemId, taskId, 'reassign', payload),
  ),
approveWorkflowWorkItemTask: (workflowId, workItemId, taskId) =>
  withRefresh(() =>
    requestWorkflowWorkItemTaskAction(workflowId, workItemId, taskId, 'approve', {}),
  ),
approveWorkflowWorkItemTaskOutput: (workflowId, workItemId, taskId) =>
  withRefresh(() =>
    requestWorkflowWorkItemTaskAction(workflowId, workItemId, taskId, 'approve-output', {}),
  ),
rejectWorkflowWorkItemTask: (workflowId, workItemId, taskId, payload) =>
  withRefresh(() =>
    requestWorkflowWorkItemTaskAction(workflowId, workItemId, taskId, 'reject', payload),
  ),
requestWorkflowWorkItemTaskChanges: (workflowId, workItemId, taskId, payload) =>
  withRefresh(() =>
    requestWorkflowWorkItemTaskAction(
      workflowId,
      workItemId,
      taskId,
      'request-changes',
      payload,
    ),
  ),
retryWorkflowWorkItemTask: (workflowId, workItemId, taskId, payload = {}) =>
  withRefresh(() =>
    requestWorkflowWorkItemTaskAction(workflowId, workItemId, taskId, 'retry', payload),
  ),
skipWorkflowWorkItemTask: (workflowId, workItemId, taskId, payload) =>
  withRefresh(() =>
    requestWorkflowWorkItemTaskAction(workflowId, workItemId, taskId, 'skip', payload),
  ),
resolveWorkflowWorkItemTaskEscalation: (workflowId, workItemId, taskId, payload) =>
  withRefresh(() =>
    requestWorkflowWorkItemTaskAction(
      workflowId,
      workItemId,
      taskId,
      'resolve-escalation',
      payload,
    ),
  ),
cancelWorkflowWorkItemTask: (workflowId, workItemId, taskId) =>
  withRefresh(() =>
    requestWorkflowWorkItemTaskAction(workflowId, workItemId, taskId, 'cancel', {}),
  ),
overrideWorkflowWorkItemTaskOutput: (workflowId, workItemId, taskId, payload) =>
  withRefresh(() =>
    requestWorkflowWorkItemTaskAction(
      workflowId,
      workItemId,
      taskId,
      'output-override',
      payload as Record<string, unknown>,
    ),
  ),
pauseWorkflowWorkItem: (workflowId, workItemId) =>
  withRefresh(() => requestWorkflowWorkItemAction(workflowId, workItemId, 'pause', {})),
resumeWorkflowWorkItem: (workflowId, workItemId) =>
  withRefresh(() => requestWorkflowWorkItemAction(workflowId, workItemId, 'resume', {})),
cancelWorkflowWorkItem: (workflowId, workItemId) =>
  withRefresh(() => requestWorkflowWorkItemAction(workflowId, workItemId, 'cancel', {})),
cancelWorkflow: (workflowId) =>
  withRefresh(() => requestWorkflowControlAction(`/api/v1/workflows/${workflowId}/cancel`)),
chainWorkflow: (workflowId, payload) =>
  withRefresh(() =>
    requestJson(`/api/v1/workflows/${workflowId}/chain`, {
      body: payload as unknown as Record<string, unknown>,
    }),
  ),
  };
}
