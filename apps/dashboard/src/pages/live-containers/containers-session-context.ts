import type { DashboardLiveContainerRecord } from '../../lib/api.js';
import { normalizePlaybookName, normalizeText } from './containers-page.diff.js';

export interface RememberedContainerContext {
  role_name: string | null;
  playbook_id: string | null;
  playbook_name: string | null;
  workflow_id: string | null;
  workflow_name: string | null;
  stage_name: string | null;
  task_id: string | null;
  task_title: string | null;
  activity_state: string | null;
  execution_environment_name: string | null;
  execution_environment_image: string | null;
  execution_environment_distro: string | null;
  execution_environment_package_manager: string | null;
}

export function rememberContainerContext(
  prior: RememberedContainerContext | null,
  row: DashboardLiveContainerRecord,
): RememberedContainerContext | null {
  const next: RememberedContainerContext = {
    role_name: normalizeText(row.role_name) || prior?.role_name || null,
    playbook_id: normalizeText(row.playbook_id) || prior?.playbook_id || null,
    playbook_name: normalizePlaybookName(row.playbook_name) || prior?.playbook_name || null,
    workflow_id: normalizeText(row.workflow_id) || prior?.workflow_id || null,
    workflow_name: normalizeText(row.workflow_name) || prior?.workflow_name || null,
    stage_name: normalizeText(row.stage_name) || prior?.stage_name || null,
    task_id: normalizeText(row.task_id) || prior?.task_id || null,
    task_title: normalizeText(row.task_title) || prior?.task_title || null,
    activity_state: normalizeText(row.activity_state) || prior?.activity_state || null,
    execution_environment_name:
      normalizeText(row.execution_environment_name) || prior?.execution_environment_name || null,
    execution_environment_image:
      normalizeText(row.execution_environment_image) || prior?.execution_environment_image || null,
    execution_environment_distro:
      normalizeText(row.execution_environment_distro) ||
      prior?.execution_environment_distro ||
      null,
    execution_environment_package_manager:
      normalizeText(row.execution_environment_package_manager) ||
      prior?.execution_environment_package_manager ||
      null,
  };

  return Object.values(next).some((value) => value) ? next : null;
}

export function applyRememberedContext(
  row: DashboardLiveContainerRecord,
  rememberedContext: RememberedContainerContext | null,
): DashboardLiveContainerRecord {
  if (!rememberedContext) {
    return row;
  }
  return {
    ...row,
    role_name: normalizeText(row.role_name) || rememberedContext.role_name,
    playbook_id: normalizeText(row.playbook_id) || rememberedContext.playbook_id,
    playbook_name: normalizePlaybookName(row.playbook_name) || rememberedContext.playbook_name,
    workflow_id: normalizeText(row.workflow_id) || rememberedContext.workflow_id,
    workflow_name: normalizeText(row.workflow_name) || rememberedContext.workflow_name,
    stage_name: normalizeText(row.stage_name) || rememberedContext.stage_name,
    task_id: normalizeText(row.task_id) || rememberedContext.task_id,
    task_title: normalizeText(row.task_title) || rememberedContext.task_title,
    activity_state: normalizeText(row.activity_state) || rememberedContext.activity_state,
    execution_environment_name:
      normalizeText(row.execution_environment_name) || rememberedContext.execution_environment_name,
    execution_environment_image:
      normalizeText(row.execution_environment_image) ||
      rememberedContext.execution_environment_image,
    execution_environment_distro:
      normalizeText(row.execution_environment_distro) ||
      rememberedContext.execution_environment_distro,
    execution_environment_package_manager:
      normalizeText(row.execution_environment_package_manager) ||
      rememberedContext.execution_environment_package_manager,
  };
}

export function extractLiveRecord(
  row: DashboardLiveContainerRecord,
): DashboardLiveContainerRecord {
  return {
    id: row.id,
    kind: row.kind,
    container_id: row.container_id,
    name: row.name,
    state: row.state,
    status: row.status,
    image: row.image,
    cpu_limit: row.cpu_limit,
    memory_limit: row.memory_limit,
    started_at: row.started_at,
    last_seen_at: row.last_seen_at,
    role_name: row.role_name,
    playbook_id: row.playbook_id,
    playbook_name: row.playbook_name,
    workflow_id: row.workflow_id,
    workflow_name: row.workflow_name,
    task_id: row.task_id,
    task_title: row.task_title,
    stage_name: row.stage_name,
    activity_state: row.activity_state,
    execution_environment_id: row.execution_environment_id,
    execution_environment_name: row.execution_environment_name,
    execution_environment_image: row.execution_environment_image,
    execution_environment_distro: row.execution_environment_distro,
    execution_environment_package_manager: row.execution_environment_package_manager,
  };
}
