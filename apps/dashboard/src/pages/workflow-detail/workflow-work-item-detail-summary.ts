import type { DashboardWorkflowWorkItemRecord } from '../../lib/api.js';
import { normalizeTaskState } from '../../lib/task-state.js';

import type {
  DashboardGroupedWorkItemRecord,
  DashboardWorkItemTaskRecord,
} from './workflow-work-item-detail-support.js';
export type {
  StructuredValueFact,
  StructuredValueSummary,
} from './workflow-work-item-detail-structured-value.js';
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

export interface WorkItemRecoveryFact {
  label: string;
  value: string;
}

export interface WorkItemRecoveryBrief {
  title: string;
  summary: string;
  tone: TaskOperatorPosture['tone'];
  badge: string;
  facts: WorkItemRecoveryFact[];
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

export function buildWorkItemRecoveryBrief(input: {
  workItem: DashboardGroupedWorkItemRecord | DashboardWorkflowWorkItemRecord;
  executionSummary: WorkItemExecutionSummary;
  milestoneSummary?: MilestoneOperatorSummary | null;
}): WorkItemRecoveryBrief {
  const milestone = isMilestoneRecord(input.workItem);
  const facts = buildRecoveryFacts(input.workItem, input.executionSummary, input.milestoneSummary);

  if (input.workItem.completed_at) {
    return {
      title: 'Work item is already closed',
      summary:
        'Keep this packet available for reference, but only reopen routing or notes if downstream recovery or follow-up work reactivates it.',
      tone: 'success',
      badge: 'Closed',
      facts,
    };
  }

  if (milestone && (input.milestoneSummary?.totalChildren ?? 0) === 0) {
    return {
      title: 'Break this milestone into child work items',
      summary:
        'Milestones only become actionable once they carry child work. Create at least one child item before expecting specialist execution to show up here.',
      tone: 'warning',
      badge: 'Needs decomposition',
      facts,
    };
  }

  if (input.executionSummary.retryableSteps > 0) {
    return {
      title: 'Recover failed execution first',
      summary: `${describeCount(
        input.executionSummary.retryableSteps,
        'linked step',
      )} failed or escalated. Retry, rework, or resolve the escalation before changing lower-risk routing or notes.`,
      tone: 'destructive',
      badge: 'Recovery blocking',
      facts,
    };
  }

  if (input.executionSummary.awaitingOperator > 0) {
    return {
      title: 'Finish operator decisions before reshaping the flow',
      summary: `${describeCount(
        input.executionSummary.awaitingOperator,
        'linked step',
      )} waiting on approval or assessment decisions. Clear those decisions before changing ownership or board placement.`,
      tone: 'warning',
      badge: 'Decision required',
      facts,
    };
  }

  if (!hasText(input.workItem.stage_name) || !hasText(input.workItem.column_id)) {
    const missingTargets = [
      hasText(input.workItem.stage_name) ? null : 'stage routing',
      hasText(input.workItem.column_id) ? null : 'board placement',
    ].filter((value): value is string => value !== null);
    return {
      title: 'Restore board routing',
      summary: `This work item is missing ${missingTargets.join(
        ' and ',
      )}. Set both so operators and specialists stay aligned on where this packet belongs.`,
      tone: 'warning',
      badge: 'Routing incomplete',
      facts,
    };
  }

  if (input.executionSummary.activeSteps > 0) {
    return {
      title: 'Monitor active execution',
      summary: `${describeCount(
        input.executionSummary.activeSteps,
        'linked step',
      )} still ready, blocked, or in progress. Keep the brief current, but avoid disruptive rerouting unless recovery becomes necessary.`,
      tone: 'secondary',
      badge: 'Execution active',
      facts,
    };
  }

  if (input.executionSummary.totalSteps === 0) {
    return {
      title: 'No linked specialist steps yet',
      summary:
        'Keep the brief, routing, and owner role current. The orchestrator can only schedule new execution once this packet is specific enough to act on.',
      tone: 'outline',
      badge: 'Waiting for scheduling',
      facts,
    };
  }

  if (milestone && (input.milestoneSummary?.openChildren ?? 0) > 0) {
    return {
      title: 'Milestone child work is still open',
      summary: `${describeCount(
        input.milestoneSummary?.openChildren ?? 0,
        'child work item',
      )} remain open. Keep routing and ownership aligned here while downstream delivery finishes.`,
      tone: 'outline',
      badge: 'Children open',
      facts,
    };
  }

  if (
    input.executionSummary.totalSteps > 0 &&
    input.executionSummary.completedSteps === input.executionSummary.totalSteps
  ) {
    return {
      title: 'Execution packet looks complete',
      summary:
        'All linked specialist steps are complete. Review artifacts and brief context here, then wait for the board to close this work item or open explicit follow-up work.',
      tone: 'success',
      badge: 'Ready for closure',
      facts,
    };
  }

  return {
    title: 'Keep board context current',
    summary:
      'The work item is stable right now. Keep the brief and routing accurate here, then use individual step controls only when the packet needs intervention.',
    tone: 'outline',
    badge: 'Stable',
    facts,
  };
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

function buildRecoveryFacts(
  workItem: DashboardGroupedWorkItemRecord | DashboardWorkflowWorkItemRecord,
  executionSummary: WorkItemExecutionSummary,
  milestoneSummary?: MilestoneOperatorSummary | null,
): WorkItemRecoveryFact[] {
  return [
    {
      label: 'Board routing',
      value: [
        formatRoutingValue(workItem.stage_name, 'Missing stage'),
        formatRoutingValue(workItem.column_id, 'Missing board column'),
      ].join(' / '),
    },
    {
      label: 'Owner role',
      value: formatRoutingValue(workItem.owner_role, 'Unassigned'),
    },
    {
      label: 'Pending decisions',
      value:
        executionSummary.awaitingOperator > 0
          ? `${describeCount(executionSummary.awaitingOperator, 'step')} waiting`
          : 'No decisions waiting',
    },
    milestoneSummary
      ? {
          label: 'Milestone scope',
          value: `${milestoneSummary.openChildren} open / ${milestoneSummary.totalChildren} child items`,
        }
      : {
          label: 'Execution coverage',
          value:
            executionSummary.totalSteps > 0
              ? `${executionSummary.activeSteps} active / ${executionSummary.completedSteps} complete`
              : 'No linked specialist steps',
        },
  ];
}

function describeCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function formatRoutingValue(value: string | null | undefined, fallback: string): string {
  return hasText(value) ? value.trim() : fallback;
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isMilestoneRecord(
  workItem: DashboardGroupedWorkItemRecord | DashboardWorkflowWorkItemRecord | null | undefined,
): boolean {
  if (!workItem) {
    return false;
  }
  return (
    (workItem.children?.length ?? 0) > 0 ||
    (workItem.children_count ?? 0) > 0 ||
    workItem.is_milestone === true
  );
}
