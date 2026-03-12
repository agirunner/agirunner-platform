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

interface ActivationBatchSummary {
  activation_id: string;
  status: string;
  reason: string | null;
  task_id: string | null;
  event_count: number;
  trigger_event_types: string[];
  workflow_events: string[];
  latest_event_at: string;
}

interface EscalationChainSummary {
  source_task_id: string;
  escalation_task_id: string | null;
  target_role: string | null;
  work_item_id: string | null;
  stage_name: string | null;
  status: string;
  event_types: string[];
  latest_event_at: string;
}

const CHILD_WORKFLOW_EVENT_TYPES = new Set([
  'child_workflow.completed',
  'child_workflow.failed',
  'child_workflow.cancelled',
]);

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
  const activationActivity = buildActivationActivity(params.events);
  const workItemActivity = buildWorkItemActivity(params.stages, params.workItems, params.events);
  const gateActivity = buildGateActivity(params.stages, params.events);
  const escalationActivity = buildEscalationActivity(params.tasks, params.events);
  const childWorkflowActivity = buildChildWorkflowActivity(metadata, relations, params.events);
  const orchestratorAnalytics = buildOrchestratorAnalytics(params.tasks, activationActivity);
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
    rework_cycles: params.tasks.reduce((sum, task) => sum + Number(task.rework_count ?? 0), 0),
    rework_by_task: reworkByTask,
    lifecycle,
    activation_activity: activationActivity,
    work_item_activity: workItemActivity,
    gate_activity: gateActivity,
    escalation_activity: escalationActivity,
    child_workflow_activity: childWorkflowActivity,
    orchestrator_analytics: orchestratorAnalytics,
    stage_progression:
      lifecycle === 'continuous' ? null : buildStageProgression(params.stages, params.workItems),
    stage_activity:
      lifecycle === 'continuous' ? buildStageActivity(params.stages, params.workItems) : null,
    stage_metrics: params.stages.map((stage) => {
      const stageItems = params.workItems.filter((item) => item.stage_name === stage.name);
      return {
        name: stage.name,
        goal: stage.goal,
        human_gate: stage.human_gate,
        status: stage.status,
        gate_status: stage.gate_status,
        iteration_count: stage.iteration_count,
        summary: stage.summary,
        work_item_counts: {
          total: stageItems.length,
          completed: stageItems.filter((item) => item.completed_at).length,
          open: stageItems.filter((item) => !item.completed_at).length,
          by_column: countByColumn(stageItems),
        },
        timing: buildStageTiming(stage, params.events, stageItems),
        gate_history: buildStageGateHistory(params.events, stage.name),
      };
    }),
    produced_artifacts: buildProducedArtifacts(params.tasks, params.artifacts),
    workflow_relations: relations,
    link: `/workflows/${String(params.workflow.id)}`,
  };
}

function buildActivationActivity(events: TimelineEventRow[]) {
  const activationEvents = events.filter((event) => event.type.startsWith('workflow.activation_'));
  const batches = new Map<string, ActivationBatchSummary>();

  for (const event of activationEvents) {
    const data = asRecord(event.data);
    const activationId = asOptionalString(data.activation_id);
    if (!activationId) continue;
    const batch = batches.get(activationId) ?? createActivationBatchSummary(activationId, data, event);
    batch.workflow_events.push(event.type);
    batch.trigger_event_types = appendUnique(batch.trigger_event_types, asOptionalString(data.event_type));
    batch.reason = batch.reason ?? asOptionalString(data.reason) ?? null;
    batch.task_id = batch.task_id ?? asOptionalString(data.task_id) ?? null;
    batch.event_count = Math.max(batch.event_count, Number(data.event_count ?? batch.event_count));
    batch.latest_event_at = event.created_at.toISOString();
    batch.status = deriveActivationStatus(batch.status, event.type);
    batches.set(activationId, batch);
  }

  const orderedBatches = [...batches.values()].sort((left, right) =>
    left.latest_event_at.localeCompare(right.latest_event_at),
  );
  return {
    total_events: activationEvents.length,
    queued_count: countEvents(activationEvents, 'workflow.activation_queued'),
    started_count: countEvents(activationEvents, 'workflow.activation_started'),
    completed_count: countEvents(activationEvents, 'workflow.activation_completed'),
    failed_count: countEvents(activationEvents, 'workflow.activation_failed'),
    requeued_count: countEvents(activationEvents, 'workflow.activation_requeued'),
    stale_detected_count: countEvents(activationEvents, 'workflow.activation_stale_detected'),
    latest_activation_id: orderedBatches[orderedBatches.length - 1]?.activation_id ?? null,
    latest_event_at: orderedBatches[orderedBatches.length - 1]?.latest_event_at ?? null,
    batches: orderedBatches,
  };
}

function buildWorkItemActivity(
  stages: WorkflowStageSummaryRow[],
  workItems: WorkflowWorkItemSummaryRow[],
  events: TimelineEventRow[],
) {
  const workItemEvents = events.filter((event) => event.type.startsWith('work_item.'));
  const activeStageNames = stages
    .filter((stage) => isContinuousAttentionStageStatus(stage.status))
    .map((stage) => stage.name);
  return {
    total: workItems.length,
    completed: workItems.filter((item) => item.completed_at).length,
    open: workItems.filter((item) => !item.completed_at).length,
    by_stage: stages.map((stage) => {
      const stageItems = workItems.filter((item) => item.stage_name === stage.name);
      return {
        stage_name: stage.name,
        total: stageItems.length,
        completed: stageItems.filter((item) => item.completed_at).length,
        open: stageItems.filter((item) => !item.completed_at).length,
        by_column: countByColumn(stageItems),
      };
    }),
    by_column: countByColumn(workItems),
    active_stage_names: activeStageNames,
    created_event_count: countEvents(workItemEvents, 'work_item.created'),
    updated_event_count: countEvents(workItemEvents, 'work_item.updated'),
  };
}

function isContinuousAttentionStageStatus(status: string) {
  return status === 'active' || status === 'awaiting_gate' || status === 'blocked';
}

function buildGateActivity(stages: WorkflowStageSummaryRow[], events: TimelineEventRow[]) {
  const gateEvents = events.filter((event) => isGateEvent(event.type));
  return {
    open_gate_count: stages.filter((stage) => stage.gate_status === 'awaiting_approval').length,
    requested_count: countEvents(gateEvents, 'stage.gate_requested'),
    approved_count: countEvents(gateEvents, 'stage.gate.approve'),
    rejected_count: countEvents(gateEvents, 'stage.gate.reject'),
    changes_requested_count: countEvents(gateEvents, 'stage.gate.request_changes'),
    attention_stage_names: stages
      .filter((stage) => ['awaiting_approval', 'changes_requested', 'rejected'].includes(stage.gate_status))
      .map((stage) => stage.name),
    latest_gate_event_at: gateEvents[gateEvents.length - 1]?.created_at.toISOString() ?? null,
  };
}

function buildEscalationActivity(
  tasks: Array<Record<string, unknown>>,
  events: TimelineEventRow[],
) {
  const escalationEvents = events.filter((event) =>
    [
      'task.agent_escalated',
      'task.escalation_task_created',
      'task.escalation_response_recorded',
      'task.escalation_resolved',
      'task.escalation_depth_exceeded',
    ].includes(event.type),
  );
  const chains = new Map<string, EscalationChainSummary>();

  for (const event of escalationEvents) {
    const data = asRecord(event.data);
    const chainId =
      asOptionalString(data.source_task_id) ??
      asOptionalString(data.task_id) ??
      asOptionalString(data.escalation_task_id);
    if (!chainId) continue;
    const chain = chains.get(chainId) ?? createEscalationChainSummary(chainId, data, event);
    chain.event_types = appendUnique(chain.event_types, event.type);
    chain.latest_event_at = event.created_at.toISOString();
    chain.escalation_task_id =
      chain.escalation_task_id ?? asOptionalString(data.escalation_task_id) ?? null;
    chain.target_role = chain.target_role ?? asOptionalString(data.target_role) ?? null;
    chain.stage_name = chain.stage_name ?? asOptionalString(data.stage_name) ?? null;
    chain.work_item_id = chain.work_item_id ?? asOptionalString(data.work_item_id) ?? null;
    chain.status = deriveEscalationStatus(chain.status, event.type);
    chains.set(chainId, chain);
  }

  return {
    active_count: tasks.filter((task) => String(task.state ?? '') === 'escalated').length,
    escalated_count: countEvents(escalationEvents, 'task.agent_escalated'),
    escalation_task_count: countEvents(escalationEvents, 'task.escalation_task_created'),
    response_recorded_count: countEvents(escalationEvents, 'task.escalation_response_recorded'),
    resolved_count: countEvents(escalationEvents, 'task.escalation_resolved'),
    depth_exceeded_count: countEvents(escalationEvents, 'task.escalation_depth_exceeded'),
    chains: [...chains.values()].sort((left, right) => left.latest_event_at.localeCompare(right.latest_event_at)),
  };
}

function buildChildWorkflowActivity(
  metadata: Record<string, unknown>,
  relations: Record<string, unknown>,
  events: TimelineEventRow[],
) {
  const childEvents = events.filter((event) => {
    const data = asRecord(event.data);
    const nestedEventType = asOptionalString(data.event_type);
    const eventType = nestedEventType ?? event.type;
    return CHILD_WORKFLOW_EVENT_TYPES.has(eventType)
      && Boolean(asOptionalString(data.child_workflow_id));
  });
  const transitions = childEvents.map((event) => {
    const data = asRecord(event.data);
    const eventType = asOptionalString(data.event_type) ?? event.type;
    return {
      activation_id: asOptionalString(data.activation_id) ?? null,
      event_type: eventType,
      child_workflow_id: asOptionalString(data.child_workflow_id) ?? null,
      child_workflow_state: asOptionalString(data.child_workflow_state) ?? null,
      parent_stage_name: asOptionalString(data.parent_stage_name) ?? null,
      parent_work_item_id: asOptionalString(data.parent_work_item_id) ?? null,
      outcome: asRecord(data.outcome),
      created_at: event.created_at.toISOString(),
    };
  }).sort((left, right) => left.created_at.localeCompare(right.created_at));
  const relationChildren = Array.isArray(relations.children)
    ? relations.children.filter(
        (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object',
      )
    : [];
  const childStatusCounts = asRecord(relations.child_status_counts);
  const parent = asRecord(relations.parent);

  return {
    source_workflow_id:
      asOptionalString(parent.workflow_id)
      ?? asOptionalString(metadata.parent_workflow_id)
      ?? null,
    child_workflow_count: relationChildren.length,
    child_status_counts: childStatusCounts,
    completion_event_count: transitions.filter((entry) => entry.event_type === 'child_workflow.completed').length,
    failure_event_count: transitions.filter((entry) => entry.event_type === 'child_workflow.failed').length,
    cancellation_event_count: transitions.filter((entry) => entry.event_type === 'child_workflow.cancelled').length,
    latest_child_workflow_id: asOptionalString(relations.latest_child_workflow_id)
      ?? asOptionalString(metadata.latest_child_workflow_id)
      ?? transitions[transitions.length - 1]?.child_workflow_id
      ?? null,
    transitions,
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
  stageItems: WorkflowWorkItemSummaryRow[],
) {
  const stageEvents = events.filter((event) => asRecord(event.data).stage_name === stage.name);
  const startedAt =
    stage.started_at ??
    stageEvents.find((event) => event.type === 'stage.started')?.created_at ??
    minimumDate(stageItems.map((item) => asDate(item.completed_at)));
  const completedAt =
    stage.completed_at ??
    latestDate([
      stageEvents.find((event) => event.type === 'stage.completed')?.created_at ?? null,
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
    .filter((event) => isGateEvent(event.type))
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

function countEvents(events: TimelineEventRow[], type: string) {
  return events.filter((event) => event.type === type).length;
}

function isGateEvent(type: string) {
  return [
    'stage.gate_requested',
    'stage.gate.approve',
    'stage.gate.reject',
    'stage.gate.request_changes',
  ].includes(type);
}

function appendUnique(values: string[], next: string | undefined) {
  if (!next || values.includes(next)) {
    return values;
  }
  return [...values, next];
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

function buildOrchestratorAnalytics(
  tasks: Array<Record<string, unknown>>,
  activationActivity: ReturnType<typeof buildActivationActivity>,
) {
  const reworkedTasks = tasks.filter((task) => Number(task.rework_count ?? 0) > 0);
  const totalReworkCycles = tasks.reduce((sum, task) => sum + Number(task.rework_count ?? 0), 0);
  const costByStage = aggregateTaskCost(tasks, 'stage_name');
  const costByWorkItem = aggregateTaskCost(tasks, 'work_item_id');

  return {
    activation_count: activationActivity.batches.length,
    queued_activation_count: activationActivity.queued_count,
    completed_activation_count: activationActivity.completed_count,
    stale_detection_count: activationActivity.stale_detected_count,
    total_rework_cycles: totalReworkCycles,
    reworked_task_count: reworkedTasks.length,
    rework_rate:
      tasks.length > 0 ? Number((reworkedTasks.length / tasks.length).toFixed(4)) : 0,
    total_cost_usd: roundCurrency(
      tasks.reduce((sum, task) => sum + readTaskCostUsd(task), 0),
    ),
    cost_by_stage: costByStage,
    cost_by_work_item: costByWorkItem,
  };
}

function aggregateTaskCost(
  tasks: Array<Record<string, unknown>>,
  key: 'stage_name' | 'work_item_id',
) {
  const totals = new Map<string, { total_cost_usd: number; task_count: number }>();
  for (const task of tasks) {
    const groupKey = asOptionalString(task[key]);
    if (!groupKey) {
      continue;
    }
    const current = totals.get(groupKey) ?? { total_cost_usd: 0, task_count: 0 };
    current.total_cost_usd += readTaskCostUsd(task);
    current.task_count += 1;
    totals.set(groupKey, current);
  }
  return [...totals.entries()]
    .map(([groupKey, value]) => ({
      [key]: groupKey,
      task_count: value.task_count,
      total_cost_usd: roundCurrency(value.total_cost_usd),
    }))
    .sort((left, right) =>
      Number((right as Record<string, unknown>).total_cost_usd)
      - Number((left as Record<string, unknown>).total_cost_usd),
    );
}

function createActivationBatchSummary(
  activationId: string,
  data: Record<string, unknown>,
  event: TimelineEventRow,
): ActivationBatchSummary {
  return {
    activation_id: activationId,
    status: deriveActivationStatus('queued', event.type),
    reason: asOptionalString(data.reason) ?? null,
    task_id: asOptionalString(data.task_id) ?? null,
    event_count: Number(data.event_count ?? 1),
    trigger_event_types: [],
    workflow_events: [],
    latest_event_at: event.created_at.toISOString(),
  };
}

function deriveActivationStatus(currentStatus: string, eventType: string) {
  if (eventType === 'workflow.activation_failed') return 'failed';
  if (eventType === 'workflow.activation_completed') return 'completed';
  if (eventType === 'workflow.activation_requeued') return 'requeued';
  if (eventType === 'workflow.activation_stale_detected') return 'stale_detected';
  if (eventType === 'workflow.activation_started') return 'in_progress';
  if (eventType === 'workflow.activation_queued') return currentStatus === 'requeued' ? 'requeued' : 'queued';
  return currentStatus;
}

function createEscalationChainSummary(
  sourceTaskId: string,
  data: Record<string, unknown>,
  event: TimelineEventRow,
): EscalationChainSummary {
  return {
    source_task_id: sourceTaskId,
    escalation_task_id: asOptionalString(data.escalation_task_id) ?? null,
    target_role: asOptionalString(data.target_role) ?? null,
    work_item_id: asOptionalString(data.work_item_id) ?? null,
    stage_name: asOptionalString(data.stage_name) ?? null,
    status: deriveEscalationStatus('open', event.type),
    event_types: [],
    latest_event_at: event.created_at.toISOString(),
  };
}

function deriveEscalationStatus(currentStatus: string, eventType: string) {
  if (eventType === 'task.escalation_resolved') return 'resolved';
  if (eventType === 'task.escalation_depth_exceeded') return 'blocked';
  if (eventType === 'task.escalation_task_created') return 'delegated';
  if (eventType === 'task.escalation_response_recorded') return 'response_recorded';
  if (eventType === 'task.agent_escalated') return currentStatus === 'resolved' ? currentStatus : 'open';
  return currentStatus;
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

function readTaskCostUsd(task: Record<string, unknown>) {
  return roundCurrency(Number(asRecord(task.metrics).total_cost_usd ?? 0));
}

function roundCurrency(value: number) {
  return Number(value.toFixed(6));
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
  const parentWorkflowId = asOptionalString(metadata.parent_workflow_id);
  const childWorkflowIds = readStringArray(metadata.child_workflow_ids);
  const latestChildWorkflowId = asOptionalString(metadata.latest_child_workflow_id);
  return {
    parent: parentWorkflowId
      ? {
          workflow_id: parentWorkflowId,
          name: null,
          state: 'unknown',
          playbook_id: null,
          playbook_name: null,
          created_at: null,
          started_at: null,
          completed_at: null,
          is_terminal: false,
          link: `/workflows/${parentWorkflowId}`,
        }
      : null,
    children: childWorkflowIds.map((workflowId) => ({
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
    })),
    latest_child_workflow_id: latestChildWorkflowId ?? null,
    child_status_counts: {
      total: childWorkflowIds.length,
      active: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    },
  };
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}
