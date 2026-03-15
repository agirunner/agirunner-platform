import type { DashboardWorkflowBoardResponse } from '../../lib/api.js';
import {
  describeWorkflowStage,
  type LiveBoardWorkflowRecord,
} from './live-board-support.js';

export interface WorkflowStageProgressStep {
  name: string;
  tone: 'done' | 'active' | 'attention' | 'pending';
  detail: string;
}

export function describeWorkflowStageLabel(
  workflow: LiveBoardWorkflowRecord,
): string {
  return workflow.lifecycle === 'ongoing' ? 'Live stages' : 'Current stage';
}

export function describeWorkflowStageSummary(
  workflow: LiveBoardWorkflowRecord,
): string {
  return `${describeWorkflowStageLabel(workflow)} · ${describeWorkflowStage(workflow)}`;
}

export function buildWorkflowStageProgressSteps(
  workflow: LiveBoardWorkflowRecord,
  board?: DashboardWorkflowBoardResponse,
): WorkflowStageProgressStep[] {
  const stageSummary = board?.stage_summary ?? [];
  if (stageSummary.length > 0) {
    return stageSummary.map((stage) => ({
      name: stage.name,
      tone: classifyStageTone(stage),
      detail: describeStageDetail(stage),
    }));
  }

  const stageNames =
    workflow.lifecycle === 'ongoing'
      ? workflow.active_stages ?? workflow.work_item_summary?.active_stage_names ?? []
      : [workflow.current_stage ?? ''].filter((stage) => stage.trim().length > 0);
  return stageNames.map((name) => ({
    name,
    tone: 'active',
    detail: workflow.lifecycle === 'ongoing' ? 'Live work in flight' : 'Current stage',
  }));
}

export function describeWorkflowStageProgressSummary(
  workflow: LiveBoardWorkflowRecord,
  board?: DashboardWorkflowBoardResponse,
): string {
  const steps = buildWorkflowStageProgressSteps(workflow, board);
  if (steps.length === 0) {
    return workflow.lifecycle === 'ongoing' ? 'No live stages yet' : 'No stage progress yet';
  }
  if (workflow.lifecycle === 'ongoing') {
    return `${steps.length} live stage${steps.length === 1 ? '' : 's'} tracked`;
  }
  const completedCount = steps.filter((step) => step.tone === 'done').length;
  const activeCount = steps.filter(
    (step) => step.tone === 'active' || step.tone === 'attention',
  ).length;
  return activeCount > 0
    ? `${completedCount} of ${steps.length} stages complete • ${activeCount} active`
    : `${completedCount} of ${steps.length} stages complete`;
}

function classifyStageTone(
  stage: DashboardWorkflowBoardResponse['stage_summary'][number],
): WorkflowStageProgressStep['tone'] {
  if (stage.gate_status === 'requested' || stage.gate_status === 'awaiting_approval') {
    return 'attention';
  }
  if (stage.is_active) {
    return 'active';
  }
  if (
    stage.status === 'completed' ||
    stage.status === 'done' ||
    (stage.completed_count > 0 && stage.open_work_item_count === 0)
  ) {
    return 'done';
  }
  return 'pending';
}

function describeStageDetail(
  stage: DashboardWorkflowBoardResponse['stage_summary'][number],
): string {
  if (stage.gate_status === 'requested' || stage.gate_status === 'awaiting_approval') {
    return 'Gate review waiting';
  }
  if (stage.is_active) {
    return `${stage.open_work_item_count} open work item${stage.open_work_item_count === 1 ? '' : 's'}`;
  }
  if (stage.completed_count > 0 && stage.open_work_item_count === 0) {
    return `${stage.completed_count} complete`;
  }
  return stage.work_item_count > 0
    ? `${stage.work_item_count} tracked work item${stage.work_item_count === 1 ? '' : 's'}`
    : 'Waiting to start';
}
