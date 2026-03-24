import { dashboardApi } from '../../lib/api.js';
import type { RoleAssignmentRecord, SystemDefaultRecord } from './role-definitions-orchestrator.support.js';
import type {
  LlmModelRecord,
  LlmProviderRecord,
  RoleDefinition,
  RoleFormState,
} from './role-definitions-page.support.js';
import { buildRolePayload } from './role-definitions-page.support.js';

export const fetchRoles = (): Promise<RoleDefinition[]> =>
  dashboardApi.listRoleDefinitions() as Promise<RoleDefinition[]>;

export const fetchProviders = (): Promise<LlmProviderRecord[]> =>
  dashboardApi.listLlmProviders() as Promise<LlmProviderRecord[]>;

export const fetchModels = (): Promise<LlmModelRecord[]> =>
  dashboardApi.listLlmModels() as Promise<LlmModelRecord[]>;

export const fetchSystemDefault = (): Promise<SystemDefaultRecord> =>
  dashboardApi.getLlmSystemDefault();

export const fetchAssignments = (): Promise<RoleAssignmentRecord[]> =>
  dashboardApi.listLlmAssignments();

export const fetchToolCatalog = () => dashboardApi.listToolTags();

export function saveRole(roleId: string | null, form: RoleFormState) {
  return dashboardApi.saveRoleDefinition(
    roleId,
    buildRolePayload(form) as Record<string, unknown>,
  ) as Promise<RoleDefinition>;
}

export function deleteRole(roleId: string) {
  return dashboardApi.deleteRoleDefinition(roleId);
}

export function updateSystemDefault(payload: SystemDefaultRecord) {
  return dashboardApi.updateLlmSystemDefault(payload);
}

export function updateAssignment(
  roleName: string,
  payload: { primaryModelId?: string; reasoningConfig?: Record<string, unknown> | null },
) {
  return dashboardApi.updateLlmAssignment(roleName, payload);
}
