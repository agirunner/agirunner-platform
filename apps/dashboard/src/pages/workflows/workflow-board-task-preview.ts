import type { WorkflowTaskPreview } from './workflow-board-task-stack.js';
import { buildOperatorFacingSummaryLines } from './workflow-operator-input-summary.js';

export interface WorkflowTaskPreviewSummary {
  tasks: WorkflowTaskPreview[];
  hasActiveOrchestratorTask: boolean;
}

export function summarizeTaskPreviewsForWorkItem(
  records: Record<string, unknown>[] | undefined,
  workItemId: string,
  context?: {
    workItemTitle?: string | null;
    stageName?: string | null;
  },
): WorkflowTaskPreviewSummary {
  if (!Array.isArray(records)) {
    return {
      tasks: [],
      hasActiveOrchestratorTask: false,
    };
  }

  const relatedRecords = records.filter((entry) => readWorkItemId(entry) === workItemId);

  return {
    tasks: relatedRecords
      .flatMap((entry) => buildTaskPreview(entry, workItemId, context))
      .sort(compareTaskPreviewPriority),
    hasActiveOrchestratorTask: relatedRecords.some(
      (entry) => readIsOrchestratorTask(entry) && isActiveOrchestratorState(readState(entry)),
    ),
  };
}

function buildTaskPreview(
  entry: Record<string, unknown>,
  workItemId: string,
  context?: {
    workItemTitle?: string | null;
    stageName?: string | null;
  },
): WorkflowTaskPreview[] {
  const id = typeof entry.id === 'string' ? entry.id : null;
  if (!id) {
    return [];
  }
  const operatorSummary = buildOperatorFacingSummaryLines(entry.input);
  return [
    {
      id,
      title: typeof entry.title === 'string' ? entry.title : 'Untitled task',
      role: typeof entry.role === 'string' ? entry.role : null,
      state: readState(entry),
      isOrchestratorTask: readIsOrchestratorTask(entry),
      recentUpdate: readRecentUpdate(entry),
      ...(operatorSummary.length > 0 ? { operatorSummary } : {}),
      workItemId,
      workItemTitle: context?.workItemTitle ?? null,
      stageName: context?.stageName ?? null,
    },
  ];
}

function compareTaskPreviewPriority(left: WorkflowTaskPreview, right: WorkflowTaskPreview): number {
  const priorityComparison = readTaskPriority(left).localeCompare(readTaskPriority(right));
  if (priorityComparison !== 0) {
    return priorityComparison;
  }
  if (Boolean(left.isOrchestratorTask) !== Boolean(right.isOrchestratorTask)) {
    return left.isOrchestratorTask ? 1 : -1;
  }
  return left.title.localeCompare(right.title);
}

function readTaskPriority(task: WorkflowTaskPreview): string {
  switch (task.state) {
    case 'failed':
    case 'awaiting_approval':
    case 'in_progress':
      return '0';
    case 'claimed':
    case 'ready':
      return '1';
    default:
      return '2';
  }
}

function readWorkItemId(entry: Record<string, unknown>): string | null {
  return typeof entry.work_item_id === 'string' ? entry.work_item_id : null;
}

function readIsOrchestratorTask(entry: Record<string, unknown>): boolean {
  return entry.is_orchestrator_task === true;
}

function readState(entry: Record<string, unknown>): string | null {
  return typeof entry.state === 'string' ? entry.state : null;
}

function readRecentUpdate(entry: Record<string, unknown>): string | null {
  return (
    readOptionalText(entry.summary) ??
    readOptionalText(entry.headline) ??
    readOptionalText(entry.status_summary) ??
    readOptionalText(entry.description)
  );
}

function readOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isActiveOrchestratorState(state: string | null): boolean {
  return (
    state === 'ready' ||
    state === 'claimed' ||
    state === 'in_progress' ||
    state === 'awaiting_approval' ||
    state === 'output_pending_assessment'
  );
}
