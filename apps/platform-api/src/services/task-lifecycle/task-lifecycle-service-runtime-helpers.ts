import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import {
  activeColumnId,
  defaultColumnId,
  parsePlaybookDefinition,
} from '../../orchestration/playbook-model.js';
import type { TaskState } from '../../orchestration/task-state-machine.js';
import {
  calculateRetryBackoffSeconds,
  type EscalationPolicy,
  type LifecyclePolicy,
  type RetryPolicy,
} from './task-lifecycle-policy.js';
import { readAssessmentSubjectLinkage } from '../workflow-task-policy/assessment-subject-service.js';
import {
  ACTIVE_PARALLELISM_SLOT_STATES,
  asRecord,
  isJsonEquivalent,
  readAssessmentFeedback,
  readOptionalText,
  readTaskKind,
  type ReworkWorkItemContextRow,
} from './task-lifecycle-service-core-helpers.js';

export function isAssessmentTask(task: Record<string, unknown>) {
  if (readTaskKind(task) === 'assessment') {
    return true;
  }

  return readAssessmentSubjectLinkage(task.input, task.metadata).subjectTaskId !== null;
}

export interface FailureClassification {
  category: string;
  retryable: boolean;
  recoverable: boolean;
}

export interface RetryPlan {
  shouldRetry: boolean;
  backoffSeconds: number;
  retryAvailableAt: Date | null;
  policy?: RetryPolicy;
}

export function classifyFailure(error: Record<string, unknown>): FailureClassification {
  const category =
    typeof error.category === 'string' && error.category.trim().length > 0
      ? error.category
      : 'unknown';
  if (typeof error.recoverable === 'boolean') {
    return {
      category,
      retryable: error.recoverable,
      recoverable: error.recoverable,
    };
  }

  const retryableCategories = new Set([
    'timeout',
    'transient_error',
    'resource_unavailable',
    'network_error',
  ]);
  const retryable = retryableCategories.has(category);
  return {
    category,
    retryable,
    recoverable: retryable,
  };
}

export function buildRetryPlan(
  task: Record<string, unknown>,
  lifecyclePolicy: LifecyclePolicy | undefined,
  failure: FailureClassification,
): RetryPlan {
  const policy = lifecyclePolicy?.retry_policy;
  if (policy) {
    const retryableCategories = new Set(policy.retryable_categories);
    const shouldRetry =
      failure.retryable &&
      retryableCategories.has(failure.category) &&
      Number(task.retry_count) < policy.max_attempts;
    const attemptNumber = Number(task.retry_count) + 1;
    const backoffSeconds = shouldRetry
      ? calculateRetryBackoffSeconds(policy, attemptNumber)
      : 0;
    return {
      shouldRetry,
      backoffSeconds,
      retryAvailableAt: shouldRetry ? new Date(Date.now() + backoffSeconds * 1000) : null,
      policy,
    };
  }

  // No lifecycle policy = no retry.
  return { shouldRetry: false, backoffSeconds: 0, retryAvailableAt: null };
}

export function buildEscalationTaskInput(
  task: Record<string, unknown>,
  escalation: EscalationPolicy,
  failure: FailureClassification,
) {
  const title = escalation.title_template.replace('{{task_title}}', String(task.title ?? 'task'));
  return {
    title,
    role: escalation.role,
    priority: 'high',
    workflow_id: task.workflow_id as string | undefined,
    work_item_id: task.work_item_id as string | undefined,
    workspace_id: task.workspace_id as string | undefined,
    stage_name: task.stage_name as string | undefined,
    parent_id: task.id as string,
    input: {
      source_task_id: task.id,
      source_task_title: task.title,
      source_task_role: task.role,
      failure,
      error: task.error ?? null,
      assessment_feedback: readAssessmentFeedback(asRecord(task.metadata)),
      retry_count: task.retry_count ?? 0,
      allowed_actions: ['retry_modified', 'reassign', 'skip', 'fail_workflow'],
    },
    context: {
      escalation: true,
    },
    metadata: {
      escalation_source_task_id: task.id,
      escalation_source_state: task.state,
    },
    role_config: escalation.instructions
      ? { system_prompt: escalation.instructions }
      : undefined,
  };
}

export function isFailTaskReplay(task: Record<string, unknown>, error: Record<string, unknown>): boolean {
  if (task.state === 'failed' && isJsonEquivalent(task.error, error)) {
    return true;
  }
  const metadata = asRecord(task.metadata);
  if (
    (task.state === 'pending' || task.state === 'ready') &&
    isJsonEquivalent(metadata.retry_last_error, error)
  ) {
    return true;
  }
  return false;
}

export interface OperatorReportingContract {
  mode: 'standard' | 'enhanced';
  executionContextId: string;
  sourceKind: 'orchestrator' | 'specialist';
  turnUpdatesRequired: boolean;
  milestoneBriefsRequired: boolean;
  operatorUpdateRequestIdPrefix: string;
  operatorBriefRequestIdPrefix: string;
}

export async function readOperatorReportingContract(
  pool: DatabasePool,
  tenantId: string,
  task: Record<string, unknown>,
  client?: DatabaseClient,
): Promise<OperatorReportingContract | null> {
  const workflowId = readOptionalText(task.workflow_id);
  const taskId = readOptionalText(task.id);
  if (!workflowId || !taskId) {
    return null;
  }
  const db = client ?? pool;
  const workflowResult = await db.query<{
    live_visibility_mode_override: string | null;
    activation_id: string | null;
    is_orchestrator_task: boolean;
  }>(
    `SELECT w.live_visibility_mode_override,
            t.activation_id::text AS activation_id,
            t.is_orchestrator_task
       FROM tasks t
       JOIN workflows w
         ON w.tenant_id = t.tenant_id
        AND w.id = t.workflow_id
      WHERE t.tenant_id = $1
        AND t.id = $2
      LIMIT 1`,
    [tenantId, taskId],
  );
  const workflowRow = workflowResult.rows[0];
  if (!workflowRow) {
    return null;
  }
  const settingsResult = await db.query<{ live_visibility_mode_default: string }>(
    `SELECT live_visibility_mode_default
       FROM agentic_settings
      WHERE tenant_id = $1`,
    [tenantId],
  );
  const mode = normalizeReportingMode(
    workflowRow.live_visibility_mode_override ?? settingsResult.rows[0]?.live_visibility_mode_default,
  );
  const isOrchestratorTask = workflowRow.is_orchestrator_task === true;
  const executionContextId = isOrchestratorTask
    ? readOptionalText(workflowRow.activation_id)
    : taskId;
  if (!executionContextId) {
    return null;
  }
  return {
    mode,
    executionContextId,
    sourceKind: isOrchestratorTask ? 'orchestrator' : 'specialist',
    turnUpdatesRequired: false,
    milestoneBriefsRequired: true,
    operatorUpdateRequestIdPrefix: `operator-update:${executionContextId}:`,
    operatorBriefRequestIdPrefix: `operator-brief:${executionContextId}:`,
  };
}

export function normalizeReportingMode(value: string | null | undefined): 'standard' | 'enhanced' {
  return value === 'standard' ? 'standard' : 'enhanced';
}

export async function hasOperatorBriefForExecutionContext(
  pool: DatabasePool,
  tenantId: string,
  workflowId: string,
  executionContextId: string,
  client?: DatabaseClient,
): Promise<boolean> {
  const db = client ?? pool;
  const result = await db.query<{ id: string }>(
    `SELECT id
       FROM workflow_operator_briefs
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND execution_context_id = $3
      LIMIT 1`,
    [tenantId, workflowId, executionContextId],
  );
  return (result.rowCount ?? 0) > 0;
}

export function buildMissingMilestoneBriefMessage(contract: OperatorReportingContract): string {
  return `This task reached a meaningful completion or handoff checkpoint without the required record_operator_brief for execution context ${contract.executionContextId}. Emit one milestone record_operator_brief with source_kind ${contract.sourceKind}, payload.short_brief.headline, and payload.detailed_brief_json.{headline,status_kind,summary} before retrying completion. Use request_id values starting with ${contract.operatorBriefRequestIdPrefix}.`;
}

export function releasesParallelismSlot(previousState: TaskState, nextState: TaskState) {
  return (
    ACTIVE_PARALLELISM_SLOT_STATES.includes(previousState) &&
    !ACTIVE_PARALLELISM_SLOT_STATES.includes(nextState)
  );
}

export function resolveReopenColumnId(input: {
  definition: ReturnType<typeof parsePlaybookDefinition>;
  currentColumnId: string | null;
  workflowState: string | null;
  workflowMetadata: unknown;
}): string | null {
  if (
    input.workflowState === 'paused'
    || input.workflowState === 'cancelled'
    || hasPendingWorkflowCancel(input.workflowMetadata)
  ) {
    return input.currentColumnId;
  }

  return activeColumnId(input.definition) ?? defaultColumnId(input.definition) ?? input.currentColumnId;
}

export function shouldReopenWorkItemForRework(
  definition: ReturnType<typeof parsePlaybookDefinition>,
  workItem: ReworkWorkItemContextRow,
): boolean {
  if (workItem.completed_at) {
    return true;
  }
  if (!workItem.column_id) {
    return false;
  }
  return definition.board.columns.some(
    (column) => column.id === workItem.column_id && column.is_terminal === true,
  );
}

export function hasPendingWorkflowCancel(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return false;
  }

  const value = (metadata as Record<string, unknown>).cancel_requested_at;
  return typeof value === 'string' && value.trim().length > 0;
}

export interface WorkflowActivationTransition {
  requestId: string;
  reason: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export function buildWorkflowActivationForTaskTransition(
  taskId: string,
  previousTask: Record<string, unknown>,
  updatedTask: Record<string, unknown>,
  nextState: TaskState,
  transitionReason?: string,
): WorkflowActivationTransition | null {
  const reason = resolveWorkflowActivationTransitionReason(nextState, transitionReason);
  if (!reason) {
    return null;
  }
  return {
    requestId: `${reason.requestPrefix}:${taskId}:${String(updatedTask.updated_at ?? updatedTask.completed_at ?? '')}`,
    reason: reason.eventType,
    eventType: reason.eventType,
    payload: {
      task_id: taskId,
      task_role: previousTask.role ?? null,
      task_title: previousTask.title ?? null,
      work_item_id: previousTask.work_item_id ?? null,
      stage_name: previousTask.stage_name ?? null,
    },
  };
}

export function resolveWorkflowActivationTransitionReason(
  nextState: TaskState,
  transitionReason?: string,
): { requestPrefix: string; eventType: string } | null {
  if (nextState === 'failed') {
    return {
      requestPrefix: 'task-failed',
      eventType: 'task.failed',
    };
  }
  if (nextState === 'output_pending_assessment') {
    return {
      requestPrefix: 'task-output-pending-assessment',
      eventType: 'task.output_pending_assessment',
    };
  }
  if ((nextState === 'ready' || nextState === 'pending') && transitionReason === 'approved') {
    return {
      requestPrefix: 'task-approved',
      eventType: 'task.approved',
    };
  }
  if ((nextState === 'ready' || nextState === 'pending') && transitionReason === 'assessment_requested_changes') {
    return {
      requestPrefix: 'task-assessment-requested',
      eventType: 'task.assessment_requested_changes',
    };
  }
  return null;
}
