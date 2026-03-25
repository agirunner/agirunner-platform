import { readTaskOperatorFlowDescription } from './task-list-page.actions.js';
import {
  describeExecutionBackendSurface,
  describeExecutionSurface,
  describeExecutionUsageSurface,
} from '../../lib/operator-surfaces.js';

export interface TaskListRecord {
  id: string;
  name?: string;
  title?: string;
  status: string;
  state?: string;
  role?: string;
  stage_name?: string | null;
  work_item_id?: string | null;
  activation_id?: string | null;
  is_orchestrator_task?: boolean | null;
  workflow_id?: string | null;
  workflow_name?: string | null;
  agent_id?: string | null;
  agent_name?: string | null;
  assigned_worker?: string | null;
  execution_backend?: 'runtime_only' | 'runtime_plus_task' | null;
  used_task_sandbox?: boolean;
  created_at: string;
  duration_seconds?: number | null;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface TaskPostureSummary {
  active: number;
  ready: number;
  assessment: number;
  recovery: number;
  orchestrator: number;
}

export type StatusFilter =
  | 'all'
  | 'ready'
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'awaiting_approval'
  | 'output_pending_assessment'
  | 'escalated';

export const STATUS_FILTERS: StatusFilter[] = [
  'all',
  'ready',
  'pending',
  'in_progress',
  'completed',
  'failed',
  'awaiting_approval',
  'output_pending_assessment',
  'escalated',
];

export const TASK_LIST_PAGE_SIZE = 20;

export function normalizeTaskListRecords(response: unknown): TaskListRecord[] {
  if (Array.isArray(response)) {
    return response as TaskListRecord[];
  }
  const wrapped = response as { data?: unknown };
  return Array.isArray(wrapped?.data) ? (wrapped.data as TaskListRecord[]) : [];
}

export function normalizeTaskStatus(status: string): string {
  return status.toLowerCase();
}

export function resolveTaskStatus(task: TaskListRecord): string {
  return normalizeTaskStatus(task.state ?? task.status ?? 'unknown');
}

export function statusBadgeVariant(
  status: string,
): 'success' | 'default' | 'destructive' | 'warning' | 'secondary' {
  const variants: Record<string, 'success' | 'default' | 'destructive' | 'warning' | 'secondary'> =
    {
      completed: 'success',
      in_progress: 'default',
      failed: 'destructive',
      output_pending_assessment: 'warning',
      awaiting_approval: 'warning',
      escalated: 'destructive',
      ready: 'secondary',
      pending: 'secondary',
    };
  return variants[status] ?? 'secondary';
}

export function describeTaskKind(task: TaskListRecord): string {
  if (task.is_orchestrator_task) {
    return 'Orchestrator activation';
  }
  const status = resolveTaskStatus(task);
  if (status === 'escalated') {
    return 'Escalated specialist step';
  }
  if (status === 'output_pending_assessment') {
    return 'Output assessment';
  }
  if (status === 'awaiting_approval') {
    return 'Operator approval';
  }
  return 'Specialist step';
}

export function describeTaskScope(task: TaskListRecord): string {
  const parts = [
    task.stage_name ? `Stage ${task.stage_name}` : null,
    task.work_item_id ? `Work item ${compactIdentifier(task.work_item_id)}` : null,
    task.activation_id ? `Activation ${compactIdentifier(task.activation_id)}` : null,
  ].filter((segment): segment is string => Boolean(segment));
  return parts.length > 0 ? parts.join(' • ') : 'No workflow scope';
}

export function describeExecutionBackend(task: TaskListRecord): string {
  return describeExecutionBackendSurface(task.execution_backend, task);
}

export function describeSandboxUsage(task: TaskListRecord): string {
  return describeExecutionUsageSurface(task.execution_backend, task.used_task_sandbox, task);
}

export function describeExecutionSurfaceLabel(task: TaskListRecord): string {
  return describeExecutionSurface(task);
}

export function describeTaskNextAction(task: TaskListRecord): string {
  const status = resolveTaskStatus(task);
  const operatorFlow = readTaskOperatorFlowDescription(task);
  if (status === 'awaiting_approval') {
    return operatorFlow
      ? `Review and approve this step from the ${operatorFlow}.`
      : 'Review and approve the step output.';
  }
  if (status === 'output_pending_assessment') {
    return operatorFlow
      ? `Inspect the output packet from the ${operatorFlow} and decide on changes.`
      : 'Inspect the output packet and decide on changes.';
  }
  if (status === 'escalated') {
    return operatorFlow
      ? `Resolve the escalation from the ${operatorFlow} so guidance stays attached to the board context.`
      : 'Resolve the escalation or re-scope the work item.';
  }
  if (status === 'failed') {
    return operatorFlow
      ? `Inspect the failure from the ${operatorFlow} and choose retry, rework, or escalation.`
      : 'Inspect the failure and choose retry, rework, or escalation.';
  }
  if (status === 'ready') {
    return 'Waiting for specialist agent capacity to claim the step.';
  }
  if (status === 'pending') {
    return 'Queued behind upstream work or orchestration.';
  }
  if (status === 'completed') {
    return 'Completed; confirm downstream work is unblocked.';
  }
  if (task.is_orchestrator_task) {
    return 'Track the orchestration turn and resulting work-item updates.';
  }
  return operatorFlow
    ? `Open the ${operatorFlow} for full board context and recent activity.`
    : 'Open the step for full context and recent activity.';
}

export function readTaskRecoveryCue(task: TaskListRecord): string {
  const status = resolveTaskStatus(task);
  if (status === 'failed') {
    return 'Failure is blocking downstream work. Inspect diagnostics, then choose retry, rework, or escalation.';
  }
  if (status === 'escalated') {
    return 'An operator decision is holding this step. Resolve the escalation to let workflow progress resume.';
  }
  if (status === 'awaiting_approval') {
    return 'An approval decision is waiting. Approve, reject, or request changes so the board can move again.';
  }
  if (status === 'output_pending_assessment') {
    return 'Output is ready for assessment. Validate the packet, then approve or request targeted changes.';
  }
  if (status === 'ready') {
    return 'This step is ready but unclaimed. Watch for specialist agent capacity buildup if more steps stack here.';
  }
  if (task.is_orchestrator_task) {
    return 'Watch this orchestrator turn for new work items, gates, or retries before leaving the queue.';
  }
  return 'Use the linked operator flow so the next decision stays attached to the right board context.';
}

export function formatTaskDuration(task: TaskListRecord, now = Date.now()): string {
  if (task.duration_seconds !== undefined && task.duration_seconds !== null) {
    return formatDurationSeconds(task.duration_seconds);
  }
  if (!task.started_at) {
    return '-';
  }
  const start = new Date(task.started_at).getTime();
  if (!Number.isFinite(start)) {
    return '-';
  }
  const end = task.completed_at ? new Date(task.completed_at).getTime() : now;
  return formatDurationSeconds((end - start) / 1000);
}

export function formatRelativeTime(value: string, now = Date.now()): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return 'Unknown time';
  }
  const deltaMinutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (deltaMinutes < 1) {
    return 'Just now';
  }
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }
  const deltaDays = Math.floor(deltaHours / 24);
  return `${deltaDays}d ago`;
}

export function formatStatusLabel(status: string): string {
  if (status === 'all') {
    return 'All Statuses';
  }
  return status
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function summarizeTaskPosture(tasks: TaskListRecord[]): TaskPostureSummary {
  return tasks.reduce<TaskPostureSummary>(
    (summary, task) => {
      const status = resolveTaskStatus(task);
      if (task.is_orchestrator_task) {
        summary.orchestrator += 1;
      }
      if (status === 'ready') {
        summary.ready += 1;
      }
      if (status === 'in_progress') {
        summary.active += 1;
      }
      if (status === 'awaiting_approval' || status === 'output_pending_assessment') {
        summary.assessment += 1;
      }
      if (status === 'failed' || status === 'escalated') {
        summary.recovery += 1;
      }
      return summary;
    },
    { active: 0, ready: 0, assessment: 0, recovery: 0, orchestrator: 0 },
  );
}

export function buildTaskSearchText(task: TaskListRecord): string {
  return [
    task.title ?? task.name ?? '',
    task.workflow_name ?? '',
    task.workflow_id ?? '',
    task.stage_name ?? '',
    task.work_item_id ?? '',
    task.activation_id ?? '',
    task.role ?? '',
    task.execution_backend ?? '',
    task.used_task_sandbox ? 'used sandbox' : 'no sandbox',
    task.assigned_worker ?? '',
    task.agent_name ?? task.agent_id ?? '',
  ]
    .join(' ')
    .toLowerCase();
}

function compactIdentifier(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function formatDurationSeconds(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}
