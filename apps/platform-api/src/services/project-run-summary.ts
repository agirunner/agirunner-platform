import type { StoredWorkflowDefinition } from '../orchestration/workflow-model.js';
import type { WorkflowPhaseView } from '../orchestration/workflow-runtime.js';
interface TimelineEventRow {
  type: string;
  actor_type: string;
  actor_id: string | null;
  data: Record<string, unknown> | null;
  created_at: Date;
}
interface ArtifactSummaryRow {
  id: string;
  task_id: string;
  logical_path: string;
  content_type: string;
  size_bytes: number;
  created_at: Date;
}
export function buildRunSummary(params: {
  workflow: Record<string, unknown>;
  tasks: Array<Record<string, unknown>>;
  workflowDef: StoredWorkflowDefinition | null;
  workflowView: {
    phases: Array<WorkflowPhaseView & { progress: { completed_tasks: number; total_tasks: number } }>;
  };
  events: TimelineEventRow[];
  artifacts: ArtifactSummaryRow[];
}) {
  const metadata = asRecord(params.workflow.metadata);
  const reworkByTask = params.tasks
    .filter((task) => Number(task.rework_count ?? 0) > 0)
    .map((task) => ({
      task_id: String(task.id),
      role: asOptionalString(task.role),
      type: String(task.type ?? ''),
      rework_count: Number(task.rework_count ?? 0),
    }));

  return {
    kind: 'run_summary',
    workflow_id: String(params.workflow.id),
    name: String(params.workflow.name),
    state: String(params.workflow.state),
    created_at: params.workflow.created_at,
    started_at: params.workflow.started_at ?? null,
    completed_at: params.workflow.completed_at ?? null,
    duration_seconds: calculateDurationSeconds(
      params.workflow.started_at,
      params.workflow.completed_at,
    ),
    task_counts: countTaskStates(params.tasks),
    rework_cycles: params.tasks.reduce((sum, task) => sum + Number(task.rework_count ?? 0), 0),
    rework_by_task: reworkByTask,
    phase_progression: buildPhaseProgression(params.workflowView.phases),
    phase_metrics: buildPhaseMetrics(params),
    produced_artifacts: buildProducedArtifacts(params.tasks, params.artifacts),
    chain: {
      source_workflow_id: metadata.chain_source_workflow_id ?? null,
      child_workflow_ids: Array.isArray(metadata.child_workflow_ids)
        ? metadata.child_workflow_ids
        : [],
    },
    link: `/workflows/${String(params.workflow.id)}`,
  };
}
export function buildRunSummaryFallback(workflow: Record<string, unknown>) {
  const metadata = asRecord(workflow.metadata);
  return {
    kind: 'run_summary',
    workflow_id: String(workflow.id),
    name: String(workflow.name),
    state: String(workflow.state),
    created_at: workflow.created_at,
    started_at: workflow.started_at ?? null,
    completed_at: workflow.completed_at ?? null,
    duration_seconds: calculateDurationSeconds(workflow.started_at, workflow.completed_at),
    task_counts: emptyTaskCounts(),
    rework_cycles: 0,
    rework_by_task: [],
    phase_progression: [],
    phase_metrics: [],
    produced_artifacts: [],
    chain: {
      source_workflow_id: metadata.chain_source_workflow_id ?? null,
      child_workflow_ids: Array.isArray(metadata.child_workflow_ids)
        ? metadata.child_workflow_ids
        : [],
    },
    link: `/workflows/${String(workflow.id)}`,
  };
}
function buildPhaseProgression(
  phases: Array<WorkflowPhaseView & { progress: { completed_tasks: number; total_tasks: number } }>,
) {
  return phases.map((phase) => ({
    name: phase.name,
    status: phase.status,
    gate_status: phase.gate_status,
    completed_tasks: phase.progress.completed_tasks,
    total_tasks: phase.progress.total_tasks,
  }));
}
function buildPhaseMetrics(params: {
  workflowDef: StoredWorkflowDefinition | null;
  workflowView: {
    phases: Array<WorkflowPhaseView & { progress: { completed_tasks: number; total_tasks: number } }>;
  };
  tasks: Array<Record<string, unknown>>;
  events: TimelineEventRow[];
}) {
  if (!params.workflowDef) {
    return [];
  }

  const phaseViewByName = new Map(params.workflowView.phases.map((phase) => [phase.name, phase]));
  return params.workflowDef.phases.map((phase) => {
    const phaseTasks = params.tasks.filter((task) => phase.task_ids.includes(String(task.id)));
    const gateHistory = buildPhaseGateHistory(params.events, phase.name);
    const timing = buildPhaseTiming(params.events, phase.name, phaseTasks, phase.gate === 'manual');
    const counts = countTaskStates(phaseTasks);
    return {
      name: phase.name,
      gate: phase.gate,
      status: phaseViewByName.get(phase.name)?.status ?? 'pending',
      gate_status: phaseViewByName.get(phase.name)?.gate_status ?? 'none',
      task_counts: counts,
      rework_by_task: phaseTasks.map((task) => ({
        task_id: String(task.id),
        role: asOptionalString(task.role),
        type: String(task.type ?? ''),
        rework_count: Number(task.rework_count ?? 0),
      })),
      timing,
      gate_history: gateHistory,
    };
  });
}
function buildPhaseTiming(
  events: TimelineEventRow[],
  phaseName: string,
  phaseTasks: Array<Record<string, unknown>>,
  isManualGate: boolean,
) {
  const phaseEvents = events.filter((event) => asRecord(event.data).phase_name === phaseName);
  const startedAt =
    phaseEvents.find((event) => event.type === 'phase.started')?.created_at ??
    minimumDate(phaseTasks.map((task) => asDate(task.started_at)));
  const completedAt =
    latestDate(
      [
        phaseEvents.find((event) => event.type === 'phase.completed')?.created_at ?? null,
        isManualGate
          ? latestDate(
              phaseEvents
                .filter((event) => event.type === 'phase.gate.approved')
                .map((event) => event.created_at),
            )
          : null,
        maximumDate(phaseTasks.map((task) => asDate(task.completed_at))),
      ].filter((value): value is Date => value instanceof Date),
    ) ?? null;

  return {
    started_at: startedAt?.toISOString() ?? null,
    completed_at: completedAt?.toISOString() ?? null,
    duration_seconds: calculateDurationSeconds(startedAt, completedAt),
  };
}
function buildPhaseGateHistory(events: TimelineEventRow[], phaseName: string) {
  return events
    .filter((event) => asRecord(event.data).phase_name === phaseName)
    .filter((event) =>
      ['phase.gate.awaiting_approval', 'phase.gate.approved', 'phase.gate.rejected', 'phase.gate.request_changes'].includes(
        event.type,
      ),
    )
    .map((event) => ({
      action: event.type.replace('phase.gate.', ''),
      actor_type: event.actor_type,
      actor_id: event.actor_id,
      feedback: asOptionalString(asRecord(event.data).feedback),
      acted_at: event.created_at.toISOString(),
    }));
}
function buildProducedArtifacts(
  tasks: Array<Record<string, unknown>>,
  artifacts: ArtifactSummaryRow[],
) {
  const fileArtifacts = artifacts.map((artifact) => ({
    kind: 'file',
    task_id: artifact.task_id,
    artifact_id: artifact.id,
    path: artifact.logical_path,
    content_type: artifact.content_type,
    size_bytes: artifact.size_bytes,
    created_at: artifact.created_at.toISOString(),
  }));
  const gitArtifacts = tasks.flatMap((task) => collectGitArtifacts(task));
  return [...fileArtifacts, ...gitArtifacts];
}
function collectGitArtifacts(task: Record<string, unknown>) {
  const gitInfo = asRecord(task.git_info);
  const taskId = String(task.id);
  const artifacts: Array<Record<string, unknown>> = [];

  const commitHash = asOptionalString(gitInfo.commit_hash);
  if (commitHash) {
    artifacts.push({ kind: 'commit', task_id: taskId, commit_hash: commitHash });
  }

  const branch = asOptionalString(gitInfo.branch);
  if (branch) {
    artifacts.push({ kind: 'branch', task_id: taskId, branch });
  }

  const linkedPrs = Array.isArray(gitInfo.linked_prs) ? gitInfo.linked_prs : [];
  for (const entry of linkedPrs) {
    artifacts.push({ kind: 'pull_request', task_id: taskId, reference: entry });
  }

  return artifacts;
}
function countTaskStates(tasks: Array<Record<string, unknown>>) {
  const counts = emptyTaskCounts();
  for (const task of tasks) {
    const state = String(task.state ?? '');
    counts.by_state[state] = (counts.by_state[state] ?? 0) + 1;
  }
  counts.completed = counts.by_state.completed ?? 0;
  counts.failed = counts.by_state.failed ?? 0;
  counts.cancelled = counts.by_state.cancelled ?? 0;
  counts.skipped = counts.cancelled;
  counts.total = tasks.length;
  return counts;
}
function emptyTaskCounts() {
  return {
    completed: 0,
    failed: 0,
    skipped: 0,
    cancelled: 0,
    total: 0,
    by_state: {} as Record<string, number>,
  };
}
function calculateDurationSeconds(startedAt: unknown, completedAt: unknown) {
  const start = asDate(startedAt);
  const end = asDate(completedAt);
  if (!start || !end) {
    return null;
  }
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
}
function minimumDate(values: Array<Date | null>) {
  return values.filter((value): value is Date => value instanceof Date).sort(compareDateAsc)[0] ?? null;
}

function maximumDate(values: Array<Date | null>) {
  const filtered = values.filter((value): value is Date => value instanceof Date).sort(compareDateAsc);
  return filtered[filtered.length - 1] ?? null;
}
function latestDate(values: Date[]) {
  const sorted = [...values].sort(compareDateAsc);
  return sorted[sorted.length - 1] ?? null;
}

function compareDateAsc(left: Date, right: Date) {
  return left.getTime() - right.getTime();
}
function asDate(value: unknown) {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return null;
}
function asOptionalString(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
