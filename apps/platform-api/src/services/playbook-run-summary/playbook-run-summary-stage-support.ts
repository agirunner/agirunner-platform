import type {
  TimelineEventRow,
  WorkflowGateSummaryRow,
  WorkflowStageSummaryRow,
  WorkflowWorkItemSummaryRow,
} from './playbook-run-summary.types.js';
import {
  asDate,
  asOptionalString,
  asRecord,
  calculateDurationSeconds,
  isGateEvent,
  latestDate,
  minimumDate,
} from './playbook-run-summary-utils.js';

export function normalizeContinuousStages(
  stages: WorkflowStageSummaryRow[],
  workItems: WorkflowWorkItemSummaryRow[],
): WorkflowStageSummaryRow[] {
  return stages.map((stage) => ({
    ...stage,
    status: deriveContinuousStageStatus(stage, workItems),
  }));
}

export function deriveContinuousStageStatus(
  stage: WorkflowStageSummaryRow,
  workItems: WorkflowWorkItemSummaryRow[],
) {
  const stageItems = workItems.filter((item) => item.stage_name === stage.name);
  const openWorkItemCount = stageItems.filter((item) => !item.completed_at).length;
  if (stage.gate_status === 'awaiting_approval') {
    return 'awaiting_gate';
  }
  if (stage.gate_status === 'rejected') {
    return 'blocked';
  }
  if (openWorkItemCount > 0 || stage.gate_status === 'changes_requested') {
    return 'active';
  }
  if (stageItems.length > 0) {
    return 'completed';
  }
  return 'pending';
}

export function buildStageProgression(
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

export function buildStageActivity(
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

export function buildStageTiming(
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

export function buildStageGateHistory(
  gates: WorkflowGateSummaryRow[],
  events: TimelineEventRow[],
  stageName: string,
) {
  const gateHistory = gates
    .filter((gate) => gate.stage_name === stageName)
    .flatMap((gate) => {
      const entries: Array<{
        action: string;
        actor_type: string;
        actor_id: string | null;
        recommendation?: string | null;
        feedback?: string | null;
        acted_at: string;
      }> = [
        {
          action: 'requested',
          actor_type: gate.requested_by_type,
          actor_id: gate.requested_by_id,
          recommendation: gate.recommendation,
          feedback: gate.request_summary,
          acted_at: gate.requested_at.toISOString(),
        },
      ];
      if (gate.decided_at && gate.decided_by_type) {
        entries.push({
          action: normalizeGateDecisionAction(gate.status),
          actor_type: gate.decided_by_type,
          actor_id: gate.decided_by_id,
          recommendation: gate.recommendation,
          feedback: gate.decision_feedback ?? undefined,
          acted_at: gate.decided_at.toISOString(),
        });
      }
      return entries;
    });
  if (gateHistory.length > 0) {
    return gateHistory.sort((left, right) => left.acted_at.localeCompare(right.acted_at));
  }
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

export function countByColumn(workItems: WorkflowWorkItemSummaryRow[]) {
  const counts: Record<string, number> = {};
  for (const item of workItems) {
    counts[item.column_id] = (counts[item.column_id] ?? 0) + 1;
  }
  return counts;
}

export function isContinuousAttentionStageStatus(status: string) {
  return status === 'active' || status === 'awaiting_gate' || status === 'blocked';
}

function normalizeGateDecisionAction(status: string) {
  if (status === 'approved') return 'approve';
  if (status === 'changes_requested') return 'request_changes';
  return status;
}
