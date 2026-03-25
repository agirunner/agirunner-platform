import {
  readAssessmentSubjectLinkage,
  readWorkflowTaskKind,
} from './assessment-subject-service.js';

export type StageRoleCoverageStatus =
  | 'active_in_flight'
  | 'completed_current_subject_assessment'
  | 'completed_task'
  | 'older_assessment'
  | 'missing';

export interface StageRoleCoverageEntry {
  role: string;
  status: StageRoleCoverageStatus;
  description: string;
  contributesToCurrentStage: boolean;
}

interface BuildStageRoleCoverageInput {
  stageName: string | null;
  stageRoles: string[];
  workItemId: string | null;
  currentSubjectRevision: number | null;
  tasks: Record<string, unknown>[];
}

export function buildStageRoleCoverage(
  input: BuildStageRoleCoverageInput,
): StageRoleCoverageEntry[] {
  if (!input.stageName || !input.workItemId || input.stageRoles.length === 0) {
    return [];
  }

  const scopedTasks = input.tasks
    .filter((task) => readString(task.work_item_id) === input.workItemId)
    .filter((task) => readString(task.stage_name) === input.stageName)
    .filter((task) => readString(task.role));

  return input.stageRoles.map((role) => {
    const roleTasks = scopedTasks.filter((task) => readString(task.role) === role);
    const status = describeStageRoleStatus(roleTasks, input.currentSubjectRevision);
    return {
      role,
      status,
      description: formatStageRoleCoverageDescription(status),
      contributesToCurrentStage:
        status === 'completed_current_subject_assessment'
        || status === 'completed_task',
    };
  });
}

function describeStageRoleStatus(
  roleTasks: Record<string, unknown>[],
  currentSubjectRevision: number | null,
): StageRoleCoverageStatus {
  if (roleTasks.some(isOpenTask)) {
    return 'active_in_flight';
  }
  if (roleTasks.some((task) => isCurrentSubjectAssessmentTask(task, currentSubjectRevision) && isCompletedTask(task))) {
    return 'completed_current_subject_assessment';
  }
  if (roleTasks.some((task) => isCompletedTask(task) && !isAssessmentTask(task))) {
    return 'completed_task';
  }
  if (roleTasks.some((task) => isAssessmentTask(task) && isCompletedTask(task))) {
    return 'older_assessment';
  }
  return 'missing';
}

function formatStageRoleCoverageDescription(status: StageRoleCoverageStatus) {
  switch (status) {
    case 'active_in_flight':
      return 'active task already in flight on the current work item.';
    case 'completed_current_subject_assessment':
      return 'completed current-subject assessment recorded on the current work item.';
    case 'completed_task':
      return 'completed task recorded on the current work item.';
    case 'older_assessment':
      return 'older assessment task recorded on the current work item; confirm whether it still applies to the current subject revision.';
    case 'missing':
    default:
      return 'no current task or recorded contribution yet on the current work item.';
  }
}

function isOpenTask(task: Record<string, unknown>) {
  const state = readString(task.state);
  return state === 'ready'
    || state === 'claimed'
    || state === 'in_progress'
    || state === 'awaiting_approval'
    || state === 'output_pending_assessment';
}

function isCompletedTask(task: Record<string, unknown>) {
  const state = readString(task.state);
  return state === 'completed';
}

function isAssessmentTask(task: Record<string, unknown>) {
  return readWorkflowTaskKind(asRecord(task.metadata), Boolean(task.is_orchestrator_task)) === 'assessment';
}

function isCurrentSubjectAssessmentTask(
  task: Record<string, unknown>,
  currentSubjectRevision: number | null,
) {
  if (!isAssessmentTask(task)) {
    return false;
  }
  if (currentSubjectRevision === null) {
    return true;
  }
  const linkage = readAssessmentSubjectLinkage(asRecord(task.input), asRecord(task.metadata));
  return linkage.subjectRevision === currentSubjectRevision;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
