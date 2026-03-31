import type {
  ActivationBatchSummary,
  ArtifactSummaryRow,
  EscalationChainSummary,
  TimelineEventRow,
  WorkflowActivationSummaryRow,
  WorkflowGateSummaryRow,
  WorkflowStageSummaryRow,
  WorkflowWorkItemSummaryRow,
} from './playbook-run-summary.types.js';
import {
  appendUnique,
  asOptionalString,
  asRecord,
  CHILD_WORKFLOW_EVENT_TYPES,
  countEvents,
  deriveActivationStatus,
  deriveActivationStatusFromRow,
  isGateEvent,
  latestActivationTimestamp,
  latestDate,
  maxIsoTimestamp,
  readActivationRecoveryStatus,
  readTaskCostUsd,
  roundCurrency,
} from './playbook-run-summary-utils.js';
import { countByColumn, isContinuousAttentionStageStatus } from './playbook-run-summary-stage-support.js';

export function buildActivationActivity(
  activations: WorkflowActivationSummaryRow[],
  events: TimelineEventRow[],
) {
  const activationEvents = events.filter((event) => event.type.startsWith('workflow.activation_'));
  const activationRows = activations.filter((row) => row.activation_id);
  const batches = new Map<string, ActivationBatchSummary>();

  for (const row of activationRows) {
    const activationId = row.activation_id;
    if (!activationId) continue;
    const batch = batches.get(activationId) ?? {
      activation_id: activationId,
      status: deriveActivationStatusFromRow(row),
      reason: row.reason ?? null,
      task_id: row.task_id ?? null,
      event_count: 0,
      trigger_event_types: [],
      workflow_events: [],
      latest_event_at: latestActivationTimestamp(row),
    };
    batch.status = deriveActivationStatusFromRow(row);
    batch.reason = batch.reason ?? row.reason ?? null;
    batch.task_id = batch.task_id ?? row.task_id ?? null;
    batch.event_count += 1;
    batch.trigger_event_types = appendUnique(batch.trigger_event_types, row.event_type);
    batch.latest_event_at = maxIsoTimestamp(batch.latest_event_at, latestActivationTimestamp(row));
    batches.set(activationId, batch);
  }

  for (const event of activationEvents) {
    const data = asRecord(event.data);
    const activationId = asOptionalString(data.activation_id);
    if (!activationId) continue;
    const batch = batches.get(activationId) ?? createActivationBatchSummary(activationId, data, event);
    batch.workflow_events.push(event.type);
    batch.trigger_event_types = appendUnique(batch.trigger_event_types, asOptionalString(data.event_type));
    batch.reason = batch.reason ?? asOptionalString(data.reason) ?? null;
    batch.task_id = batch.task_id ?? asOptionalString(data.task_id) ?? null;
    if (activationRows.length === 0) {
      batch.event_count = Math.max(batch.event_count, Number(data.event_count ?? batch.event_count));
    }
    batch.latest_event_at = event.created_at.toISOString();
    batch.status = deriveActivationStatus(batch.status, event.type);
    batches.set(activationId, batch);
  }

  const orderedBatches = [...batches.values()].sort((left, right) =>
    left.latest_event_at.localeCompare(right.latest_event_at),
  );
  const staleDetectedCount =
    activationRows.length > 0
      ? activationRows.filter((row) => readActivationRecoveryStatus(row.error) === 'stale_detected').length
      : countEvents(activationEvents, 'workflow.activation_stale_detected');
  const requeuedCount =
    activationRows.length > 0
      ? activationRows.filter((row) => readActivationRecoveryStatus(row.error) === 'requeued').length
      : countEvents(activationEvents, 'workflow.activation_requeued');
  return {
    total_events: activationRows.length > 0 ? activationRows.length : activationEvents.length,
    queued_count:
      activationRows.length > 0
        ? activationRows.filter((row) => row.state === 'queued').length
        : countEvents(activationEvents, 'workflow.activation_queued'),
    started_count:
      activationRows.length > 0
        ? activationRows.filter((row) => row.started_at).length
        : countEvents(activationEvents, 'workflow.activation_started'),
    completed_count:
      activationRows.length > 0
        ? activationRows.filter((row) => row.state === 'completed').length
        : countEvents(activationEvents, 'workflow.activation_completed'),
    failed_count:
      activationRows.length > 0
        ? activationRows.filter((row) => row.state === 'failed').length
        : countEvents(activationEvents, 'workflow.activation_failed'),
    requeued_count: requeuedCount,
    stale_detected_count: staleDetectedCount,
    latest_activation_id: orderedBatches[orderedBatches.length - 1]?.activation_id ?? null,
    latest_event_at: orderedBatches[orderedBatches.length - 1]?.latest_event_at ?? null,
    batches: orderedBatches,
  };
}

export function buildWorkItemActivity(
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

export function buildGateActivity(
  stages: WorkflowStageSummaryRow[],
  gates: WorkflowGateSummaryRow[],
  events: TimelineEventRow[],
) {
  const gateEvents = events.filter((event) => isGateEvent(event.type));
  const openGateCount =
    gates.length > 0
      ? gates.filter((gate) => gate.status === 'awaiting_approval').length
      : stages.filter((stage) => stage.gate_status === 'awaiting_approval').length;
  const latestGateEventAt =
    gates.length > 0
      ? latestDate([...gates.map((gate) => gate.decided_at), ...gates.map((gate) => gate.requested_at)])
          ?.toISOString() ?? null
      : gateEvents[gateEvents.length - 1]?.created_at.toISOString() ?? null;
  return {
    open_gate_count: openGateCount,
    requested_count:
      gates.length > 0 ? gates.length : countEvents(gateEvents, 'stage.gate_requested'),
    approved_count:
      gates.length > 0
        ? gates.filter((gate) => gate.status === 'approved').length
        : countEvents(gateEvents, 'stage.gate.approve'),
    rejected_count:
      gates.length > 0
        ? gates.filter((gate) => gate.status === 'rejected').length
        : countEvents(gateEvents, 'stage.gate.reject'),
    changes_requested_count:
      gates.length > 0
        ? gates.filter((gate) => gate.status === 'changes_requested').length
        : countEvents(gateEvents, 'stage.gate.request_changes'),
    attention_stage_names: stages
      .filter((stage) => ['awaiting_approval', 'changes_requested', 'rejected'].includes(stage.gate_status))
      .map((stage) => stage.name),
    latest_gate_event_at: latestGateEventAt,
  };
}

export function buildEscalationActivity(
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

export function buildChildWorkflowActivity(
  metadata: Record<string, unknown>,
  relations: Record<string, unknown>,
  events: TimelineEventRow[],
) {
  const childEvents = events.filter((event) => {
    const data = asRecord(event.data);
    const nestedEventType = asOptionalString(data.event_type);
    const eventType = nestedEventType ?? event.type;
    return CHILD_WORKFLOW_EVENT_TYPES.has(eventType) && Boolean(asOptionalString(data.child_workflow_id));
  });
  const transitions = childEvents
    .map((event) => {
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
    })
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
  const relationChildren = Array.isArray(relations.children)
    ? relations.children.filter(
        (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object',
      )
    : [];
  const childStatusCounts = asRecord(relations.child_status_counts);
  const parent = asRecord(relations.parent);

  return {
    source_workflow_id:
      asOptionalString(parent.workflow_id) ??
      asOptionalString(metadata.parent_workflow_id) ??
      null,
    child_workflow_count: relationChildren.length,
    child_status_counts: childStatusCounts,
    completion_event_count:
      transitions.filter((entry) => entry.event_type === 'child_workflow.completed').length,
    failure_event_count:
      transitions.filter((entry) => entry.event_type === 'child_workflow.failed').length,
    cancellation_event_count:
      transitions.filter((entry) => entry.event_type === 'child_workflow.cancelled').length,
    latest_child_workflow_id:
      asOptionalString(relations.latest_child_workflow_id) ??
      asOptionalString(metadata.latest_child_workflow_id) ??
      transitions[transitions.length - 1]?.child_workflow_id ??
      null,
    transitions,
  };
}

export function buildProducedArtifacts(
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

export function buildOrchestratorAnalytics(
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
    rework_rate: tasks.length > 0 ? Number((reworkedTasks.length / tasks.length).toFixed(4)) : 0,
    total_cost_usd: roundCurrency(tasks.reduce((sum, task) => sum + readTaskCostUsd(task), 0)),
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
      Number((right as Record<string, unknown>).total_cost_usd) -
      Number((left as Record<string, unknown>).total_cost_usd),
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
