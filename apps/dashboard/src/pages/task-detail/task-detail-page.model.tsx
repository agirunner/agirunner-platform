import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';

import { dashboardApi } from '../../lib/api.js';
import {
  describeExecutionBackendSurface,
  describeExecutionSurface,
  describeExecutionUsageSurface,
} from '../../lib/operator-surfaces.js';

export interface Task {
  id: string;
  name?: string;
  title?: string;
  status: string;
  state?: string;
  role?: string;
  stage_name?: string | null;
  work_item_id?: string | null;
  activation_id?: string | null;
  execution_backend?: 'runtime_only' | 'runtime_plus_task' | null;
  used_task_sandbox?: boolean;
  is_orchestrator_task?: boolean;
  agent_id?: string;
  agent_name?: string;
  assigned_worker?: string;
  worker_id?: string;
  workflow_id?: string;
  workflow_name?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  duration_seconds?: number;
  cost?: number;
  output?: unknown;
  description?: string;
  input?: Record<string, unknown>;
  context?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  verification?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  execution_environment?: {
    id?: string | null;
    name?: string | null;
    image?: string | null;
    pull_policy?: string | null;
    verified_metadata?: Record<string, unknown>;
  } | null;
  rework_count?: number;
  type?: string;
}

export function useTaskDetailQuery(taskId: string | undefined) {
  return useQuery({
    queryKey: ['task', taskId],
    queryFn: () => dashboardApi.getTask(taskId!),
    enabled: Boolean(taskId),
    select: normalizeTask,
  });
}

export function normalizeTask(response: unknown): Task {
  const wrapped = response as { data?: unknown };
  if (wrapped?.data && typeof wrapped.data === 'object' && 'id' in (wrapped.data as object)) {
    return wrapped.data as Task;
  }
  return response as Task;
}

export function resolveStatus(task: Task): string {
  return normalizeTaskStatus((task.status ?? task.state ?? 'unknown').toLowerCase());
}

export function statusBadgeVariant(status: string) {
  const map: Record<string, 'success' | 'default' | 'destructive' | 'warning' | 'secondary'> = {
    completed: 'success',
    in_progress: 'default',
    failed: 'destructive',
    output_pending_assessment: 'warning',
    pending: 'secondary',
    awaiting_approval: 'warning',
    escalated: 'destructive',
    ready: 'secondary',
  };
  return map[status] ?? 'secondary';
}

export function describeTaskKind(task: Task): string {
  const status = resolveStatus(task);
  if (task.is_orchestrator_task) {
    return 'Orchestrator activation';
  }
  if (status === 'output_pending_assessment') {
    return 'Output assessment';
  }
  if (status === 'awaiting_approval') {
    return 'Operator approval';
  }
  if (status === 'escalated') {
    return 'Escalated specialist step';
  }
  return 'Specialist step';
}

export function describeExecutionBackend(task: Task): string {
  return describeExecutionBackendSurface(task.execution_backend, task);
}

export function describeTaskSandboxUsage(task: Task): string {
  return describeExecutionUsageSurface(task.execution_backend, task.used_task_sandbox, task);
}

export function formatTimestamp(value?: string): string {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

export function formatDuration(task: Task): string {
  if (task.duration_seconds !== undefined && task.duration_seconds !== null) {
    const seconds = task.duration_seconds;
    if (seconds < 60) return `${Math.round(seconds)}s`;
    return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  }
  if (!task.started_at) return '-';
  const start = new Date(task.started_at).getTime();
  const end = task.completed_at ? new Date(task.completed_at).getTime() : Date.now();
  const seconds = (end - start) / 1000;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export function renderExecutionEnvironmentValue(task: Task): ReactNode {
  const name = task.execution_environment?.name?.trim();
  const image = task.execution_environment?.image?.trim();
  const distro = readExecutionEnvironmentMetadata(task, 'distro');
  const value = name ?? image ?? '-';

  if (!distro || value === '-') {
    return value;
  }

  return (
    <span>
      {value}
      <span className="block text-xs text-muted">{distro}</span>
    </span>
  );
}

export function describeExecutionEnvironmentPackageManager(task: Task): string {
  return readExecutionEnvironmentMetadata(task, 'package_manager') ?? '-';
}

export function formatStatusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

export function renderTimestamp(value?: string): ReactNode {
  if (!value) {
    return '-';
  }
  return (
    <time dateTime={value} title={formatTimestamp(value)}>
      {formatRelativeTime(value)}
    </time>
  );
}

export function formatRelativeTime(value: string): string {
  const millis = new Date(value).getTime();
  if (!Number.isFinite(millis)) {
    return formatTimestamp(value);
  }
  const deltaSeconds = Math.round((Date.now() - millis) / 1000);
  const absSeconds = Math.abs(deltaSeconds);
  if (absSeconds < 60) {
    return deltaSeconds >= 0 ? `${absSeconds}s ago` : `in ${absSeconds}s`;
  }
  const absMinutes = Math.round(absSeconds / 60);
  if (absMinutes < 60) {
    return deltaSeconds >= 0 ? `${absMinutes}m ago` : `in ${absMinutes}m`;
  }
  const absHours = Math.round(absMinutes / 60);
  if (absHours < 24) {
    return deltaSeconds >= 0 ? `${absHours}h ago` : `in ${absHours}h`;
  }
  const absDays = Math.round(absHours / 24);
  return deltaSeconds >= 0 ? `${absDays}d ago` : `in ${absDays}d`;
}

export function summarizeId(value?: string | null): string {
  if (!value) {
    return '-';
  }
  if (value.length <= 16) {
    return value;
  }
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function normalizeTaskStatus(status: string): string {
  return status;
}

function readExecutionEnvironmentMetadata(task: Task, key: string): string | null {
  const value = task.execution_environment?.verified_metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export { describeExecutionSurface };
