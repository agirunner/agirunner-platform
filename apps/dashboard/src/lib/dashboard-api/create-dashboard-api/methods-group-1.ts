import type * as Contracts from '../contracts.js';
import { normalizeWorkspaceSpecRecord } from '../contracts.js';
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

export function createDashboardApiMethodsGroup1(
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
async login(apiKey: string, persistentSession = true): Promise<void> {
  const auth = await client.exchangeApiKey(apiKey, persistentSession);
  writeSession({
    accessToken: auth.token,
    tenantId: auth.tenant_id,
    persistentSession,
  });
  client.setAccessToken(auth.token);
},
async logout(): Promise<void> {
  try {
    await requestJson('/api/v1/auth/logout', { method: 'POST' });
  } finally {
    clearSession();
  }
},
listWorkflows: (filters) => withRefresh(() => client.listWorkflows(filters ?? {})),
listWorkspaces: () =>
  withRefresh(
    () =>
      requestJson('/api/v1/workspaces?per_page=50', { method: 'GET' }) as Promise<{
        data: Contracts.DashboardWorkspaceRecord[];
        meta?: Record<string, unknown>;
      }>,
  ),
createWorkspace: (payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardWorkspaceRecord>('/api/v1/workspaces', {
      body: payload as unknown as Record<string, unknown>,
    }),
  ),
patchWorkspace: (workspaceId, payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardWorkspaceRecord>(`/api/v1/workspaces/${workspaceId}`, {
      method: 'PATCH',
      body: payload as Record<string, unknown>,
    }),
  ),
verifyWorkspaceGitAccess: (workspaceId, payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardWorkspaceGitAccessVerifyResult>(
      `/api/v1/workspaces/${workspaceId}/verify-git-access`,
      {
        method: 'POST',
        body: payload as unknown as Record<string, unknown>,
      },
    ),
  ),
getWorkspace: (workspaceId) =>
  withRefresh(() =>
    requestData<Contracts.DashboardWorkspaceRecord>(`/api/v1/workspaces/${workspaceId}`, {
      method: 'GET',
    }),
  ),
getPlatformInstructions: () =>
  withRefresh(() =>
    requestData<Contracts.DashboardPlatformInstructionRecord>('/api/v1/platform/instructions', {
      method: 'GET',
    }),
  ),
updatePlatformInstructions: (payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardPlatformInstructionRecord>('/api/v1/platform/instructions', {
      method: 'PUT',
      body: payload as Record<string, unknown>,
    }),
  ),
clearPlatformInstructions: () =>
  withRefresh(() =>
    requestData<Contracts.DashboardPlatformInstructionRecord>('/api/v1/platform/instructions', {
      method: 'DELETE',
    }),
  ),
listPlatformInstructionVersions: () =>
  withRefresh(() =>
    requestData<Contracts.DashboardPlatformInstructionVersionRecord[]>(
      '/api/v1/platform/instructions/versions',
      {
        method: 'GET',
      },
    ),
  ),
getPlatformInstructionVersion: (version) =>
  withRefresh(() =>
    requestData<Contracts.DashboardPlatformInstructionVersionRecord>(
      `/api/v1/platform/instructions/versions/${version}`,
      {
        method: 'GET',
      },
    ),
  ),
getOrchestratorConfig: () =>
  withRefresh(() =>
    requestData<{ prompt: string; updatedAt: string }>('/api/v1/config/orchestrator', {
      method: 'GET',
    }),
  ),
updateOrchestratorConfig: (payload) =>
  withRefresh(() =>
    requestData<{ prompt: string; updatedAt: string }>('/api/v1/config/orchestrator', {
      method: 'PUT',
      body: payload as Record<string, unknown>,
    }),
  ),
getWorkspaceSpec: (workspaceId) =>
  withRefresh(async () =>
    normalizeWorkspaceSpecRecord(
      await requestData<Contracts.DashboardWorkspaceSpecEnvelope>(
        `/api/v1/workspaces/${workspaceId}/spec`,
        {
          method: 'GET',
        },
      ),
    ),
  ),
updateWorkspaceSpec: (workspaceId, payload) =>
  withRefresh(async () =>
    normalizeWorkspaceSpecRecord(
      await requestData<Contracts.DashboardWorkspaceSpecEnvelope>(
        `/api/v1/workspaces/${workspaceId}/spec`,
        {
          method: 'PUT',
          body: payload,
        },
      ),
    ),
  ),
listWorkspaceResources: (workspaceId) =>
  withRefresh(() =>
    requestJson<{ data: Contracts.DashboardWorkspaceResourceRecord[] }>(
      `/api/v1/workspaces/${workspaceId}/resources`,
      {
        method: 'GET',
      },
    ),
  ),
listWorkspaceTools: (workspaceId) =>
  withRefresh(() =>
    requestJson<{ data: Contracts.DashboardWorkspaceToolCatalog }>(
      `/api/v1/workspaces/${workspaceId}/tools`,
      {
        method: 'GET',
      },
    ),
  ),
patchWorkspaceMemory: (workspaceId, payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardWorkspaceRecord>(`/api/v1/workspaces/${workspaceId}/memory`, {
      method: 'PATCH',
      body: payload as Record<string, unknown>,
    }),
  ),
removeWorkspaceMemory: (workspaceId, key) =>
  withRefresh(() =>
    requestData<Contracts.DashboardWorkspaceRecord>(
      `/api/v1/workspaces/${workspaceId}/memory/${encodeURIComponent(key)}`,
      {
        method: 'DELETE',
      },
    ),
  ),
configureGitWebhook: (workspaceId, payload) =>
  withRefresh(() =>
    requestData<Record<string, unknown>>(`/api/v1/workspaces/${workspaceId}/git-webhook`, {
      method: 'PUT',
      body: payload as Record<string, unknown>,
    }),
  ),
getWorkflow: (id) => withRefresh(() => client.getWorkflow(id)),
getWorkflowRail: (input) =>
  withRefresh(() =>
    requestData<Contracts.DashboardWorkflowRailPacket>(
      `/api/v1/operations/workflows${buildMissionControlQuery({
        mode: input?.mode,
        page: input?.page,
        per_page: input?.perPage,
        needs_action_only: input?.needsActionOnly ? 'true' : undefined,
        lifecycle: input?.lifecycleFilter && input.lifecycleFilter !== 'all'
          ? input.lifecycleFilter
          : undefined,
        playbook_id: input?.playbookId,
        updated_within:
          input?.updatedWithin && input.updatedWithin !== 'all'
            ? input.updatedWithin
            : undefined,
        search: input?.search,
        workflow_id: input?.workflowId,
      })}`,
      {
        method: 'GET',
      },
    ),
  ),
getWorkflowWorkspace: (workflowId, input) =>
  withRefresh(() =>
    requestData<Contracts.DashboardWorkflowWorkspacePacket>(
      `/api/v1/operations/workflows/${workflowId}/workspace${buildMissionControlQuery({
        work_item_id: input?.workItemId,
        task_id: input?.taskId,
        tab_scope: input?.tabScope,
        live_console_limit: input?.liveConsoleLimit,
        history_limit: input?.historyLimit,
        deliverables_limit: input?.deliverablesLimit,
        board_mode: input?.boardMode,
        board_filters: input?.boardFilters,
        live_console_after: input?.liveConsoleAfter,
        history_after: input?.historyAfter,
        deliverables_after: input?.deliverablesAfter,
      })}`,
      {
        method: 'GET',
      },
    ),
  ),
getAgenticSettings: () =>
  withRefresh(() =>
    requestData<Contracts.DashboardAgenticSettingsRecord>('/api/v1/agentic-settings', {
      method: 'GET',
    }),
  ),
updateAgenticSettings: (payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardAgenticSettingsRecord>('/api/v1/agentic-settings', {
      method: 'PATCH',
      body: payload as unknown as Record<string, unknown>,
    }),
  ),
getWorkflowSettings: (workflowId) =>
  withRefresh(() =>
    requestData<Contracts.DashboardWorkflowSettingsRecord>(`/api/v1/workflows/${workflowId}/settings`, {
      method: 'GET',
    }),
  ),
updateWorkflowSettings: (workflowId, payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardWorkflowSettingsRecord>(`/api/v1/workflows/${workflowId}/settings`, {
      method: 'PATCH',
      body: payload as unknown as Record<string, unknown>,
    }),
  ),
getMissionControlLive: (input) =>
  withRefresh(() =>
    requestData<Contracts.DashboardMissionControlLiveResponse>(
      `/api/v1/operations/workflows${buildMissionControlQuery({
        mode: 'live',
        page: input?.page,
        per_page: input?.perPage,
      })}`,
      {
        method: 'GET',
      },
    ),
  ),
getMissionControlRecent: (input) =>
  withRefresh(() =>
    requestData<Contracts.DashboardMissionControlRecentResponse>(
      `/api/v1/operations/workflows${buildMissionControlQuery({
        mode: 'recent',
        limit: input?.limit,
      })}`,
      {
        method: 'GET',
      },
    ),
  ),
getMissionControlHistory: (input) =>
  withRefresh(() =>
    requestData<Contracts.DashboardMissionControlHistoryResponse>(
      `/api/v1/operations/workflows${buildMissionControlQuery({
        mode: 'history',
        workflow_id: input?.workflowId,
        limit: input?.limit,
      })}`,
      {
        method: 'GET',
      },
    ),
  ),
getMissionControlWorkflowWorkspace: (workflowId, input) =>
  withRefresh(() =>
    requestData<Contracts.DashboardMissionControlWorkspaceResponse>(
      `/api/v1/operations/workflows/${workflowId}/workspace${buildMissionControlQuery({
        history_limit: input?.historyLimit,
        output_limit: input?.outputLimit,
      })}`,
      {
        method: 'GET',
      },
    ),
  ),
listWorkflowInputPackets: (workflowId) =>
  withRefresh(() =>
    requestData<Contracts.DashboardWorkflowInputPacketRecord[]>(
      `/api/v1/workflows/${workflowId}/input-packets`,
      { method: 'GET' },
    ),
  ),
createWorkflowInputPacket: (workflowId, payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardWorkflowInputPacketRecord>(
      `/api/v1/workflows/${workflowId}/input-packets`,
      {
        method: 'POST',
        body: payload as unknown as Record<string, unknown>,
      },
    ),
  ),
listWorkflowInterventions: (workflowId) =>
  withRefresh(() =>
    requestData<Contracts.DashboardWorkflowInterventionRecord[]>(
      `/api/v1/workflows/${workflowId}/interventions`,
      { method: 'GET' },
    ),
  ),
createWorkflowIntervention: (workflowId, payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardWorkflowInterventionRecord>(
      `/api/v1/workflows/${workflowId}/interventions`,
      {
        method: 'POST',
        body: payload as unknown as Record<string, unknown>,
      },
    ),
  ),
listWorkflowSteeringSessions: (workflowId) =>
  withRefresh(() =>
    requestData<Contracts.DashboardWorkflowSteeringSessionRecord[]>(
      `/api/v1/workflows/${workflowId}/steering-sessions`,
      { method: 'GET' },
    ),
  ),
createWorkflowSteeringSession: (workflowId, payload = {}) =>
  withRefresh(() =>
    requestData<Contracts.DashboardWorkflowSteeringSessionRecord>(
      `/api/v1/workflows/${workflowId}/steering-sessions`,
      {
        method: 'POST',
        body: payload as unknown as Record<string, unknown>,
      },
    ),
  ),
listWorkflowSteeringMessages: (workflowId, sessionId) =>
  withRefresh(() =>
    requestData<Contracts.DashboardWorkflowSteeringMessageRecord[]>(
      `/api/v1/workflows/${workflowId}/steering-sessions/${sessionId}/messages`,
      { method: 'GET' },
    ),
  ),
createWorkflowSteeringRequest: (workflowId, payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardWorkflowSteeringRequestResult>(
      `/api/v1/workflows/${workflowId}/steering-requests`,
      {
        method: 'POST',
        body: payload as unknown as Record<string, unknown>,
      },
    ),
  ),
appendWorkflowSteeringMessage: (workflowId, sessionId, payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardWorkflowSteeringMessageRecord>(
      `/api/v1/workflows/${workflowId}/steering-sessions/${sessionId}/messages`,
      {
        method: 'POST',
        body: payload as unknown as Record<string, unknown>,
      },
    ),
  ),
redriveWorkflow: (workflowId, payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardWorkflowRedriveResult>(`/api/v1/workflows/${workflowId}/redrives`, {
      method: 'POST',
      body: payload as unknown as Record<string, unknown>,
    }),
  ),
getWorkflowBudget: (workflowId) =>
  withRefresh(() =>
    requestData<Contracts.DashboardWorkflowBudgetRecord>(`/api/v1/workflows/${workflowId}/budget`, {
      method: 'GET',
    }),
  ),
getWorkflowBoard: (workflowId) =>
  withRefresh(() =>
    requestData<Contracts.DashboardWorkflowBoardResponse>(`/api/v1/workflows/${workflowId}/board`, {
      method: 'GET',
    }),
  ),
listWorkflowStages: (workflowId) =>
  withRefresh(() =>
    requestData<Contracts.DashboardWorkflowStageRecord[]>(`/api/v1/workflows/${workflowId}/stages`, {
      method: 'GET',
    }),
  ),
listWorkflowWorkItems: (workflowId) =>
  withRefresh(() =>
    requestData<Contracts.DashboardWorkflowWorkItemRecord[]>(
      `/api/v1/workflows/${workflowId}/work-items`,
      {
        method: 'GET',
      },
    ),
  ),
  };
}
