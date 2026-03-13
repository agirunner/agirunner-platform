import { readSession } from '../../lib/session.js';
import type { RoleAssignmentRecord, SystemDefaultRecord } from './role-definitions-orchestrator.support.js';
import type {
  LlmModelRecord,
  LlmProviderRecord,
  RoleDefinition,
  RoleFormState,
} from './role-definitions-page.support.js';
import { buildRolePayload } from './role-definitions-page.support.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

function getAuthHeaders(): Record<string, string> {
  const session = readSession();
  return {
    'Content-Type': 'application/json',
    ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
  };
}

async function requestData<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    headers: getAuthHeaders(),
    ...init,
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const body = await response.json();
  return (body.data ?? body) as T;
}

export const fetchRoles = () => requestData<RoleDefinition[]>('/api/v1/config/roles');

export const fetchProviders = () =>
  requestData<LlmProviderRecord[]>('/api/v1/config/llm/providers');

export const fetchModels = () => requestData<LlmModelRecord[]>('/api/v1/config/llm/models');

export const fetchSystemDefault = () =>
  requestData<SystemDefaultRecord>('/api/v1/config/llm/system-default');

export const fetchAssignments = () =>
  requestData<RoleAssignmentRecord[]>('/api/v1/config/llm/assignments');

export function saveRole(roleId: string | null, form: RoleFormState) {
  return requestData<RoleDefinition>(
    roleId ? `/api/v1/config/roles/${roleId}` : '/api/v1/config/roles',
    {
      method: roleId ? 'PUT' : 'POST',
      body: JSON.stringify(buildRolePayload(form)),
    },
  );
}

export function deleteRole(roleId: string) {
  return requestData<Record<string, never>>(`/api/v1/config/roles/${roleId}`, {
    method: 'DELETE',
  }).then(() => undefined);
}

export function updateSystemDefault(payload: SystemDefaultRecord) {
  return requestData<SystemDefaultRecord>('/api/v1/config/llm/system-default', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function updateAssignment(
  roleName: string,
  payload: { primaryModelId?: string; reasoningConfig?: Record<string, unknown> | null },
) {
  return requestData<RoleAssignmentRecord>(`/api/v1/config/llm/assignments/${roleName}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}
