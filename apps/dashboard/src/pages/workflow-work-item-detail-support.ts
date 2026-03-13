import type {
  DashboardEventRecord,
  DashboardTaskArtifactRecord,
  DashboardWorkItemMemoryEntry,
  DashboardWorkItemMemoryHistoryEntry,
  DashboardWorkflowWorkItemRecord,
} from '../lib/api.js';
import { normalizeTaskState } from '../lib/task-state.js';

export interface DashboardWorkItemTaskRecord {
  id: string;
  title: string;
  state: string;
  role: string | null;
  stage_name: string | null;
  work_item_id: string | null;
  created_at?: string;
  completed_at: string | null;
  depends_on: string[];
}

export interface DashboardWorkItemArtifactRecord extends DashboardTaskArtifactRecord {
  task_title: string;
}

export interface DashboardGroupedWorkItemRecord extends DashboardWorkflowWorkItemRecord {
  children_count?: number;
  children_completed?: number;
  is_milestone?: boolean;
  children?: DashboardGroupedWorkItemRecord[];
}

export interface MilestoneOperatorSummary {
  totalChildren: number;
  completedChildren: number;
  openChildren: number;
  awaitingStepReviews: number;
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

export interface StructuredValueFact {
  label: string;
  value: string;
}

export interface StructuredValueSummary {
  hasValue: boolean;
  shapeLabel: string;
  detail: string;
  keyHighlights: string[];
  scalarFacts: StructuredValueFact[];
}

export interface TaskOperatorPosture {
  title: string;
  detail: string;
  tone: 'destructive' | 'outline' | 'secondary' | 'success' | 'warning';
}

export function normalizeWorkItemTasks(response: unknown): DashboardWorkItemTaskRecord[] {
  const records = Array.isArray(asWrappedList(response)) ? asWrappedList(response) : [];
  const normalized: DashboardWorkItemTaskRecord[] = [];
  for (const record of records) {
    const item = asRecord(record);
    const id = readString(item.id);
    if (!id) {
      continue;
    }
    normalized.push({
      id,
      title: readString(item.title) ?? readString(item.name) ?? id,
      state: normalizeTaskState(readString(item.state) ?? readString(item.status) ?? 'unknown'),
      role: readString(item.role) ?? null,
      stage_name: readString(item.stage_name) ?? null,
      work_item_id: readString(item.work_item_id) ?? null,
      created_at: readString(item.created_at),
      completed_at: readString(item.completed_at) ?? null,
      depends_on: readStringArray(item.depends_on),
    });
  }
  return normalized;
}

export function selectTasksForWorkItem(
  tasks: DashboardWorkItemTaskRecord[],
  workItemId: string,
  workItems?: DashboardGroupedWorkItemRecord[],
): DashboardWorkItemTaskRecord[] {
  const relatedIds = new Set([workItemId]);
  const selectedItem = workItems ? findWorkItemById(workItems, workItemId) : null;
  for (const child of selectedItem?.children ?? []) {
    relatedIds.add(child.id);
  }
  return tasks.filter((task) => task.work_item_id && relatedIds.has(task.work_item_id));
}

export function groupWorkflowWorkItems(
  workItems: DashboardWorkflowWorkItemRecord[],
): DashboardGroupedWorkItemRecord[] {
  const grouped = new Map<string, DashboardGroupedWorkItemRecord>();
  const roots: DashboardGroupedWorkItemRecord[] = [];

  for (const item of workItems) {
    grouped.set(item.id, { ...item, children: [] });
  }

  for (const item of grouped.values()) {
    const parentId = item.parent_work_item_id ?? null;
    if (!parentId) {
      roots.push(item);
      continue;
    }
    const parent = grouped.get(parentId);
    if (!parent) {
      roots.push(item);
      continue;
    }
    parent.children = [...(parent.children ?? []), item];
  }

  return roots;
}

export function flattenGroupedWorkItems(
  workItems: DashboardGroupedWorkItemRecord[],
): DashboardGroupedWorkItemRecord[] {
  const flattened: DashboardGroupedWorkItemRecord[] = [];
  for (const item of workItems) {
    flattened.push(item);
    flattened.push(...(item.children ?? []));
  }
  return flattened;
}

export function findWorkItemById(
  workItems: DashboardGroupedWorkItemRecord[],
  workItemId: string,
): DashboardGroupedWorkItemRecord | null {
  for (const item of workItems) {
    if (item.id === workItemId) {
      return item;
    }
    for (const child of item.children ?? []) {
      if (child.id === workItemId) {
        return child;
      }
    }
  }
  return null;
}

export function buildWorkItemBreadcrumbs(
  workItems: DashboardGroupedWorkItemRecord[],
  workItemId: string,
): string[] {
  const index = buildWorkItemIndex(workItems);
  const breadcrumbs: string[] = [];
  const visited = new Set<string>();
  let currentId: string | null = workItemId;

  while (currentId) {
    if (visited.has(currentId)) {
      break;
    }
    visited.add(currentId);
    const current = index.get(currentId);
    if (!current) {
      break;
    }
    breadcrumbs.unshift(current.title);
    currentId = current.parent_work_item_id ?? null;
  }

  return breadcrumbs;
}

export function isMilestoneWorkItem(workItem: DashboardGroupedWorkItemRecord | null | undefined): boolean {
  if (!workItem) {
    return false;
  }
  return (workItem.children?.length ?? 0) > 0 || (workItem.children_count ?? 0) > 0 || workItem.is_milestone === true;
}

export function summarizeMilestoneOperatorFlow(
  children: DashboardGroupedWorkItemRecord[],
  tasks: DashboardWorkItemTaskRecord[],
): MilestoneOperatorSummary {
  const totalChildren = children.length;
  const completedChildren = children.filter((child) => Boolean(child.completed_at)).length;
  const openChildren = totalChildren - completedChildren;
  const awaitingStepReviews = tasks.filter((task) => {
    const state = normalizeTaskState(task.state);
    return state === 'awaiting_approval' || state === 'output_pending_review';
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
        .filter((stageName): stageName is string => typeof stageName === 'string' && stageName.length > 0),
    ),
  );
  const activeColumnIds = Array.from(
    new Set(
      children
        .map((child) => child.column_id)
        .filter((columnId): columnId is string => typeof columnId === 'string' && columnId.length > 0),
    ),
  );

  return {
    totalChildren,
    completedChildren,
    openChildren,
    awaitingStepReviews,
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
    if (state === 'awaiting_approval' || state === 'output_pending_review') {
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
        detail: 'Approve or redirect this step from the work-item flow before the next stage can continue.',
        tone: 'warning',
      };
    case 'output_pending_review':
      return {
        title: 'Output review needed',
        detail: 'Review the specialist output from the work-item flow before the board can advance.',
        tone: 'warning',
      };
    case 'failed':
      return {
        title: 'Retry or rework available',
        detail: 'This step failed; choose retry, rework, or escalation from the work-item flow before progress can continue.',
        tone: 'destructive',
      };
    case 'escalated':
      return {
        title: 'Escalation waiting',
        detail: 'The step raised an escalation and needs explicit operator follow-up from the work-item flow.',
        tone: 'destructive',
      };
    case 'blocked':
      return {
        title: 'Blocked by dependencies',
        detail: 'Resolve the upstream blocker or reroute the work item before execution can resume.',
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
        detail: 'Stay in the work-item flow for board context, then open step diagnostics if you need runtime detail.',
        tone: 'outline',
      };
  }
}

export function summarizeStructuredValue(value: unknown): StructuredValueSummary {
  if (typeof value === 'undefined') {
    return {
      hasValue: false,
      shapeLabel: 'No packet',
      detail: 'No structured data recorded.',
      keyHighlights: [],
      scalarFacts: [],
    };
  }

  if (Array.isArray(value)) {
    return {
      hasValue: true,
      shapeLabel: `${value.length} item${value.length === 1 ? '' : 's'}`,
      detail: value.length > 0 ? 'Ordered list payload.' : 'Empty list payload.',
      keyHighlights: [],
      scalarFacts: [],
    };
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort((left, right) => left.localeCompare(right));
    const scalarFacts = keys
      .filter((key) => isScalarValue(record[key]))
      .slice(0, 4)
      .map((key) => ({
        label: formatFactLabel(key),
        value: formatFactValue(record[key]),
      }));

    return {
      hasValue: true,
      shapeLabel: `${keys.length} field${keys.length === 1 ? '' : 's'}`,
      detail:
        keys.length > 0
          ? `Includes ${keys.slice(0, 4).map((key) => formatFactLabel(key)).join(', ')}.`
          : 'Empty structured payload.',
      keyHighlights: keys.slice(0, 6).map((key) => formatFactLabel(key)),
      scalarFacts,
    };
  }

  return {
    hasValue: true,
    shapeLabel: scalarShapeLabel(value),
    detail: 'Inline scalar payload.',
    keyHighlights: [],
    scalarFacts: [{ label: 'Value', value: formatFactValue(value) }],
  };
}

export function flattenArtifactsByTask(
  tasks: DashboardWorkItemTaskRecord[],
  artifactSets: DashboardTaskArtifactRecord[][],
): DashboardWorkItemArtifactRecord[] {
  const taskTitles = new Map(tasks.map((task) => [task.id, task.title]));
  return artifactSets
    .flatMap((artifacts) => artifacts)
    .map((artifact) => ({
      ...artifact,
      task_title: taskTitles.get(artifact.task_id) ?? artifact.task_id,
    }))
    .sort((left, right) => compareTimestampsDescending(left.created_at, right.created_at));
}

export function sortEventsNewestFirst(events: DashboardEventRecord[]): DashboardEventRecord[] {
  return [...events].sort((left, right) => compareTimestampsDescending(left.created_at, right.created_at));
}

export function sortMemoryEntriesByKey(
  entries: DashboardWorkItemMemoryEntry[],
): DashboardWorkItemMemoryEntry[] {
  return [...entries].sort((left, right) => left.key.localeCompare(right.key));
}

export function sortMemoryHistoryNewestFirst(
  history: DashboardWorkItemMemoryHistoryEntry[],
): DashboardWorkItemMemoryHistoryEntry[] {
  return [...history].sort((left, right) => {
    if (left.updated_at === right.updated_at) {
      return right.event_id - left.event_id;
    }
    return compareTimestampsDescending(left.updated_at, right.updated_at);
  });
}

function readTaskUrgencyRank(state: DashboardWorkItemTaskRecord['state']): number {
  switch (normalizeTaskState(state)) {
    case 'awaiting_approval':
    case 'output_pending_review':
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

function compareTimestampsDescending(left: unknown, right: unknown): number {
  const normalizedLeft = normalizeTimestamp(left);
  const normalizedRight = normalizeTimestamp(right);
  return normalizedRight.localeCompare(normalizedLeft);
}

function buildWorkItemIndex(
  workItems: DashboardGroupedWorkItemRecord[],
): Map<string, DashboardGroupedWorkItemRecord> {
  const index = new Map<string, DashboardGroupedWorkItemRecord>();
  for (const item of workItems) {
    index.set(item.id, item);
    for (const child of item.children ?? []) {
      index.set(child.id, child);
    }
  }
  return index;
}

function formatFactLabel(value: string): string {
  return value.replaceAll('_', ' ').replaceAll('.', ' ');
}

function formatFactValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.length > 96 ? `${value.slice(0, 93)}...` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null) {
    return 'null';
  }
  return 'structured';
}

function scalarShapeLabel(value: unknown): string {
  if (typeof value === 'string') {
    return 'Text value';
  }
  if (typeof value === 'number') {
    return 'Numeric value';
  }
  if (typeof value === 'boolean') {
    return 'Boolean value';
  }
  return 'Scalar value';
}

function isScalarValue(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  );
}

function normalizeTimestamp(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return typeof value === 'string' ? value : '';
}

function asWrappedList(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  const wrapped = asRecord(value);
  return Array.isArray(wrapped.data) ? wrapped.data : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}
