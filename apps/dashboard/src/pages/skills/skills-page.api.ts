import { dashboardApi } from '../../lib/api.js';
import type {
  DashboardSpecialistSkillCreateInput,
  DashboardSpecialistSkillRecord,
  DashboardSpecialistSkillUpdateInput,
} from '../../lib/api.js';

export const fetchSpecialistSkills = (): Promise<DashboardSpecialistSkillRecord[]> =>
  dashboardApi.listSpecialistSkills();

export function createSpecialistSkill(payload: DashboardSpecialistSkillCreateInput) {
  return dashboardApi.createSpecialistSkill(payload);
}

export function updateSpecialistSkill(
  skillId: string,
  payload: DashboardSpecialistSkillUpdateInput,
) {
  return dashboardApi.updateSpecialistSkill(skillId, payload);
}

export function deleteSpecialistSkill(skillId: string) {
  return dashboardApi.deleteSpecialistSkill(skillId);
}
