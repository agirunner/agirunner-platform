import { describeWorkflowProgress, type WorkflowListRecord } from './workflow-list-support.js';

export function describeWorkflowStageLabel(workflow: WorkflowListRecord): string {
  return workflow.lifecycle === 'ongoing' ? 'Live stages' : 'Current stage';
}

export function describeWorkflowStageFootnote(workflow: WorkflowListRecord): string {
  const activeCount = workflow.work_item_summary?.active_stage_count ?? 0;
  if (activeCount > 0) {
    return `${activeCount} live stage${activeCount === 1 ? '' : 's'}`;
  }
  return describeWorkflowProgress(workflow);
}
