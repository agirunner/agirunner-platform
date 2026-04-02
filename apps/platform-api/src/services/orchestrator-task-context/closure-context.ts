import {
  guidedClosureContextSchema,
  type GuidedClosureContext,
  type GuidedClosureSuggestedAction,
} from '../guided-closure/types.js';
import { buildStageRoleCoverage } from '../workflow-stage/stage-role-coverage.js';
import {
  type EscalationRow,
  type StageGateRow,
  type ToolResultRow,
  asRecord,
  isOpenSpecialistTask,
  readOptionalNumber,
  readOptionalPositiveInteger,
  readOptionalString,
  selectFocusedWorkItemForClosure,
} from './helpers.js';
import { nextStageNameFor } from '../playbook-workflow-control/playbook-workflow-control-utils.js';

export function buildClosureContext(params: {
  definition: { stages: Array<{ name: string; involves?: string[] }> };
  lifecycle: 'planned' | 'ongoing';
  workItems: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
  stageGates: StageGateRow[];
  escalations: EscalationRow[];
  toolResults: ToolResultRow[];
  focusWorkItemId: string | null;
  focusStageName: string | null;
}): GuidedClosureContext {
  const focusedWorkItem = selectFocusedWorkItemForClosure(params.workItems, params.focusWorkItemId, params.focusStageName);
  const focusedStageName = readOptionalString(focusedWorkItem.stage_name) ?? params.focusStageName;
  const focusedWorkItemId = readOptionalString(focusedWorkItem.id) ?? params.focusWorkItemId;
  const currentSubjectRevision = readOptionalPositiveInteger(focusedWorkItem.current_subject_revision);
  const stage = focusedStageName
    ? params.definition.stages.find((entry) => entry.name === focusedStageName) ?? null
    : null;
  const nextStageName = focusedStageName ? nextStageNameFor(params.definition, focusedStageName) : null;
  const stageRoles = (stage?.involves ?? [])
    .map((role) => role.trim())
    .filter((role) => role.length > 0);
  const roleCoverage = buildStageRoleCoverage({
    stageName: focusedStageName,
    stageRoles,
    workItemId: focusedWorkItemId,
    currentSubjectRevision,
    tasks: params.tasks,
  });

  const activeBlockingControls = [
    ...summarizeStageGates(params.stageGates, focusedStageName, focusedWorkItemId, 'blocking'),
    ...summarizeEscalations(params.escalations, focusedWorkItemId, 'blocking'),
  ];
  const activeAdvisoryControls = [
    ...summarizeStageGates(params.stageGates, focusedStageName, focusedWorkItemId, 'advisory'),
    ...summarizeEscalations(params.escalations, focusedWorkItemId, 'advisory'),
  ];
  const preferredObligations = roleCoverage
    .filter((entry) => entry.status === 'missing' || entry.status === 'older_assessment')
    .map((entry) => ({
      code: 'stage_role_contribution' as const,
      status: 'unmet' as const,
      subject: entry.role,
    }));
  const recentRecoveryOutcomes = params.toolResults
    .filter((row) => row.mutation_outcome && row.mutation_outcome !== 'applied' && row.recovery_class)
    .slice(0, 5)
    .map((row) => ({
      recovery_class: row.recovery_class as string,
      suggested_next_actions: normalizeSuggestedNextActions(asRecord(row.response).suggested_next_actions),
    }));
  const specialistTasks = params.tasks.filter((row) => row.is_orchestrator_task !== true);
  const attemptCountByWorkItem = countAttemptsByKey(
    specialistTasks.map((row) => readOptionalString(row.work_item_id)).filter((value): value is string => Boolean(value)),
  );
  const attemptCountByRole = countAttemptsByKey(
    specialistTasks.map((row) => readOptionalString(row.role)).filter((value): value is string => Boolean(value)),
  );
  const recentFailures = specialistTasks
    .filter((row) => isFailureState(readOptionalString(row.state)))
    .map((row) => ({
      task_id: readOptionalString(row.id) ?? 'unknown-task',
      role: readOptionalString(row.role),
      state: readOptionalString(row.state) ?? 'failed',
      why: readFailureReason(row),
    }))
    .filter((row) => row.why.length > 0)
    .slice(0, 10);
  const retryTask = specialistTasks.find((row) => {
    const retryAvailableAt = readOptionalString(asRecord(row.metadata).retry_available_at);
    return Boolean(retryAvailableAt) && isFailureState(readOptionalString(row.state));
  });
  const retryMetadata = retryTask ? asRecord(retryTask.metadata) : {};
  const retryWindow = readOptionalString(retryMetadata.retry_available_at)
    ? {
        retry_available_at: readOptionalString(retryMetadata.retry_available_at) as string,
        backoff_seconds: readOptionalNumber(retryMetadata.retry_backoff_seconds) ?? 0,
      }
    : null;
  const lastRetryReason = retryTask ? readFailureReason(retryTask) : recentFailures[0]?.why ?? null;
  const rerouteCandidates = Array.from(
    new Set(
      [
        ...preferredObligations.map((entry) => entry.subject),
        ...recentFailures.map((entry) => entry.role).filter((value): value is string => Boolean(value)),
      ].filter((value) => value.length > 0),
    ),
  );
  const focusedOpenSpecialistTasks = specialistTasks.filter(
    (row) =>
      readOptionalString(row.work_item_id) === focusedWorkItemId
      && isOpenSpecialistTask(row),
  );
  const openSpecialistTaskRoles = Array.from(
    new Set(
      focusedOpenSpecialistTasks
        .map((row) => readOptionalString(row.role))
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const focusedWorkItemCompleted = focusedWorkItem.completed_at !== null && focusedWorkItem.completed_at !== undefined;
  const workItemCanCloseNow = !focusedWorkItemCompleted
    && activeBlockingControls.length === 0
    && focusedOpenSpecialistTasks.length === 0;
  const workflowCanCloseNow = params.workItems.every((row) => row.completed_at !== null && row.completed_at !== undefined)
    && specialistTasks.every((row) => !isOpenSpecialistTask(row))
    && activeBlockingControls.length === 0
    && !nextStageName;
  const closureReadiness = activeBlockingControls.length > 0
    ? 'blocked'
    : activeAdvisoryControls.length > 0 || preferredObligations.length > 0
      ? 'can_close_with_callouts'
      : workItemCanCloseNow
        ? 'ready_to_close'
        : 'not_ready';

  return guidedClosureContextSchema.parse({
    workflow_can_close_now: workflowCanCloseNow,
    work_item_can_close_now: workItemCanCloseNow,
    active_blocking_controls: activeBlockingControls,
    active_advisory_controls: activeAdvisoryControls,
    preferred_obligations: preferredObligations,
    closure_readiness: closureReadiness,
    open_specialist_task_count: focusedOpenSpecialistTasks.length,
    open_specialist_task_roles: openSpecialistTaskRoles,
    recent_recovery_outcomes: recentRecoveryOutcomes,
    attempt_count_by_work_item: attemptCountByWorkItem,
    attempt_count_by_role: attemptCountByRole,
    recent_failures: recentFailures,
    last_retry_reason: lastRetryReason,
    retry_window: retryWindow,
    reroute_candidates: rerouteCandidates,
  });
}

function summarizeStageGates(
  rows: StageGateRow[],
  stageName: string | null,
  workItemId: string | null,
  closureEffect: 'blocking' | 'advisory',
) {
  return rows
    .filter((row) => (row.status ?? 'awaiting_approval') === 'awaiting_approval')
    .filter((row) => normalizeClosureEffect(row.closure_effect) === closureEffect)
    .filter((row) => !stageName || row.stage_name === stageName)
    .filter((row) => !workItemId || !row.requested_by_work_item_id || row.requested_by_work_item_id === workItemId)
    .map((row) => ({
      kind: 'approval',
      id: row.id,
      closure_effect: closureEffect,
      summary: row.request_summary ?? `Approval remains ${closureEffect}.`,
    }));
}

function summarizeEscalations(
  rows: EscalationRow[],
  workItemId: string | null,
  closureEffect: 'blocking' | 'advisory',
) {
  return rows
    .filter((row) => (row.status ?? 'open') === 'open')
    .filter((row) => normalizeClosureEffect(row.closure_effect) === closureEffect)
    .filter((row) => !workItemId || !row.work_item_id || row.work_item_id === workItemId)
    .map((row) => ({
      kind: 'escalation',
      id: row.id,
      closure_effect: closureEffect,
      summary: row.reason,
    }));
}

function normalizeSuggestedNextActions(value: unknown): GuidedClosureSuggestedAction[] {
  const entries = Array.isArray(value) ? value : [];
  return entries
    .map((entry) => asRecord(entry))
    .filter((entry) =>
      typeof entry.action_code === 'string'
      && typeof entry.target_type === 'string'
      && typeof entry.target_id === 'string'
      && typeof entry.why === 'string'
      && typeof entry.requires_orchestrator_judgment === 'boolean',
    )
    .map((entry) => ({
      action_code: entry.action_code as string,
      target_type: entry.target_type as string,
      target_id: entry.target_id as string,
      why: entry.why as string,
      requires_orchestrator_judgment: entry.requires_orchestrator_judgment as boolean,
    }));
}

function countAttemptsByKey(values: string[]) {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function isFailureState(state: string | null) {
  return state === 'failed' || state === 'escalated';
}

function readFailureReason(task: Record<string, unknown>) {
  const metadata = asRecord(task.metadata);
  return readOptionalString(metadata.retry_last_error)
    ?? readOptionalString(asRecord(task.error).message)
    ?? readOptionalString(asRecord(task.error).error)
    ?? 'task failed without a structured reason';
}

function normalizeClosureEffect(value: string | null) {
  return value === 'advisory' ? 'advisory' : 'blocking';
}
