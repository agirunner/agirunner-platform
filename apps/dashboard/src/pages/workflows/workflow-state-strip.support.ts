import type {
  DashboardMissionControlWorkflowCard,
  DashboardWorkflowBoardResponse,
  DashboardWorkflowStickyStrip,
} from '../../lib/api.js';
import { formatRelativeTimestamp } from '../workflow-detail/workflow-detail-presentation.js';
import { isCompletedWorkItem } from './workflow-board.support.js';

export function buildWorkflowHeaderState(props: {
  workflow: DashboardMissionControlWorkflowCard;
  stickyStrip: DashboardWorkflowStickyStrip | null;
  board: DashboardWorkflowBoardResponse | null;
  addWorkLabel?: string | null;
}): {
  addWorkLabel: string;
  activeSpecialistTaskCount: number;
  canAddWork: boolean;
  effectiveWorkflowActions: DashboardMissionControlWorkflowCard['availableActions'];
  needsActionCount: number;
  playbookLabel: string | null;
  postureLabel: string;
  updatedLabel: string;
  workload: {
    activeWorkItemCount: number;
    completedWorkItemCount: number;
  };
} {
  const sticky = props.stickyStrip;
  const workflowScopedActions = props.workflow.availableActions.filter(
    (action) => action.scope === 'workflow' && action.kind !== 'redrive_workflow',
  );
  const shouldUseFallbackWorkflowActions =
    props.workflow.availableActions.length === 0 &&
    sticky?.posture !== 'cancelling' &&
    sticky?.posture !== 'cancelled';
  const effectiveWorkflowActions =
    workflowScopedActions.length > 0
      ? workflowScopedActions
      : shouldUseFallbackWorkflowActions
        ? buildFallbackWorkflowActions(props.workflow.state)
        : [];
  const workload = summarizeWorkload(props.board, props.workflow);
  const playbookLabel = readOptionalSummary(props.workflow.playbookName);
  const updatedLabel = `Updated ${formatRelativeTimestamp(props.workflow.metrics.lastChangedAt)}`;
  const canAddWork = workflowScopedActions.some(
    (action) => action.kind === 'add_work_item' && action.enabled,
  );
  const postureLabel = humanizePosture(sticky?.posture ?? props.workflow.posture);
  const isOngoingWorkflow = props.workflow.lifecycle === 'ongoing';
  const addWorkLabel = props.addWorkLabel ?? (isOngoingWorkflow ? 'Add Intake' : 'Add Work');
  const needsActionCount = readNeedsActionCount(sticky);
  const activeSpecialistTaskCount = sticky?.active_task_count ?? props.workflow.metrics.activeTaskCount;

  return {
    addWorkLabel,
    activeSpecialistTaskCount,
    canAddWork,
    effectiveWorkflowActions,
    needsActionCount,
    playbookLabel,
    postureLabel,
    updatedLabel,
    workload,
  };
}

export function summarizeWorkload(
  board: DashboardWorkflowBoardResponse | null,
  workflow: DashboardMissionControlWorkflowCard,
): {
  activeWorkItemCount: number;
  completedWorkItemCount: number;
} {
  if (!board) {
    return {
      activeWorkItemCount: workflow.metrics.activeWorkItemCount,
      completedWorkItemCount: 0,
    };
  }

  return {
    activeWorkItemCount: board.work_items.filter(
      (workItem) => !isCompletedWorkItem(board.columns, workItem),
    ).length,
    completedWorkItemCount: board.work_items.filter((workItem) =>
      isCompletedWorkItem(board.columns, workItem),
    ).length,
  };
}

export function formatNeedsActionDetail(
  sticky: DashboardWorkflowStickyStrip | null,
): string | null {
  const segments = [
    formatCountSegment(sticky?.approvals_count ?? 0, 'approval'),
    formatCountSegment(sticky?.escalations_count ?? 0, 'escalation'),
  ].filter((segment): segment is string => Boolean(segment));

  if (segments.length === 0) {
    return 'No unresolved approvals or escalations';
  }

  return segments.join(' • ');
}

export function buildFallbackWorkflowActions(
  workflowState: string | null | undefined,
): DashboardMissionControlWorkflowCard['availableActions'] {
  if (workflowState === 'paused') {
    return [
      createFallbackWorkflowAction('resume_workflow'),
      createFallbackWorkflowAction('cancel_workflow'),
    ];
  }
  if (workflowState === 'active') {
    return [
      createFallbackWorkflowAction('pause_workflow'),
      createFallbackWorkflowAction('cancel_workflow'),
    ];
  }
  if (workflowState === 'pending') {
    return [createFallbackWorkflowAction('cancel_workflow')];
  }
  return [];
}

export function readWorkflowStateDetail(
  summary: string | null | undefined,
  postureLabel: string,
): string | null {
  const detail = readOptionalSummary(summary);
  if (!detail) {
    return null;
  }
  const normalized = detail.trim().toLowerCase();
  if (normalized === 'workflow is waiting by design') {
    return null;
  }
  if (normalized === postureLabel.trim().toLowerCase()) {
    return null;
  }
  return truncateDetail(detail);
}

export function formatWorkItemDetail(input: {
  activeWorkItemCount: number;
  completedWorkItemCount: number;
}): string | null {
  if (input.completedWorkItemCount > 0) {
    return `${input.completedWorkItemCount} completed`;
  }
  if (input.activeWorkItemCount > 0) {
    return 'In active lanes';
  }
  return 'No active work items';
}

export function formatSpecialistTaskDetail(input: {
  activeSpecialistTaskCount: number;
  activeWorkItemCount: number;
  lifecycle: string | null;
  posture: string | null;
}): string | null {
  if (input.activeWorkItemCount === 0 && input.activeSpecialistTaskCount > 0) {
    return 'Orchestrating workflow setup';
  }
  if (
    input.activeSpecialistTaskCount === 0 &&
    (input.lifecycle === 'ongoing' || input.posture === 'waiting_by_design')
  ) {
    return 'Routing next step';
  }
  if (input.activeSpecialistTaskCount === 0) {
    return 'No active tasks';
  }
  return `${input.activeSpecialistTaskCount} active task${
    input.activeSpecialistTaskCount === 1 ? '' : 's'
  }`;
}

export function readNeedsActionCount(sticky: DashboardWorkflowStickyStrip | null): number {
  return (sticky?.approvals_count ?? 0) + (sticky?.escalations_count ?? 0);
}

function readOptionalSummary(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatCountSegment(count: number, singularLabel: string): string | null {
  if (count <= 0) {
    return null;
  }
  return `${count} ${singularLabel}${count === 1 ? '' : 's'}`;
}

function truncateDetail(value: string): string {
  return value.length <= 72 ? value : `${value.slice(0, 69)}...`;
}

function humanizePosture(value: string | null | undefined): string {
  if (!value) {
    return 'Workflow';
  }
  if (value === 'waiting_by_design') {
    return 'Waiting for Work';
  }
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function createFallbackWorkflowAction(
  kind: 'pause_workflow' | 'resume_workflow' | 'cancel_workflow',
): DashboardMissionControlWorkflowCard['availableActions'][number] {
  return {
    kind,
    scope: 'workflow',
    enabled: true,
    confirmationLevel: kind === 'cancel_workflow' ? 'high_impact_confirm' : 'immediate',
    stale: false,
    disabledReason: null,
  };
}
