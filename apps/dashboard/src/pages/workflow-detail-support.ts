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

export interface DashboardProjectMemoryEntry {
  key: string;
  value: unknown;
}

export function readWorkflowProjectId(workflow: unknown): string | undefined {
  const record = asRecord(workflow);
  return readNonEmptyString(record.project_id);
}

export function readWorkflowRunSummary(workflow: unknown): Record<string, unknown> | undefined {
  const metadata = asRecord(asRecord(workflow).metadata);
  return asRecord(metadata.run_summary ?? metadata.timeline_summary);
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

export function parseMemoryValue(value: string) {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return { value: '', error: 'Memory value must not be empty.' };
  }

  try {
    return { value: JSON.parse(normalized), error: undefined };
  } catch {
    return { value: undefined, error: 'Memory value must be valid JSON.' };
  }
}

export function readProjectMemoryEntries(project: unknown): DashboardProjectMemoryEntry[] {
  return Object.entries(asRecord(asRecord(project).memory))
    .map(([key, value]) => ({ key, value }))
    .sort((left, right) => left.key.localeCompare(right.key));
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

function normalizeTaskState(state: string): string {
  if (state === 'running' || state === 'claimed') return 'in_progress';
  if (state === 'awaiting_escalation') return 'escalated';
  return state;
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
