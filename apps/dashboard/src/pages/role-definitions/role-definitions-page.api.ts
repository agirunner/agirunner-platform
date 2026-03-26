import { dashboardApi } from '../../lib/api.js';
import type { RoleAssignmentRecord, SystemDefaultRecord } from './role-definitions-orchestrator.support.js';
import type {
  LlmModelRecord,
  LlmProviderRecord,
  RoleDefinition,
  RoleExecutionEnvironmentSummary,
  RoleFormState,
} from './role-definitions-page.support.js';
import { buildRolePayload } from './role-definitions-page.support.js';
import type {
  DashboardRemoteMcpServerRecord,
  DashboardSpecialistSkillCreateInput,
  DashboardSpecialistSkillRecord,
  DashboardSpecialistSkillUpdateInput,
} from '../../lib/api.js';

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

export const fetchExecutionEnvironments = (): Promise<RoleExecutionEnvironmentSummary[]> =>
  dashboardApi.listExecutionEnvironments() as Promise<RoleExecutionEnvironmentSummary[]>;

export const fetchRemoteMcpServers = (): Promise<DashboardRemoteMcpServerRecord[]> =>
  dashboardApi.listRemoteMcpServers();

export const fetchSpecialistSkills = (): Promise<DashboardSpecialistSkillRecord[]> =>
  dashboardApi.listSpecialistSkills();

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

export function createSpecialistSkill(payload: DashboardSpecialistSkillCreateInput) {
  return dashboardApi.createSpecialistSkill(payload);
}

export function updateSpecialistSkill(
  skillId: string,
  payload: DashboardSpecialistSkillUpdateInput,
) {
  return dashboardApi.updateSpecialistSkill(skillId, payload);
}

export function archiveSpecialistSkill(skillId: string) {
  return dashboardApi.archiveSpecialistSkill(skillId);
}

export function restoreSpecialistSkill(skillId: string) {
  return dashboardApi.unarchiveSpecialistSkill(skillId);
}
