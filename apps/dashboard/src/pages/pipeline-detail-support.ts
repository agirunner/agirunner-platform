export interface DashboardPipelineTaskRow {
  id: string;
  title: string;
  state: string;
  depends_on: string[];
  created_at?: string;
  metadata?: Record<string, unknown>;
}

export interface DashboardPipelinePhaseRow {
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

export function readPipelineProjectId(pipeline: unknown): string | undefined {
  const record = asRecord(pipeline);
  return readNonEmptyString(record.project_id);
}

export function readPipelineCurrentPhase(pipeline: unknown): string | undefined {
  return readNonEmptyString(asRecord(pipeline).current_phase);
}

export function readPipelineRunSummary(pipeline: unknown): Record<string, unknown> | undefined {
  const metadata = asRecord(asRecord(pipeline).metadata);
  return asRecord(metadata.run_summary ?? metadata.timeline_summary);
}

export function readPipelinePhases(pipeline: unknown): DashboardPipelinePhaseRow[] {
  const phases = asArray(asRecord(pipeline).phases);
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
  tasks: DashboardPipelineTaskRow[],
  phases: DashboardPipelinePhaseRow[],
) {
  const buckets = new Map<string, DashboardPipelineTaskRow[]>();
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

export function shouldInvalidatePipelineRealtimeEvent(
  eventType: string,
  pipelineId: string,
  payload: Record<string, unknown>,
): boolean {
  if (!pipelineId) {
    return false;
  }
  if (eventType.startsWith('pipeline.')) {
    return resolvePipelineEventPipelineId(payload) === pipelineId;
  }
  if (eventType.startsWith('task.')) {
    return resolveTaskEventPipelineId(payload) === pipelineId;
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

function readPipelineIdFromData(data: Record<string, unknown> | undefined): string | undefined {
  if (!data) {
    return undefined;
  }
  return (
    readNonEmptyString(data.pipeline_id)
    ?? readNonEmptyString(data.pipelineId)
    ?? readNonEmptyString(asRecord(data.task).pipeline_id)
    ?? readNonEmptyString(asRecord(data.task).pipelineId)
    ?? readNonEmptyString(asRecord(data.pipeline).id)
  );
}

function resolvePipelineEventPipelineId(payload: Record<string, unknown>): string | undefined {
  const payloadData = asRecord(payload.data);
  return (
    readPipelineIdFromData(payloadData)
    ?? readNonEmptyString(payload.pipeline_id)
    ?? (payload.entity_type === 'pipeline' ? readNonEmptyString(payload.entity_id) : undefined)
  );
}

function resolveTaskEventPipelineId(payload: Record<string, unknown>): string | undefined {
  return readPipelineIdFromData(asRecord(payload.data)) ?? readNonEmptyString(payload.pipeline_id);
}
