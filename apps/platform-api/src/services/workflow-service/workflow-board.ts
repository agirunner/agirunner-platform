import { parsePlaybookDefinition } from '../../orchestration/playbook-model.js';
import {
  isActiveStageStatus,
  type WorkflowStageResponse,
} from '../workflow-stage/workflow-stage-service.js';
import type { WorkflowWorkItemSummary } from './workflow-service.types.js';
import { asOptionalString, asRecord } from './workflow-read-model.js';

export function annotateBoardWorkItems(
  workItems: Array<Record<string, unknown>>,
  terminalColumns: Set<string>,
  reopenedActiveColumnId: string | null,
  workflowState: string | null,
  hasCancelRequest: boolean,
): Array<Record<string, unknown>> {
  const childCounts = new Map<string, { total: number; completed: number }>();

  for (const item of workItems) {
    const parentId = asOptionalString(item.parent_work_item_id);
    if (!parentId) {
      continue;
    }
    const current = childCounts.get(parentId) ?? { total: 0, completed: 0 };
    current.total += 1;
    if (isCompletedBoardChild(item, terminalColumns)) {
      current.completed += 1;
    }
    childCounts.set(parentId, current);
  }

  return workItems.map((item) => {
    const counts = childCounts.get(String(item.id));
    const columnId = resolveBoardColumnId(
      item,
      terminalColumns,
      reopenedActiveColumnId,
      workflowState,
      hasCancelRequest,
    );
    if (!counts) {
      return {
        ...item,
        column_id: columnId,
      };
    }
    return {
      ...item,
      column_id: columnId,
      children_count: counts.total,
      children_completed: counts.completed,
      is_milestone: counts.total > 0,
    };
  });
}

export function buildWorkflowWorkItemSummary(
  workItems: Array<Record<string, unknown>>,
  workflowStages: Array<Pick<WorkflowStageResponse, 'name' | 'position' | 'gate_status'>>,
  terminalColumns: Set<string>,
): WorkflowWorkItemSummary {
  const totalWorkItems = workItems.length;
  const openWorkItems = workItems.filter((item) => isBoardItemOpen(item, terminalColumns));
  const blockedWorkItemCount = openWorkItems.filter((item) => isBlockedBoardItem(item)).length;
  const activeStageNames = orderStageNames(
    uniqueStageNames(openWorkItems.map((item) => item.stage_name)),
    workflowStages,
  );
  const awaitingGateCount = workflowStages.filter((stage) => stage.gate_status === 'awaiting_approval').length;
  return {
    total_work_items: totalWorkItems,
    open_work_item_count: openWorkItems.length,
    blocked_work_item_count: blockedWorkItemCount,
    completed_work_item_count: totalWorkItems - openWorkItems.length,
    active_stage_count: activeStageNames.length,
    awaiting_gate_count: awaitingGateCount,
    active_stage_names: activeStageNames,
  };
}

export function buildBoardStageSummary(
  lifecycle: string,
  stageDefinitions: Array<{ name: string; goal: string }>,
  workflowStages: WorkflowStageResponse[],
  workItems: Array<Record<string, unknown>>,
  terminalColumns: Set<string>,
) {
  const stageNames = new Set<string>();
  if (lifecycle !== 'ongoing') {
    for (const stage of stageDefinitions) {
      stageNames.add(stage.name);
    }
  }
  for (const stage of workflowStages) {
    stageNames.add(stage.name);
  }
  for (const item of workItems) {
    const stageName = asOptionalString(item.stage_name);
    if (stageName) {
      stageNames.add(stageName);
    }
  }

  const workflowStageByName = new Map(workflowStages.map((stage) => [stage.name, stage]));
  const orderedStageNames =
    lifecycle === 'ongoing'
      ? orderStageNames(Array.from(stageNames), workflowStages)
      : Array.from(stageNames);
  return orderedStageNames.map((stageName) => {
    const definition = stageDefinitions.find((stage) => stage.name === stageName);
    const workflowStage = workflowStageByName.get(stageName);
    const stageItems = workItems.filter((item) => item.stage_name === stageName);
    const fallbackCompletedCount = stageItems.filter((item) =>
      isCompletedBoardChild(item, terminalColumns),
    ).length;
    const fallbackOpenCount = stageItems.length - fallbackCompletedCount;
    const workItemCount = workflowStage?.total_work_item_count ?? stageItems.length;
    const openCount = workflowStage?.open_work_item_count ?? fallbackOpenCount;
    const completedCount = Math.max(workItemCount - openCount, 0);
    const status = workflowStage?.status ?? 'pending';
    return {
      name: stageName,
      goal: definition?.goal ?? workflowStage?.goal ?? '',
      status,
      is_active: workflowStage?.is_active ?? isActiveStageStatus(status),
      gate_status: workflowStage?.gate_status ?? 'not_requested',
      work_item_count: workItemCount,
      open_work_item_count: openCount,
      completed_count: completedCount,
    };
  });
}

export function readTerminalColumns(definition: unknown): Set<string> {
  try {
    const parsed = parsePlaybookDefinition(definition);
    return new Set(
      parsed.board.columns
        .filter((column) => Boolean(column.is_terminal))
        .map((column) => String(column.id)),
    );
  } catch {
    return new Set<string>();
  }
}

export function hasWorkflowCancelRequest(metadata: Record<string, unknown>) {
  const value = metadata.cancel_requested_at;
  return typeof value === 'string' && value.length > 0;
}

export function isBoardItemOpen(item: Record<string, unknown>, terminalColumns: Set<string>): boolean {
  return !isCompletedBoardChild(item, terminalColumns);
}

function resolveBoardColumnId(
  item: Record<string, unknown>,
  terminalColumns: Set<string>,
  reopenedActiveColumnId: string | null,
  workflowState: string | null,
  hasCancelRequest: boolean,
): string | null {
  const currentColumnId = asOptionalString(item.column_id) ?? null;
  if (isCompletedBoardChild(item, terminalColumns)) {
    return currentColumnId;
  }
  if ((hasCancelRequest || isTerminalWorkflowState(workflowState)) && terminalColumns.size > 0) {
    return terminalColumns.values().next().value ?? currentColumnId;
  }
  if (currentColumnId && terminalColumns.has(currentColumnId) && reopenedActiveColumnId) {
    return reopenedActiveColumnId;
  }
  return currentColumnId;
}

function isTerminalWorkflowState(workflowState: string | null): boolean {
  return workflowState === 'cancelled' || workflowState === 'completed' || workflowState === 'failed';
}

function isCompletedBoardChild(item: Record<string, unknown>, terminalColumns: Set<string>) {
  void terminalColumns;
  return item.completed_at != null || hasBoardStopMarker(item);
}

function hasBoardStopMarker(item: Record<string, unknown>) {
  const metadata = asRecord(item.metadata);
  return typeof metadata.cancel_requested_at === 'string' && metadata.cancel_requested_at.length > 0;
}

function isBlockedBoardItem(item: Record<string, unknown>) {
  if (item.completed_at != null) {
    return false;
  }
  const blockedState = asOptionalString(item.blocked_state);
  if (blockedState === 'blocked') {
    return true;
  }
  const assessmentStatus = asOptionalString(item.assessment_status);
  if (assessmentStatus === 'blocked') {
    return true;
  }
  const gateStatus = asOptionalString(item.gate_status);
  return gateStatus === 'blocked' || gateStatus === 'changes_requested' || gateStatus === 'rejected';
}

function orderStageNames(
  stageNames: string[],
  workflowStages: Array<Pick<WorkflowStageResponse, 'name'>>,
): string[] {
  const orderedStageNames = workflowStages.map((stage) => stage.name).filter(Boolean);
  const remaining = new Set(stageNames);
  const ordered: string[] = [];

  for (const stageName of orderedStageNames) {
    if (!remaining.has(stageName)) {
      continue;
    }
    ordered.push(stageName);
    remaining.delete(stageName);
  }

  for (const stageName of stageNames) {
    if (!remaining.has(stageName)) {
      continue;
    }
    ordered.push(stageName);
    remaining.delete(stageName);
  }

  return ordered;
}

function uniqueStageNames(values: unknown): string[] {
  const entries = Array.isArray(values) ? values : [];
  return Array.from(
    new Set(
      entries.filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  );
}
