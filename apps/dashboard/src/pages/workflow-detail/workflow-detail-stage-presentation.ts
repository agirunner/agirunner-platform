export interface WorkflowStageDisplay {
  label: string;
  badgeValue: string | null;
  detailValue: string;
}

interface WorkflowStageRecord {
  lifecycle?: 'planned' | 'ongoing' | null;
  current_stage?: string | null;
  active_stages?: string[] | null;
  work_item_summary?: {
    active_stage_names?: string[] | null;
  } | null;
}

export function deriveWorkflowStageDisplay(
  workflow: WorkflowStageRecord | undefined,
): WorkflowStageDisplay {
  if (!workflow) {
    return {
      label: 'Current stage',
      badgeValue: null,
      detailValue: 'Workflow context unavailable',
    };
  }

  const liveStages = Array.from(
    new Set([
      ...(workflow.work_item_summary?.active_stage_names ?? []),
      ...(workflow.active_stages ?? []),
    ]),
  ).filter((stage) => stage.trim().length > 0);

  if (workflow.lifecycle === 'ongoing') {
    if (liveStages.length > 0) {
      const value = liveStages.join(', ');
      return { label: 'Live stages', badgeValue: value, detailValue: value };
    }
    return {
      label: 'Live stages',
      badgeValue: null,
      detailValue: 'No live stages',
    };
  }

  if (workflow.current_stage) {
    return {
      label: 'Current stage',
      badgeValue: workflow.current_stage,
      detailValue: workflow.current_stage,
    };
  }
  if (liveStages.length > 0) {
    const value = liveStages.join(', ');
    return {
      label: 'Current stage',
      badgeValue: value,
      detailValue: value,
    };
  }
  return {
    label: 'Current stage',
    badgeValue: null,
    detailValue: 'No current stage',
  };
}
