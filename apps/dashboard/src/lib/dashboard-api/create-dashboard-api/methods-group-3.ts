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

export function createDashboardApiMethodsGroup3(
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
listTasks: (filters) => withRefresh(() => client.listTasks(filters)),
getTask: (id) => withRefresh(() => client.getTask(id)),
listTaskArtifacts: (taskId) =>
  withRefresh(() =>
    requestData<Contracts.DashboardTaskArtifactRecord[]>(`/api/v1/tasks/${taskId}/artifacts`, {
      method: 'GET',
    }),
  ),
uploadTaskArtifact: (taskId, payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardTaskArtifactRecord>(`/api/v1/tasks/${taskId}/artifacts`, {
      method: 'POST',
      body: payload as unknown as Record<string, unknown>,
    }),
  ),
readTaskArtifactContent: (taskId, artifactId) =>
  withRefresh(async () => {
    const response = await requestBinary(`/api/v1/tasks/${taskId}/artifacts/${artifactId}`, {
      method: 'GET',
    });
    return {
      content_type: response.headers.get('content-type') ?? 'application/octet-stream',
      content_text: await response.text(),
      file_name: readContentDispositionFileName(response.headers.get('content-disposition')),
      size_bytes: Number(response.headers.get('content-length') ?? '0'),
    };
  }),
downloadTaskArtifact: (taskId, artifactId) =>
  withRefresh(async () => {
    const response = await requestBinary(`/api/v1/tasks/${taskId}/artifacts/${artifactId}`, {
      method: 'GET',
    });
    return {
      blob: await response.blob(),
      content_type: response.headers.get('content-type') ?? 'application/octet-stream',
      file_name: readContentDispositionFileName(response.headers.get('content-disposition')),
      size_bytes: Number(response.headers.get('content-length') ?? '0'),
    };
  }),
readBinaryContentByHref: (href) =>
  withRefresh(async () => {
    const response = await requestBinary(href, {
      method: 'GET',
    });
    return {
      content_type: response.headers.get('content-type') ?? 'application/octet-stream',
      content_text: await response.text(),
      file_name: readContentDispositionFileName(response.headers.get('content-disposition')),
      size_bytes: Number(response.headers.get('content-length') ?? '0'),
    };
  }),
downloadBinaryByHref: (href) =>
  withRefresh(async () => {
    const response = await requestBinary(href, {
      method: 'GET',
    });
    return {
      blob: await response.blob(),
      content_type: response.headers.get('content-type') ?? 'application/octet-stream',
      file_name: readContentDispositionFileName(response.headers.get('content-disposition')),
      size_bytes: Number(response.headers.get('content-length') ?? '0'),
    };
  }),
deleteTaskArtifact: (taskId, artifactId) =>
  withRefresh(() =>
    requestJson<Record<string, never>>(`/api/v1/tasks/${taskId}/artifacts/${artifactId}`, {
      method: 'DELETE',
    }).then(() => undefined),
  ),
listWorkers: () => withRefresh(() => client.listWorkers()),
listAgents: () => withRefresh(() => client.listAgents() as Promise<Contracts.DashboardAgentRecord[]>),
approveTask: (taskId) => withRefresh(() => requestJson(`/api/v1/tasks/${taskId}/approve`)),
approveTaskOutput: (taskId) =>
  withRefresh(() => requestJson(`/api/v1/tasks/${taskId}/approve-output`)),
retryTask: (taskId, payload = {}) =>
  withRefresh(() => requestJson(`/api/v1/tasks/${taskId}/retry`, { body: payload })),
cancelTask: (taskId) => withRefresh(() => requestJson(`/api/v1/tasks/${taskId}/cancel`)),
rejectTask: (taskId, payload) =>
  withRefresh(() => requestJson(`/api/v1/tasks/${taskId}/reject`, { body: payload })),
requestTaskChanges: (taskId, payload) =>
  withRefresh(() => requestJson(`/api/v1/tasks/${taskId}/request-changes`, { body: payload })),
skipTask: (taskId, payload) =>
  withRefresh(() => requestJson(`/api/v1/tasks/${taskId}/skip`, { body: payload })),
reassignTask: (taskId, payload) =>
  withRefresh(() => requestJson(`/api/v1/tasks/${taskId}/reassign`, { body: payload })),
escalateTask: (taskId, payload) =>
  withRefresh(() => requestJson(`/api/v1/tasks/${taskId}/escalate`, { body: payload })),
resolveEscalation: (taskId, payload) =>
  withRefresh(() => requestTaskEscalationResolution(taskId, payload)),
resolveTaskEscalation: (taskId, payload, options) =>
  withRefresh(() => requestTaskEscalationResolution(taskId, payload, options)),
actOnWorkflowGate: (workflowId, gateId, payload) =>
  withRefresh(() =>
    requestJson(`/api/v1/workflows/${workflowId}/gates/${gateId}`, {
      body: buildRequestBodyWithRequestId(payload),
    }),
  ),
overrideTaskOutput: (taskId, payload) =>
  withRefresh(() => requestJson(`/api/v1/tasks/${taskId}/output-override`, { body: payload })),
pauseWorkflow: (workflowId) =>
  withRefresh(() => requestWorkflowControlAction(`/api/v1/workflows/${workflowId}/pause`)),
resumeWorkflow: (workflowId) =>
  withRefresh(() => requestWorkflowControlAction(`/api/v1/workflows/${workflowId}/resume`)),
getWorkspaceTimeline: (workspaceId) =>
  withRefresh(() =>
    requestData<Contracts.DashboardWorkspaceTimelineEntry[]>(
      `/api/v1/workspaces/${workspaceId}/timeline`,
      {
        method: 'GET',
      },
    ),
  ),
listWorkspaceArtifacts: (workspaceId, filters) =>
  withRefresh(() =>
    requestJson<Contracts.DashboardWorkspaceArtifactResponse>(
      `/api/v1/workspaces/${workspaceId}/artifacts${buildQueryString(filters)}`,
      {
        method: 'GET',
      },
    ),
  ),
listWorkspaceArtifactFiles: (workspaceId) =>
  withRefresh(() =>
    requestData<Contracts.DashboardWorkspaceArtifactFileRecord[]>(
      `/api/v1/workspaces/${workspaceId}/files`,
      {
        method: 'GET',
      },
    ),
  ),
downloadWorkspaceArtifactFile: (workspaceId, fileId) =>
  withRefresh(async () => {
    const response = await requestBinary(
      `/api/v1/workspaces/${workspaceId}/files/${fileId}/content`,
      {
        method: 'GET',
      },
    );
    return {
      blob: await response.blob(),
      content_type: response.headers.get('content-type') ?? 'application/octet-stream',
      file_name: readContentDispositionFileName(response.headers.get('content-disposition')),
      size_bytes: Number(response.headers.get('content-length') ?? '0'),
    };
  }),
uploadWorkspaceArtifactFiles: (workspaceId, payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardWorkspaceArtifactFileRecord[]>(
      `/api/v1/workspaces/${workspaceId}/files/batch`,
      {
        body: { files: payload as unknown as Record<string, unknown>[] },
      },
    ),
  ),
deleteWorkspaceArtifactFile: (workspaceId, fileId) =>
  withRefresh(async () => {
    await requestJson(`/api/v1/workspaces/${workspaceId}/files/${fileId}`, {
      method: 'DELETE',
      allowNoContent: true,
    });
  }),
createPlanningWorkflow: (workspaceId, payload) =>
  withRefresh(() =>
    requestJson(`/api/v1/workspaces/${workspaceId}/planning-workflow`, {
      body: payload,
    }),
  ),
  };
}
