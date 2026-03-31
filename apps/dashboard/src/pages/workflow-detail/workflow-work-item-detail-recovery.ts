import type { DashboardWorkflowWorkItemRecord } from '../../lib/api.js';

import type {
  DashboardGroupedWorkItemRecord,
  DashboardWorkItemTaskRecord,
} from './workflow-work-item-detail-support.js';
import type {
  MilestoneOperatorSummary,
  TaskOperatorPosture,
  WorkItemExecutionSummary,
} from './workflow-work-item-detail-summary.js';

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
