import type { DashboardWorkflowWorkItemRecord } from '../../lib/api.js';
import { normalizeTaskState } from '../work-shared/task-state.js';

import type {
  DashboardGroupedWorkItemRecord,
  DashboardWorkItemTaskRecord,
} from './workflow-work-item-detail-support.js';
export type {
  WorkItemRecoveryBrief,
  WorkItemRecoveryFact,
} from './workflow-work-item-detail-recovery.js';
export type {
  StructuredValueFact,
  StructuredValueSummary,
} from './workflow-work-item-detail-structured-value.js';
export { buildWorkItemRecoveryBrief } from './workflow-work-item-detail-recovery.js';
export { summarizeStructuredValue } from './workflow-work-item-detail-structured-value.js';

export interface MilestoneOperatorSummary {
  totalChildren: number;
  completedChildren: number;
  openChildren: number;
  awaitingStepDecisions: number;
  failedSteps: number;
  inFlightSteps: number;
  activeStageNames: string[];
  activeColumnIds: string[];
}

export interface WorkItemExecutionSummary {
  totalSteps: number;
  awaitingOperator: number;
  retryableSteps: number;
  activeSteps: number;
  completedSteps: number;
  distinctRoles: string[];
  distinctStages: string[];
}

export interface TaskOperatorPosture {
  title: string;
  detail: string;
  tone: 'destructive' | 'outline' | 'secondary' | 'success' | 'warning';
}

export function summarizeMilestoneOperatorFlow(
  children: DashboardGroupedWorkItemRecord[],
  tasks: DashboardWorkItemTaskRecord[],
): MilestoneOperatorSummary {
  const totalChildren = children.length;
  const completedChildren = children.filter((child) => Boolean(child.completed_at)).length;
  const openChildren = totalChildren - completedChildren;
  const awaitingStepDecisions = tasks.filter((task) => {
    const state = normalizeTaskState(task.state);
    return state === 'awaiting_approval' || state === 'output_pending_assessment';
  }).length;
  const failedSteps = tasks.filter((task) => {
    const state = normalizeTaskState(task.state);
    return state === 'failed' || state === 'escalated';
  }).length;
  const inFlightSteps = tasks.filter((task) => {
    const state = normalizeTaskState(task.state);
    return state === 'in_progress' || state === 'ready' || state === 'blocked';
  }).length;
  const activeStageNames = Array.from(
    new Set(
      children
        .map((child) => child.stage_name)
        .filter(
          (stageName): stageName is string => typeof stageName === 'string' && stageName.length > 0,
        ),
    ),
  );
  const activeColumnIds = Array.from(
    new Set(
      children
        .map((child) => child.column_id)
        .filter(
          (columnId): columnId is string => typeof columnId === 'string' && columnId.length > 0,
        ),
    ),
  );

  return {
    totalChildren,
    completedChildren,
    openChildren,
    awaitingStepDecisions,
    failedSteps,
    inFlightSteps,
    activeStageNames,
    activeColumnIds,
  };
}

export function summarizeWorkItemExecution(
  tasks: DashboardWorkItemTaskRecord[],
): WorkItemExecutionSummary {
  const distinctRoles = new Set<string>();
  const distinctStages = new Set<string>();
  let awaitingOperator = 0;
  let retryableSteps = 0;
  let activeSteps = 0;
  let completedSteps = 0;

  for (const task of tasks) {
    const state = normalizeTaskState(task.state);
    if (task.role) {
      distinctRoles.add(task.role);
    }
    if (task.stage_name) {
      distinctStages.add(task.stage_name);
    }
    if (state === 'awaiting_approval' || state === 'output_pending_assessment') {
      awaitingOperator += 1;
      continue;
    }
    if (state === 'failed' || state === 'escalated') {
      retryableSteps += 1;
      continue;
    }
    if (state === 'completed') {
      completedSteps += 1;
      continue;
    }
    if (state === 'in_progress' || state === 'ready' || state === 'blocked') {
      activeSteps += 1;
    }
  }

  return {
    totalSteps: tasks.length,
    awaitingOperator,
    retryableSteps,
    activeSteps,
    completedSteps,
    distinctRoles: Array.from(distinctRoles).sort((left, right) => left.localeCompare(right)),
    distinctStages: Array.from(distinctStages).sort((left, right) => left.localeCompare(right)),
  };
}

export function sortTasksForOperatorReview(
  tasks: DashboardWorkItemTaskRecord[],
): DashboardWorkItemTaskRecord[] {
  return [...tasks].sort((left, right) => {
    const postureDelta = readTaskUrgencyRank(left.state) - readTaskUrgencyRank(right.state);
    if (postureDelta !== 0) {
      return postureDelta;
    }
    const stageDelta = (left.stage_name ?? '').localeCompare(right.stage_name ?? '');
    if (stageDelta !== 0) {
      return stageDelta;
    }
    const titleDelta = left.title.localeCompare(right.title);
    if (titleDelta !== 0) {
      return titleDelta;
    }
    return left.id.localeCompare(right.id);
  });
}

export function describeTaskOperatorPosture(
  task: DashboardWorkItemTaskRecord,
): TaskOperatorPosture {
  switch (normalizeTaskState(task.state)) {
    case 'awaiting_approval':
      return {
        title: 'Approval needed',
        detail:
          'Approve or redirect this step from the work-item flow before the next stage can continue.',
        tone: 'warning',
      };
    case 'output_pending_assessment':
      return {
        title: 'Output decision needed',
        detail:
          'Assess or approve the specialist output from the work-item flow before the board can advance.',
        tone: 'warning',
      };
    case 'failed':
      return {
        title: 'Retry or rework available',
        detail:
          'This step failed; choose retry, rework, or escalation from the work-item flow before progress can continue.',
        tone: 'destructive',
      };
    case 'escalated':
      return {
        title: 'Escalation waiting',
        detail:
          'The step raised an escalation and needs explicit operator follow-up from the work-item flow.',
        tone: 'destructive',
      };
    case 'blocked':
      return {
        title: 'Blocked by dependencies',
        detail:
          'Resolve the upstream blocker or reroute the work item before execution can resume.',
        tone: 'warning',
      };
    case 'in_progress':
      return {
        title: 'Execution in flight',
        detail: 'A specialist is actively working this step right now.',
        tone: 'secondary',
      };
    case 'ready':
      return {
        title: 'Ready to start',
        detail: 'The step is queued and waiting for available execution capacity.',
        tone: 'outline',
      };
    case 'completed':
      return {
        title: 'Completed',
        detail: 'This step has finished and only needs follow-up if downstream work reopens it.',
        tone: 'success',
      };
    case 'cancelled':
      return {
        title: 'Cancelled',
        detail: 'This step will not run again unless it is recreated or retried from elsewhere.',
        tone: 'outline',
      };
    default:
      return {
        title: 'Execution state recorded',
        detail:
          'Stay in the work-item flow for board context, then open step diagnostics if you need execution detail.',
        tone: 'outline',
      };
  }
}

function readTaskUrgencyRank(state: DashboardWorkItemTaskRecord['state']): number {
  switch (normalizeTaskState(state)) {
    case 'awaiting_approval':
    case 'output_pending_assessment':
      return 0;
    case 'failed':
    case 'escalated':
      return 1;
    case 'blocked':
      return 2;
    case 'in_progress':
      return 3;
    case 'ready':
      return 4;
    case 'completed':
      return 5;
    case 'cancelled':
      return 6;
    default:
      return 7;
  }
}
