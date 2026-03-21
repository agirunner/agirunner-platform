import type { DashboardLiveContainerRecord } from '../../lib/api.js';

const MAX_RECENT_INACTIVE_ROWS = 20;
const INACTIVE_RETENTION_MS = 10 * 60 * 1000;
const PENDING_TRANSITION_MS = 1_000;
const RECENT_CHANGE_MS = 8 * 1000;
const KIND_ORDER: Record<DashboardLiveContainerRecord['kind'], number> = {
  orchestrator: 0,
  runtime: 1,
  task: 2,
};

export type ContainerStatusFilter = 'all' | 'running' | 'inactive';
export type ContainerKindFilter = 'all' | DashboardLiveContainerRecord['kind'];

interface PendingSessionState {
  record: DashboardLiveContainerRecord;
  presence: 'running' | 'inactive';
  inactive_at: string | null;
}

export interface SessionContainerRow extends DashboardLiveContainerRecord {
  presence: 'running' | 'inactive';
  inactive_at: string | null;
  changed_at: string | null;
  pending_state: PendingSessionState | null;
  pending_flip_at: string | null;
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
  const stablePrevious = advanceSessionContainerRows(previous, observedAt);
  const previousById = new Map(stablePrevious.map((row) => [row.id, row] as const));
  const runningRows = liveRows.map((row) => buildRunningSessionRow(previousById.get(row.id), row, observedAt));
  const liveIds = new Set(runningRows.map((row) => row.id));
  const recentInactiveRows = stablePrevious
    .filter((row) => !liveIds.has(row.id))
    .map((row) => buildMissingSessionRow(row, observedAt))
    .filter((row) => !isExpiredInactiveRow(row, observedAt))
    .sort(compareSessionContainerRows)
    .slice(0, MAX_RECENT_INACTIVE_ROWS);

  return [...runningRows, ...recentInactiveRows].sort(compareSessionContainerRows);
}

export function advanceSessionContainerRows(
  rows: SessionContainerRow[],
  observedAt: string,
): SessionContainerRow[] {
  let changed = false;
  const advancedRows = rows.map((row) => {
    const nextRow = advancePendingSessionRow(row, observedAt);
    if (nextRow !== row) {
      changed = true;
    }
    return nextRow;
  });
  if (!changed) {
    return rows;
  }
  return advancedRows.sort(compareSessionContainerRows);
}

export function isPendingChangeRow(row: SessionContainerRow, now = Date.now()): boolean {
  if (!row.pending_state || !row.pending_flip_at) {
    return false;
  }
  const flipAt = Date.parse(row.pending_flip_at);
  if (!Number.isFinite(flipAt)) {
    return false;
  }
  return now < flipAt;
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
    left.kind !== right.kind
    || left.name !== right.name
    || left.state !== right.state
    || left.image !== right.image
    || left.cpu_limit !== right.cpu_limit
    || left.memory_limit !== right.memory_limit
    || left.started_at !== right.started_at
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

function buildRunningSessionRow(
  prior: SessionContainerRow | undefined,
  next: DashboardLiveContainerRecord,
  observedAt: string,
): SessionContainerRow {
  if (!prior) {
    return buildStableSessionRow(next, 'running', null, observedAt);
  }
  if (prior.presence !== 'running') {
    return buildStableSessionRow(next, 'running', null, observedAt);
  }
  if (isPendingChangeRow(prior, Date.parse(observedAt))) {
    if (!hasMaterialContainerDifference(prior, next)) {
      return {
        ...buildStableSessionRow(next, 'running', null, prior.changed_at),
        changed_at: prior.changed_at,
      };
    }
    return {
      ...prior,
      pending_state: buildPendingState(next, 'running', null),
    };
  }
  if (!shouldMarkRunningRowChanged(prior, next)) {
    return {
      ...buildStableSessionRow(next, 'running', null, prior.changed_at),
      changed_at: prior.changed_at,
    };
  }
  return buildPendingTransitionRow(prior, buildPendingState(next, 'running', null), observedAt);
}

function buildMissingSessionRow(row: SessionContainerRow, observedAt: string): SessionContainerRow {
  if (row.presence === 'inactive' && !row.pending_state) {
    return row;
  }
  if (isPendingChangeRow(row, Date.parse(observedAt))) {
    return {
      ...row,
      pending_state: buildPendingState(extractLiveRecord(row), 'inactive', observedAt),
    };
  }
  return buildPendingTransitionRow(
    row,
    buildPendingState(extractLiveRecord(row), 'inactive', observedAt),
    observedAt,
  );
}

function buildStableSessionRow(
  row: DashboardLiveContainerRecord,
  presence: 'running' | 'inactive',
  inactiveAt: string | null,
  changedAt: string | null,
): SessionContainerRow {
  return {
    ...row,
    presence,
    inactive_at: inactiveAt,
    changed_at: changedAt,
    pending_state: null,
    pending_flip_at: null,
  };
}

function buildPendingTransitionRow(
  current: SessionContainerRow,
  pendingState: PendingSessionState,
  observedAt: string,
): SessionContainerRow {
  return {
    ...current,
    changed_at: null,
    pending_state: pendingState,
    pending_flip_at: new Date(Date.parse(observedAt) + PENDING_TRANSITION_MS).toISOString(),
  };
}

function buildPendingState(
  row: DashboardLiveContainerRecord,
  presence: 'running' | 'inactive',
  inactiveAt: string | null,
): PendingSessionState {
  return {
    record: row,
    presence,
    inactive_at: inactiveAt,
  };
}

function advancePendingSessionRow(row: SessionContainerRow, observedAt: string): SessionContainerRow {
  if (!row.pending_state || !row.pending_flip_at) {
    return row;
  }
  const flipAt = Date.parse(row.pending_flip_at);
  const now = Date.parse(observedAt);
  if (!Number.isFinite(flipAt) || !Number.isFinite(now) || now < flipAt) {
    return row;
  }
  return buildStableSessionRow(
    row.pending_state.record,
    row.pending_state.presence,
    row.pending_state.inactive_at,
    row.pending_flip_at,
  );
}

function extractLiveRecord(row: SessionContainerRow): DashboardLiveContainerRecord {
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
  };
}
