import {
  describeWorkflowStage,
  type LiveBoardWorkflowRecord,
} from './live-board-support.js';

export function describeWorkflowStageLabel(
  workflow: LiveBoardWorkflowRecord,
): string {
  return workflow.lifecycle === 'continuous' ? 'Live stages' : 'Current stage';
}

export function describeWorkflowStageSummary(
  workflow: LiveBoardWorkflowRecord,
): string {
  return `${describeWorkflowStageLabel(workflow)} · ${describeWorkflowStage(workflow)}`;
}
