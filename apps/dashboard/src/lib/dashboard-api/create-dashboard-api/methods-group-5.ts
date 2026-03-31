import type * as Contracts from '../contracts.js';
import { clearSession, readSession, writeSession } from '../../auth/session.js';

import {
  buildMissionControlQuery,
  buildQueryString,
  buildRequestBodyWithRequestId,
  createRequestId,
  readContentDispositionFileName,
} from '../create-dashboard-api.request.js';
import { buildSearchResults, extractDataResult, extractListResult } from '../create-dashboard-api.search.js';
import type { DashboardApiMethodContext } from './method-context.js';

export function createDashboardApiMethodsGroup5(
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
getCostSummary: () =>
  withRefresh(() =>
    requestData<Contracts.DashboardCostSummaryRecord>('/api/v1/metering/summary', {
      method: 'GET',
    }),
  ),
getRetentionPolicy: () =>
  withRefresh(() =>
    requestData<Contracts.DashboardGovernanceRetentionPolicy>('/api/v1/governance/retention-policy', {
      method: 'GET',
    }),
  ),
updateRetentionPolicy: (payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardGovernanceRetentionPolicy>('/api/v1/governance/retention-policy', {
      method: 'PUT',
      body: payload as Record<string, unknown>,
    }),
  ),
getLoggingConfig: () =>
  withRefresh(() =>
    requestData<Contracts.DashboardLoggingConfig>('/api/v1/governance/logging', {
      method: 'GET',
    }),
  ),
updateLoggingConfig: (payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardLoggingConfig>('/api/v1/governance/logging', {
      method: 'PUT',
      body: payload as unknown as Record<string, unknown>,
    }),
  ),
listEvents: (filters) =>
  withRefresh(async () =>
    normalizeEventPage(
      await requestJson<{
        data: Contracts.DashboardEventRecord[];
        meta?: { has_more?: boolean; next_after?: string | number | null };
      }>(`/api/v1/events${buildQueryString(filters)}`, {
        method: 'GET',
      }),
    ),
  ),
listApiKeys: () =>
  withRefresh(async () => {
    const response = await requestJson<{ data: Contracts.DashboardApiKeyRecord[] }>('/api/v1/api-keys', {
      method: 'GET',
    });
    return response.data;
  }),
createApiKey: (payload) =>
  withRefresh(async () => {
    const response = await requestJson<{
      data: { api_key: string; key_prefix: string };
    }>('/api/v1/api-keys', { body: payload });
    return response.data;
  }),
revokeApiKey: (id) =>
  withRefresh(() => requestJson(`/api/v1/api-keys/${id}`, { method: 'DELETE' })),
search: (query) =>
  withRefresh(async () => {
    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery.length < 2) {
      return [];
    }

    const [workflows, tasks, workers, agents, workspaces, playbooks] = await Promise.allSettled(
      [
        client.listWorkflows({ per_page: 50 }),
        client.listTasks({ per_page: 50 }),
        client.listWorkers(),
        client.listAgents(),
        client.listWorkspaces({ per_page: 50 }),
        client.listPlaybooks(),
      ],
    );

    return buildSearchResults(normalizedQuery, {
      workflows: extractListResult(workflows),
      tasks: extractListResult(tasks),
      workers: extractDataResult(workers),
      agents: extractDataResult(agents),
      workspaces: extractListResult(workspaces),
      playbooks: extractDataResult(playbooks),
    });
  }),
fetchFleetStatus: () =>
  withRefresh(() =>
    requestData<Contracts.FleetStatusResponse>('/api/v1/fleet/status', {
      method: 'GET',
    }),
  ),
fetchFleetEvents: (filters) =>
  withRefresh(async () => {
    const response = await requestJson<{
      data?: { events?: Contracts.FleetEventRecord[]; total?: number };
    }>(`/api/v1/fleet/events${buildQueryString(filters)}`, { method: 'GET' });
    return {
      data: response.data?.events ?? [],
      total: response.data?.total ?? 0,
    };
  }),
fetchFleetWorkers: () =>
  withRefresh(() =>
    requestData<Contracts.FleetWorkerRecord[]>('/api/v1/fleet/workers', {
      method: 'GET',
    }),
  ),
createFleetWorker: (payload) =>
  withRefresh(() =>
    requestData<Contracts.FleetWorkerRecord>('/api/v1/fleet/workers', {
      method: 'POST',
      body: payload as Record<string, unknown>,
    }),
  ),
updateFleetWorker: (workerId, payload) =>
  withRefresh(() =>
    requestData<Contracts.FleetWorkerRecord>(`/api/v1/fleet/workers/${workerId}`, {
      method: 'PATCH',
      body: payload as Record<string, unknown>,
    }),
  ),
restartFleetWorker: (workerId) =>
  withRefresh(() =>
    requestData<unknown>(`/api/v1/fleet/workers/${workerId}/restart`, {
      method: 'POST',
    }),
  ),
drainFleetWorker: (workerId) =>
  withRefresh(() =>
    requestData<unknown>(`/api/v1/fleet/workers/${workerId}/drain`, {
      method: 'POST',
    }),
  ),
deleteFleetWorker: (workerId) =>
  withRefresh(() =>
    requestJson<Record<string, never>>(`/api/v1/fleet/workers/${workerId}`, {
      method: 'DELETE',
    }).then(() => undefined),
  ),
fetchLiveContainers: () =>
  withRefresh(() =>
    requestData<Contracts.DashboardLiveContainerRecord[]>('/api/v1/fleet/live-containers', {
      method: 'GET',
    }),
  ),
fetchQueueDepth: (playbookId) =>
  withRefresh(() => {
    const path = playbookId
      ? `/api/v1/tasks/queue-depth?playbook_id=${encodeURIComponent(playbookId)}`
      : '/api/v1/tasks/queue-depth';
    return requestData<Contracts.QueueDepthResponse>(path, { method: 'GET' });
  }),
getMetrics: () =>
  withRefresh(async () => {
    const activeSession = readSession();
    const headers = activeSession?.accessToken
      ? {
          Authorization: `Bearer ${activeSession.accessToken}`,
        }
      : undefined;

    const response = await requestFetch(`${baseUrl}/metrics`, {
      headers,
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.text();
  }),
getCustomizationStatus: () =>
  withRefresh(() =>
    requestData<Contracts.DashboardCustomizationStatusResponse>('/api/v1/runtime/customizations/status', {
      method: 'GET',
    }),
  ),
validateCustomization: (payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardCustomizationValidateResponse>(
      '/api/v1/runtime/customizations/validate',
      { body: payload },
    ),
  ),
createCustomizationBuild: (payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardCustomizationBuildResponse>('/api/v1/runtime/customizations/builds', {
      body: payload,
    }),
  ),
getCustomizationBuild: (id) =>
  withRefresh(() =>
    requestData<Contracts.DashboardCustomizationBuildResponse>(
      `/api/v1/runtime/customizations/builds/${id}`,
      { method: 'GET' },
    ),
  ),
linkCustomizationBuild: (payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardCustomizationLinkResponse>('/api/v1/runtime/customizations/links', {
      body: payload,
    }),
  ),
rollbackCustomizationBuild: (payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardCustomizationRollbackResponse>(
      '/api/v1/runtime/customizations/rollback',
      { body: payload },
    ),
  ),
reconstructCustomization: () =>
  withRefresh(() =>
    requestData<Contracts.DashboardCustomizationInspectResponse>(
      '/api/v1/runtime/customizations/reconstruct',
      { body: {} },
    ),
  ),
exportCustomization: (payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardCustomizationExportResponse>(
      '/api/v1/runtime/customizations/reconstruct/export',
      { body: payload },
    ),
  ),
queryLogs: (filters) =>
  withRefresh(() =>
    requestJson<Contracts.LogQueryResponse>(`/api/v1/logs${buildQueryString(filters)}`, {
      method: 'GET',
    }),
  ),
getLog: (logId) =>
  withRefresh(() =>
    requestJson<{ data: Contracts.LogEntry }>(`/api/v1/logs/${encodeURIComponent(String(logId))}`, {
      method: 'GET',
    }),
  ),
getLogStats: (filters) =>
  withRefresh(() =>
    requestJson<Contracts.LogStatsResponse>(`/api/v1/logs/stats${buildQueryString(filters)}`, {
      method: 'GET',
    }),
  ),
getLogOperations: (filters) =>
  withRefresh(() =>
    requestJson<{ data: Contracts.LogOperationRecord[] }>(
      `/api/v1/logs/operations${buildQueryString(filters)}`,
      { method: 'GET' },
    ),
  ),
getLogRoles: (filters) =>
  withRefresh(() =>
    requestJson<{ data: Contracts.LogRoleRecord[] }>(`/api/v1/logs/roles${buildQueryString(filters)}`, {
      method: 'GET',
    }),
  ),
getLogActors: (filters) =>
  withRefresh(() =>
    requestJson<{ data: Contracts.LogActorRecord[] }>(`/api/v1/logs/actors${buildQueryString(filters)}`, {
      method: 'GET',
    }),
  ),
getLogOperationValues: (filters) =>
  withRefresh(() =>
    requestJson<{ data: Contracts.LogOperationValueRecord[] }>(
      `/api/v1/logs/operations${buildQueryString({ ...(filters ?? {}), mode: 'values' })}`,
      {
        method: 'GET',
      },
    ),
  ),
getLogRoleValues: (filters) =>
  withRefresh(() =>
    requestJson<{ data: Contracts.LogRoleValueRecord[] }>(
      `/api/v1/logs/roles${buildQueryString({ ...(filters ?? {}), mode: 'values' })}`,
      {
        method: 'GET',
      },
    ),
  ),
getLogActorKindValues: (filters) =>
  withRefresh(() =>
    requestJson<{ data: Contracts.LogActorKindValueRecord[] }>(
      `/api/v1/logs/actors${buildQueryString({ ...(filters ?? {}), mode: 'values' })}`,
      {
        method: 'GET',
      },
    ),
  ),
getLogWorkflowValues: (filters) =>
  withRefresh(() =>
    requestJson<{ data: Contracts.LogWorkflowValueRecord[] }>(
      `/api/v1/logs/workflows${buildQueryString(filters)}`,
      {
        method: 'GET',
      },
    ),
  ),
exportLogs: (filters) =>
  withRefresh(async () => {
    const res = await requestFetch(
      `${baseUrl}/api/v1/logs/export${buildQueryString(filters)}`,
      {
        headers: { Authorization: `Bearer ${readSession()?.accessToken ?? ''}` },
      },
    );
    if (!res.ok) throw new Error(`Export failed: ${res.status}`);
    return res.blob();
  }),
getWorkspaceDeleteImpact: (workspaceId) =>
  withRefresh(async () => {
    return requestData<Contracts.DashboardDeleteImpactSummary>(
      `/api/v1/workspaces/${workspaceId}/delete-impact`,
      {
        method: 'GET',
      },
    );
  }),
deleteWorkspace: (workspaceId, options) =>
  withRefresh(async () => {
    await requestJson(
      `/api/v1/workspaces/${workspaceId}${buildQueryString(
        options?.cascade ? { cascade: 'true' } : undefined,
      )}`,
      { method: 'DELETE' },
    );
  }),
  };
}
