import type {
  DashboardEffectiveModelResolution,
  DashboardWorkflowWorkItemRecord,
} from '../lib/api.js';
import { normalizeTaskState } from '../lib/task-state.js';

export interface DashboardWorkflowTaskRow {
  id: string;
  title: string;
  state: string;
  depends_on: string[];
  work_item_id?: string | null;
  role?: string | null;
  stage_name?: string | null;
  created_at?: string;
  completed_at?: string | null;
  metadata?: Record<string, unknown>;
}

export interface MissionControlSummary {
  total: number;
  ready: number;
  in_progress: number;
  blocked: number;
  completed: number;
  failed: number;
}

export interface DashboardWorkspaceMemoryEntry {
  key: string;
  value: unknown;
}

export interface DashboardPacketFact {
  label: string;
  value: string;
}

export interface DashboardTaskGraphPacket {
  focus: string;
  upstream: string;
  timing: string;
}

export interface DashboardConfigLayerSummary {
  name: string;
  fieldCount: number;
  keys: string[];
}

export function readWorkflowWorkspaceId(workflow: unknown): string | undefined {
  const record = asRecord(workflow);
  return readNonEmptyString(record.workspace_id);
}

export function readWorkflowRunSummary(workflow: unknown): Record<string, unknown> | undefined {
  const metadata = asRecord(asRecord(workflow).metadata);
  return asRecord(metadata.run_summary);
}

export function groupTasksByStage(
  tasks: DashboardWorkflowTaskRow[],
  stageNames: string[],
) {
  const buckets = new Map<string, DashboardWorkflowTaskRow[]>();
  for (const stageName of stageNames) {
    if (!buckets.has(stageName)) {
      buckets.set(stageName, []);
    }
  }

  for (const task of tasks) {
    const stageName = readNonEmptyString(task.stage_name) ?? 'unassigned';
    const existing = buckets.get(stageName);
    if (existing) {
      existing.push(task);
      continue;
    }
    buckets.set(stageName, [task]);
  }

  return Array.from(buckets.entries()).map(([stageName, stageTasks]) => ({
    stageName,
    tasks: stageTasks,
  }));
}

export function readWorkspaceMemoryEntries(workspace: unknown): DashboardWorkspaceMemoryEntry[] {
  return Object.entries(asRecord(asRecord(workspace).memory))
    .map(([key, value]) => ({ key, value }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

export function deriveWorkflowRoleOptions(input: {
  tasks: DashboardWorkflowTaskRow[];
  workItems: DashboardWorkflowWorkItemRecord[];
  effectiveModels?: Record<string, DashboardEffectiveModelResolution>;
  workflowModelOverrides?: Record<string, unknown>;
}): string[] {
  const roles = new Set<string>();

  for (const task of input.tasks) {
    const role = readNonEmptyString(task.role);
    if (role) {
      roles.add(role.trim());
    }
  }

  for (const workItem of input.workItems) {
    const role = readNonEmptyString(workItem.owner_role);
    if (role) {
      roles.add(role.trim());
    }
  }

  for (const role of Object.keys(input.effectiveModels ?? {})) {
    const normalizedRole = readNonEmptyString(role);
    if (normalizedRole) {
      roles.add(normalizedRole.trim());
    }
  }

  for (const role of Object.keys(input.workflowModelOverrides ?? {})) {
    const normalizedRole = readNonEmptyString(role);
    if (normalizedRole) {
      roles.add(normalizedRole.trim());
    }
  }

  return Array.from(roles).sort((left, right) => left.localeCompare(right));
}

export function readPacketScalarFacts(
  value: unknown,
  limit = 6,
): DashboardPacketFact[] {
  const record = asRecord(value);
  return Object.keys(record)
    .sort((left, right) => left.localeCompare(right))
    .filter((key) => isScalarPacketValue(record[key]))
    .slice(0, limit)
    .map((key) => ({
      label: key.replaceAll('_', ' ').replaceAll('.', ' '),
      value: formatPacketFactValue(record[key]),
    }));
}

export function readPacketNestedKeys(value: unknown, limit = 8): string[] {
  const record = asRecord(value);
  return Object.keys(record)
    .sort((left, right) => left.localeCompare(right))
    .filter((key) => !isScalarPacketValue(record[key]))
    .slice(0, limit)
    .map((key) => key.replaceAll('_', ' ').replaceAll('.', ' '));
}

export function summarizeConfigLayers(value: unknown): DashboardConfigLayerSummary[] {
  const layers = asRecord(value);
  return Object.keys(layers)
    .sort((left, right) => left.localeCompare(right))
    .map((name) => {
      const layerRecord = asRecord(layers[name]);
      const keys = Object.keys(layerRecord).sort((left, right) => left.localeCompare(right));
      return {
        name,
        fieldCount: keys.length,
        keys,
      };
    });
}

export function shouldInvalidateWorkflowRealtimeEvent(
  eventType: string,
  workflowId: string,
  payload: Record<string, unknown>,
): boolean {
  if (!workflowId) {
    return false;
  }
  if (eventType.startsWith('workflow.')) {
    return resolveWorkflowEventWorkflowId(payload) === workflowId;
  }
  if (eventType.startsWith('work_item.')) {
    return resolveWorkflowEventWorkflowId(payload) === workflowId;
  }
  if (eventType.startsWith('task.')) {
    return resolveTaskEventWorkflowId(payload) === workflowId;
  }
  return false;
}

export function summarizeTasks(tasks: Array<{ state: string }>): MissionControlSummary {
  return tasks.reduce<MissionControlSummary>(
    (acc, task) => {
      const state = normalizeTaskState(task.state);
      acc.total += 1;
      if (state === 'ready') acc.ready += 1;
      else if (state === 'in_progress') acc.in_progress += 1;
      else if (
        state === 'blocked'
        || state === 'awaiting_approval'
        || state === 'output_pending_review'
        || state === 'escalated'
      ) acc.blocked += 1;
      else if (state === 'completed') acc.completed += 1;
      else if (state === 'failed' || state === 'cancelled') acc.failed += 1;
      return acc;
    },
    { total: 0, ready: 0, in_progress: 0, blocked: 0, completed: 0, failed: 0 },
  );
}

export function describeTaskGraphPacket(
  task: DashboardWorkflowTaskRow,
  allTasks: DashboardWorkflowTaskRow[],
  now = Date.now(),
): DashboardTaskGraphPacket {
  const taskIndex = new Map(allTasks.map((entry) => [entry.id, entry]));
  const upstreamTitles = task.depends_on
    .map((dependencyId) => taskIndex.get(dependencyId)?.title ?? summarizeIdentifier(dependencyId))
    .slice(0, 3);

  const focusParts = [readNonEmptyString(task.role), readNonEmptyString(task.stage_name)]
    .filter((value): value is string => Boolean(value))
    .map((value, index) => (index === 0 ? value : `stage ${value}`));
  const workItemId = readNonEmptyString(task.work_item_id);
  const focus =
    focusParts.length > 0
      ? focusParts.join(' • ')
      : workItemId
        ? `work item ${summarizeIdentifier(workItemId)}`
        : 'Standalone specialist step';

  const hasCompletedAt = readNonEmptyString(task.completed_at);
  const hasCreatedAt = readNonEmptyString(task.created_at);
  const timingReference = hasCompletedAt ?? hasCreatedAt;
  const timingPrefix = hasCompletedAt ? 'Completed' : hasCreatedAt ? 'Queued' : 'No timestamp';

  return {
    focus,
    upstream:
      upstreamTitles.length > 0
        ? upstreamTitles.join(', ')
        : 'No upstream steps',
    timing:
      timingReference
        ? `${timingPrefix} ${formatCompactRelativeTime(timingReference, now)}`
        : timingPrefix,
  };
}

function summarizeIdentifier(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function formatCompactRelativeTime(value: string, now: number): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return 'recently';
  }
  const deltaMinutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (deltaMinutes < 1) {
    return 'just now';
  }
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }
  return `${Math.floor(deltaHours / 24)}d ago`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readWorkflowIdFromData(data: Record<string, unknown> | undefined): string | undefined {
  if (!data) {
    return undefined;
  }
  return (
    readNonEmptyString(data.workflow_id)
    ?? readNonEmptyString(data.workflowId)
    ?? readNonEmptyString(asRecord(data.task).workflow_id)
    ?? readNonEmptyString(asRecord(data.task).workflowId)
    ?? readNonEmptyString(asRecord(data.workflow).id)
  );
}

function isScalarPacketValue(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  );
}

function formatPacketFactValue(value: unknown): string {
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

function resolveWorkflowEventWorkflowId(payload: Record<string, unknown>): string | undefined {
  const payloadData = asRecord(payload.data);
  return (
    readWorkflowIdFromData(payloadData)
    ?? readNonEmptyString(payload.workflow_id)
    ?? (payload.entity_type === 'workflow' ? readNonEmptyString(payload.entity_id) : undefined)
  );
}

function resolveTaskEventWorkflowId(payload: Record<string, unknown>): string | undefined {
  return readWorkflowIdFromData(asRecord(payload.data)) ?? readNonEmptyString(payload.workflow_id);
}
