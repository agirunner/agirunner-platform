import type {
  DashboardEventRecord,
  DashboardWorkflowActivationRecord,
  DashboardWorkflowRelationRef,
  DashboardWorkflowStageRecord,
  DashboardWorkflowWorkItemRecord,
} from '../lib/api.js';
import type { DashboardWorkflowTaskRow } from './workflow-detail-support.js';
import {
  capitalizeToken,
  describeTimelineEmphasisLabel,
  describeTimelineEmphasisTone,
  humanizeToken,
  isNonEmptyString,
  readString,
  readStringArray,
} from './workflow-history-card.narrative.helpers.js';
import { describeEventNarrative } from './workflow-history-card.narrative.events.js';

export interface TimelineLookupContext {
  activationsById: Map<string, DashboardWorkflowActivationRecord>;
  childWorkflowsById: Map<string, DashboardWorkflowRelationRef>;
  stagesByName: Map<string, DashboardWorkflowStageRecord>;
  tasksById: Map<string, DashboardWorkflowTaskRow>;
  workItemsById: Map<string, DashboardWorkflowWorkItemRecord>;
}

export interface TimelineDescriptor {
  actionLabel: string;
  activationId: string | null;
  actor: string | null;
  actorLabel: string;
  childWorkflowHref: string | null;
  childWorkflowId: string | null;
  emphasisLabel: string;
  emphasisTone: 'secondary' | 'warning' | 'destructive' | 'success';
  gateStageName: string | null;
  headline: string;
  narrativeHeadline: string;
  objectLabel: string | null;
  outcomeLabel: string | null;
  scopeSummary: string | null;
  signalBadges: string[];
  stageName: string | null;
  summary: string | null;
  taskId: string | null;
  workItemId: string | null;
  workItemLabel: string | null;
}

const emptyContext: TimelineLookupContext = {
  activationsById: new Map(),
  childWorkflowsById: new Map(),
  stagesByName: new Map(),
  tasksById: new Map(),
  workItemsById: new Map(),
};

export function buildTimelineContext(input: {
  activations: DashboardWorkflowActivationRecord[];
  childWorkflows: DashboardWorkflowRelationRef[];
  stages: DashboardWorkflowStageRecord[];
  tasks: DashboardWorkflowTaskRow[];
  workItems: DashboardWorkflowWorkItemRecord[];
}): TimelineLookupContext {
  return {
    activationsById: new Map(
      input.activations.flatMap((activation) => {
        const ids = new Set([activation.id, activation.activation_id].filter(isNonEmptyString));
        return Array.from(ids).map((id) => [id, activation] as const);
      }),
    ),
    childWorkflowsById: new Map(
      input.childWorkflows.map((workflow) => [workflow.workflow_id, workflow] as const),
    ),
    stagesByName: new Map(input.stages.map((stage) => [stage.name, stage] as const)),
    tasksById: new Map(input.tasks.map((task) => [task.id, task] as const)),
    workItemsById: new Map(input.workItems.map((workItem) => [workItem.id, workItem] as const)),
  };
}

export function describeTimelineEvent(
  event: DashboardEventRecord,
  context: TimelineLookupContext = emptyContext,
): TimelineDescriptor {
  const taskId = resolveTaskId(event, context);
  const task = taskId ? context.tasksById.get(taskId) ?? null : null;
  const workItemId = resolveWorkItemId(event, task);
  const workItem = workItemId ? context.workItemsById.get(workItemId) ?? null : null;
  const stageName = resolveStageName(event, task, workItem);
  const activationId = readString(event.data?.activation_id) ?? null;
  const childWorkflowId = readString(event.data?.child_workflow_id) ?? null;
  const childWorkflow = childWorkflowId
    ? context.childWorkflowsById.get(childWorkflowId) ?? null
    : null;
  const actorLabel = describeActorLabel(event, task);
  const objectLabel = describeObjectLabel(event, task, workItem, stageName, childWorkflow);
  const nextState = readString(event.data?.to_state) ?? readString(event.data?.state) ?? null;
  const descriptorBase = describeEventNarrative(event, {
    childWorkflow,
    nextState,
    objectLabel,
    stageName,
    task,
    workItem,
  });

  return {
    actionLabel: descriptorBase.actionLabel,
    activationId,
    actor: actorLabel,
    actorLabel,
    childWorkflowHref: childWorkflow?.link ?? null,
    childWorkflowId,
    emphasisLabel: describeTimelineEmphasisLabel(event.type),
    emphasisTone: describeTimelineEmphasisTone(event.type),
    gateStageName: event.type.startsWith('stage.gate') ? stageName : null,
    headline: descriptorBase.headline,
    narrativeHeadline: buildNarrativeHeadline(actorLabel, descriptorBase.actionLabel, objectLabel),
    objectLabel,
    outcomeLabel: descriptorBase.outcomeLabel,
    scopeSummary: buildScopeSummary({
      actorLabel,
      activationId,
      childWorkflowName: childWorkflow?.name ?? null,
      stageName,
      task,
      taskId,
      workItem,
      workItemId,
    }),
    signalBadges: readTimelineSignalBadges(event, task),
    stageName,
    summary: descriptorBase.summary,
    taskId,
    workItemId,
    workItemLabel: workItem?.title ?? readString(event.data?.work_item_title) ?? null,
  };
}

function buildNarrativeHeadline(
  actorLabel: string,
  actionLabel: string,
  objectLabel: string | null,
): string {
  return objectLabel ? `${actorLabel} ${actionLabel} ${objectLabel}` : `${actorLabel} ${actionLabel}`;
}

function buildScopeSummary(input: {
  actorLabel: string;
  activationId: string | null;
  childWorkflowName: string | null;
  stageName: string | null;
  task: DashboardWorkflowTaskRow | null;
  taskId: string | null;
  workItem: DashboardWorkflowWorkItemRecord | null;
  workItemId: string | null;
}): string | null {
  const parts = [
    `Actor ${input.actorLabel}`,
    input.stageName ? `Stage ${input.stageName}` : null,
    input.workItem?.title
      ? `Work item ${input.workItem.title}`
      : input.workItemId
        ? `Work item ${input.workItemId.slice(0, 8)}`
        : null,
    input.task?.title
      ? `Step ${input.task.title}`
      : input.taskId
        ? `Step ${input.taskId.slice(0, 8)}`
        : null,
    input.activationId ? `Activation ${input.activationId.slice(0, 8)}` : null,
    input.childWorkflowName ? `Child board ${input.childWorkflowName}` : null,
  ].filter(isNonEmptyString);
  return parts.length > 0 ? parts.join(' • ') : null;
}

function describeActorLabel(
  event: DashboardEventRecord,
  task: DashboardWorkflowTaskRow | null,
): string {
  if (event.actor_type === 'orchestrator') return 'Orchestrator';
  if (event.actor_type === 'operator') return 'Operator';
  if (event.actor_type === 'system') return 'System';
  if (event.actor_type === 'task') {
    const role = readString(task?.role) ?? readString(event.data?.role) ?? readString(event.data?.assigned_role);
    return role ? `${capitalizeToken(role)} specialist` : 'Specialist';
  }
  const actorType = capitalizeToken(event.actor_type);
  const actorId = readString(event.actor_id);
  return actorId ? `${actorType} ${actorId}` : actorType;
}

function describeObjectLabel(
  event: DashboardEventRecord,
  task: DashboardWorkflowTaskRow | null,
  workItem: DashboardWorkflowWorkItemRecord | null,
  stageName: string | null,
  childWorkflow: DashboardWorkflowRelationRef | null,
): string | null {
  if (event.type.startsWith('work_item.')) return workItem?.title ?? readString(event.data?.work_item_title);
  if (event.type.startsWith('task.')) return task?.title ?? readString(event.data?.task_title) ?? readString(event.data?.role);
  if (event.type.startsWith('stage.')) return stageName;
  if (event.type.startsWith('child_workflow.')) return childWorkflow?.name ?? readString(event.data?.child_workflow_name);
  return null;
}

function resolveTaskId(
  event: DashboardEventRecord,
  context: TimelineLookupContext,
): string | null {
  const taskId =
    readString(event.data?.task_id) ??
    (event.entity_type === 'task' ? event.entity_id : null) ??
    (event.actor_type === 'task' ? readString(event.actor_id) : null);
  if (!taskId) return null;
  return context.tasksById.has(taskId) || taskId.length > 0 ? taskId : null;
}

function resolveWorkItemId(
  event: DashboardEventRecord,
  task: DashboardWorkflowTaskRow | null,
): string | null {
  return readString(event.data?.work_item_id) ?? readString(task?.work_item_id) ?? null;
}

function resolveStageName(
  event: DashboardEventRecord,
  task: DashboardWorkflowTaskRow | null,
  workItem: DashboardWorkflowWorkItemRecord | null,
): string | null {
  return readString(event.data?.stage_name) ?? readString(task?.stage_name) ?? readString(workItem?.stage_name) ?? null;
}

function readTimelineSignalBadges(
  event: DashboardEventRecord,
  task: DashboardWorkflowTaskRow | null,
): string[] {
  const badges: string[] = [];
  const role = readString(task?.role) ?? readString(event.data?.role) ?? readString(event.data?.assigned_role);
  if (role) badges.push(role);
  if (event.type.startsWith('stage.gate.')) badges.push('Operator decision');
  if (event.type === 'stage.gate_requested') badges.push('Awaiting review');
  if (event.type.startsWith('budget.')) {
    for (const dimension of readStringArray(event.data?.dimensions)) {
      badges.push(`${capitalizeToken(dimension)} guardrail`);
    }
  }
  return badges;
}
