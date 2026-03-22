import type { DashboardLiveContainerRecord } from '../../lib/api.js';

const MAX_RECENT_INACTIVE_ROWS = 10;
const INACTIVE_RETENTION_MS = 10 * 1000;
const PENDING_TRANSITION_MS = 1_000;
const RECENT_CHANGE_MS = 1_000;
const KIND_ORDER: Record<DashboardLiveContainerRecord['kind'], number> = {
  orchestrator: 0,
  runtime: 1,
  task: 2,
};

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

export type ContainerStatusFilter = 'all' | 'running' | 'inactive';
export type ContainerKindFilter = 'all' | DashboardLiveContainerRecord['kind'];
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

interface PendingSessionState {
  record: DashboardLiveContainerRecord;
  presence: 'running' | 'inactive';
  inactive_at: string | null;
  changed_fields: ContainerDiffField[];
  remembered_context: RememberedContainerContext | null;
}

interface RememberedContainerContext {
  role_name: string | null;
  playbook_id: string | null;
  playbook_name: string | null;
  workflow_id: string | null;
  workflow_name: string | null;
  stage_name: string | null;
  task_id: string | null;
  task_title: string | null;
  activity_state: string | null;
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

export function partitionSessionContainerRowsByFunction(rows: SessionContainerRow[]): {
  orchestrator: SessionContainerRow[];
  specialists: SessionContainerRow[];
} {
  return rows.reduce(
    (groups, row) => {
      if (isOrchestratorFunctionRow(row)) {
        groups.orchestrator.push(row);
      } else {
        groups.specialists.push(row);
      }
      return groups;
    },
    { orchestrator: [] as SessionContainerRow[], specialists: [] as SessionContainerRow[] },
  );
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

function isOrchestratorFunctionRow(row: SessionContainerRow): boolean {
  return row.kind === 'orchestrator' || normalizeText(row.role_name).toLowerCase() === 'orchestrator';
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

  const changedFields = diffVisibleFields(extractLiveRecord(prior), prior.presence, next, 'running');
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
    row.pending_state.changed_fields,
    row.pending_state.remembered_context,
  );
}

function visibleFieldsForNewRow(row: DashboardLiveContainerRecord): ContainerDiffField[] {
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

function diffVisibleFields(
  left: DashboardLiveContainerRecord,
  leftPresence: 'running' | 'inactive',
  right: DashboardLiveContainerRecord,
  rightPresence: 'running' | 'inactive',
): ContainerDiffField[] {
  const changed = new Set<ContainerDiffField>();

  if (
    leftPresence !== rightPresence
    || normalizeText(left.state) !== normalizeText(right.state)
    || normalizeText(left.activity_state) !== normalizeText(right.activity_state)
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
    normalizeText(left.playbook_id) !== normalizeText(right.playbook_id)
    || normalizePlaybookName(left.playbook_name) !== normalizePlaybookName(right.playbook_name)
  ) {
    changed.add('playbook');
  }
  if (
    normalizeText(left.workflow_id) !== normalizeText(right.workflow_id)
    || normalizeText(left.workflow_name) !== normalizeText(right.workflow_name)
  ) {
    changed.add('workflow');
  }
  if (normalizeText(left.stage_name) !== normalizeText(right.stage_name)) {
    changed.add('stage');
  }
  if (
    normalizeText(left.task_id) !== normalizeText(right.task_id)
    || normalizeText(left.task_title) !== normalizeText(right.task_title)
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

function normalizeText(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

function normalizePlaybookName(value: string | null | undefined): string {
  const normalized = normalizeText(value);
  return isSyntheticContainerContextLabel(normalized) ? '' : normalized;
}

function hasMeaningfulPlaybookContext(id: string | null | undefined, name: string | null | undefined): boolean {
  return normalizeText(id) !== '' || normalizePlaybookName(name) !== '';
}

function isSyntheticContainerContextLabel(value: string | null | undefined): boolean {
  return normalizeText(value).toLowerCase() === 'specialist runtimes';
}

function rememberContainerContext(
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
  };

  return Object.values(next).some((value) => value) ? next : null;
}

function applyRememberedContext(
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
  };
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
