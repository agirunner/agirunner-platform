import type { DashboardLiveContainerRecord } from '../../lib/api.js';

const ALL_DIFF_FIELDS: ContainerDiffField[] = [
  'status',
  'kind',
  'role',
  'playbook',
  'workflow',
  'stage',
  'task',
  'image',
  'cpu',
  'memory',
  'started',
];

export type ContainerDiffField =
  | 'status'
  | 'kind'
  | 'role'
  | 'playbook'
  | 'workflow'
  | 'stage'
  | 'task'
  | 'image'
  | 'cpu'
  | 'memory'
  | 'started';

export function visibleFieldsForNewRow(row: DashboardLiveContainerRecord): ContainerDiffField[] {
  const fields: ContainerDiffField[] = ['status', 'kind', 'image', 'cpu', 'memory', 'started'];
  if (row.role_name?.trim()) {
    fields.push('role');
  }
  if (hasMeaningfulPlaybookContext(row.playbook_id, row.playbook_name)) {
    fields.push('playbook');
  }
  if (row.workflow_id || row.workflow_name?.trim()) {
    fields.push('workflow');
  }
  if (row.stage_name?.trim()) {
    fields.push('stage');
  }
  if (row.task_id || row.task_title?.trim()) {
    fields.push('task');
  }
  return fields;
}

export function diffVisibleFields(
  left: DashboardLiveContainerRecord,
  leftPresence: 'running' | 'inactive',
  right: DashboardLiveContainerRecord,
  rightPresence: 'running' | 'inactive',
): ContainerDiffField[] {
  const changed = new Set<ContainerDiffField>();

  if (
    leftPresence !== rightPresence ||
    normalizeText(left.state) !== normalizeText(right.state) ||
    normalizeText(left.activity_state) !== normalizeText(right.activity_state)
  ) {
    changed.add('status');
  }
  if (left.kind !== right.kind || normalizeText(left.name) !== normalizeText(right.name)) {
    changed.add('kind');
  }
  if (normalizeText(left.role_name) !== normalizeText(right.role_name)) {
    changed.add('role');
  }
  if (
    normalizeText(left.playbook_id) !== normalizeText(right.playbook_id) ||
    normalizePlaybookName(left.playbook_name) !== normalizePlaybookName(right.playbook_name)
  ) {
    changed.add('playbook');
  }
  if (
    normalizeText(left.workflow_id) !== normalizeText(right.workflow_id) ||
    normalizeText(left.workflow_name) !== normalizeText(right.workflow_name)
  ) {
    changed.add('workflow');
  }
  if (normalizeText(left.stage_name) !== normalizeText(right.stage_name)) {
    changed.add('stage');
  }
  if (
    normalizeText(left.task_id) !== normalizeText(right.task_id) ||
    normalizeText(left.task_title) !== normalizeText(right.task_title)
  ) {
    changed.add('task');
  }
  if (normalizeText(left.image) !== normalizeText(right.image)) {
    changed.add('image');
  }
  if (normalizeText(left.cpu_limit) !== normalizeText(right.cpu_limit)) {
    changed.add('cpu');
  }
  if (normalizeText(left.memory_limit) !== normalizeText(right.memory_limit)) {
    changed.add('memory');
  }
  if (normalizeText(left.started_at) !== normalizeText(right.started_at)) {
    changed.add('started');
  }

  return ALL_DIFF_FIELDS.filter((field) => changed.has(field));
}

export function normalizeText(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

export function normalizePlaybookName(value: string | null | undefined): string {
  const normalized = normalizeText(value);
  return isSyntheticContainerContextLabel(normalized) ? '' : normalized;
}

export function hasMeaningfulPlaybookContext(
  id: string | null | undefined,
  name: string | null | undefined,
): boolean {
  return normalizeText(id) !== '' || normalizePlaybookName(name) !== '';
}

function isSyntheticContainerContextLabel(value: string | null | undefined): boolean {
  return normalizeText(value).toLowerCase() === 'specialist agents';
}
