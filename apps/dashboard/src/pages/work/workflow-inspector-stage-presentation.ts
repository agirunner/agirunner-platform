interface InspectorWorkflowStageRecord {
  lifecycle?: 'standard' | 'continuous' | null;
  work_item_summary?: { active_stage_names?: string[] | null } | null;
  active_stages?: string[] | null;
  current_stage?: string | null;
}

function readLiveStageNames(workflow: InspectorWorkflowStageRecord | undefined): string[] {
  const summaryStages = workflow?.work_item_summary?.active_stage_names?.filter(Boolean) ?? [];
  const activeStages = workflow?.active_stages?.filter(Boolean) ?? [];
  return summaryStages.length > 0 ? summaryStages : activeStages;
}

export function describeWorkflowStageLabel(
  workflow: InspectorWorkflowStageRecord | undefined,
): string {
  return workflow?.lifecycle === 'continuous' ? 'Live stages' : 'Current stage';
}

export function describeWorkflowStageValue(
  workflow: InspectorWorkflowStageRecord | undefined,
): string {
  const liveStages = readLiveStageNames(workflow);
  if (liveStages.length > 0) {
    return liveStages.join(', ');
  }
  if (workflow?.lifecycle === 'continuous') {
    return 'No live stages';
  }
  return workflow?.current_stage ?? 'No current stage';
}

export function describeWorkflowScopeSummary(
  workflow: InspectorWorkflowStageRecord | undefined,
): string {
  return `${describeWorkflowStageLabel(workflow)}: ${describeWorkflowStageValue(workflow)}`;
}
