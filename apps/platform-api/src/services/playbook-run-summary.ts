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

interface WorkflowStageSummaryRow {
  name: string;
  goal: string;
  human_gate: boolean;
  status: string;
  gate_status: string;
  iteration_count: number;
  summary: string | null;
  started_at: Date | null;
  completed_at: Date | null;
}

interface WorkflowWorkItemSummaryRow {
  id: string;
  stage_name: string;
  column_id: string;
  title: string;
  completed_at: Date | null;
}

export function buildPlaybookRunSummary(params: {
  workflow: Record<string, unknown>;
  tasks: Array<Record<string, unknown>>;
  stages: WorkflowStageSummaryRow[];
  workItems: WorkflowWorkItemSummaryRow[];
  events: TimelineEventRow[];
  artifacts: ArtifactSummaryRow[];
}) {
  const metadata = asRecord(params.workflow.metadata);
  const relations = readWorkflowRelations(params.workflow, metadata);
  const lifecycle = readWorkflowLifecycle(params.workflow);
  const reworkByTask = params.tasks
    .filter((task) => Number(task.rework_count ?? 0) > 0)
    .map((task) => ({
      task_id: String(task.id),
      role: asOptionalString(task.role),
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
    lifecycle,
    stage_progression:
      lifecycle === 'continuous' ? null : buildStageProgression(params.stages, params.workItems),
    stage_activity:
      lifecycle === 'continuous' ? buildStageActivity(params.stages, params.workItems) : null,
    stage_metrics: params.stages.map((stage) => {
      const stageTasks = params.tasks.filter((task) => String(task.stage_name ?? '') === stage.name);
      const stageItems = params.workItems.filter((item) => item.stage_name === stage.name);
      return {
        name: stage.name,
        goal: stage.goal,
        human_gate: stage.human_gate,
        status: stage.status,
        gate_status: stage.gate_status,
        iteration_count: stage.iteration_count,
        summary: stage.summary,
        task_counts: countTaskStates(stageTasks),
        work_item_counts: {
          total: stageItems.length,
          completed: stageItems.filter((item) => item.completed_at).length,
          open: stageItems.filter((item) => !item.completed_at).length,
          by_column: countByColumn(stageItems),
        },
        timing: buildStageTiming(stage, params.events, stageTasks, stageItems),
        gate_history: buildStageGateHistory(params.events, stage.name),
      };
    }),
    produced_artifacts: buildProducedArtifacts(params.tasks, params.artifacts),
    chain: {
      source_workflow_id: metadata.chain_source_workflow_id ?? null,
      child_workflow_ids: Array.isArray(metadata.child_workflow_ids)
        ? metadata.child_workflow_ids
        : [],
      latest_child_workflow_id: metadata.latest_chained_workflow_id ?? null,
    },
    workflow_relations: relations,
    link: `/workflows/${String(params.workflow.id)}`,
  };
}

function buildStageProgression(
  stages: WorkflowStageSummaryRow[],
  workItems: WorkflowWorkItemSummaryRow[],
) {
  return stages.map((stage) => {
    const stageItems = workItems.filter((item) => item.stage_name === stage.name);
    const completedWorkItemCount = stageItems.filter((item) => item.completed_at).length;
    return {
      name: stage.name,
      status: stage.status,
      gate_status: stage.gate_status,
      work_item_count: stageItems.length,
      completed_work_item_count: completedWorkItemCount,
    };
  });
}

function buildStageActivity(
  stages: WorkflowStageSummaryRow[],
  workItems: WorkflowWorkItemSummaryRow[],
) {
  return stages.map((stage) => {
    const stageItems = workItems.filter((item) => item.stage_name === stage.name);
    const completedWorkItemCount = stageItems.filter((item) => item.completed_at).length;
    return {
      name: stage.name,
      status: stage.status,
      gate_status: stage.gate_status,
      total_work_item_count: stageItems.length,
      open_work_item_count: stageItems.length - completedWorkItemCount,
      completed_work_item_count: completedWorkItemCount,
    };
  });
}

function buildStageTiming(
  stage: WorkflowStageSummaryRow,
  events: TimelineEventRow[],
  stageTasks: Array<Record<string, unknown>>,
  stageItems: WorkflowWorkItemSummaryRow[],
) {
  const stageEvents = events.filter((event) => asRecord(event.data).stage_name === stage.name);
  const startedAt =
    stage.started_at ??
    stageEvents.find((event) => event.type === 'stage.started')?.created_at ??
    minimumDate([
      ...stageTasks.map((task) => asDate(task.started_at)),
      ...stageItems.map((item) => asDate(item.completed_at)),
    ]);
  const completedAt =
    stage.completed_at ??
    latestDate([
      stageEvents.find((event) => event.type === 'stage.completed')?.created_at ?? null,
      ...stageTasks.map((task) => asDate(task.completed_at)),
      ...stageItems.map((item) => asDate(item.completed_at)),
    ]);

  return {
    started_at: startedAt?.toISOString() ?? null,
    completed_at: completedAt?.toISOString() ?? null,
    duration_seconds: calculateDurationSeconds(startedAt, completedAt),
  };
}

function buildStageGateHistory(events: TimelineEventRow[], stageName: string) {
  return events
    .filter((event) => asRecord(event.data).stage_name === stageName)
    .filter((event) =>
      [
        'stage.gate_requested',
        'stage.gate.approve',
        'stage.gate.reject',
        'stage.gate.request_changes',
      ].includes(event.type),
    )
    .map((event) => ({
      action: event.type === 'stage.gate_requested' ? 'requested' : event.type.replace('stage.gate.', ''),
      actor_type: event.actor_type,
      actor_id: event.actor_id,
      recommendation: asOptionalString(asRecord(event.data).recommendation),
      feedback: asOptionalString(asRecord(event.data).feedback),
      acted_at: event.created_at.toISOString(),
    }));
}

function countByColumn(workItems: WorkflowWorkItemSummaryRow[]) {
  const counts: Record<string, number> = {};
  for (const item of workItems) {
    counts[item.column_id] = (counts[item.column_id] ?? 0) + 1;
  }
  return counts;
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
  const counts = {
    completed: 0,
    failed: 0,
    skipped: 0,
    cancelled: 0,
    total: tasks.length,
    by_state: {} as Record<string, number>,
  };
  for (const task of tasks) {
    const state = String(task.state ?? '');
    counts.by_state[state] = (counts.by_state[state] ?? 0) + 1;
  }
  counts.completed = counts.by_state.completed ?? 0;
  counts.failed = counts.by_state.failed ?? 0;
  counts.cancelled = counts.by_state.cancelled ?? 0;
  counts.skipped = counts.cancelled;
  return counts;
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

function latestDate(values: Array<Date | null>) {
  const filtered = values.filter((value): value is Date => value instanceof Date).sort(compareDateAsc);
  return filtered[filtered.length - 1] ?? null;
}

function compareDateAsc(left: Date, right: Date) {
  return left.getTime() - right.getTime();
}

function asDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readWorkflowLifecycle(workflow: Record<string, unknown>) {
  return workflow.lifecycle === 'continuous' ? 'continuous' : 'standard';
}

function readWorkflowRelations(
  workflow: Record<string, unknown>,
  metadata: Record<string, unknown>,
) {
  const existing = asRecord(workflow.workflow_relations);
  if (Object.keys(existing).length > 0) {
    return existing;
  }
  return {
    parent: typeof metadata.chain_source_workflow_id === 'string'
      ? {
          workflow_id: metadata.chain_source_workflow_id,
          name: null,
          state: 'unknown',
          playbook_id: null,
          playbook_name: null,
          created_at: null,
          started_at: null,
          completed_at: null,
          is_terminal: false,
          link: `/workflows/${metadata.chain_source_workflow_id}`,
        }
      : null,
    children: Array.isArray(metadata.child_workflow_ids)
      ? metadata.child_workflow_ids
          .filter((entry): entry is string => typeof entry === 'string')
          .map((workflowId) => ({
            workflow_id: workflowId,
            name: null,
            state: 'unknown',
            playbook_id: null,
            playbook_name: null,
            created_at: null,
            started_at: null,
            completed_at: null,
            is_terminal: false,
            link: `/workflows/${workflowId}`,
          }))
      : [],
    latest_child_workflow_id:
      typeof metadata.latest_chained_workflow_id === 'string'
        ? metadata.latest_chained_workflow_id
        : null,
    child_status_counts: {
      total: Array.isArray(metadata.child_workflow_ids) ? metadata.child_workflow_ids.length : 0,
      active: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    },
  };
}
