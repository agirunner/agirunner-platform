import type { LogEntry } from '../lib/api.js';

export interface InspectorFilters {
  search: string;
  workflowId: string;
  taskId: string;
  workItemId: string;
  stageName: string;
  activationId: string;
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
  workItemId: '',
  stageName: '',
  activationId: '',
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
  workItemId: 'work_item',
  stageName: 'stage',
  activationId: 'activation',
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
  setIfPresent(params, 'work_item_id', filters.workItemId);
  setIfPresent(params, 'stage_name', filters.stageName);
  setIfPresent(params, 'activation_id', filters.activationId);
  setIfPresent(params, 'operation', filters.operation);
  setIfPresent(params, 'role', filters.role);
  setIfPresent(params, 'actor', filters.actor);
  return params;
}

export function readInspectorFilters(
  searchParams: URLSearchParams,
): InspectorFilters {
  return {
    search: searchParams.get(FILTER_PARAM_KEYS.search) ?? DEFAULT_INSPECTOR_FILTERS.search,
    workflowId:
      searchParams.get(FILTER_PARAM_KEYS.workflowId) ?? DEFAULT_INSPECTOR_FILTERS.workflowId,
    taskId: searchParams.get(FILTER_PARAM_KEYS.taskId) ?? DEFAULT_INSPECTOR_FILTERS.taskId,
    workItemId:
      searchParams.get(FILTER_PARAM_KEYS.workItemId) ?? DEFAULT_INSPECTOR_FILTERS.workItemId,
    stageName:
      searchParams.get(FILTER_PARAM_KEYS.stageName) ?? DEFAULT_INSPECTOR_FILTERS.stageName,
    activationId:
      searchParams.get(FILTER_PARAM_KEYS.activationId) ?? DEFAULT_INSPECTOR_FILTERS.activationId,
    level: searchParams.get(FILTER_PARAM_KEYS.level) ?? DEFAULT_INSPECTOR_FILTERS.level,
    operation:
      searchParams.get(FILTER_PARAM_KEYS.operation) ?? DEFAULT_INSPECTOR_FILTERS.operation,
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

  setFilterParam(next, FILTER_PARAM_KEYS.search, filters.search);
  setFilterParam(next, FILTER_PARAM_KEYS.workflowId, filters.workflowId);
  setFilterParam(next, FILTER_PARAM_KEYS.taskId, filters.taskId);
  setFilterParam(next, FILTER_PARAM_KEYS.workItemId, filters.workItemId);
  setFilterParam(next, FILTER_PARAM_KEYS.stageName, filters.stageName);
  setFilterParam(next, FILTER_PARAM_KEYS.activationId, filters.activationId);
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

export function readInspectorView(searchParams: URLSearchParams): 'summary' | 'detailed' | 'debug' {
  const view = searchParams.get('view');
  return view === 'detailed' || view === 'debug' ? view : 'summary';
}

export function summarizeLogContext(entry: LogEntry): string[] {
  const items: string[] = [];
  if (entry.workflow_name || entry.workflow_id) {
    items.push(`board ${entry.workflow_name ?? shortId(entry.workflow_id)}`);
  }
  if (entry.task_title || entry.task_id) {
    items.push(`step ${entry.task_title ?? shortId(entry.task_id)}`);
  }
  if (entry.stage_name) {
    items.push(`stage ${entry.stage_name}`);
  }
  if (entry.work_item_id) {
    items.push(`work item ${shortId(entry.work_item_id)}`);
  }
  if (entry.activation_id) {
    items.push(`activation ${shortId(entry.activation_id)}`);
  }
  return items;
}

export function shortId(value?: string | null): string {
  if (!value) {
    return '-';
  }
  return value.length <= 12 ? value : value.slice(0, 8);
}

export function formatDuration(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return '-';
  }
  if (value < 1_000) {
    return `${Math.round(value)} ms`;
  }
  return `${(value / 1_000).toFixed(2)} s`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

export function formatCost(value: unknown): string {
  const cost = typeof value === 'number' ? value : Number(value ?? 0);
  if (!Number.isFinite(cost) || cost === 0) {
    return '$0.0000';
  }
  return `$${cost.toFixed(4)}`;
}

export function levelVariant(level: string):
  | 'secondary'
  | 'success'
  | 'warning'
  | 'destructive' {
  switch (level) {
    case 'debug':
      return 'secondary';
    case 'info':
      return 'success';
    case 'warn':
      return 'warning';
    case 'error':
      return 'destructive';
    default:
      return 'secondary';
  }
}

export function statusVariant(status: string):
  | 'secondary'
  | 'success'
  | 'warning'
  | 'destructive' {
  switch (status) {
    case 'completed':
      return 'success';
    case 'started':
      return 'secondary';
    case 'skipped':
      return 'warning';
    case 'failed':
      return 'destructive';
    default:
      return 'secondary';
  }
}

export function topGroups<T extends { count: number }>(items: T[], limit = 8): T[] {
  return [...items].sort((left, right) => right.count - left.count).slice(0, limit);
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
