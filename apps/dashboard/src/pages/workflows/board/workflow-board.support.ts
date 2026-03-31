import type { DashboardWorkflowWorkItemRecord } from '../../../lib/api.js';
import { isCancelledWorkItem, isNeedsActionWorkItem } from '../workflow-board.support.js';
import type { WorkflowTaskPreviewSummary } from '../workflow-board-task-preview.js';
import type { WorkflowBoardMode } from '../workflows-page.support.js';

export type WorkflowBoardWorkItemAction =
  | 'steer'
  | 'pause'
  | 'resume'
  | 'cancel'
  | 'repeat'
  | 'needs-action';

export interface WorkflowBoardWorkItemControl {
  action: WorkflowBoardWorkItemAction;
  label: string;
  variant: 'outline' | 'destructive';
  disabled?: boolean;
  className?: string;
}

export const THEMED_SCROLL_STYLE = {
  scrollbarWidth: 'thin',
  scrollbarColor: 'rgba(148, 163, 184, 0.5) transparent',
} as const;

export function readDesktopFitClassName(laneCount: number): string {
  switch (laneCount) {
    case 1:
      return 'grid min-w-full gap-3 md:grid-cols-1 md:items-start';
    case 2:
      return 'grid min-w-full gap-3 md:grid-cols-2 md:items-start';
    case 3:
      return 'grid min-w-full gap-3 md:grid-cols-3 md:items-start';
    default:
      return 'grid min-w-full gap-3 md:grid-cols-4 md:items-start';
  }
}

export function readPinnedCompletedCount(
  isTerminalLane: boolean | null | undefined,
  boardMode: WorkflowBoardMode,
): number {
  if (!isTerminalLane) {
    return 0;
  }
  return 2;
}

export function humanizeToken(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

export function shouldShowPriorityBadge(priority: string | null | undefined): boolean {
  if (!priority) {
    return false;
  }
  const normalized = priority.trim().toLowerCase();
  return normalized !== 'medium' && normalized !== 'normal';
}

export function emptyTaskSummary(): WorkflowTaskPreviewSummary {
  return {
    tasks: [],
    hasActiveOrchestratorTask: false,
  };
}

export function buildTaskStatusSummary(taskSummary: WorkflowTaskPreviewSummary): string | null {
  if (taskSummary.tasks.length === 0) {
    return null;
  }

  let activeCount = 0;
  let readyCount = 0;
  let blockedCount = 0;
  let completedCount = 0;

  for (const task of taskSummary.tasks) {
    if (task.state === 'ready') {
      readyCount += 1;
      continue;
    }
    if (task.state === 'failed') {
      blockedCount += 1;
      continue;
    }
    if (task.state === 'completed') {
      completedCount += 1;
      continue;
    }
    if (
      task.state === 'claimed' ||
      task.state === 'in_progress' ||
      task.state === 'awaiting_approval'
    ) {
      activeCount += 1;
    }
  }

  const segments = [
    activeCount > 0 ? `${activeCount} working` : null,
    readyCount > 0 ? `${readyCount} ready next` : null,
    blockedCount > 0 ? `${blockedCount} blocked` : null,
    completedCount > 0 ? `${completedCount} completed` : null,
  ].filter(Boolean);

  return segments.length > 0 ? segments.join(' • ') : null;
}

export function readWorkItemCardControls(
  workItem: DashboardWorkflowWorkItemRecord,
  workflowState: string | null | undefined,
  isDone: boolean,
): WorkflowBoardWorkItemControl[] {
  const isCancelled = isCancelledWorkItem(workItem, workflowState);
  const isWorkflowPaused = workflowState === 'paused';
  const isPaused = isPausedWorkflowWorkItem(workItem);
  const controls: WorkflowBoardWorkItemControl[] = [];

  if (isNeedsActionWorkItem(workItem)) {
    controls.push({
      action: 'needs-action',
      label: 'Needs Action',
      variant: 'outline',
      className:
        'border-amber-300/70 bg-amber-50/70 text-amber-950 hover:bg-amber-50 dark:border-amber-700/60 dark:bg-amber-950/20 dark:text-amber-100',
    });
  }

  if (isCancelled) {
    return controls;
  }

  if (isDone) {
    controls.push({
      action: 'repeat',
      label: 'Repeat',
      variant: 'outline',
    });
    return controls;
  }

  if (isWorkflowPaused) {
    return controls;
  }

  controls.push({
    action: 'steer',
    label: 'Steer',
    variant: 'outline',
    disabled: isPaused,
  });
  controls.push({
    action: isPaused ? 'resume' : 'pause',
    label: isPaused ? 'Resume' : 'Pause',
    variant: 'outline',
  });
  controls.push({
    action: 'cancel',
    label: 'Cancel',
    variant: 'destructive',
  });

  return controls;
}

export function readWorkItemControlAriaLabel(
  action: Exclude<WorkflowBoardWorkItemAction, 'needs-action'>,
): string {
  switch (action) {
    case 'steer':
      return 'Steer work item';
    case 'pause':
      return 'Pause work item';
    case 'resume':
      return 'Resume work item';
    case 'repeat':
      return 'Repeat work item';
    case 'cancel':
      return 'Cancel work item';
  }
}

export function isPausedWorkflowWorkItem(
  workItem: DashboardWorkflowWorkItemRecord,
): boolean {
  return !Boolean(workItem.completed_at) && hasMetadataMarker(workItem.metadata, 'pause_requested_at');
}

function hasMetadataMarker(metadata: Record<string, unknown> | null | undefined, key: string): boolean {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim().length > 0;
}
