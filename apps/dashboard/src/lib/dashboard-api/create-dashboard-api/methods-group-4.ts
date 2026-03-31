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

export function createDashboardApiMethodsGroup4(
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
listRoleDefinitions: () =>
  withRefresh(() =>
    requestData<Contracts.DashboardRoleDefinitionRecord[]>('/api/v1/config/roles', {
      method: 'GET',
    }),
  ),
listToolTags: () =>
  withRefresh(() =>
    requestData<Contracts.DashboardToolTagRecord[]>('/api/v1/tools', {
      method: 'GET',
    }),
  ),
createToolTag: (payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardToolTagRecord>('/api/v1/tools', {
      body: payload as unknown as Record<string, unknown>,
    }),
  ),
updateToolTag: (toolId, payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardToolTagRecord>(`/api/v1/tools/${encodeURIComponent(toolId)}`, {
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
    requestData<Contracts.DashboardRuntimeDefaultRecord[]>('/api/v1/config/runtime-defaults', {
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
    requestData<Contracts.DashboardExecutionEnvironmentCatalogRecord[]>(
      '/api/v1/execution-environment-catalog',
      {
        method: 'GET',
      },
    ),
  ),
listExecutionEnvironments: () =>
  withRefresh(() =>
    requestData<Contracts.DashboardExecutionEnvironmentRecord[]>('/api/v1/execution-environments', {
      method: 'GET',
    }),
  ),
createExecutionEnvironment: (payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardExecutionEnvironmentRecord>('/api/v1/execution-environments', {
      body: payload as unknown as Record<string, unknown>,
    }),
  ),
createExecutionEnvironmentFromCatalog: (payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardExecutionEnvironmentRecord>(
      '/api/v1/execution-environments/from-catalog',
      {
        body: payload as unknown as Record<string, unknown>,
      },
    ),
  ),
updateExecutionEnvironment: (environmentId, payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardExecutionEnvironmentRecord>(
      `/api/v1/execution-environments/${environmentId}`,
      {
        method: 'PATCH',
        body: payload as unknown as Record<string, unknown>,
      },
    ),
  ),
verifyExecutionEnvironment: (environmentId) =>
  withRefresh(() =>
    requestData<Contracts.DashboardExecutionEnvironmentRecord>(
      `/api/v1/execution-environments/${environmentId}/verify`,
      {
        body: {},
      },
    ),
  ),
setDefaultExecutionEnvironment: (environmentId) =>
  withRefresh(() =>
    requestData<Contracts.DashboardExecutionEnvironmentRecord>(
      `/api/v1/execution-environments/${environmentId}/set-default`,
      {
        body: {},
      },
    ),
  ),
archiveExecutionEnvironment: (environmentId) =>
  withRefresh(() =>
    requestData<Contracts.DashboardExecutionEnvironmentRecord>(
      `/api/v1/execution-environments/${environmentId}/archive`,
      {
        body: {},
      },
    ),
  ),
restoreExecutionEnvironment: (environmentId) =>
  withRefresh(() =>
    requestData<Contracts.DashboardExecutionEnvironmentRecord>(
      `/api/v1/execution-environments/${environmentId}/unarchive`,
      {
        body: {},
      },
    ),
  ),
listRemoteMcpOAuthClientProfiles: () =>
  withRefresh(() =>
    requestData<Contracts.DashboardRemoteMcpOAuthClientProfileRecord[]>(
      '/api/v1/remote-mcp-oauth-client-profiles',
      {
        method: 'GET',
      },
    ),
  ),
getRemoteMcpOAuthClientProfile: (profileId) =>
  withRefresh(() =>
    requestData<Contracts.DashboardRemoteMcpOAuthClientProfileRecord>(
      `/api/v1/remote-mcp-oauth-client-profiles/${profileId}`,
      {
        method: 'GET',
      },
    ),
  ),
createRemoteMcpOAuthClientProfile: (payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardRemoteMcpOAuthClientProfileRecord>(
      '/api/v1/remote-mcp-oauth-client-profiles',
      {
        body: payload as unknown as Record<string, unknown>,
      },
    ),
  ),
updateRemoteMcpOAuthClientProfile: (profileId, payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardRemoteMcpOAuthClientProfileRecord>(
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
    requestData<Contracts.DashboardRemoteMcpServerRecord[]>('/api/v1/remote-mcp-servers', {
      method: 'GET',
    }),
  ),
getRemoteMcpServer: (serverId) =>
  withRefresh(() =>
    requestData<Contracts.DashboardRemoteMcpServerRecord>(`/api/v1/remote-mcp-servers/${serverId}`, {
      method: 'GET',
    }),
  ),
createRemoteMcpServer: (payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardRemoteMcpServerRecord>('/api/v1/remote-mcp-servers', {
      body: payload as unknown as Record<string, unknown>,
    }),
  ),
updateRemoteMcpServer: (serverId, payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardRemoteMcpServerRecord>(`/api/v1/remote-mcp-servers/${serverId}`, {
      method: 'PUT',
      body: payload as unknown as Record<string, unknown>,
    }),
  ),
initiateRemoteMcpOAuthAuthorization: (payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardRemoteMcpAuthorizeResult>(
      '/api/v1/remote-mcp-servers/oauth/authorize',
      {
        body: payload as unknown as Record<string, unknown>,
      },
    ),
  ),
reconnectRemoteMcpOAuth: (serverId) =>
  withRefresh(() =>
    requestData<Contracts.DashboardRemoteMcpAuthorizeResult>(
      `/api/v1/remote-mcp-servers/${serverId}/oauth/reconnect`,
      {
        body: {},
      },
    ),
  ),
pollRemoteMcpOAuthDeviceAuthorization: (deviceFlowId) =>
  withRefresh(() =>
    requestData<Contracts.DashboardRemoteMcpAuthorizeResult>(
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
    requestData<Contracts.DashboardRemoteMcpServerRecord>(
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
    requestData<Contracts.DashboardSpecialistSkillRecord[]>('/api/v1/specialist-skills', {
      method: 'GET',
    }),
  ),
getSpecialistSkill: (skillId) =>
  withRefresh(() =>
    requestData<Contracts.DashboardSpecialistSkillRecord>(`/api/v1/specialist-skills/${skillId}`, {
      method: 'GET',
    }),
  ),
createSpecialistSkill: (payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardSpecialistSkillRecord>('/api/v1/specialist-skills', {
      body: payload as unknown as Record<string, unknown>,
    }),
  ),
updateSpecialistSkill: (skillId, payload) =>
  withRefresh(() =>
    requestData<Contracts.DashboardSpecialistSkillRecord>(`/api/v1/specialist-skills/${skillId}`, {
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
    requestData<Contracts.DashboardRoleDefinitionRecord>(
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
    requestData<Contracts.DashboardLlmSystemDefaultRecord>('/api/v1/config/llm/system-default', {
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
    requestData<Contracts.DashboardLlmAssignmentRecord[]>('/api/v1/config/llm/assignments', {
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
    requestData<Contracts.DashboardLlmProviderRecord>('/api/v1/config/llm/providers', {
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
    requestData<Contracts.DashboardOAuthProfileRecord[]>('/api/v1/config/oauth/profiles', {
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
    requestData<Contracts.DashboardOAuthStatusRecord>(
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
  };
}
