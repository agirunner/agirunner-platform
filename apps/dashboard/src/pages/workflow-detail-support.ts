export interface DashboardWorkflowTaskRow {
  id: string;
  title: string;
  state: string;
  depends_on: string[];
  created_at?: string;
  metadata?: Record<string, unknown>;
}

export interface DashboardWorkflowPhaseRow {
  name: string;
  status: string;
  gate: string;
  gate_status: string;
  completed_tasks: number;
  total_tasks: number;
}

export interface MissionControlSummary {
  total: number;
  ready: number;
  running: number;
  blocked: number;
  completed: number;
  failed: number;
}

export interface DashboardProjectMemoryEntry {
  key: string;
  value: unknown;
}

export interface DashboardPhaseActionDraft {
  feedback: string;
  overrideInput: string;
  overrideError: string | null;
}

const DEFAULT_PHASE_FEEDBACK = 'Clarify the current phase requirements.';
const DEFAULT_PHASE_OVERRIDE_INPUT = '{\n  "clarification_answers": {}\n}';

export function readWorkflowProjectId(workflow: unknown): string | undefined {
  const record = asRecord(workflow);
  return readNonEmptyString(record.project_id);
}

export function readWorkflowCurrentPhase(workflow: unknown): string | undefined {
  return readNonEmptyString(asRecord(workflow).current_phase);
}

export function readWorkflowRunSummary(workflow: unknown): Record<string, unknown> | undefined {
  const metadata = asRecord(asRecord(workflow).metadata);
  return asRecord(metadata.run_summary ?? metadata.timeline_summary);
}

export function readWorkflowPhases(workflow: unknown): DashboardWorkflowPhaseRow[] {
  const phases = asArray(asRecord(workflow).phases);
  return phases.map((phase) => {
    const record = asRecord(phase);
    const progress = asRecord(record.progress);
    return {
      name: readNonEmptyString(record.name) ?? 'unnamed',
      status: readNonEmptyString(record.status) ?? 'pending',
      gate: readNonEmptyString(record.gate) ?? 'none',
      gate_status: readNonEmptyString(record.gate_status) ?? 'none',
      completed_tasks: readNumber(progress.completed_tasks),
      total_tasks: readNumber(progress.total_tasks),
    };
  });
}

export function groupTasksByPhase(
  tasks: DashboardWorkflowTaskRow[],
  phases: DashboardWorkflowPhaseRow[],
) {
  const buckets = new Map<string, DashboardWorkflowTaskRow[]>();
  for (const phase of phases) {
    buckets.set(phase.name, []);
  }

  for (const task of tasks) {
    const phaseName = readNonEmptyString(asRecord(task.metadata).workflow_phase) ?? 'unassigned';
    const existing = buckets.get(phaseName);
    if (existing) {
      existing.push(task);
      continue;
    }
    buckets.set(phaseName, [task]);
  }

  return Array.from(buckets.entries()).map(([phaseName, phaseTasks]) => ({
    phaseName,
    tasks: phaseTasks,
  }));
}

export function parseOverrideInput(value: string) {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return { value: undefined, error: undefined };
  }

  try {
    const parsed = JSON.parse(normalized);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { value: undefined, error: 'Override input must be a JSON object.' };
    }
    return { value: parsed as Record<string, unknown>, error: undefined };
  } catch {
    return { value: undefined, error: 'Override input must be valid JSON.' };
  }
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

export function readPhaseActionDraft(
  drafts: Record<string, DashboardPhaseActionDraft>,
  phaseName: string,
): DashboardPhaseActionDraft {
  return drafts[phaseName] ?? {
    feedback: DEFAULT_PHASE_FEEDBACK,
    overrideInput: DEFAULT_PHASE_OVERRIDE_INPUT,
    overrideError: null,
  };
}

export function updatePhaseActionDraft(
  drafts: Record<string, DashboardPhaseActionDraft>,
  phaseName: string,
  updates: Partial<DashboardPhaseActionDraft>,
): Record<string, DashboardPhaseActionDraft> {
  return {
    ...drafts,
    [phaseName]: {
      ...readPhaseActionDraft(drafts, phaseName),
      ...updates,
    },
  };
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
  if (eventType.startsWith('task.')) {
    return resolveTaskEventWorkflowId(payload) === workflowId;
  }
  return false;
}

export function summarizeTasks(tasks: Array<{ state: string }>): MissionControlSummary {
  return tasks.reduce<MissionControlSummary>(
    (acc, task) => {
      acc.total += 1;
      if (task.state === 'ready') acc.ready += 1;
      else if (task.state === 'running') acc.running += 1;
      else if (task.state === 'blocked' || task.state === 'awaiting_approval') acc.blocked += 1;
      else if (task.state === 'completed') acc.completed += 1;
      else if (task.state === 'failed' || task.state === 'cancelled') acc.failed += 1;
      return acc;
    },
    { total: 0, ready: 0, running: 0, blocked: 0, completed: 0, failed: 0 },
  );
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
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
