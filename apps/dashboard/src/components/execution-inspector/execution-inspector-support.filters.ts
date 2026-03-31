export type InspectorView = 'raw' | 'summary';

export interface InspectorFilters {
  search: string;
  workflowId: string;
  taskId: string;
  level: string;
  operation: string;
  role: string;
  actor: string;
  timeWindowHours: string;
}

export const DEFAULT_INSPECTOR_FILTERS: InspectorFilters = {
  search: '',
  workflowId: '',
  taskId: '',
  level: 'info',
  operation: '',
  role: '',
  actor: '',
  timeWindowHours: '24',
};

const FILTER_PARAM_KEYS = {
  search: 'search',
  workflowId: 'workflow',
  taskId: 'task',
  level: 'level',
  operation: 'operation',
  role: 'role',
  actor: 'actor',
  timeWindowHours: 'time_window',
} as const;

export function buildLogFilters(
  filters: InspectorFilters,
  extra: Record<string, string> = {},
): Record<string, string> {
  const params: Record<string, string> = { ...extra };
  const since = new Date(Date.now() - Number(filters.timeWindowHours || '24') * 3_600_000);
  params.since = since.toISOString();
  params.until = new Date().toISOString();
  params.level = filters.level;

  setIfPresent(params, 'search', filters.search);
  setIfPresent(params, 'workflow_id', filters.workflowId);
  setIfPresent(params, 'task_id', filters.taskId);
  setIfPresent(params, 'operation', filters.operation);
  setIfPresent(params, 'role', filters.role);
  setIfPresent(params, 'actor', filters.actor);
  return params;
}

export function readInspectorFilters(searchParams: URLSearchParams): InspectorFilters {
  return {
    search: searchParams.get(FILTER_PARAM_KEYS.search) ?? DEFAULT_INSPECTOR_FILTERS.search,
    workflowId:
      searchParams.get(FILTER_PARAM_KEYS.workflowId) ?? DEFAULT_INSPECTOR_FILTERS.workflowId,
    taskId: searchParams.get(FILTER_PARAM_KEYS.taskId) ?? DEFAULT_INSPECTOR_FILTERS.taskId,
    level: searchParams.get(FILTER_PARAM_KEYS.level) ?? DEFAULT_INSPECTOR_FILTERS.level,
    operation: searchParams.get(FILTER_PARAM_KEYS.operation) ?? DEFAULT_INSPECTOR_FILTERS.operation,
    role: searchParams.get(FILTER_PARAM_KEYS.role) ?? DEFAULT_INSPECTOR_FILTERS.role,
    actor: searchParams.get(FILTER_PARAM_KEYS.actor) ?? DEFAULT_INSPECTOR_FILTERS.actor,
    timeWindowHours:
      searchParams.get(FILTER_PARAM_KEYS.timeWindowHours) ??
      DEFAULT_INSPECTOR_FILTERS.timeWindowHours,
  };
}

export function writeInspectorFilters(
  searchParams: URLSearchParams,
  filters: InspectorFilters,
): URLSearchParams {
  const next = new URLSearchParams(searchParams);
  next.delete('work_item');
  next.delete('stage');
  next.delete('activation');

  setFilterParam(next, FILTER_PARAM_KEYS.search, filters.search);
  setFilterParam(next, FILTER_PARAM_KEYS.workflowId, filters.workflowId);
  setFilterParam(next, FILTER_PARAM_KEYS.taskId, filters.taskId);
  setFilterParam(next, FILTER_PARAM_KEYS.operation, filters.operation);
  setFilterParam(next, FILTER_PARAM_KEYS.role, filters.role);
  setFilterParam(next, FILTER_PARAM_KEYS.actor, filters.actor);

  if (filters.level === DEFAULT_INSPECTOR_FILTERS.level) {
    next.delete(FILTER_PARAM_KEYS.level);
  } else {
    next.set(FILTER_PARAM_KEYS.level, filters.level);
  }

  if (filters.timeWindowHours === DEFAULT_INSPECTOR_FILTERS.timeWindowHours) {
    next.delete(FILTER_PARAM_KEYS.timeWindowHours);
  } else {
    next.set(FILTER_PARAM_KEYS.timeWindowHours, filters.timeWindowHours);
  }

  return next;
}

export function readSelectedInspectorLogId(searchParams: URLSearchParams): number | null {
  const raw = searchParams.get('log');
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function readInspectorView(searchParams: URLSearchParams): InspectorView {
  const view = searchParams.get('view');
  if (view === 'summary' || view === 'detailed') {
    return 'summary';
  }
  return 'raw';
}

export function describeTaskContextPacketKind(
  operation: string,
): 'attachments' | 'predecessor_handoff' | null {
  if (operation === 'task.context.attachments') {
    return 'attachments';
  }
  if (operation === 'task.context.predecessor_handoff.attach') {
    return 'predecessor_handoff';
  }
  return null;
}

function setIfPresent(target: Record<string, string>, key: string, value: string): void {
  const normalized = value.trim();
  if (normalized.length > 0) {
    target[key] = normalized;
  }
}

function setFilterParam(searchParams: URLSearchParams, key: string, value: string): void {
  const normalized = value.trim();
  if (normalized.length === 0) {
    searchParams.delete(key);
    return;
  }
  searchParams.set(key, normalized);
}
