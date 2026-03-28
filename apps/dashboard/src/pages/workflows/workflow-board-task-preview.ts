import type { WorkflowTaskPreview } from './workflow-board-task-stack.js';

export interface WorkflowTaskPreviewSummary {
  tasks: WorkflowTaskPreview[];
  hasActiveOrchestratorTask: boolean;
}

export function summarizeTaskPreviewsForWorkItem(
  records: Record<string, unknown>[] | undefined,
  workItemId: string,
): WorkflowTaskPreviewSummary {
  if (!Array.isArray(records)) {
    return {
      tasks: [],
      hasActiveOrchestratorTask: false,
    };
  }

  const relatedRecords = records.filter((entry) => readWorkItemId(entry, workItemId) === workItemId);

  return {
    tasks: relatedRecords
      .filter((entry) => readIsOrchestratorTask(entry) === false)
      .flatMap((entry) => buildTaskPreview(entry))
      .sort((left, right) => readTaskPriority(left).localeCompare(readTaskPriority(right))),
    hasActiveOrchestratorTask: relatedRecords.some(
      (entry) => readIsOrchestratorTask(entry) && isActiveOrchestratorState(readState(entry)),
    ),
  };
}

function buildTaskPreview(entry: Record<string, unknown>): WorkflowTaskPreview[] {
  const id = typeof entry.id === 'string' ? entry.id : null;
  if (!id) {
    return [];
  }
  return [
    {
      id,
      title: typeof entry.title === 'string' ? entry.title : 'Untitled task',
      role: typeof entry.role === 'string' ? entry.role : null,
      state: readState(entry),
    },
  ];
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

function readWorkItemId(entry: Record<string, unknown>, fallback: string): string {
  return typeof entry.work_item_id === 'string' ? entry.work_item_id : fallback;
}

function readIsOrchestratorTask(entry: Record<string, unknown>): boolean {
  return entry.is_orchestrator_task === true;
}

function readState(entry: Record<string, unknown>): string | null {
  return typeof entry.state === 'string' ? entry.state : null;
}

function isActiveOrchestratorState(state: string | null): boolean {
  return state === 'ready'
    || state === 'claimed'
    || state === 'in_progress'
    || state === 'awaiting_approval'
    || state === 'output_pending_assessment';
}
