import type { DashboardLiveContainerRecord } from '../../lib/api.js';
import {
  diffVisibleFields,
  hasMeaningfulPlaybookContext,
  visibleFieldsForNewRow,
  type ContainerDiffField,
} from './containers-page.diff.js';
import {
  applyRememberedContext,
  extractLiveRecord,
  rememberContainerContext,
  type RememberedContainerContext,
} from './containers-session-context.js';

const MAX_RECENT_INACTIVE_ROWS = 10;
const INACTIVE_RETENTION_MS = 10 * 1000;
const PENDING_TRANSITION_MS = 1_000;
const RECENT_CHANGE_MS = 1_000;
const KIND_ORDER: Record<DashboardLiveContainerRecord['kind'], number> = {
  orchestrator: 0,
  runtime: 1,
  task: 2,
};

interface PendingSessionState {
  record: DashboardLiveContainerRecord;
  presence: 'running' | 'inactive';
  inactive_at: string | null;
  changed_fields: ContainerDiffField[];
  remembered_context: RememberedContainerContext | null;
}

export interface SessionContainerRow extends DashboardLiveContainerRecord {
  presence: 'running' | 'inactive';
  inactive_at: string | null;
  changed_at: string | null;
  changed_fields: ContainerDiffField[];
  pending_state: PendingSessionState | null;
  pending_flip_at: string | null;
  pending_fields: ContainerDiffField[];
  remembered_context: RememberedContainerContext | null;
}

export function mergeLiveContainerSessionRows(
  previous: SessionContainerRow[],
  liveRows: DashboardLiveContainerRecord[],
  observedAt: string,
  options?: { hasBaselineSnapshot?: boolean },
): SessionContainerRow[] {
  const stablePrevious = advanceSessionContainerRows(previous, observedAt);
  const hasBaselineSnapshot = options?.hasBaselineSnapshot ?? stablePrevious.length > 0;
  const previousById = new Map(stablePrevious.map((row) => [row.id, row] as const));
  const runningRows = liveRows.map((row) =>
    buildRunningSessionRow(previousById.get(row.id), row, observedAt, hasBaselineSnapshot),
  );
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
  return now - changedAt <= RECENT_CHANGE_MS;
}

export function hasPendingField(
  row: SessionContainerRow,
  field: ContainerDiffField,
  now = Date.now(),
): boolean {
  return isPendingChangeRow(row, now) && row.pending_fields.includes(field);
}

export function hasRecentlyChangedField(
  row: SessionContainerRow,
  field: ContainerDiffField,
  now = Date.now(),
): boolean {
  return isRecentlyChangedRow(row, now) && row.changed_fields.includes(field);
}

function compareSessionContainerRows(
  left: SessionContainerRow,
  right: SessionContainerRow,
): number {
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

function buildRunningSessionRow(
  prior: SessionContainerRow | undefined,
  next: DashboardLiveContainerRecord,
  observedAt: string,
  hasBaselineSnapshot: boolean,
): SessionContainerRow {
  const priorContext = prior
    ? rememberContainerContext(prior.remembered_context, extractLiveRecord(prior))
    : null;
  const rememberedContext = rememberContainerContext(priorContext, next);
  if (!prior) {
    return buildStableSessionRow(
      next,
      'running',
      null,
      hasBaselineSnapshot ? observedAt : null,
      hasBaselineSnapshot ? visibleFieldsForNewRow(next) : [],
      rememberedContext,
    );
  }

  const changedFields = diffVisibleFields(
    extractLiveRecord(prior),
    prior.presence,
    next,
    'running',
  );
  if (changedFields.length === 0) {
    return {
      ...buildStableSessionRow(
        next,
        'running',
        null,
        prior.changed_at,
        prior.changed_fields,
        rememberedContext,
      ),
      changed_at: prior.changed_at,
    };
  }

  if (isPendingChangeRow(prior, Date.parse(observedAt))) {
    return {
      ...prior,
      remembered_context: rememberedContext,
      pending_state: buildPendingState(next, 'running', null, changedFields, rememberedContext),
      pending_fields: changedFields,
    };
  }

  return buildPendingTransitionRow(
    prior,
    buildPendingState(next, 'running', null, changedFields, rememberedContext),
    observedAt,
  );
}

function buildMissingSessionRow(row: SessionContainerRow, observedAt: string): SessionContainerRow {
  if (row.presence === 'inactive' && !row.pending_state) {
    return row;
  }
  const changedFields: ContainerDiffField[] = ['status'];
  const inactiveRecord = applyRememberedContext(extractLiveRecord(row), row.remembered_context);
  if (isPendingChangeRow(row, Date.parse(observedAt))) {
    return {
      ...row,
      pending_state: buildPendingState(
        inactiveRecord,
        'inactive',
        observedAt,
        changedFields,
        row.remembered_context,
      ),
      pending_fields: changedFields,
    };
  }
  return buildPendingTransitionRow(
    row,
    buildPendingState(
      inactiveRecord,
      'inactive',
      observedAt,
      changedFields,
      row.remembered_context,
    ),
    observedAt,
  );
}

function buildStableSessionRow(
  row: DashboardLiveContainerRecord,
  presence: 'running' | 'inactive',
  inactiveAt: string | null,
  changedAt: string | null,
  changedFields: ContainerDiffField[],
  rememberedContext: RememberedContainerContext | null,
): SessionContainerRow {
  return {
    ...row,
    presence,
    inactive_at: inactiveAt,
    changed_at: changedAt,
    changed_fields: changedFields,
    pending_state: null,
    pending_flip_at: null,
    pending_fields: [],
    remembered_context: rememberedContext,
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
    pending_fields: pendingState.changed_fields,
  };
}

function buildPendingState(
  row: DashboardLiveContainerRecord,
  presence: 'running' | 'inactive',
  inactiveAt: string | null,
  changedFields: ContainerDiffField[],
  rememberedContext: RememberedContainerContext | null,
): PendingSessionState {
  return {
    record: row,
    presence,
    inactive_at: inactiveAt,
    changed_fields: changedFields,
    remembered_context: rememberedContext,
  };
}

function advancePendingSessionRow(
  row: SessionContainerRow,
  observedAt: string,
): SessionContainerRow {
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
    row.pending_state.changed_fields,
    row.pending_state.remembered_context,
  );
}
