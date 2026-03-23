import type {
  DashboardEventRecord,
  DashboardWorkflowRelationRef,
  DashboardWorkflowWorkItemRecord,
} from '../../lib/api.js';
import type { DashboardWorkflowTaskRow } from './workflow-detail-support.js';
import {
  buildBudgetSummary,
  buildMovementSummary,
  capitalizeToken,
  humanizeToken,
  readString,
} from './workflow-history-card.narrative.helpers.js';

export interface TimelineEventNarrative {
  actionLabel: string;
  headline: string;
  outcomeLabel: string | null;
  summary: string | null;
}

export function describeEventNarrative(
  event: DashboardEventRecord,
  input: {
    nextState: string | null;
    objectLabel: string | null;
    stageName: string | null;
    task: DashboardWorkflowTaskRow | null;
    workItem: DashboardWorkflowWorkItemRecord | null;
    childWorkflow: DashboardWorkflowRelationRef | null;
  },
): TimelineEventNarrative {
  switch (event.type) {
    case 'workflow.created':
      return packet('Board run created', 'started the board run', 'The board run is now live.');
    case 'workflow.activation_queued':
      return packet(
        'Orchestrator wake-up queued',
        'queued an orchestrator activation',
        readString(event.data?.reason) ?? 'Queued workflow activity is waiting for orchestrator attention.',
      );
    case 'workflow.activation_started':
      return packet(
        'Orchestrator activation started',
        'started an orchestrator activation',
        readString(event.data?.activation_id)
          ? `Activation ${readString(event.data?.activation_id)} is now processing the queue.`
          : 'The orchestrator is processing queued workflow activity.',
      );
    case 'workflow.state_changed':
      return packet(
        input.nextState ? `Workflow moved to ${humanizeToken(input.nextState)}` : 'Workflow state changed',
        input.nextState ? `moved the board run to ${humanizeToken(input.nextState)}` : 'changed the board state',
        readString(event.data?.reason),
      );
    case 'workflow.completed':
      return packet('Workflow completed', 'completed the board run', readString(event.data?.summary));
    case 'workflow.cancelled':
      return packet('Workflow cancelled', 'cancelled the board run', readString(event.data?.reason));
    case 'work_item.created':
      return packet(
        input.workItem?.title ? `Created work item ${input.workItem.title}` : 'Created work item',
        'opened work item',
        readString(event.data?.goal) ?? readString(event.data?.notes),
      );
    case 'work_item.updated':
      return packet(
        input.workItem?.title ? `Updated work item ${input.workItem.title}` : 'Updated work item',
        'updated work item',
        readString(event.data?.summary) ?? readString(event.data?.notes),
      );
    case 'work_item.moved':
      return packet(
        input.workItem?.title ? `Moved work item ${input.workItem.title}` : 'Moved work item',
        'moved work item',
        buildMovementSummary(event.data, input.stageName),
      );
    case 'work_item.reparented':
      return packet(
        input.workItem?.title ? `Reparented work item ${input.workItem.title}` : 'Reparented work item',
        'reparented work item',
        readString(event.data?.parent_work_item_title) ?? 'The work item now rolls up under a different milestone.',
      );
    case 'work_item.completed':
      return packet(
        input.workItem?.title ? `Completed work item ${input.workItem.title}` : 'Completed work item',
        'completed work item',
        readString(event.data?.summary),
      );
    case 'task.created':
      return packet(
        input.objectLabel ? `Queued step ${input.objectLabel}` : 'Queued specialist step',
        'assigned specialist step',
        readString(event.data?.role) ?? readString(event.data?.assigned_role),
      );
    case 'task.completed':
      return packet(
        input.objectLabel ? `Completed step ${input.objectLabel}` : 'Completed specialist step',
        'completed specialist step',
        readString(event.data?.summary) ?? readString(event.data?.role),
      );
    case 'task.failed':
      return packet(
        input.objectLabel ? `Step failed: ${input.objectLabel}` : 'Specialist step failed',
        'reported a failed specialist step',
        readString(event.data?.error) ?? readString(event.data?.message),
      );
    case 'task.escalated':
      return packet(
        input.objectLabel ? `Escalated step ${input.objectLabel}` : 'Specialist step escalated',
        'escalated specialist step',
        readString(event.data?.reason),
      );
    case 'stage.started':
      return packet(
        input.stageName ? `Started stage ${input.stageName}` : 'Started workflow stage',
        'started stage',
        readString(event.data?.goal) ?? readString(event.data?.summary),
      );
    case 'stage.completed':
      return packet(
        input.stageName ? `Completed stage ${input.stageName}` : 'Completed workflow stage',
        'completed stage',
        readString(event.data?.summary),
      );
    case 'stage.gate_requested':
      return packet(
        input.stageName ? `Requested gate for ${input.stageName}` : 'Requested stage gate',
        'requested a gate decision',
        readString(event.data?.recommendation) ?? readString(event.data?.request_summary),
      );
    case 'stage.gate.approve':
      return packet(
        input.stageName ? `Approved gate for ${input.stageName}` : 'Approved stage gate',
        'approved the gate',
        readString(event.data?.feedback),
      );
    case 'stage.gate.reject':
      return packet(
        input.stageName ? `Rejected gate for ${input.stageName}` : 'Rejected stage gate',
        'rejected the gate',
        readString(event.data?.feedback),
      );
    case 'stage.gate.request_changes':
      return packet(
        input.stageName ? `Request changes gate for ${input.stageName}` : 'Request changes stage gate',
        'requested changes on the gate',
        readString(event.data?.feedback),
      );
    case 'budget.warning':
      return packet('Workflow budget warning', 'raised a budget warning', buildBudgetSummary(event.data, 'warning'));
    case 'budget.exceeded':
      return packet('Workflow budget exceeded', 'reported a budget exceedance', buildBudgetSummary(event.data, 'exceeded'));
    case 'child_workflow.completed':
      return packet(
        input.objectLabel ? `Child board completed: ${input.objectLabel}` : 'Child board completed',
        'completed child board',
        readString(event.data?.summary),
      );
    case 'child_workflow.failed':
      return packet(
        input.objectLabel ? `Child board failed: ${input.objectLabel}` : 'Child board failed',
        'failed child board',
        readString(event.data?.error) ?? readString(event.data?.reason),
      );
    default:
      return packet(
        capitalizeToken(event.type),
        humanizeToken(event.type),
        readString(event.data?.summary) ?? readString(event.data?.reason),
      );
  }
}

function packet(
  headline: string,
  actionLabel: string,
  summary: string | null,
): TimelineEventNarrative {
  return { actionLabel, headline, outcomeLabel: summary, summary };
}
