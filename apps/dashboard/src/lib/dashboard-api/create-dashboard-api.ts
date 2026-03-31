import { PlatformApiClient } from '@agirunner/sdk';

import { clearSession, readSession, writeSession } from '../auth/session.js';

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
import type { DashboardApiMethodContext } from './create-dashboard-api/method-context.js';
import { createDashboardApiMethodsGroup1 } from './create-dashboard-api/methods-group-1.js';
import { createDashboardApiMethodsGroup2 } from './create-dashboard-api/methods-group-2.js';
import { createDashboardApiMethodsGroup3 } from './create-dashboard-api/methods-group-3.js';
import { createDashboardApiMethodsGroup4 } from './create-dashboard-api/methods-group-4.js';
import { createDashboardApiMethodsGroup5 } from './create-dashboard-api/methods-group-5.js';
import { createDashboardApiMethodsGroup6 } from './create-dashboard-api/methods-group-6.js';
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

  const methodContext: DashboardApiMethodContext = {
    baseUrl,
    client,
    requestFetch,
    defaultManualWorkflowActivationEventType,
    withRefresh,
    requestJson,
    requestData,
    requestBinary,
    requestWorkflowControlAction,
    requestWorkflowWorkItemTaskAction,
    requestWorkflowWorkItemAction,
    requestTaskEscalationResolution,
    normalizeEventPage,
  };

  return {
    ...createDashboardApiMethodsGroup1(methodContext),
    ...createDashboardApiMethodsGroup2(methodContext),
    ...createDashboardApiMethodsGroup3(methodContext),
    ...createDashboardApiMethodsGroup4(methodContext),
    ...createDashboardApiMethodsGroup5(methodContext),
    ...createDashboardApiMethodsGroup6(methodContext),
  } as DashboardApi;
}

export const dashboardApi = createDashboardApi();
export { buildSearchResults } from './create-dashboard-api.search.js';
