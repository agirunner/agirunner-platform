import { PlatformApiClient } from '@agirunner/sdk';

import { clearSession, readSession, writeSession } from '../session.js';

import { normalizeWorkspaceSpecRecord } from './contracts.js';
import {
  buildHttpErrorMessage,
  buildMissionControlQuery,
  buildQueryString,
  buildRequestBodyWithRequestId,
  createRequestId,
  readContentDispositionFileName,
  resolvePlatformPath,
} from './create-dashboard-api.request.js';
import {
  buildSearchResults,
  extractDataResult,
  extractListResult,
} from './create-dashboard-api.search.js';
import type * as Contracts from './contracts.js';

type DashboardAgentRecord = Contracts.DashboardAgentRecord;
type DashboardAgenticSettingsRecord = Contracts.DashboardAgenticSettingsRecord;
type DashboardApi = Contracts.DashboardApi;
type DashboardApiKeyRecord = Contracts.DashboardApiKeyRecord;
type DashboardApiOptions = Contracts.DashboardApiOptions;
type DashboardCostSummaryRecord = Contracts.DashboardCostSummaryRecord;
type DashboardCustomizationBuildResponse = Contracts.DashboardCustomizationBuildResponse;
type DashboardCustomizationExportResponse = Contracts.DashboardCustomizationExportResponse;
type DashboardCustomizationInspectResponse = Contracts.DashboardCustomizationInspectResponse;
type DashboardCustomizationLinkResponse = Contracts.DashboardCustomizationLinkResponse;
type DashboardCustomizationRollbackResponse = Contracts.DashboardCustomizationRollbackResponse;
type DashboardCustomizationStatusResponse = Contracts.DashboardCustomizationStatusResponse;
type DashboardCustomizationValidateResponse = Contracts.DashboardCustomizationValidateResponse;
type DashboardDeleteImpactSummary = Contracts.DashboardDeleteImpactSummary;
type DashboardEventPage = Contracts.DashboardEventPage;
type DashboardEventRecord = Contracts.DashboardEventRecord;
type DashboardExecutionEnvironmentCatalogRecord =
  Contracts.DashboardExecutionEnvironmentCatalogRecord;
type DashboardExecutionEnvironmentRecord = Contracts.DashboardExecutionEnvironmentRecord;
type DashboardGovernanceRetentionPolicy = Contracts.DashboardGovernanceRetentionPolicy;
type DashboardLiveContainerRecord = Contracts.DashboardLiveContainerRecord;
type DashboardLlmAssignmentRecord = Contracts.DashboardLlmAssignmentRecord;
type DashboardLlmModelRecord = Contracts.DashboardLlmModelRecord;
type DashboardLlmProviderRecord = Contracts.DashboardLlmProviderRecord;
type DashboardLlmSystemDefaultRecord = Contracts.DashboardLlmSystemDefaultRecord;
type DashboardLoggingConfig = Contracts.DashboardLoggingConfig;
type DashboardMissionControlHistoryResponse = Contracts.DashboardMissionControlHistoryResponse;
type DashboardMissionControlLiveResponse = Contracts.DashboardMissionControlLiveResponse;
type DashboardMissionControlRecentResponse = Contracts.DashboardMissionControlRecentResponse;
type DashboardMissionControlWorkspaceResponse = Contracts.DashboardMissionControlWorkspaceResponse;
type DashboardOAuthProfileRecord = Contracts.DashboardOAuthProfileRecord;
type DashboardOAuthStatusRecord = Contracts.DashboardOAuthStatusRecord;
type DashboardPlatformInstructionRecord = Contracts.DashboardPlatformInstructionRecord;
type DashboardPlatformInstructionVersionRecord =
  Contracts.DashboardPlatformInstructionVersionRecord;
type DashboardPlaybookDeleteImpact = Contracts.DashboardPlaybookDeleteImpact;
type DashboardPlaybookRecord = Contracts.DashboardPlaybookRecord;
type DashboardRemoteMcpAuthorizeResult = Contracts.DashboardRemoteMcpAuthorizeResult;
type DashboardRemoteMcpOAuthClientProfileRecord =
  Contracts.DashboardRemoteMcpOAuthClientProfileRecord;
type DashboardRemoteMcpServerRecord = Contracts.DashboardRemoteMcpServerRecord;
type DashboardResolvedDocumentReference = Contracts.DashboardResolvedDocumentReference;
type DashboardRoleDefinitionRecord = Contracts.DashboardRoleDefinitionRecord;
type DashboardRuntimeDefaultRecord = Contracts.DashboardRuntimeDefaultRecord;
type DashboardSearchResult = Contracts.DashboardSearchResult;
type DashboardSpecialistSkillRecord = Contracts.DashboardSpecialistSkillRecord;
type DashboardTaskArtifactRecord = Contracts.DashboardTaskArtifactRecord;
type DashboardTaskHandoffRecord = Contracts.DashboardTaskHandoffRecord;
type DashboardToolTagRecord = Contracts.DashboardToolTagRecord;
type DashboardWorkItemMemoryEntry = Contracts.DashboardWorkItemMemoryEntry;
type DashboardWorkItemMemoryHistoryEntry = Contracts.DashboardWorkItemMemoryHistoryEntry;
type DashboardWorkflowActivationRecord = Contracts.DashboardWorkflowActivationRecord;
type DashboardWorkflowBoardResponse = Contracts.DashboardWorkflowBoardResponse;
type DashboardWorkflowBudgetRecord = Contracts.DashboardWorkflowBudgetRecord;
type DashboardWorkflowInputPacketRecord = Contracts.DashboardWorkflowInputPacketRecord;
type DashboardWorkflowInterventionRecord = Contracts.DashboardWorkflowInterventionRecord;
type DashboardWorkflowRailPacket = Contracts.DashboardWorkflowRailPacket;
type DashboardWorkflowRecord = Contracts.DashboardWorkflowRecord;
type DashboardWorkflowRedriveResult = Contracts.DashboardWorkflowRedriveResult;
type DashboardWorkflowSettingsRecord = Contracts.DashboardWorkflowSettingsRecord;
type DashboardWorkflowStageRecord = Contracts.DashboardWorkflowStageRecord;
type DashboardWorkflowSteeringMessageRecord = Contracts.DashboardWorkflowSteeringMessageRecord;
type DashboardWorkflowSteeringRequestResult = Contracts.DashboardWorkflowSteeringRequestResult;
type DashboardWorkflowSteeringSessionRecord = Contracts.DashboardWorkflowSteeringSessionRecord;
type DashboardWorkflowWorkItemRecord = Contracts.DashboardWorkflowWorkItemRecord;
type DashboardWorkflowWorkspacePacket = Contracts.DashboardWorkflowWorkspacePacket;
type DashboardWorkspaceArtifactFileRecord = Contracts.DashboardWorkspaceArtifactFileRecord;
type DashboardWorkspaceArtifactResponse = Contracts.DashboardWorkspaceArtifactResponse;
type DashboardWorkspaceGitAccessVerifyResult = Contracts.DashboardWorkspaceGitAccessVerifyResult;
type DashboardWorkspaceRecord = Contracts.DashboardWorkspaceRecord;
type DashboardWorkspaceResourceRecord = Contracts.DashboardWorkspaceResourceRecord;
type DashboardWorkspaceSpecEnvelope = Contracts.DashboardWorkspaceSpecEnvelope;
type DashboardWorkspaceTimelineEntry = Contracts.DashboardWorkspaceTimelineEntry;
type DashboardWorkspaceToolCatalog = Contracts.DashboardWorkspaceToolCatalog;
type FleetEventRecord = Contracts.FleetEventRecord;
type FleetStatusResponse = Contracts.FleetStatusResponse;
type FleetWorkerRecord = Contracts.FleetWorkerRecord;
type LogActorKindValueRecord = Contracts.LogActorKindValueRecord;
type LogActorRecord = Contracts.LogActorRecord;
type LogEntry = Contracts.LogEntry;
type LogOperationRecord = Contracts.LogOperationRecord;
type LogOperationValueRecord = Contracts.LogOperationValueRecord;
type LogQueryResponse = Contracts.LogQueryResponse;
type LogRoleRecord = Contracts.LogRoleRecord;
type LogRoleValueRecord = Contracts.LogRoleValueRecord;
type LogStatsResponse = Contracts.LogStatsResponse;
type LogWorkflowValueRecord = Contracts.LogWorkflowValueRecord;
type NamedRecord = Contracts.NamedRecord;
type QueueDepthResponse = Contracts.QueueDepthResponse;

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

export function createDashboardApi(options: DashboardApiOptions = {}): DashboardApi {
  const baseUrl = options.baseUrl ?? API_BASE_URL;
  const session = readSession();
  const defaultManualWorkflowActivationEventType = 'operator.manual_enqueue';
  const client =
    options.client ??
    new PlatformApiClient({
      baseUrl,
      accessToken: session?.accessToken ?? undefined,
    });
  const requestFetch = options.fetcher ?? fetch;

  // Deduplicate concurrent refresh calls — only one in-flight at a time.
  let refreshPromise: Promise<{ token: string }> | null = null;

  async function doRefresh(): Promise<{ token: string }> {
    if (refreshPromise) return refreshPromise;
    refreshPromise = client.refreshSession().finally(() => {
      refreshPromise = null;
    });
    return refreshPromise;
  }

  async function withRefresh<T>(handler: () => Promise<T>): Promise<T> {
    try {
      return await handler();
    } catch (error) {
      const message = String(error);
      if (!message.includes('HTTP 401')) {
        throw error;
      }

      const activeSession = readSession();
      if (!activeSession) {
        throw error;
      }

      try {
        const refreshed = await doRefresh();
        writeSession({
          accessToken: refreshed.token,
          tenantId: activeSession.tenantId,
          persistentSession: activeSession.persistentSession,
        });
        client.setAccessToken(refreshed.token);
        return await handler();
      } catch (refreshError) {
        clearSession();
        if (typeof window !== 'undefined') {
          window.location.assign('/login');
        }
        throw refreshError;
      }
    }
  }

  async function requestJson<T>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      body?: Record<string, unknown>;
      includeAuth?: boolean;
      allowNoContent?: boolean;
    } = {},
  ): Promise<T> {
    const activeSession = readSession();
    const headers: Record<string, string> = {};

    if (options.body) {
      headers['Content-Type'] = 'application/json';
    }

    if ((options.includeAuth ?? true) && activeSession?.accessToken) {
      headers.Authorization = `Bearer ${activeSession.accessToken}`;
    }

    const response = await requestFetch(`${baseUrl}${path}`, {
      method: options.method ?? 'POST',
      headers,
      credentials: 'include',
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      throw new Error(await buildHttpErrorMessage(response));
    }

    if (options.allowNoContent && response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  async function requestData<T>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      body?: Record<string, unknown>;
      allowNoContent?: boolean;
    } = {},
  ): Promise<T> {
    const response = await requestJson<{ data: T }>(path, options);
    if (response === undefined) {
      return undefined as T;
    }
    return response.data;
  }

  function requestWorkflowControlAction(path: string): Promise<unknown> {
    return requestData<unknown>(path, {
      body: buildRequestBodyWithRequestId({}),
    });
  }

  function requestWorkflowWorkItemTaskAction(
    workflowId: string,
    workItemId: string,
    taskId: string,
    action: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    return requestJson(
      `/api/v1/workflows/${workflowId}/work-items/${workItemId}/tasks/${taskId}/${action}`,
      {
        body: buildRequestBodyWithRequestId(body),
      },
    );
  }

  function requestWorkflowWorkItemAction(
    workflowId: string,
    workItemId: string,
    action: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    return requestJson(`/api/v1/workflows/${workflowId}/work-items/${workItemId}/${action}`, {
      body: buildRequestBodyWithRequestId(body),
    });
  }

  function requestTaskEscalationResolution(
    taskId: string,
    payload: { instructions: string; context?: Record<string, unknown> },
    options: { workflowId?: string | null; workItemId?: string | null } = {},
  ): Promise<unknown> {
    const workflowId = options.workflowId?.trim();
    const workItemId = options.workItemId?.trim();

    if (workflowId && workItemId) {
      return requestWorkflowWorkItemTaskAction(
        workflowId,
        workItemId,
        taskId,
        'resolve-escalation',
        payload,
      );
    }

    return requestJson(`/api/v1/tasks/${taskId}/resolve-escalation`, {
      body: buildRequestBodyWithRequestId(payload),
    });
  }

  function normalizeEventPage(page: {
    data?: DashboardEventRecord[];
    meta?: { has_more?: boolean; next_after?: string | number | null };
  }): DashboardEventPage {
    return {
      data: page.data ?? [],
      meta: {
        has_more: Boolean(page.meta?.has_more),
        next_after:
          page.meta?.next_after === null || page.meta?.next_after === undefined
            ? null
            : String(page.meta.next_after),
      },
    };
  }

  async function requestBinary(
    path: string,
    options: { method?: 'GET'; includeAuth?: boolean } = {},
  ): Promise<Response> {
    const activeSession = readSession();
    const headers: Record<string, string> = {};

    if ((options.includeAuth ?? true) && activeSession?.accessToken) {
      headers.Authorization = `Bearer ${activeSession.accessToken}`;
    }

    const response = await requestFetch(resolvePlatformPath(path, baseUrl), {
      method: options.method ?? 'GET',
      headers,
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(await buildHttpErrorMessage(response));
    }

    return response;
  }

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
            data: DashboardWorkspaceRecord[];
            meta?: Record<string, unknown>;
          }>,
      ),
    createWorkspace: (payload) =>
      withRefresh(() =>
        requestData<DashboardWorkspaceRecord>('/api/v1/workspaces', {
          body: payload as unknown as Record<string, unknown>,
        }),
      ),
    patchWorkspace: (workspaceId, payload) =>
      withRefresh(() =>
        requestData<DashboardWorkspaceRecord>(`/api/v1/workspaces/${workspaceId}`, {
          method: 'PATCH',
          body: payload as Record<string, unknown>,
        }),
      ),
    verifyWorkspaceGitAccess: (workspaceId, payload) =>
      withRefresh(() =>
        requestData<DashboardWorkspaceGitAccessVerifyResult>(
          `/api/v1/workspaces/${workspaceId}/verify-git-access`,
          {
            method: 'POST',
            body: payload as unknown as Record<string, unknown>,
          },
        ),
      ),
    getWorkspace: (workspaceId) =>
      withRefresh(() =>
        requestData<DashboardWorkspaceRecord>(`/api/v1/workspaces/${workspaceId}`, {
          method: 'GET',
        }),
      ),
    getPlatformInstructions: () =>
      withRefresh(() =>
        requestData<DashboardPlatformInstructionRecord>('/api/v1/platform/instructions', {
          method: 'GET',
        }),
      ),
    updatePlatformInstructions: (payload) =>
      withRefresh(() =>
        requestData<DashboardPlatformInstructionRecord>('/api/v1/platform/instructions', {
          method: 'PUT',
          body: payload as Record<string, unknown>,
        }),
      ),
    clearPlatformInstructions: () =>
      withRefresh(() =>
        requestData<DashboardPlatformInstructionRecord>('/api/v1/platform/instructions', {
          method: 'DELETE',
        }),
      ),
    listPlatformInstructionVersions: () =>
      withRefresh(() =>
        requestData<DashboardPlatformInstructionVersionRecord[]>(
          '/api/v1/platform/instructions/versions',
          {
            method: 'GET',
          },
        ),
      ),
    getPlatformInstructionVersion: (version) =>
      withRefresh(() =>
        requestData<DashboardPlatformInstructionVersionRecord>(
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
          await requestData<DashboardWorkspaceSpecEnvelope>(
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
          await requestData<DashboardWorkspaceSpecEnvelope>(
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
        requestJson<{ data: DashboardWorkspaceResourceRecord[] }>(
          `/api/v1/workspaces/${workspaceId}/resources`,
          {
            method: 'GET',
          },
        ),
      ),
    listWorkspaceTools: (workspaceId) =>
      withRefresh(() =>
        requestJson<{ data: DashboardWorkspaceToolCatalog }>(
          `/api/v1/workspaces/${workspaceId}/tools`,
          {
            method: 'GET',
          },
        ),
      ),
    patchWorkspaceMemory: (workspaceId, payload) =>
      withRefresh(() =>
        requestData<DashboardWorkspaceRecord>(`/api/v1/workspaces/${workspaceId}/memory`, {
          method: 'PATCH',
          body: payload as Record<string, unknown>,
        }),
      ),
    removeWorkspaceMemory: (workspaceId, key) =>
      withRefresh(() =>
        requestData<DashboardWorkspaceRecord>(
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
        requestData<DashboardWorkflowRailPacket>(
          `/api/v1/operations/workflows${buildMissionControlQuery({
            mode: input?.mode,
            page: input?.page,
            per_page: input?.perPage,
            needs_action_only: input?.needsActionOnly ? 'true' : undefined,
            ongoing_only: input?.ongoingOnly ? 'true' : undefined,
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
        requestData<DashboardWorkflowWorkspacePacket>(
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
        requestData<DashboardAgenticSettingsRecord>('/api/v1/agentic-settings', {
          method: 'GET',
        }),
      ),
    updateAgenticSettings: (payload) =>
      withRefresh(() =>
        requestData<DashboardAgenticSettingsRecord>('/api/v1/agentic-settings', {
          method: 'PATCH',
          body: payload as unknown as Record<string, unknown>,
        }),
      ),
    getWorkflowSettings: (workflowId) =>
      withRefresh(() =>
        requestData<DashboardWorkflowSettingsRecord>(`/api/v1/workflows/${workflowId}/settings`, {
          method: 'GET',
        }),
      ),
    updateWorkflowSettings: (workflowId, payload) =>
      withRefresh(() =>
        requestData<DashboardWorkflowSettingsRecord>(`/api/v1/workflows/${workflowId}/settings`, {
          method: 'PATCH',
          body: payload as unknown as Record<string, unknown>,
        }),
      ),
    getMissionControlLive: (input) =>
      withRefresh(() =>
        requestData<DashboardMissionControlLiveResponse>(
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
        requestData<DashboardMissionControlRecentResponse>(
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
        requestData<DashboardMissionControlHistoryResponse>(
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
        requestData<DashboardMissionControlWorkspaceResponse>(
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
        requestData<DashboardWorkflowInputPacketRecord[]>(
          `/api/v1/workflows/${workflowId}/input-packets`,
          { method: 'GET' },
        ),
      ),
    createWorkflowInputPacket: (workflowId, payload) =>
      withRefresh(() =>
        requestData<DashboardWorkflowInputPacketRecord>(
          `/api/v1/workflows/${workflowId}/input-packets`,
          {
            method: 'POST',
            body: payload as unknown as Record<string, unknown>,
          },
        ),
      ),
    listWorkflowInterventions: (workflowId) =>
      withRefresh(() =>
        requestData<DashboardWorkflowInterventionRecord[]>(
          `/api/v1/workflows/${workflowId}/interventions`,
          { method: 'GET' },
        ),
      ),
    createWorkflowIntervention: (workflowId, payload) =>
      withRefresh(() =>
        requestData<DashboardWorkflowInterventionRecord>(
          `/api/v1/workflows/${workflowId}/interventions`,
          {
            method: 'POST',
            body: payload as unknown as Record<string, unknown>,
          },
        ),
      ),
    listWorkflowSteeringSessions: (workflowId) =>
      withRefresh(() =>
        requestData<DashboardWorkflowSteeringSessionRecord[]>(
          `/api/v1/workflows/${workflowId}/steering-sessions`,
          { method: 'GET' },
        ),
      ),
    createWorkflowSteeringSession: (workflowId, payload = {}) =>
      withRefresh(() =>
        requestData<DashboardWorkflowSteeringSessionRecord>(
          `/api/v1/workflows/${workflowId}/steering-sessions`,
          {
            method: 'POST',
            body: payload as unknown as Record<string, unknown>,
          },
        ),
      ),
    listWorkflowSteeringMessages: (workflowId, sessionId) =>
      withRefresh(() =>
        requestData<DashboardWorkflowSteeringMessageRecord[]>(
          `/api/v1/workflows/${workflowId}/steering-sessions/${sessionId}/messages`,
          { method: 'GET' },
        ),
      ),
    createWorkflowSteeringRequest: (workflowId, payload) =>
      withRefresh(() =>
        requestData<DashboardWorkflowSteeringRequestResult>(
          `/api/v1/workflows/${workflowId}/steering-requests`,
          {
            method: 'POST',
            body: payload as unknown as Record<string, unknown>,
          },
        ),
      ),
    appendWorkflowSteeringMessage: (workflowId, sessionId, payload) =>
      withRefresh(() =>
        requestData<DashboardWorkflowSteeringMessageRecord>(
          `/api/v1/workflows/${workflowId}/steering-sessions/${sessionId}/messages`,
          {
            method: 'POST',
            body: payload as unknown as Record<string, unknown>,
          },
        ),
      ),
    redriveWorkflow: (workflowId, payload) =>
      withRefresh(() =>
        requestData<DashboardWorkflowRedriveResult>(`/api/v1/workflows/${workflowId}/redrives`, {
          method: 'POST',
          body: payload as unknown as Record<string, unknown>,
        }),
      ),
    getWorkflowBudget: (workflowId) =>
      withRefresh(() =>
        requestData<DashboardWorkflowBudgetRecord>(`/api/v1/workflows/${workflowId}/budget`, {
          method: 'GET',
        }),
      ),
    getWorkflowBoard: (workflowId) =>
      withRefresh(() =>
        requestData<DashboardWorkflowBoardResponse>(`/api/v1/workflows/${workflowId}/board`, {
          method: 'GET',
        }),
      ),
    listWorkflowStages: (workflowId) =>
      withRefresh(() =>
        requestData<DashboardWorkflowStageRecord[]>(`/api/v1/workflows/${workflowId}/stages`, {
          method: 'GET',
        }),
      ),
    listWorkflowWorkItems: (workflowId) =>
      withRefresh(() =>
        requestData<DashboardWorkflowWorkItemRecord[]>(
          `/api/v1/workflows/${workflowId}/work-items`,
          {
            method: 'GET',
          },
        ),
      ),
    getWorkflowWorkItem: (workflowId, workItemId) =>
      withRefresh(() =>
        requestData<DashboardWorkflowWorkItemRecord>(
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
        requestData<DashboardEventRecord[]>(
          `/api/v1/workflows/${workflowId}/work-items/${workItemId}/events?limit=${limit}`,
          {
            method: 'GET',
          },
        ),
      ),
    listWorkflowWorkItemHandoffs: (workflowId, workItemId) =>
      withRefresh(() =>
        requestData<DashboardTaskHandoffRecord[]>(
          `/api/v1/workflows/${workflowId}/work-items/${workItemId}/handoffs`,
          {
            method: 'GET',
          },
        ),
      ),
    getLatestWorkflowWorkItemHandoff: (workflowId, workItemId) =>
      withRefresh(() =>
        requestData<DashboardTaskHandoffRecord | null>(
          `/api/v1/workflows/${workflowId}/work-items/${workItemId}/handoffs/latest`,
          {
            method: 'GET',
          },
        ),
      ),
    getWorkflowWorkItemMemory: (workflowId, workItemId) =>
      withRefresh(() =>
        requestData<{ entries: DashboardWorkItemMemoryEntry[] }>(
          `/api/v1/workflows/${workflowId}/work-items/${workItemId}/memory`,
          {
            method: 'GET',
          },
        ),
      ),
    getWorkflowWorkItemMemoryHistory: (workflowId, workItemId, limit = 100) =>
      withRefresh(() =>
        requestData<{ history: DashboardWorkItemMemoryHistoryEntry[] }>(
          `/api/v1/workflows/${workflowId}/work-items/${workItemId}/memory/history?limit=${limit}`,
          {
            method: 'GET',
          },
        ),
      ),
    listWorkflowActivations: (workflowId) =>
      withRefresh(() =>
        requestData<DashboardWorkflowActivationRecord[]>(
          `/api/v1/workflows/${workflowId}/activations`,
          { method: 'GET' },
        ),
      ),
    enqueueWorkflowActivation: (workflowId, payload) =>
      withRefresh(() =>
        requestData<DashboardWorkflowActivationRecord>(
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
            data: DashboardEventRecord[];
            meta?: { has_more?: boolean; next_after?: string | number | null };
          }>(`/api/v1/workflows/${workflowId}/events${buildQueryString(filters)}`, {
            method: 'GET',
          }),
        ),
      ),
    listWorkflowDocuments: (workflowId) =>
      withRefresh(() =>
        requestData<DashboardResolvedDocumentReference[]>(
          `/api/v1/workflows/${workflowId}/documents`,
          { method: 'GET' },
        ),
      ),
    createWorkflowDocument: (workflowId, payload) =>
      withRefresh(() =>
        requestData<DashboardResolvedDocumentReference>(
          `/api/v1/workflows/${workflowId}/documents`,
          {
            method: 'POST',
            body: buildRequestBodyWithRequestId(payload as unknown as Record<string, unknown>),
          },
        ),
      ),
    updateWorkflowDocument: (workflowId, logicalName, payload) =>
      withRefresh(() =>
        requestData<DashboardResolvedDocumentReference>(
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
        data: (await client.listPlaybooks()) as DashboardPlaybookRecord[],
      })),
    getPlaybook: (playbookId) =>
      withRefresh(() => client.getPlaybook(playbookId) as Promise<DashboardPlaybookRecord>),
    createPlaybook: (payload) =>
      withRefresh(
        () => client.createPlaybook(payload as never) as Promise<DashboardPlaybookRecord>,
      ),
    updatePlaybook: (playbookId, payload) =>
      withRefresh(
        () =>
          client.updatePlaybook(playbookId, payload as never) as Promise<DashboardPlaybookRecord>,
      ),
    archivePlaybook: (playbookId) =>
      withRefresh(() => client.archivePlaybook(playbookId) as Promise<DashboardPlaybookRecord>),
    restorePlaybook: (playbookId) =>
      withRefresh(() => client.restorePlaybook(playbookId) as Promise<DashboardPlaybookRecord>),
    deletePlaybook: (playbookId) =>
      withRefresh(() => client.deletePlaybook(playbookId).then(() => undefined)),
    getPlaybookDeleteImpact: (playbookId) =>
      withRefresh(() =>
        requestData<DashboardPlaybookDeleteImpact>(
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
        requestData<DashboardLlmProviderRecord[]>('/api/v1/config/llm/providers', {
          method: 'GET',
        }),
      ),
    listLlmModels: () =>
      withRefresh(() =>
        requestData<DashboardLlmModelRecord[]>('/api/v1/config/llm/models', {
          method: 'GET',
        }),
      ),
    createWorkflow: (payload) =>
      withRefresh(
        () => client.createWorkflow(payload as never) as Promise<DashboardWorkflowRecord>,
      ),
    createWorkflowWorkItem: (workflowId, payload) =>
      withRefresh(() =>
        requestData<DashboardWorkflowWorkItemRecord>(`/api/v1/workflows/${workflowId}/work-items`, {
          body: buildRequestBodyWithRequestId(payload as Record<string, unknown>),
        }),
      ),
    updateWorkflowWorkItem: (workflowId, workItemId, payload) =>
      withRefresh(() =>
        requestData<DashboardWorkflowWorkItemRecord>(
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
    listTasks: (filters) => withRefresh(() => client.listTasks(filters)),
    getTask: (id) => withRefresh(() => client.getTask(id)),
    listTaskArtifacts: (taskId) =>
      withRefresh(() =>
        requestData<DashboardTaskArtifactRecord[]>(`/api/v1/tasks/${taskId}/artifacts`, {
          method: 'GET',
        }),
      ),
    uploadTaskArtifact: (taskId, payload) =>
      withRefresh(() =>
        requestData<DashboardTaskArtifactRecord>(`/api/v1/tasks/${taskId}/artifacts`, {
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
    listAgents: () => withRefresh(() => client.listAgents() as Promise<DashboardAgentRecord[]>),
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
        requestData<DashboardWorkspaceTimelineEntry[]>(
          `/api/v1/workspaces/${workspaceId}/timeline`,
          {
            method: 'GET',
          },
        ),
      ),
    listWorkspaceArtifacts: (workspaceId, filters) =>
      withRefresh(() =>
        requestJson<DashboardWorkspaceArtifactResponse>(
          `/api/v1/workspaces/${workspaceId}/artifacts${buildQueryString(filters)}`,
          {
            method: 'GET',
          },
        ),
      ),
    listWorkspaceArtifactFiles: (workspaceId) =>
      withRefresh(() =>
        requestData<DashboardWorkspaceArtifactFileRecord[]>(
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
        requestData<DashboardWorkspaceArtifactFileRecord[]>(
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
    listRoleDefinitions: () =>
      withRefresh(() =>
        requestData<DashboardRoleDefinitionRecord[]>('/api/v1/config/roles', {
          method: 'GET',
        }),
      ),
    listToolTags: () =>
      withRefresh(() =>
        requestData<DashboardToolTagRecord[]>('/api/v1/tools', {
          method: 'GET',
        }),
      ),
    createToolTag: (payload) =>
      withRefresh(() =>
        requestData<DashboardToolTagRecord>('/api/v1/tools', {
          body: payload as unknown as Record<string, unknown>,
        }),
      ),
    updateToolTag: (toolId, payload) =>
      withRefresh(() =>
        requestData<DashboardToolTagRecord>(`/api/v1/tools/${encodeURIComponent(toolId)}`, {
          method: 'PATCH',
          body: payload as unknown as Record<string, unknown>,
        }),
      ),
    deleteToolTag: (toolId) =>
      withRefresh(async () => {
        await requestJson(`/api/v1/tools/${encodeURIComponent(toolId)}`, {
          method: 'DELETE',
        });
      }),
    listRuntimeDefaults: () =>
      withRefresh(() =>
        requestData<DashboardRuntimeDefaultRecord[]>('/api/v1/config/runtime-defaults', {
          method: 'GET',
        }),
      ),
    upsertRuntimeDefault: (input) =>
      withRefresh(async () => {
        await requestJson('/api/v1/config/runtime-defaults', {
          body: input as unknown as Record<string, unknown>,
        });
      }),
    deleteRuntimeDefault: (id) =>
      withRefresh(async () => {
        await requestJson(`/api/v1/config/runtime-defaults/${id}`, {
          method: 'DELETE',
        });
      }),
    listExecutionEnvironmentCatalog: () =>
      withRefresh(() =>
        requestData<DashboardExecutionEnvironmentCatalogRecord[]>(
          '/api/v1/execution-environment-catalog',
          {
            method: 'GET',
          },
        ),
      ),
    listExecutionEnvironments: () =>
      withRefresh(() =>
        requestData<DashboardExecutionEnvironmentRecord[]>('/api/v1/execution-environments', {
          method: 'GET',
        }),
      ),
    createExecutionEnvironment: (payload) =>
      withRefresh(() =>
        requestData<DashboardExecutionEnvironmentRecord>('/api/v1/execution-environments', {
          body: payload as unknown as Record<string, unknown>,
        }),
      ),
    createExecutionEnvironmentFromCatalog: (payload) =>
      withRefresh(() =>
        requestData<DashboardExecutionEnvironmentRecord>(
          '/api/v1/execution-environments/from-catalog',
          {
            body: payload as unknown as Record<string, unknown>,
          },
        ),
      ),
    updateExecutionEnvironment: (environmentId, payload) =>
      withRefresh(() =>
        requestData<DashboardExecutionEnvironmentRecord>(
          `/api/v1/execution-environments/${environmentId}`,
          {
            method: 'PATCH',
            body: payload as unknown as Record<string, unknown>,
          },
        ),
      ),
    verifyExecutionEnvironment: (environmentId) =>
      withRefresh(() =>
        requestData<DashboardExecutionEnvironmentRecord>(
          `/api/v1/execution-environments/${environmentId}/verify`,
          {
            body: {},
          },
        ),
      ),
    setDefaultExecutionEnvironment: (environmentId) =>
      withRefresh(() =>
        requestData<DashboardExecutionEnvironmentRecord>(
          `/api/v1/execution-environments/${environmentId}/set-default`,
          {
            body: {},
          },
        ),
      ),
    archiveExecutionEnvironment: (environmentId) =>
      withRefresh(() =>
        requestData<DashboardExecutionEnvironmentRecord>(
          `/api/v1/execution-environments/${environmentId}/archive`,
          {
            body: {},
          },
        ),
      ),
    restoreExecutionEnvironment: (environmentId) =>
      withRefresh(() =>
        requestData<DashboardExecutionEnvironmentRecord>(
          `/api/v1/execution-environments/${environmentId}/unarchive`,
          {
            body: {},
          },
        ),
      ),
    listRemoteMcpOAuthClientProfiles: () =>
      withRefresh(() =>
        requestData<DashboardRemoteMcpOAuthClientProfileRecord[]>(
          '/api/v1/remote-mcp-oauth-client-profiles',
          {
            method: 'GET',
          },
        ),
      ),
    getRemoteMcpOAuthClientProfile: (profileId) =>
      withRefresh(() =>
        requestData<DashboardRemoteMcpOAuthClientProfileRecord>(
          `/api/v1/remote-mcp-oauth-client-profiles/${profileId}`,
          {
            method: 'GET',
          },
        ),
      ),
    createRemoteMcpOAuthClientProfile: (payload) =>
      withRefresh(() =>
        requestData<DashboardRemoteMcpOAuthClientProfileRecord>(
          '/api/v1/remote-mcp-oauth-client-profiles',
          {
            body: payload as unknown as Record<string, unknown>,
          },
        ),
      ),
    updateRemoteMcpOAuthClientProfile: (profileId, payload) =>
      withRefresh(() =>
        requestData<DashboardRemoteMcpOAuthClientProfileRecord>(
          `/api/v1/remote-mcp-oauth-client-profiles/${profileId}`,
          {
            method: 'PUT',
            body: payload as unknown as Record<string, unknown>,
          },
        ),
      ),
    deleteRemoteMcpOAuthClientProfile: (profileId) =>
      withRefresh(() =>
        requestData<void>(`/api/v1/remote-mcp-oauth-client-profiles/${profileId}`, {
          method: 'DELETE',
          allowNoContent: true,
        }),
      ),
    listRemoteMcpServers: () =>
      withRefresh(() =>
        requestData<DashboardRemoteMcpServerRecord[]>('/api/v1/remote-mcp-servers', {
          method: 'GET',
        }),
      ),
    getRemoteMcpServer: (serverId) =>
      withRefresh(() =>
        requestData<DashboardRemoteMcpServerRecord>(`/api/v1/remote-mcp-servers/${serverId}`, {
          method: 'GET',
        }),
      ),
    createRemoteMcpServer: (payload) =>
      withRefresh(() =>
        requestData<DashboardRemoteMcpServerRecord>('/api/v1/remote-mcp-servers', {
          body: payload as unknown as Record<string, unknown>,
        }),
      ),
    updateRemoteMcpServer: (serverId, payload) =>
      withRefresh(() =>
        requestData<DashboardRemoteMcpServerRecord>(`/api/v1/remote-mcp-servers/${serverId}`, {
          method: 'PUT',
          body: payload as unknown as Record<string, unknown>,
        }),
      ),
    initiateRemoteMcpOAuthAuthorization: (payload) =>
      withRefresh(() =>
        requestData<DashboardRemoteMcpAuthorizeResult>(
          '/api/v1/remote-mcp-servers/oauth/authorize',
          {
            body: payload as unknown as Record<string, unknown>,
          },
        ),
      ),
    reconnectRemoteMcpOAuth: (serverId) =>
      withRefresh(() =>
        requestData<DashboardRemoteMcpAuthorizeResult>(
          `/api/v1/remote-mcp-servers/${serverId}/oauth/reconnect`,
          {
            body: {},
          },
        ),
      ),
    pollRemoteMcpOAuthDeviceAuthorization: (deviceFlowId) =>
      withRefresh(() =>
        requestData<DashboardRemoteMcpAuthorizeResult>(
          `/api/v1/remote-mcp-servers/oauth/device/${deviceFlowId}/poll`,
          {
            body: {},
          },
        ),
      ),
    disconnectRemoteMcpOAuth: (serverId) =>
      withRefresh(async () => {
        await requestJson(`/api/v1/remote-mcp-servers/${serverId}/oauth/disconnect`, {
          method: 'POST',
          allowNoContent: true,
        });
      }),
    reverifyRemoteMcpServer: (serverId) =>
      withRefresh(() =>
        requestData<DashboardRemoteMcpServerRecord>(
          `/api/v1/remote-mcp-servers/${serverId}/reverify`,
          {
            body: {},
          },
        ),
      ),
    deleteRemoteMcpServer: (serverId) =>
      withRefresh(() =>
        requestData<void>(`/api/v1/remote-mcp-servers/${serverId}`, {
          method: 'DELETE',
          allowNoContent: true,
        }),
      ),
    listSpecialistSkills: () =>
      withRefresh(() =>
        requestData<DashboardSpecialistSkillRecord[]>('/api/v1/specialist-skills', {
          method: 'GET',
        }),
      ),
    getSpecialistSkill: (skillId) =>
      withRefresh(() =>
        requestData<DashboardSpecialistSkillRecord>(`/api/v1/specialist-skills/${skillId}`, {
          method: 'GET',
        }),
      ),
    createSpecialistSkill: (payload) =>
      withRefresh(() =>
        requestData<DashboardSpecialistSkillRecord>('/api/v1/specialist-skills', {
          body: payload as unknown as Record<string, unknown>,
        }),
      ),
    updateSpecialistSkill: (skillId, payload) =>
      withRefresh(() =>
        requestData<DashboardSpecialistSkillRecord>(`/api/v1/specialist-skills/${skillId}`, {
          method: 'PUT',
          body: payload as unknown as Record<string, unknown>,
        }),
      ),
    deleteSpecialistSkill: (skillId) =>
      withRefresh(async () => {
        await requestJson(`/api/v1/specialist-skills/${skillId}`, {
          method: 'DELETE',
          allowNoContent: true,
        });
      }),
    saveRoleDefinition: (roleId, payload) =>
      withRefresh(() =>
        requestData<DashboardRoleDefinitionRecord>(
          roleId ? `/api/v1/config/roles/${roleId}` : '/api/v1/config/roles',
          {
            method: roleId ? 'PUT' : 'POST',
            body: payload,
          },
        ),
      ),
    deleteRoleDefinition: (roleId) =>
      withRefresh(async () => {
        await requestJson(`/api/v1/config/roles/${roleId}`, {
          method: 'DELETE',
          allowNoContent: true,
        });
      }),
    getLlmSystemDefault: () =>
      withRefresh(() =>
        requestData<DashboardLlmSystemDefaultRecord>('/api/v1/config/llm/system-default', {
          method: 'GET',
        }),
      ),
    updateLlmSystemDefault: (payload) =>
      withRefresh(async () => {
        await requestJson('/api/v1/config/llm/system-default', {
          method: 'PUT',
          body: payload as unknown as Record<string, unknown>,
        });
      }),
    listLlmAssignments: () =>
      withRefresh(() =>
        requestData<DashboardLlmAssignmentRecord[]>('/api/v1/config/llm/assignments', {
          method: 'GET',
        }),
      ),
    updateLlmAssignment: (roleName, payload) =>
      withRefresh(async () => {
        await requestJson(`/api/v1/config/llm/assignments/${encodeURIComponent(roleName)}`, {
          method: 'PUT',
          body: payload as unknown as Record<string, unknown>,
        });
      }),
    createLlmProvider: (payload) =>
      withRefresh(() =>
        requestData<DashboardLlmProviderRecord>('/api/v1/config/llm/providers', {
          body: payload as unknown as Record<string, unknown>,
        }),
      ),
    deleteLlmProvider: (providerId) =>
      withRefresh(async () => {
        await requestJson(`/api/v1/config/llm/providers/${providerId}`, {
          method: 'DELETE',
          allowNoContent: true,
        });
      }),
    discoverLlmModels: (providerId) =>
      withRefresh(() =>
        requestData<unknown[]>(`/api/v1/config/llm/providers/${providerId}/discover`, {
          method: 'POST',
        }),
      ),
    updateLlmModel: (modelId, payload) =>
      withRefresh(async () => {
        await requestJson(`/api/v1/config/llm/models/${modelId}`, {
          method: 'PUT',
          body: payload,
        });
      }),
    listOAuthProfiles: () =>
      withRefresh(() =>
        requestData<DashboardOAuthProfileRecord[]>('/api/v1/config/oauth/profiles', {
          method: 'GET',
        }),
      ),
    initiateOAuthFlow: (profileId) =>
      withRefresh(() =>
        requestData<{ authorizeUrl: string }>('/api/v1/config/oauth/authorize', {
          body: { profileId },
        }),
      ),
    getOAuthProviderStatus: (providerId) =>
      withRefresh(() =>
        requestData<DashboardOAuthStatusRecord>(
          `/api/v1/config/oauth/providers/${providerId}/status`,
          { method: 'GET' },
        ),
      ),
    disconnectOAuthProvider: (providerId) =>
      withRefresh(async () => {
        await requestJson(`/api/v1/config/oauth/providers/${providerId}/disconnect`, {
          method: 'POST',
          allowNoContent: true,
        });
      }),
    getCostSummary: () =>
      withRefresh(() =>
        requestData<DashboardCostSummaryRecord>('/api/v1/metering/summary', {
          method: 'GET',
        }),
      ),
    getRetentionPolicy: () =>
      withRefresh(() =>
        requestData<DashboardGovernanceRetentionPolicy>('/api/v1/governance/retention-policy', {
          method: 'GET',
        }),
      ),
    updateRetentionPolicy: (payload) =>
      withRefresh(() =>
        requestData<DashboardGovernanceRetentionPolicy>('/api/v1/governance/retention-policy', {
          method: 'PUT',
          body: payload as Record<string, unknown>,
        }),
      ),
    getLoggingConfig: () =>
      withRefresh(() =>
        requestData<DashboardLoggingConfig>('/api/v1/governance/logging', {
          method: 'GET',
        }),
      ),
    updateLoggingConfig: (payload) =>
      withRefresh(() =>
        requestData<DashboardLoggingConfig>('/api/v1/governance/logging', {
          method: 'PUT',
          body: payload as unknown as Record<string, unknown>,
        }),
      ),
    listEvents: (filters) =>
      withRefresh(async () =>
        normalizeEventPage(
          await requestJson<{
            data: DashboardEventRecord[];
            meta?: { has_more?: boolean; next_after?: string | number | null };
          }>(`/api/v1/events${buildQueryString(filters)}`, {
            method: 'GET',
          }),
        ),
      ),
    listApiKeys: () =>
      withRefresh(async () => {
        const response = await requestJson<{ data: DashboardApiKeyRecord[] }>('/api/v1/api-keys', {
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
        requestData<FleetStatusResponse>('/api/v1/fleet/status', {
          method: 'GET',
        }),
      ),
    fetchFleetEvents: (filters) =>
      withRefresh(async () => {
        const response = await requestJson<{
          data?: { events?: FleetEventRecord[]; total?: number };
        }>(`/api/v1/fleet/events${buildQueryString(filters)}`, { method: 'GET' });
        return {
          data: response.data?.events ?? [],
          total: response.data?.total ?? 0,
        };
      }),
    fetchFleetWorkers: () =>
      withRefresh(() =>
        requestData<FleetWorkerRecord[]>('/api/v1/fleet/workers', {
          method: 'GET',
        }),
      ),
    createFleetWorker: (payload) =>
      withRefresh(() =>
        requestData<FleetWorkerRecord>('/api/v1/fleet/workers', {
          method: 'POST',
          body: payload as Record<string, unknown>,
        }),
      ),
    updateFleetWorker: (workerId, payload) =>
      withRefresh(() =>
        requestData<FleetWorkerRecord>(`/api/v1/fleet/workers/${workerId}`, {
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
        requestData<DashboardLiveContainerRecord[]>('/api/v1/fleet/live-containers', {
          method: 'GET',
        }),
      ),
    fetchQueueDepth: (playbookId) =>
      withRefresh(() => {
        const path = playbookId
          ? `/api/v1/tasks/queue-depth?playbook_id=${encodeURIComponent(playbookId)}`
          : '/api/v1/tasks/queue-depth';
        return requestData<QueueDepthResponse>(path, { method: 'GET' });
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
        requestData<DashboardCustomizationStatusResponse>('/api/v1/runtime/customizations/status', {
          method: 'GET',
        }),
      ),
    validateCustomization: (payload) =>
      withRefresh(() =>
        requestData<DashboardCustomizationValidateResponse>(
          '/api/v1/runtime/customizations/validate',
          { body: payload },
        ),
      ),
    createCustomizationBuild: (payload) =>
      withRefresh(() =>
        requestData<DashboardCustomizationBuildResponse>('/api/v1/runtime/customizations/builds', {
          body: payload,
        }),
      ),
    getCustomizationBuild: (id) =>
      withRefresh(() =>
        requestData<DashboardCustomizationBuildResponse>(
          `/api/v1/runtime/customizations/builds/${id}`,
          { method: 'GET' },
        ),
      ),
    linkCustomizationBuild: (payload) =>
      withRefresh(() =>
        requestData<DashboardCustomizationLinkResponse>('/api/v1/runtime/customizations/links', {
          body: payload,
        }),
      ),
    rollbackCustomizationBuild: (payload) =>
      withRefresh(() =>
        requestData<DashboardCustomizationRollbackResponse>(
          '/api/v1/runtime/customizations/rollback',
          { body: payload },
        ),
      ),
    reconstructCustomization: () =>
      withRefresh(() =>
        requestData<DashboardCustomizationInspectResponse>(
          '/api/v1/runtime/customizations/reconstruct',
          { body: {} },
        ),
      ),
    exportCustomization: (payload) =>
      withRefresh(() =>
        requestData<DashboardCustomizationExportResponse>(
          '/api/v1/runtime/customizations/reconstruct/export',
          { body: payload },
        ),
      ),
    queryLogs: (filters) =>
      withRefresh(() =>
        requestJson<LogQueryResponse>(`/api/v1/logs${buildQueryString(filters)}`, {
          method: 'GET',
        }),
      ),
    getLog: (logId) =>
      withRefresh(() =>
        requestJson<{ data: LogEntry }>(`/api/v1/logs/${encodeURIComponent(String(logId))}`, {
          method: 'GET',
        }),
      ),
    getLogStats: (filters) =>
      withRefresh(() =>
        requestJson<LogStatsResponse>(`/api/v1/logs/stats${buildQueryString(filters)}`, {
          method: 'GET',
        }),
      ),
    getLogOperations: (filters) =>
      withRefresh(() =>
        requestJson<{ data: LogOperationRecord[] }>(
          `/api/v1/logs/operations${buildQueryString(filters)}`,
          { method: 'GET' },
        ),
      ),
    getLogRoles: (filters) =>
      withRefresh(() =>
        requestJson<{ data: LogRoleRecord[] }>(`/api/v1/logs/roles${buildQueryString(filters)}`, {
          method: 'GET',
        }),
      ),
    getLogActors: (filters) =>
      withRefresh(() =>
        requestJson<{ data: LogActorRecord[] }>(`/api/v1/logs/actors${buildQueryString(filters)}`, {
          method: 'GET',
        }),
      ),
    getLogOperationValues: (filters) =>
      withRefresh(() =>
        requestJson<{ data: LogOperationValueRecord[] }>(
          `/api/v1/logs/operations${buildQueryString({ ...(filters ?? {}), mode: 'values' })}`,
          {
            method: 'GET',
          },
        ),
      ),
    getLogRoleValues: (filters) =>
      withRefresh(() =>
        requestJson<{ data: LogRoleValueRecord[] }>(
          `/api/v1/logs/roles${buildQueryString({ ...(filters ?? {}), mode: 'values' })}`,
          {
            method: 'GET',
          },
        ),
      ),
    getLogActorKindValues: (filters) =>
      withRefresh(() =>
        requestJson<{ data: LogActorKindValueRecord[] }>(
          `/api/v1/logs/actors${buildQueryString({ ...(filters ?? {}), mode: 'values' })}`,
          {
            method: 'GET',
          },
        ),
      ),
    getLogWorkflowValues: (filters) =>
      withRefresh(() =>
        requestJson<{ data: LogWorkflowValueRecord[] }>(
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
        return requestData<DashboardDeleteImpactSummary>(
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

export const dashboardApi = createDashboardApi();
export { buildSearchResults } from './create-dashboard-api.search.js';
