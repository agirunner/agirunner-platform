import type { DashboardLiveContainerRecord } from '../../lib/api.js';

const MAX_RECENT_INACTIVE_ROWS = 20;
const INACTIVE_RETENTION_MS = 10 * 60 * 1000;
const RECENT_CHANGE_MS = 8 * 1000;
const KIND_ORDER: Record<DashboardLiveContainerRecord['kind'], number> = {
  orchestrator: 0,
  runtime: 1,
  task: 2,
};

export type ContainerStatusFilter = 'all' | 'running' | 'inactive';
export type ContainerKindFilter = 'all' | DashboardLiveContainerRecord['kind'];

export interface SessionContainerRow extends DashboardLiveContainerRecord {
  presence: 'running' | 'inactive';
  inactive_at: string | null;
  changed_at: string | null;
}

export function formatContainerKindLabel(kind: DashboardLiveContainerRecord['kind']): string {
  switch (kind) {
    case 'orchestrator':
      return 'Orchestrator worker';
    case 'runtime':
      return 'Runtime';
    case 'task':
      return 'Task execution';
    default:
      return kind;
  }
}

export function mergeLiveContainerSessionRows(
  previous: SessionContainerRow[],
  liveRows: DashboardLiveContainerRecord[],
  observedAt: string,
): SessionContainerRow[] {
  const previousById = new Map(previous.map((row) => [row.id, row] as const));
  const runningRows = liveRows.map((row) => {
    const prior = previousById.get(row.id);
    const changedAt = shouldMarkRunningRowChanged(prior, row) ? observedAt : prior?.changed_at ?? null;
    return {
      ...row,
      presence: 'running' as const,
      inactive_at: null,
      changed_at: changedAt,
    };
  });
  const liveIds = new Set(runningRows.map((row) => row.id));
  const recentInactiveRows = previous
    .filter((row) => !liveIds.has(row.id))
    .map((row) => ({
      ...row,
      presence: 'inactive' as const,
      inactive_at: row.inactive_at ?? observedAt,
      changed_at: row.presence === 'inactive' ? row.changed_at : observedAt,
    }))
    .filter((row) => !isExpiredInactiveRow(row, observedAt))
    .sort(compareSessionContainerRows)
    .slice(0, MAX_RECENT_INACTIVE_ROWS);

  return [...runningRows, ...recentInactiveRows].sort(compareSessionContainerRows);
}

export function isRecentlyChangedRow(row: SessionContainerRow, now = Date.now()): boolean {
  if (!row.changed_at) {
    return false;
  }
  const changedAt = Date.parse(row.changed_at);
  if (!Number.isFinite(changedAt)) {
    return false;
  }
  return now-changedAt <= RECENT_CHANGE_MS;
}

export function filterSessionContainerRows(
  rows: SessionContainerRow[],
  filters: {
    query: string;
    kind: ContainerKindFilter;
    status: ContainerStatusFilter;
  },
): SessionContainerRow[] {
  const normalizedQuery = filters.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.kind !== 'all' && row.kind !== filters.kind) {
      return false;
    }
    if (filters.status !== 'all' && row.presence !== filters.status) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    return buildSearchableFields(row).some((value) => value.includes(normalizedQuery));
  });
}

function buildSearchableFields(row: SessionContainerRow): string[] {
  return [
    row.id,
    row.container_id,
    row.name,
    row.image,
    row.kind,
    row.role_name ?? '',
    row.playbook_name ?? '',
    row.workflow_name ?? '',
    row.task_title ?? '',
    row.stage_name ?? '',
    row.activity_state ?? '',
    row.status ?? '',
  ]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function compareSessionContainerRows(left: SessionContainerRow, right: SessionContainerRow): number {
  if (left.presence !== right.presence) {
    return left.presence === 'running' ? -1 : 1;
  }

  const leftKind = KIND_ORDER[left.kind] ?? Number.MAX_SAFE_INTEGER;
  const rightKind = KIND_ORDER[right.kind] ?? Number.MAX_SAFE_INTEGER;
  if (leftKind !== rightKind) {
    return leftKind - rightKind;
  }

  const rightTime = readOrderingTimestamp(right);
  const leftTime = readOrderingTimestamp(left);
  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }

  return left.name.localeCompare(right.name);
}

function readOrderingTimestamp(row: SessionContainerRow): number {
  return (
    Date.parse(row.inactive_at ?? row.started_at ?? row.last_seen_at) ||
    Date.parse(row.last_seen_at) ||
    0
  );
}

function isExpiredInactiveRow(row: SessionContainerRow, observedAt: string): boolean {
  if (!row.inactive_at) {
    return false;
  }
  const inactiveAt = Date.parse(row.inactive_at);
  const cutoff = Date.parse(observedAt) - INACTIVE_RETENTION_MS;
  return Number.isFinite(inactiveAt) && inactiveAt < cutoff;
}

function shouldMarkRunningRowChanged(
  prior: SessionContainerRow | undefined,
  next: DashboardLiveContainerRecord,
): boolean {
  if (!prior) {
    return true;
  }
  if (prior.presence !== 'running') {
    return true;
  }
  return hasMaterialContainerDifference(prior, next);
}

function hasMaterialContainerDifference(
  left: DashboardLiveContainerRecord,
  right: DashboardLiveContainerRecord,
): boolean {
  return (
    left.state !== right.state
    || left.status !== right.status
    || left.image !== right.image
    || left.cpu_limit !== right.cpu_limit
    || left.memory_limit !== right.memory_limit
    || left.started_at !== right.started_at
    || left.last_seen_at !== right.last_seen_at
    || left.role_name !== right.role_name
    || left.playbook_id !== right.playbook_id
    || left.playbook_name !== right.playbook_name
    || left.workflow_id !== right.workflow_id
    || left.workflow_name !== right.workflow_name
    || left.task_id !== right.task_id
    || left.task_title !== right.task_title
    || left.stage_name !== right.stage_name
    || left.activity_state !== right.activity_state
  );
}
