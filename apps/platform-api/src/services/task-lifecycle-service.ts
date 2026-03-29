import type { ApiKeyIdentity } from '../auth/api-key.js';
import { validateOutputSchema } from '../validation/output-validator.js';
import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { ConflictError, ForbiddenError, ValidationError } from '../errors/domain-errors.js';
import type { LogService } from '../logging/log-service.js';
import { logTaskGovernanceTransition } from '../logging/task-governance-log.js';
import {
  assertValidTransition,
  normalizeTaskState,
  toStoredTaskState,
  type TaskState,
} from '../orchestration/task-state-machine.js';
import {
  activeColumnId,
  defaultColumnId,
  parsePlaybookDefinition,
} from '../orchestration/playbook-model.js';
import type { ArtifactService } from './artifact-service.js';
import { applyTaskCompletionSideEffects } from './task-completion-side-effects.js';
import { registerTaskOutputDocuments } from './document-reference-service.js';
import { EventService } from './event-service.js';
import { areJsonValuesEquivalent } from './json-equivalence.js';
import { PlaybookTaskParallelismService } from './playbook-task-parallelism-service.js';
import { WorkflowStateService } from './workflow-state-service.js';
import { applyOutputStateDeclarations } from './task-output-storage.js';
import type { HandoffService } from './handoff-service.js';
import type { WorkItemContinuityService } from './work-item-continuity-service.js';
import type { ExecutionContainerLeaseService } from './execution-container-lease-service.js';
import {
  calculateRetryBackoffSeconds,
  readPersistedLifecyclePolicy,
  type EscalationPolicy,
  type LifecyclePolicy,
  type RetryPolicy,
} from './task-lifecycle-policy.js';
import {
  readPositiveInteger,
  readRequiredPositiveIntegerRuntimeDefault,
  TASK_DEFAULT_TIMEOUT_MINUTES_RUNTIME_KEY,
} from './runtime-default-values.js';
import {
  sanitizeSecretLikeValue,
  sanitizeSecretLikeRecord,
} from './secret-redaction.js';
import {
  loadOpenWorkItemEscalation,
  openWorkItemEscalation,
  resolveWorkItemEscalation,
} from './work-item-escalations.js';
import {
  enqueueAndDispatchImmediatePlaybookActivation,
  type ImmediateWorkflowActivationDispatcher,
} from './workflow-immediate-activation.js';
import { readAssessmentSubjectLinkage } from './assessment-subject-service.js';
import { supersedeCurrentFinalDeliverablesForWorkItem } from './workflow-deliverable-lifecycle-service.js';

interface TransitionOptions {
  expectedStates: TaskState[];
  requireAssignment?: { agentId?: string; workerId?: string };
  output?: unknown;
  error?: unknown;
  metrics?: Record<string, unknown>;
  gitInfo?: Record<string, unknown>;
  verification?: Record<string, unknown>;
  reason?: string;
  retryIncrement?: boolean;
  reworkIncrement?: boolean;
  clearAssignment?: boolean;
  clearExecutionData?: boolean;
  clearLifecycleControlMetadata?: boolean;
  clearEscalationMetadata?: boolean;
  startedAt?: Date;
  overrideInput?: Record<string, unknown>;
  metadataPatch?: Record<string, unknown>;
  afterUpdate?: (
    updatedTask: Record<string, unknown>,
    client: DatabaseClient,
  ) => Promise<void>;
}

interface TaskLifecycleDependencies {
  pool: DatabasePool;
  eventService: EventService;
  logService?: LogService;
  activationDispatchService?: ImmediateWorkflowActivationDispatcher;
  workflowStateService: WorkflowStateService;
  defaultTaskTimeoutMinutes?: number;
  loadTaskOrThrow: (
    tenantId: string,
    taskId: string,
    client?: DatabaseClient,
  ) => Promise<Record<string, unknown>>;
  toTaskResponse: (task: Record<string, unknown>) => Record<string, unknown>;
  artifactService?: Pick<ArtifactService, 'uploadTaskArtifact' | 'deleteTaskArtifact'>;
  queueWorkerCancelSignal?: (
    identity: ApiKeyIdentity,
    workerId: string,
    taskId: string,
    reason: 'manual_cancel' | 'task_timeout',
    requestedAt: Date,
  ) => Promise<string | null>;
  getRoleByName?: (
    tenantId: string,
    name: string,
  ) => Promise<{ escalation_target: string | null; max_escalation_depth: number } | null>;
  finalizeOrchestratorActivation?: (
    tenantId: string,
    task: Record<string, unknown>,
    status: 'completed' | 'failed' | 'escalated',
    client: DatabaseClient,
  ) => Promise<void>;
  evaluateWorkflowBudget?: (
    tenantId: string,
    workflowId: string,
    client: DatabaseClient,
  ) => Promise<void>;
  parallelismService?: PlaybookTaskParallelismService;
  workItemContinuityService?: Pick<
    WorkItemContinuityService,
    'clearAssessmentExpectation' | 'recordAssessmentRequestedChanges' | 'recordTaskCompleted'
  >;
  handoffService?: Pick<HandoffService, 'assertRequiredTaskHandoffBeforeCompletion'>;
  executionContainerLeaseService?: Pick<ExecutionContainerLeaseService, 'releaseForTask'>;
}

interface ReworkWorkItemContextRow {
  workflow_id: string;
  work_item_id: string;
  stage_name: string | null;
  column_id: string | null;
  completed_at: Date | null;
  workflow_state: string | null;
  workflow_metadata: unknown;
  definition: unknown;
}

interface WorkItemExecutionColumnContextRow {
  workflow_id: string;
  work_item_id: string;
  stage_name: string | null;
  column_id: string | null;
  completed_at: Date | null;
  blocked_state: string | null;
  escalation_status: string | null;
  definition: unknown;
}

interface WorkItemExecutionProgressRow {
  engaged_task_count: string | number;
}

interface LatestAssessmentRequestHandoffRow {
  handoff_id: string;
  assessment_task_id: string;
  created_at: Date | null;
}

const ACTIVE_PARALLELISM_SLOT_STATES: TaskState[] = [
  'ready',
  'claimed',
  'in_progress',
  'awaiting_approval',
];
const DEFAULT_ORCHESTRATOR_ESCALATION_TARGET = 'human';
const DEFAULT_ORCHESTRATOR_MAX_ESCALATION_DEPTH = 1;
const REWORK_REQUIRED_MARKER = '\n\nRework required:\n';

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function normalizeTaskRecord(task: Record<string, unknown>): Record<string, unknown> {
  const normalizedState = normalizeTaskState(task.state as string | null | undefined);
  return normalizedState ? { ...task, state: normalizedState } : task;
}

function isJsonEquivalent(left: unknown, right: unknown): boolean {
  return areJsonValuesEquivalent(left, right);
}

function readOptionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function readTaskKind(task: Record<string, unknown>): 'delivery' | 'assessment' | 'approval' | 'orchestrator' {
  const taskKind = readOptionalText(asRecord(task.metadata).task_kind);
  if (taskKind === 'assessment' || taskKind === 'approval' || taskKind === 'orchestrator' || taskKind === 'delivery') {
    return taskKind;
  }
  if (task.is_orchestrator_task === true) {
    return 'orchestrator';
  }
  return 'delivery';
}

function buildOutputRevisionMetadataPatch(task: Record<string, unknown>) {
  const taskKind = readTaskKind(task);
  if (taskKind === 'assessment' || taskKind === 'approval' || taskKind === 'orchestrator') {
    return undefined;
  }
  return {
    output_revision: (readInteger(task.rework_count) ?? 0) + 1,
  };
}

function normalizeAssessmentApprovalOutcome(value: unknown): 'approved' | null {
  return readOptionalText(value) === 'approved' ? 'approved' : null;
}

function readAssessmentAction(metadata: Record<string, unknown>): string | null {
  return readOptionalText(metadata.assessment_action);
}

function readAssessmentFeedback(metadata: Record<string, unknown>): string | null {
  return readOptionalText(metadata.assessment_feedback);
}

function resolveRequestedChangesDescription(
  task: Record<string, unknown>,
  overrideInput: Record<string, unknown> | null,
  nextInput: Record<string, unknown>,
): string | null {
  const explicitOverrideDescription = readOptionalText(overrideInput?.description);
  if (explicitOverrideDescription) {
    return explicitOverrideDescription;
  }

  const taskInput = asRecord(task.input);
  const taskMetadata = asRecord(task.metadata);
  const explicitReworkScope =
    readOptionalText(taskInput.rework_completion_scope)
    ?? readOptionalText(taskMetadata.rework_completion_scope);
  if (explicitReworkScope) {
    return explicitReworkScope;
  }

  const latestFeedback = readOptionalText(nextInput.assessment_feedback);
  const baseDescription = normalizeRequestedChangesBaseDescription(
    readOptionalText(nextInput.description)
    ?? readOptionalText(taskInput.description)
    ?? readOptionalText(taskMetadata.description),
  );
  if (!latestFeedback) {
    return baseDescription;
  }
  if (!baseDescription) {
    return `Rework required:\n${latestFeedback}`;
  }
  return `${baseDescription}${REWORK_REQUIRED_MARKER}${latestFeedback}`;
}

function normalizeRequestedChangesBaseDescription(description: string | null) {
  if (!description) {
    return null;
  }
  const markerIndex = description.indexOf(REWORK_REQUIRED_MARKER);
  if (markerIndex < 0) {
    return description;
  }
  const base = description.slice(0, markerIndex).trimEnd();
  return base.length > 0 ? base : null;
}

function matchesReviewMetadata(
  task: Record<string, unknown>,
  expected: {
    action: string;
    feedback?: string;
    preferredAgentId?: string | null;
    preferredWorkerId?: string | null;
  },
): boolean {
  const metadata = asRecord(task.metadata);
  return (
    readAssessmentAction(metadata) === expected.action &&
    (expected.feedback === undefined || readAssessmentFeedback(metadata) === expected.feedback) &&
    (expected.preferredAgentId === undefined ||
      (metadata.preferred_agent_id ?? null) === expected.preferredAgentId) &&
    (expected.preferredWorkerId === undefined ||
      (metadata.preferred_worker_id ?? null) === expected.preferredWorkerId)
  );
}

function hasActiveReworkRequest(task: Record<string, unknown>): boolean {
  const state = normalizeTaskState(task.state as string | null | undefined);
  if (state !== 'ready' && state !== 'claimed' && state !== 'in_progress') {
    return false;
  }
  return readAssessmentAction(asRecord(task.metadata)) === 'request_changes';
}

function hasAppliedLatestAssessmentRequest(
  task: Record<string, unknown>,
  latestAssessmentRequest: LatestAssessmentRequestHandoffRow | null,
): boolean {
  if (!latestAssessmentRequest) {
    return false;
  }

  return readOptionalText(asRecord(task.metadata).last_applied_assessment_request_handoff_id)
    === latestAssessmentRequest.handoff_id;
}

function hasSupersedingTaskHandoffAfterAssessmentRequest(
  task: Record<string, unknown>,
  latestAssessmentRequest: LatestAssessmentRequestHandoffRow | null,
  latestTaskHandoffCreatedAt: Date | null,
) {
  const state = normalizeTaskState(task.state as string | null | undefined);
  if (state !== 'output_pending_assessment' && state !== 'completed') {
    return false;
  }
  if (!(latestAssessmentRequest?.created_at instanceof Date) || !(latestTaskHandoffCreatedAt instanceof Date)) {
    return false;
  }
  return latestTaskHandoffCreatedAt.getTime() > latestAssessmentRequest.created_at.getTime();
}

function hasMatchingManualEscalation(
  task: Record<string, unknown>,
  payload: {
    reason: string;
    escalation_target?: string;
    context?: Record<string, unknown>;
    recommendation?: string;
    blocking_task_id?: string;
    urgency?: 'info' | 'important' | 'critical';
  },
): boolean {
  const metadata = asRecord(task.metadata);
  const escalations = Array.isArray(metadata.escalations)
    ? (metadata.escalations as Array<Record<string, unknown>>)
    : [];
  const latestEscalation = escalations.at(-1);
  if (!latestEscalation) {
    return false;
  }
  return latestEscalation.reason === payload.reason
    && (latestEscalation.target ?? null) === (payload.escalation_target ?? null)
    && areJsonValuesEquivalent(latestEscalation.context ?? null, payload.context ?? null)
    && (latestEscalation.recommendation ?? null) === (payload.recommendation ?? null)
    && (latestEscalation.blocking_task_id ?? null) === (payload.blocking_task_id ?? null)
    && (latestEscalation.urgency ?? null) === (payload.urgency ?? null)
    && metadata.assessment_action === 'escalate'
    && metadata.assessment_feedback === payload.reason
    && areJsonValuesEquivalent(metadata.escalation_context_packet ?? null, payload.context ?? null)
    && (metadata.escalation_recommendation ?? null) === (payload.recommendation ?? null)
    && (metadata.escalation_blocking_task_id ?? null) === (payload.blocking_task_id ?? null)
    && (metadata.escalation_urgency ?? null) === (payload.urgency ?? null);
}

function hasMatchingAgentEscalation(
  task: Record<string, unknown>,
  resolvedTarget: string,
  payload: {
    reason: string;
    context_summary?: string;
    work_so_far?: string;
  },
): boolean {
  const metadata = asRecord(task.metadata);
  if (task.state !== 'escalated') {
    return false;
  }
  if ((metadata.escalation_target ?? null) !== resolvedTarget) {
    return false;
  }
  if ((metadata.escalation_reason ?? null) !== payload.reason) {
    return false;
  }
  if ((metadata.escalation_context ?? null) !== (payload.context_summary ?? null)) {
    return false;
  }
  if ((metadata.escalation_work_so_far ?? null) !== (payload.work_so_far ?? null)) {
    return false;
  }
  if (resolvedTarget === 'human') {
    return metadata.escalation_awaiting_human === true;
  }
  return typeof metadata.escalation_task_id === 'string' && metadata.escalation_task_id.length > 0;
}

function hasMatchingAgentEscalationDepthFailure(
  task: Record<string, unknown>,
  currentDepth: number,
  maxDepth: number,
): boolean {
  const metadata = asRecord(task.metadata);
  const error = asRecord(task.error);
  return task.state === 'failed'
    && error.category === 'escalation_depth_exceeded'
    && (metadata.escalation_depth ?? null) === currentDepth
    && (metadata.escalation_max_depth ?? null) === maxDepth;
}

function hasMatchingAssessmentRejection(
  task: Record<string, unknown>,
  feedback: string,
): boolean {
  const error = asRecord(task.error);
  return (
    task.state === 'failed'
    && matchesReviewMetadata(task, { action: 'reject', feedback })
    && error.category === 'assessment_rejected'
    && error.message === feedback
  );
}

function isCancelledOrCompletedTask(task: Record<string, unknown>): boolean {
  return task.state === 'cancelled' || task.state === 'completed';
}

export class TaskLifecycleService {
  constructor(private readonly deps: TaskLifecycleDependencies) {}

  private async clearOpenChildAssessmentWorkItemRouting(
    tenantId: string,
    task: Record<string, unknown>,
    client: DatabaseClient,
  ): Promise<void> {
    const workflowId = readOptionalText(task.workflow_id);
    const workItemId = readOptionalText(task.work_item_id);
    if (!workflowId || !workItemId) {
      return;
    }

    await client.query(
      `UPDATE workflow_work_items wi
          SET next_expected_actor = NULL,
              next_expected_action = NULL,
              metadata = COALESCE(metadata, '{}'::jsonb) - 'orchestrator_finish_state',
              updated_at = now()
        WHERE wi.tenant_id = $1
          AND wi.workflow_id = $2
          AND wi.parent_work_item_id = $3
          AND wi.completed_at IS NULL
          AND EXISTS (
            SELECT 1
              FROM tasks assessment_task
             WHERE assessment_task.tenant_id = wi.tenant_id
               AND assessment_task.workflow_id = wi.workflow_id
               AND assessment_task.work_item_id = wi.id
               AND COALESCE(assessment_task.metadata->>'task_kind', '') = 'assessment'
          )`,
      [tenantId, workflowId, workItemId],
    );
  }

  private async restoreOpenChildAssessmentWorkItemRouting(
    tenantId: string,
    task: Record<string, unknown>,
    client: DatabaseClient,
  ): Promise<void> {
    const workflowId = readOptionalText(task.workflow_id);
    const workItemId = readOptionalText(task.work_item_id);
    if (!workflowId || !workItemId) {
      return;
    }

    await client.query(
      `UPDATE workflow_work_items wi
          SET next_expected_actor = COALESCE(owner_role, next_expected_actor),
              next_expected_action = 'assess',
              metadata = COALESCE(metadata, '{}'::jsonb) - 'orchestrator_finish_state',
              updated_at = now()
        WHERE wi.tenant_id = $1
          AND wi.workflow_id = $2
          AND wi.parent_work_item_id = $3
          AND wi.completed_at IS NULL
          AND EXISTS (
            SELECT 1
              FROM tasks assessment_task
             WHERE assessment_task.tenant_id = wi.tenant_id
               AND assessment_task.workflow_id = wi.workflow_id
               AND assessment_task.work_item_id = wi.id
               AND COALESCE(assessment_task.metadata->>'task_kind', '') = 'assessment'
          )`,
      [tenantId, workflowId, workItemId],
    );
  }

  private async reopenCompletedWorkItemForRework(
    identity: ApiKeyIdentity,
    task: Record<string, unknown>,
    client: DatabaseClient,
  ): Promise<void> {
    const workflowId = readOptionalText(task.workflow_id);
    const workItemId = readOptionalText(task.work_item_id);
    if (!workflowId || !workItemId) {
      return;
    }

    const workItemResult = await client.query<ReworkWorkItemContextRow>(
      `SELECT wi.workflow_id,
              wi.id AS work_item_id,
              wi.stage_name,
              wi.column_id,
              wi.completed_at,
              w.state AS workflow_state,
              w.metadata AS workflow_metadata,
              p.definition
         FROM workflow_work_items wi
         JOIN workflows w
           ON w.tenant_id = wi.tenant_id
          AND w.id = wi.workflow_id
         JOIN playbooks p
           ON p.tenant_id = w.tenant_id
          AND p.id = w.playbook_id
        WHERE wi.tenant_id = $1
          AND wi.workflow_id = $2
          AND wi.id = $3
        LIMIT 1
        FOR UPDATE OF wi`,
      [identity.tenantId, workflowId, workItemId],
    );
    const workItem = workItemResult.rows[0];
    if (!workItem) {
      return;
    }

    const definition = parsePlaybookDefinition(workItem.definition);
    if (!shouldReopenWorkItemForRework(definition, workItem)) {
      return;
    }
    const reopenColumnId = resolveReopenColumnId({
      definition,
      currentColumnId: workItem.column_id,
      workflowState: workItem.workflow_state,
      workflowMetadata: workItem.workflow_metadata,
    });
    if (!reopenColumnId) {
      return;
    }

    const reopenedAt = new Date();
    const reopenResult = await client.query<{ id: string }>(
      `UPDATE workflow_work_items
          SET column_id = $4,
              completed_at = NULL,
              next_expected_actor = NULL,
              next_expected_action = NULL,
              metadata = COALESCE(metadata, '{}'::jsonb) - 'orchestrator_finish_state',
              updated_at = now()
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3
          AND (completed_at IS NOT NULL OR column_id = $5)
      RETURNING id`,
      [identity.tenantId, workflowId, workItemId, reopenColumnId, workItem.column_id],
    );
    if (!reopenResult.rowCount) {
      return;
    }

    await supersedeCurrentFinalDeliverablesForWorkItem(
      client,
      identity.tenantId,
      workflowId,
      workItemId,
    );

    const eventData = {
      workflow_id: workflowId,
      work_item_id: workItemId,
      stage_name: workItem.stage_name,
      previous_column_id: workItem.column_id,
      column_id: reopenColumnId,
      previous_completed_at: workItem.completed_at?.toISOString() ?? null,
      reopened_at: reopenedAt.toISOString(),
    };
    await this.deps.eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'work_item.updated',
        entityType: 'work_item',
        entityId: workItemId,
        actorType: identity.scope,
        actorId: identity.keyPrefix,
        data: eventData,
      },
      client,
    );
    if (workItem.column_id !== reopenColumnId) {
      await this.deps.eventService.emit(
        {
          tenantId: identity.tenantId,
          type: 'work_item.moved',
          entityType: 'work_item',
          entityId: workItemId,
          actorType: identity.scope,
          actorId: identity.keyPrefix,
          data: eventData,
        },
        client,
      );
    }
    await this.deps.eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'work_item.reopened',
        entityType: 'work_item',
        entityId: workItemId,
        actorType: identity.scope,
        actorId: identity.keyPrefix,
        data: eventData,
      },
      client,
    );
  }

  private async reconcileWorkItemExecutionColumn(
    identity: ApiKeyIdentity,
    task: Record<string, unknown>,
    client: DatabaseClient,
  ): Promise<void> {
    const workflowId = readOptionalText(task.workflow_id);
    const workItemId = readOptionalText(task.work_item_id);
    if (!workflowId || !workItemId || task.is_orchestrator_task === true) {
      return;
    }

    const workItemResult = await client.query<WorkItemExecutionColumnContextRow>(
      `SELECT wi.workflow_id,
              wi.id AS work_item_id,
              wi.stage_name,
              wi.column_id,
              wi.completed_at,
              wi.blocked_state,
              wi.escalation_status,
              p.definition
         FROM workflow_work_items wi
         JOIN workflows w
           ON w.tenant_id = wi.tenant_id
          AND w.id = wi.workflow_id
         JOIN playbooks p
           ON p.tenant_id = w.tenant_id
          AND p.id = w.playbook_id
        WHERE wi.tenant_id = $1
          AND wi.workflow_id = $2
          AND wi.id = $3
        LIMIT 1
        FOR UPDATE OF wi`,
      [identity.tenantId, workflowId, workItemId],
    );
    const workItem = workItemResult.rows[0];
    if (!workItem || workItem.completed_at || workItem.blocked_state === 'blocked' || workItem.escalation_status === 'open') {
      return;
    }

    const definition = parsePlaybookDefinition(workItem.definition);
    const entryColumnId = defaultColumnId(definition);
    const executionColumnId = activeColumnId(definition);
    if (!entryColumnId || !executionColumnId) {
      return;
    }

    const executionProgress = await this.loadWorkItemExecutionProgress(
      client,
      identity.tenantId,
      workflowId,
      workItemId,
    );
    const nextColumnId = executionProgress.hasEngagedSpecialistTask
      ? executionColumnId
      : null;
    if (!nextColumnId || nextColumnId === workItem.column_id) {
      return;
    }

    const moveResult = await client.query<{ id: string }>(
      `UPDATE workflow_work_items
          SET column_id = $4,
              updated_at = now()
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3
          AND completed_at IS NULL
      RETURNING id`,
      [identity.tenantId, workflowId, workItemId, nextColumnId],
    );
    if (!moveResult.rowCount) {
      return;
    }

    const eventData = {
      workflow_id: workflowId,
      work_item_id: workItemId,
      stage_name: workItem.stage_name,
      previous_column_id: workItem.column_id,
      column_id: nextColumnId,
    };
    await this.deps.eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'work_item.updated',
        entityType: 'work_item',
        entityId: workItemId,
        actorType: identity.scope,
        actorId: identity.keyPrefix,
        data: eventData,
      },
      client,
    );
    await this.deps.eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'work_item.moved',
        entityType: 'work_item',
        entityId: workItemId,
        actorType: identity.scope,
        actorId: identity.keyPrefix,
        data: eventData,
      },
      client,
    );
  }

  private async loadWorkItemExecutionProgress(
    client: DatabaseClient,
    tenantId: string,
    workflowId: string,
    workItemId: string,
  ) {
    const result = await client.query<WorkItemExecutionProgressRow>(
      `SELECT COUNT(*)::int AS engaged_task_count
         FROM tasks
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND work_item_id = $3
          AND is_orchestrator_task = FALSE
          AND state IN (
            'claimed',
            'in_progress',
            'awaiting_approval',
            'output_pending_assessment',
            'completed',
            'failed',
            'escalated'
          )`,
      [tenantId, workflowId, workItemId],
    );

    return {
      hasEngagedSpecialistTask: Number(result.rows[0]?.engaged_task_count ?? 0) > 0,
    };
  }

  private async logGovernanceTransition(
    tenantId: string,
    operation: string,
    task: Record<string, unknown>,
    payload: Record<string, unknown>,
    client: DatabaseClient,
  ): Promise<void> {
    await logTaskGovernanceTransition(this.deps.logService, {
      tenantId,
      operation,
      executor: client,
      task,
      payload,
    });
  }

  private requireLifecycleIdentity(
    identity: ApiKeyIdentity,
    payload: { agent_id?: string; worker_id?: string } = {},
  ): { agentId?: string; workerId?: string } {
    if (identity.scope === 'agent') {
      if (!identity.ownerId) {
        throw new ForbiddenError('Agent identity is required for task lifecycle operations');
      }
      if (payload.agent_id && payload.agent_id !== identity.ownerId) {
        throw new ForbiddenError('Task lifecycle operation can only target the calling agent');
      }
      return {
        agentId: identity.ownerId,
        workerId: payload.worker_id,
      };
    }

    if (identity.scope === 'worker') {
      if (!identity.ownerId) {
        throw new ForbiddenError('Specialist Agent identity is required for task lifecycle operations');
      }
      if (payload.worker_id && payload.worker_id !== identity.ownerId) {
        throw new ForbiddenError('Task lifecycle operation can only target the calling Specialist Agent');
      }
      return {
        agentId: payload.agent_id,
        workerId: identity.ownerId,
      };
    }

    throw new ForbiddenError('Specialist Execution or Specialist Agent identity is required for task lifecycle operations');
  }

  private extractOutputSchema(task: Record<string, unknown>): Record<string, unknown> | undefined {
    const explicitOutputSchema = task.output_schema;
    if (
      explicitOutputSchema &&
      typeof explicitOutputSchema === 'object' &&
      !Array.isArray(explicitOutputSchema)
    ) {
      return explicitOutputSchema as Record<string, unknown>;
    }

    const roleConfig = asRecord(task.role_config);
    const schema = roleConfig.output_schema;
    if (schema && typeof schema === 'object' && !Array.isArray(schema)) {
      return schema as Record<string, unknown>;
    }

    return undefined;
  }

  private readVerificationPassed(
    verification: Record<string, unknown> | undefined,
    metrics: Record<string, unknown> | undefined,
  ): boolean | undefined {
    if (typeof verification?.passed === 'boolean') {
      return verification.passed;
    }
    if (typeof metrics?.verification_passed === 'boolean') {
      return metrics.verification_passed as boolean;
    }
    return undefined;
  }

  private async lockWorkflowRowForTask(
    tenantId: string,
    task: Record<string, unknown>,
    client: DatabaseClient,
  ): Promise<void> {
    const workflowId = readOptionalText(task.workflow_id);
    if (!workflowId) {
      return;
    }

    const workflowResult = await client.query(
      `SELECT id
         FROM workflows
        WHERE tenant_id = $1
          AND id = $2
        FOR UPDATE`,
      [tenantId, workflowId],
    );
    if (!workflowResult.rowCount) return;
  }

  async applyStateTransition(
    identity: ApiKeyIdentity,
    taskId: string,
    nextState: TaskState,
    options: TransitionOptions,
    existingClient?: DatabaseClient,
  ) {
    const client = existingClient ?? await this.deps.pool.connect();
    const ownsClient = existingClient === undefined;
    try {
      if (ownsClient) {
        await client.query('BEGIN');
      }
      const task = normalizeTaskRecord(await this.deps.loadTaskOrThrow(identity.tenantId, taskId, client));

      if (!options.expectedStates.includes(task.state as TaskState)) {
        assertValidTransition(task.id as string, task.state as TaskState, nextState);
      }

      if (
        options.requireAssignment?.agentId &&
        task.assigned_agent_id !== options.requireAssignment.agentId
      ) {
        throw new ForbiddenError('Task is assigned to a different agent');
      }
      if (
        options.requireAssignment?.workerId &&
        task.assigned_worker_id !== options.requireAssignment.workerId
      ) {
        throw new ConflictError('Task is assigned to a different Specialist Agent');
      }

      await this.lockWorkflowRowForTask(identity.tenantId, task, client);

      const resolvedNextState = await this.resolveNextState(identity.tenantId, task, nextState, client);
      const updateFragments: string[] = ['state = $3', 'state_changed_at = now()'];
      const values: unknown[] = [identity.tenantId, taskId, toStoredTaskState(resolvedNextState)];

      if (resolvedNextState === 'in_progress') {
        if (options.startedAt) {
          values.push(options.startedAt);
          updateFragments.push(`started_at = $${values.length}`);
        } else {
          updateFragments.push('started_at = now()');
        }
      }

      if (resolvedNextState === 'completed') {
        updateFragments.push('completed_at = now()', 'error = NULL');
      } else if (resolvedNextState === 'escalated') {
        updateFragments.push('completed_at = NULL', 'error = NULL');
      } else {
        updateFragments.push('completed_at = NULL');
      }

      if (options.output !== undefined) {
        values.push(options.output);
        updateFragments.push(`output = $${values.length}`);
      }

      if (options.overrideInput !== undefined) {
        values.push(options.overrideInput);
        updateFragments.push(`input = $${values.length}`);
      }

      if (resolvedNextState === 'failed') {
        values.push(
          options.error ?? {
            category: 'unknown',
            message: options.reason ?? 'failed',
            recoverable: false,
          },
        );
        updateFragments.push(`error = $${values.length}`);
      }

      if (options.metrics !== undefined) {
        values.push(options.metrics);
        updateFragments.push(`metrics = $${values.length}`);
      }

      if (options.gitInfo !== undefined) {
        values.push(options.gitInfo);
        updateFragments.push(`git_info = $${values.length}`);
      }

      const metadataPatch =
        options.verification !== undefined || options.metadataPatch !== undefined
          ? {
              ...(options.verification !== undefined ? { verification: options.verification } : {}),
              ...(options.metadataPatch ?? {}),
            }
          : undefined;

      let metadataExpression = 'metadata';
      if (options.clearLifecycleControlMetadata) {
        metadataExpression =
          "(metadata - 'cancel_signal_requested_at' - 'cancel_force_fail_at' - 'cancel_signal_id' - 'cancel_reason' - 'timeout_cancel_requested_at' - 'timeout_force_fail_at' - 'timeout_signal_id' - 'workflow_cancel_requested_at' - 'workflow_cancel_force_at' - 'workflow_cancel_signal_id')";
      }
      if (options.clearEscalationMetadata) {
        metadataExpression = `${metadataExpression} - 'escalation_status' - 'escalation_task_id'`;
      }
      if (metadataPatch) {
        values.push(metadataPatch);
        metadataExpression = `${metadataExpression} || $${values.length}::jsonb`;
      }
      if (metadataExpression !== 'metadata') {
        updateFragments.push(`metadata = ${metadataExpression}`);
      }

      if (options.retryIncrement) updateFragments.push('retry_count = retry_count + 1');
      if (options.reworkIncrement) updateFragments.push('rework_count = rework_count + 1');
      if (options.clearAssignment)
        updateFragments.push(
          'assigned_agent_id = NULL',
          'assigned_worker_id = NULL',
          'claimed_at = NULL',
          'started_at = NULL',
        );
      if (options.clearExecutionData)
        updateFragments.push('output = NULL', 'error = NULL', 'metrics = NULL', 'git_info = NULL');

      const expectedStateParam = `$${values.length + 1}`;
      values.push(options.expectedStates.map(toStoredTaskState));

      const updateSql = `UPDATE tasks SET ${updateFragments.join(', ')} WHERE tenant_id = $1 AND id = $2 AND state = ANY(${expectedStateParam}::task_state[]) RETURNING *`;
      const updatedResult = await client.query(updateSql, values);
      if (!updatedResult.rowCount) {
        const latestTask = normalizeTaskRecord(await this.deps.loadTaskOrThrow(identity.tenantId, taskId, client));
        if (!options.expectedStates.includes(latestTask.state as TaskState)) {
          assertValidTransition(task.id as string, latestTask.state as TaskState, nextState);
        }
        throw new ConflictError('Task state changed concurrently');
      }

      const updatedTask = normalizeTaskRecord(updatedResult.rows[0] as Record<string, unknown>);

      if (options.clearAssignment && task.assigned_agent_id) {
        await client.query(
          `UPDATE agents
           SET current_task_id = NULL,
               status = (CASE WHEN status = 'inactive' THEN 'inactive' ELSE 'idle' END)::agent_status
           WHERE tenant_id = $1 AND id = $2`,
          [identity.tenantId, task.assigned_agent_id],
        );
      }

      if (options.clearAssignment && !updatedTask.is_orchestrator_task) {
        await this.deps.executionContainerLeaseService?.releaseForTask(
          identity.tenantId,
          taskId,
          client,
        );
      }

      await this.deps.eventService.emit(
        {
          tenantId: identity.tenantId,
          type: 'task.state_changed',
          entityType: 'task',
          entityId: taskId,
          actorType: identity.scope,
          actorId: identity.keyPrefix,
          data: {
            from_state: normalizeTaskState(task.state as string | undefined) ?? task.state,
            to_state: resolvedNextState,
            reason: options.reason,
            feedback: options.metadataPatch?.assessment_feedback ?? undefined,
          },
        },
        client,
      );

      if (resolvedNextState === 'completed' && !updatedTask.is_orchestrator_task) {
        await applyTaskCompletionSideEffects(
          this.deps.eventService,
          this.deps.parallelismService,
          this.deps.workItemContinuityService,
          identity,
          updatedTask,
          client,
          this.deps.activationDispatchService,
          this.deps.logService,
          {
            requestTaskChanges: (nextIdentity, managedTaskId, payload, nextClient) =>
              this.requestTaskChanges(nextIdentity, managedTaskId, payload, nextClient),
            rejectTask: (nextIdentity, managedTaskId, payload, nextClient) =>
              this.rejectTask(nextIdentity, managedTaskId, payload, nextClient),
          },
        );
      }
      if (resolvedNextState === 'output_pending_assessment' && !updatedTask.is_orchestrator_task) {
        await this.deps.workItemContinuityService?.recordTaskCompleted(
          identity.tenantId,
          updatedTask,
          client,
        );
        await this.restoreOpenChildAssessmentWorkItemRouting(
          identity.tenantId,
          updatedTask,
          client,
        );
      }
      if (
        !updatedTask.is_orchestrator_task &&
        task.workflow_id &&
        buildWorkflowActivationForTaskTransition(taskId, task, updatedTask, resolvedNextState, options.reason)
      ) {
        const activation = buildWorkflowActivationForTaskTransition(
          taskId,
          task,
          updatedTask,
          resolvedNextState,
          options.reason,
        );
        if (!activation) {
          throw new Error('workflow activation contract unexpectedly missing for task transition');
        }
        await enqueueAndDispatchImmediatePlaybookActivation(
          client,
          this.deps.eventService,
          this.deps.activationDispatchService,
          {
          tenantId: identity.tenantId,
          workflowId: task.workflow_id as string,
          requestId: activation.requestId,
          reason: activation.reason,
          eventType: activation.eventType,
          payload: activation.payload,
          actorType: 'system',
          actorId: 'task_lifecycle_service',
          },
        );
      }
      if (
        this.deps.finalizeOrchestratorActivation &&
        updatedTask.is_orchestrator_task &&
        (
          resolvedNextState === 'completed' ||
          resolvedNextState === 'failed' ||
          resolvedNextState === 'cancelled' ||
          resolvedNextState === 'escalated'
        )
      ) {
        await this.deps.finalizeOrchestratorActivation(
          identity.tenantId,
          updatedTask,
          resolvedNextState === 'completed'
            ? 'completed'
            : resolvedNextState === 'escalated'
              ? 'escalated'
              : 'failed',
          client,
        );
      }
      if (
        this.deps.parallelismService &&
        !updatedTask.is_orchestrator_task &&
        typeof updatedTask.workflow_id === 'string' &&
        releasesParallelismSlot(task.state as TaskState, resolvedNextState)
      ) {
        await this.deps.parallelismService.releaseQueuedReadyTasks(
          this.deps.eventService,
          identity.tenantId,
          updatedTask.workflow_id,
          client,
        );
      }
      if (options.afterUpdate) {
        await options.afterUpdate(updatedTask, client);
      }
      if (!updatedTask.is_orchestrator_task) {
        await this.reconcileWorkItemExecutionColumn(identity, updatedTask, client);
      }

      if (task.workflow_id) {
        await this.deps.workflowStateService.recomputeWorkflowState(
          identity.tenantId,
          task.workflow_id as string,
          client,
          {
            actorType: 'system',
            actorId: 'task_state_transition',
          },
        );
        if (this.deps.evaluateWorkflowBudget) {
          await this.deps.evaluateWorkflowBudget(identity.tenantId, task.workflow_id as string, client);
        }
      }

      if (ownsClient) {
        await client.query('COMMIT');
      }
      return this.deps.toTaskResponse(updatedTask);
    } catch (error) {
      if (ownsClient) {
        await client.query('ROLLBACK');
      }
      throw error;
    } finally {
      if (ownsClient) {
        client.release();
      }
    }
  }

  private async resolveNextState(
    tenantId: string,
    task: Record<string, unknown>,
    requestedState: TaskState,
    client: DatabaseClient,
  ): Promise<TaskState> {
    if (!this.deps.parallelismService || requestedState !== 'ready') {
      return requestedState;
    }

    const shouldQueue = await this.deps.parallelismService.shouldQueueForCapacity(
      tenantId,
      {
        taskId: String(task.id),
        workflowId: (task.workflow_id as string | null | undefined) ?? null,
        workItemId: (task.work_item_id as string | null | undefined) ?? null,
        isOrchestratorTask: Boolean(task.is_orchestrator_task),
        currentState: task.state as TaskState,
      },
      client,
    );
    if (!shouldQueue) {
      return 'ready';
    }

    if (
      task.state === 'failed' &&
      typeof task.workflow_id === 'string' &&
      typeof this.deps.parallelismService.reclaimReadySlotForTask === 'function' &&
      (await this.deps.parallelismService.reclaimReadySlotForTask(
        this.deps.eventService,
        tenantId,
        {
          taskId: String(task.id),
          workflowId: task.workflow_id,
          workItemId: (task.work_item_id as string | null | undefined) ?? null,
          isOrchestratorTask: Boolean(task.is_orchestrator_task),
          currentState: task.state as TaskState,
        },
        client,
      ))
    ) {
      return 'ready';
    }

    return 'pending';
  }

  private async resolveCreatedSpecialistTaskState(
    tenantId: string,
    task: {
      workflow_id?: string | null;
      work_item_id?: string | null;
      is_orchestrator_task?: boolean;
    },
    client: DatabaseClient,
  ): Promise<'ready' | 'pending'> {
    if (!this.deps.parallelismService) {
      return 'ready';
    }

    const shouldQueue = await this.deps.parallelismService.shouldQueueForCapacity(
      tenantId,
      {
        workflowId: task.workflow_id ?? null,
        workItemId: task.work_item_id ?? null,
        isOrchestratorTask: Boolean(task.is_orchestrator_task),
        currentState: null,
      },
      client,
    );
    return shouldQueue ? 'pending' : 'ready';
  }

  async startTask(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: { agent_id?: string; worker_id?: string; started_at?: string },
    existingClient?: DatabaseClient,
  ) {
    const assignment = this.requireLifecycleIdentity(identity, payload);
    const task = normalizeTaskRecord(await this.deps.loadTaskOrThrow(identity.tenantId, taskId, existingClient));

    if (
      task.state === 'in_progress' &&
      (!assignment.agentId || task.assigned_agent_id === assignment.agentId) &&
      (!assignment.workerId || task.assigned_worker_id === assignment.workerId)
    ) {
      return this.deps.toTaskResponse(task);
    }

    const startedAt = payload.started_at ? new Date(payload.started_at) : undefined;

    return this.applyStateTransition(identity, taskId, 'in_progress', {
      expectedStates: ['claimed'],
      requireAssignment: assignment,
      reason: 'task_started',
      startedAt: startedAt && Number.isFinite(startedAt.getTime()) ? startedAt : undefined,
    }, existingClient);
  }

  async completeTask(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: {
      output: unknown;
      metrics?: Record<string, unknown>;
      git_info?: Record<string, unknown>;
      verification?: Record<string, unknown>;
      agent_id?: string;
      worker_id?: string;
    },
    existingClient?: DatabaseClient,
  ) {
    const assignment = this.requireLifecycleIdentity(identity, payload);
    const task = normalizeTaskRecord(await this.deps.loadTaskOrThrow(identity.tenantId, taskId, existingClient));

    const sanitizedOutput = sanitizeSecretLikeValue(payload.output);

    if (
      (task.state === 'completed' || task.state === 'output_pending_assessment') &&
      isJsonEquivalent(task.output, sanitizedOutput)
    ) {
      return this.deps.toTaskResponse(task);
    }

    await this.deps.handoffService?.assertRequiredTaskHandoffBeforeCompletion(
      identity.tenantId,
      task,
      existingClient,
    );
    await this.assertOperatorReportingBeforeCompletion(
      identity.tenantId,
      task,
      existingClient,
    );

    const outputValidation = validateOutputSchema(payload.output, this.extractOutputSchema(task));
    const verificationPassed = this.readVerificationPassed(payload.verification, payload.metrics);
    const persisted = this.deps.artifactService
      ? await applyOutputStateDeclarations(
          this.deps.artifactService,
          identity,
          task,
          payload.output,
          payload.git_info,
        )
      : {
          output: payload.output,
          gitInfo: payload.git_info,
          cleanupArtifactIds: [],
        };

    const safeOutput = sanitizeSecretLikeValue(persisted.output);
    const safeMetrics = payload.metrics
      ? sanitizeSecretLikeRecord(payload.metrics)
      : undefined;
    const safeGitInfo = persisted.gitInfo
      ? sanitizeSecretLikeRecord(persisted.gitInfo)
      : undefined;
    const safeVerification = payload.verification
      ? sanitizeSecretLikeRecord(payload.verification)
      : undefined;
    const outputRevisionMetadataPatch = buildOutputRevisionMetadataPatch(task);

    const shouldMoveToOutputAssessment = !outputValidation.valid || verificationPassed === false;

    try {
      return shouldMoveToOutputAssessment
        ? await this.applyStateTransition(identity, taskId, 'output_pending_assessment', {
            expectedStates: ['in_progress'],
            requireAssignment: assignment,
            output: safeOutput,
            metrics: safeMetrics,
            gitInfo: safeGitInfo,
            verification: safeVerification,
            metadataPatch: outputRevisionMetadataPatch,
            clearAssignment: true,
            clearLifecycleControlMetadata: true,
            clearEscalationMetadata: true,
            reason: !outputValidation.valid
              ? 'output_schema_assessment_required'
              : 'verification_assessment_required',
          }, existingClient)
        : await this.applyStateTransition(identity, taskId, 'completed', {
            expectedStates: ['in_progress'],
            requireAssignment: assignment,
            output: safeOutput,
            metrics: safeMetrics,
            gitInfo: safeGitInfo,
            verification: safeVerification,
            metadataPatch: outputRevisionMetadataPatch,
            clearAssignment: true,
            clearLifecycleControlMetadata: true,
            clearEscalationMetadata: true,
            afterUpdate: async (updatedTask, client) => {
              await registerTaskOutputDocuments(client, identity.tenantId, updatedTask, persisted.output);
              await this.maybeResolveEscalationSource(identity, updatedTask, client);
            },
            reason: 'task_completed',
          }, existingClient);
    } catch (error) {
      if (this.deps.artifactService) {
        for (const artifactId of persisted.cleanupArtifactIds) {
          await this.deps.artifactService
            .deleteTaskArtifact(identity, taskId, artifactId)
            .catch(() => undefined);
        }
      }
      throw error;
    }
  }

  private async assertOperatorReportingBeforeCompletion(
    tenantId: string,
    task: Record<string, unknown>,
    client?: DatabaseClient,
  ): Promise<void> {
    const queryClient = client ?? await this.deps.pool.connect();
    const shouldReleaseClient = !client;
    const workflowId = readOptionalText(task.workflow_id);
    const taskId = readOptionalText(task.id);
    if (!workflowId || !taskId) {
      if (shouldReleaseClient) {
        queryClient.release();
      }
      return;
    }

    try {
      const contract = await readOperatorReportingContract(
        this.deps.pool,
        tenantId,
        task,
        queryClient,
      );
      if (!contract) {
        return;
      }

      if (!contract.milestoneBriefsRequired) {
        return;
      }

      const hasBrief = await hasOperatorBriefForExecutionContext(
        this.deps.pool,
        tenantId,
        workflowId,
        contract.executionContextId,
        queryClient,
      );
      if (hasBrief) {
        return;
      }

      throw new ValidationError(
        buildMissingMilestoneBriefMessage(contract),
        {
          reason_code: 'required_operator_milestone_brief',
          recoverable: true,
          recovery_hint: 'record_required_operator_brief',
          recovery: {
            status: 'action_required',
            reason: 'required_operator_milestone_brief',
            action: 'record_operator_brief',
            execution_context_id: contract.executionContextId,
            request_id_prefix: contract.operatorBriefRequestIdPrefix,
            source_kind: contract.sourceKind,
          },
        },
      );
    } finally {
      if (shouldReleaseClient) {
        queryClient.release();
      }
    }
  }

  private async loadLatestAssessmentRequestHandoff(
    tenantId: string,
    task: Record<string, unknown>,
    db?: DatabaseClient,
  ): Promise<LatestAssessmentRequestHandoffRow | null> {
    const taskId = readOptionalText(task.id);
    const workflowId = readOptionalText(task.workflow_id);
    const workItemId = readOptionalText(task.work_item_id);
    if (!taskId || !workflowId || !workItemId) {
      return null;
    }

    const queryClient = db
      ?? ('query' in this.deps.pool && typeof this.deps.pool.query === 'function'
        ? this.deps.pool
        : await this.deps.pool.connect());
    const ownsClient = db == null && queryClient !== this.deps.pool;

    try {
      const result = await queryClient.query<LatestAssessmentRequestHandoffRow>(
        `WITH RECURSIVE descendant_work_items AS (
            SELECT id
              FROM workflow_work_items
             WHERE tenant_id = $1
               AND workflow_id = $2
               AND id = $3
            UNION ALL
            SELECT child.id
              FROM workflow_work_items child
              JOIN descendant_work_items parent
                ON parent.id = child.parent_work_item_id
             WHERE child.tenant_id = $1
               AND child.workflow_id = $2
          )
          SELECT th.id AS handoff_id,
                 th.task_id AS assessment_task_id,
                 th.created_at
           FROM task_handoffs th
          WHERE th.tenant_id = $1
            AND th.workflow_id = $2
            AND th.resolution = 'request_changes'
            AND (
              COALESCE(th.role_data->>'subject_task_id', '') = $4
              OR COALESCE(th.role_data->>'subject_work_item_id', '') = $3::text
              OR EXISTS (
                SELECT 1
                  FROM descendant_work_items review_wi
                 WHERE review_wi.id <> $3
                   AND review_wi.id = th.work_item_id
              )
            )
          ORDER BY th.sequence DESC, th.created_at DESC
          LIMIT 1`,
        [tenantId, workflowId, workItemId, taskId],
      );
      return result.rows[0] ?? null;
    } finally {
      if (ownsClient && 'release' in queryClient && typeof queryClient.release === 'function') {
        queryClient.release();
      }
    }
  }

  async failTask(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: {
      error: Record<string, unknown>;
      metrics?: Record<string, unknown>;
      git_info?: Record<string, unknown>;
      agent_id?: string;
      worker_id?: string;
    },
    existingClient?: DatabaseClient,
  ) {
    // Workers/admins (container-manager) can fail any task via hung detection — skip assignment enforcement.
    const assignment = identity.scope === 'agent'
      ? this.requireLifecycleIdentity(identity, payload)
      : undefined;
    const task = normalizeTaskRecord(await this.deps.loadTaskOrThrow(identity.tenantId, taskId, existingClient));

    const safeError = sanitizeSecretLikeRecord(payload.error);

    if (isFailTaskReplay(task, safeError)) {
      return this.deps.toTaskResponse(task);
    }
    if (isCancelledOrCompletedTask(task)) {
      return this.deps.toTaskResponse(task);
    }

    const lifecyclePolicy = readPersistedLifecyclePolicy(task.metadata);
    const failure = classifyFailure(payload.error);
    const retryPlan = buildRetryPlan(task, lifecyclePolicy, failure);

    if (retryPlan.shouldRetry) {
      const nextState: TaskState = retryPlan.policy ? 'pending' : 'ready';
      return this.applyStateTransition(identity, taskId, nextState, {
        expectedStates: ['in_progress', 'claimed'],
        requireAssignment: assignment,
        retryIncrement: true,
        clearAssignment: true,
        reason: 'auto_retry_scheduled',
        clearExecutionData: true,
        clearLifecycleControlMetadata: true,
        clearEscalationMetadata: true,
        metadataPatch: {
          retry_policy: retryPlan.policy,
          ...(retryPlan.policy
            ? { retry_available_at: retryPlan.retryAvailableAt?.toISOString() ?? null }
            : { retry_available_at: null }),
          retry_backoff_seconds: retryPlan.backoffSeconds,
          last_failure: failure,
          retry_last_error: safeError,
        },
        afterUpdate: async (updatedTask, client) => {
          await this.deps.eventService.emit(
            {
              tenantId: identity.tenantId,
              type: 'task.retry_scheduled',
              entityType: 'task',
              entityId: taskId,
              actorType: identity.scope,
              actorId: identity.keyPrefix,
              data: {
                retry_count: updatedTask.retry_count,
                backoff_seconds: retryPlan.backoffSeconds,
                retry_available_at: retryPlan.retryAvailableAt?.toISOString() ?? null,
                failure,
              },
            },
            client,
          );
          await this.logGovernanceTransition(
            identity.tenantId,
            'task.retry.scheduled',
            updatedTask,
            {
              event_type: 'task.retry_scheduled',
              retry_count: updatedTask.retry_count ?? null,
              backoff_seconds: retryPlan.backoffSeconds,
              retry_available_at: retryPlan.retryAvailableAt?.toISOString() ?? null,
              failure,
            },
            client,
          );
        },
      }, existingClient);
    }

    const safeMetrics = payload.metrics
      ? sanitizeSecretLikeRecord(payload.metrics)
      : undefined;
    const safeGitInfo = payload.git_info
      ? sanitizeSecretLikeRecord(payload.git_info)
      : undefined;

    return this.applyStateTransition(identity, taskId, 'failed', {
      expectedStates: ['in_progress', 'claimed'],
      requireAssignment: assignment,
      error: safeError,
      metrics: safeMetrics,
      gitInfo: safeGitInfo,
      clearAssignment: true,
      clearLifecycleControlMetadata: true,
      metadataPatch: {
        last_failure: failure,
      },
      afterUpdate: async (updatedTask, client) => {
        await this.maybeCreateEscalationTask(identity, updatedTask, lifecyclePolicy, failure, client);
      },
      reason: 'task_failed',
    }, existingClient);
  }

  async approveTask(identity: ApiKeyIdentity, taskId: string, client?: DatabaseClient) {
    const currentTask = normalizeTaskRecord(
      await this.deps.loadTaskOrThrow(identity.tenantId, taskId, client),
    );
    if (
      (currentTask.state === 'ready' || currentTask.state === 'pending') &&
      matchesReviewMetadata(currentTask, { action: 'approve' })
    ) {
      return this.deps.toTaskResponse(currentTask);
    }

    return this.applyStateTransition(identity, taskId, 'ready', {
      expectedStates: ['awaiting_approval'],
      metadataPatch: {
        assessment_action: 'approve',
        assessment_updated_at: new Date().toISOString(),
      },
      afterUpdate: async (updatedTask, client) => {
        await this.deps.workItemContinuityService?.clearAssessmentExpectation(
          identity.tenantId,
          updatedTask,
          client,
        );
      },
      reason: 'approved',
    }, client);
  }

  async approveTaskOutput(identity: ApiKeyIdentity, taskId: string, client?: DatabaseClient) {
    const currentTask = normalizeTaskRecord(
      await this.deps.loadTaskOrThrow(identity.tenantId, taskId, client),
    );
    if (currentTask.state === 'completed') {
      return this.deps.toTaskResponse(currentTask);
    }
    if (identity.scope === 'agent' && !currentTask.is_orchestrator_task && currentTask.workflow_id) {
      throw new ConflictError(
        'Agent-driven task output approval is not allowed for workflow specialist tasks; use formal assessment resolution instead.',
      );
    }

    return this.applyStateTransition(identity, taskId, 'completed', {
      expectedStates: ['output_pending_assessment'],
      clearLifecycleControlMetadata: true,
      clearEscalationMetadata: true,
      metadataPatch: {
        assessment_action: 'approve_output',
        assessment_updated_at: new Date().toISOString(),
      },
      afterUpdate: async (updatedTask, client) => {
        await registerTaskOutputDocuments(client, identity.tenantId, updatedTask, updatedTask.output);
        await this.deps.workItemContinuityService?.clearAssessmentExpectation(
          identity.tenantId,
          updatedTask,
          client,
        );
        await this.restoreOpenChildAssessmentWorkItemRouting(
          identity.tenantId,
          updatedTask,
          client,
        );
      },
      reason: 'output_assessment_approved',
    }, client);
  }

  async retryTask(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: { override_input?: Record<string, unknown>; force?: boolean } = {},
    client?: DatabaseClient,
  ) {
    const task = normalizeTaskRecord(await this.deps.loadTaskOrThrow(identity.tenantId, taskId, client));
    if (
      (task.state === 'ready' || task.state === 'pending')
      && task.assigned_agent_id == null
      && task.assigned_worker_id == null
    ) {
      return this.deps.toTaskResponse(task);
    }

    const expectedStates: TaskState[] = payload.force
      ? [
          'failed',
          'cancelled',
          'completed',
          'ready',
          'pending',
          'awaiting_approval',
          'output_pending_assessment',
          'escalated',
        ]
      : ['failed'];

    if (!expectedStates.includes(task.state as TaskState)) {
      throw new ConflictError('Task is not retryable');
    }

    return this.applyStateTransition(identity, taskId, 'ready', {
      expectedStates,
      retryIncrement: true,
      clearAssignment: true,
      clearExecutionData: true,
      clearLifecycleControlMetadata: true,
      clearEscalationMetadata: true,
      overrideInput: payload.override_input,
      reason: payload.force ? 'manual_retry_forced' : 'manual_retry',
    }, client);
  }

  async cancelTask(identity: ApiKeyIdentity, taskId: string, client?: DatabaseClient) {
    const task = normalizeTaskRecord(await this.deps.loadTaskOrThrow(identity.tenantId, taskId, client));
    if (task.state === 'cancelled' || task.state === 'completed') {
      return this.deps.toTaskResponse(task);
    }

    if (
      (task.state === 'claimed' || task.state === 'in_progress') &&
      typeof task.assigned_worker_id === 'string' &&
      this.deps.queueWorkerCancelSignal
    ) {
      await this.deps.queueWorkerCancelSignal(
        identity,
        task.assigned_worker_id,
        taskId,
        'manual_cancel',
        new Date(),
      );
    }

    return this.applyStateTransition(identity, taskId, 'cancelled', {
      expectedStates: [
        'pending',
        'ready',
        'claimed',
        'in_progress',
        'awaiting_approval',
        'output_pending_assessment',
        'escalated',
        'failed',
      ],
      clearAssignment: true,
      clearLifecycleControlMetadata: true,
      clearEscalationMetadata: true,
      reason: 'cancelled',
    }, client);
  }

  async rejectTask(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: { feedback: string; record_continuity?: boolean },
    client?: DatabaseClient,
  ) {
    const task = normalizeTaskRecord(await this.deps.loadTaskOrThrow(identity.tenantId, taskId, client));
    if (hasMatchingAssessmentRejection(task, payload.feedback)) {
      return this.deps.toTaskResponse(task);
    }

    return this.applyStateTransition(identity, taskId, 'failed', {
      expectedStates: ['awaiting_approval', 'output_pending_assessment', 'in_progress', 'claimed', 'completed'],
      clearAssignment: true,
      clearLifecycleControlMetadata: true,
      clearEscalationMetadata: true,
      error: {
        category: 'assessment_rejected',
        message: payload.feedback,
        recoverable: true,
      },
      metadataPatch: {
        assessment_feedback: payload.feedback,
        assessment_action: 'reject',
        assessment_updated_at: new Date().toISOString(),
      },
      afterUpdate: async (updatedTask, client) => {
        if (payload.record_continuity !== false) {
          await this.deps.workItemContinuityService?.recordAssessmentRequestedChanges(
            identity.tenantId,
            updatedTask,
            client,
          );
        }
      },
      reason: 'assessment_rejected',
    }, client);
  }

  async requestTaskChanges(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: {
      feedback: string;
      override_input?: Record<string, unknown>;
      preferred_agent_id?: string;
      preferred_worker_id?: string;
    },
    client?: DatabaseClient,
  ) {
    const task = normalizeTaskRecord(await this.deps.loadTaskOrThrow(identity.tenantId, taskId, client));
    if (hasActiveReworkRequest(task)) {
      return this.deps.toTaskResponse(task);
    }
    const latestAssessmentRequest = await this.loadLatestAssessmentRequestHandoff(
      identity.tenantId,
      task,
      client,
    );
    const latestTaskHandoffCreatedAt = await this.loadLatestTaskAttemptHandoffCreatedAt(
      identity.tenantId,
      task,
      client,
    );
    if (hasSupersedingTaskHandoffAfterAssessmentRequest(task, latestAssessmentRequest, latestTaskHandoffCreatedAt)) {
      return this.deps.toTaskResponse(task);
    }
    if (hasAppliedLatestAssessmentRequest(task, latestAssessmentRequest)) {
      return this.deps.toTaskResponse(task);
    }
    const overrideInput = payload.override_input ?? null;
    const nextInput = overrideInput ?? {
      ...asRecord(task.input),
      assessment_feedback: payload.feedback,
    };
    const nextDescription = resolveRequestedChangesDescription(task, overrideInput, nextInput);
    const nextReworkInput = nextDescription
      ? { ...nextInput, description: nextDescription }
      : nextInput;
    if (
      (task.state === 'ready' || task.state === 'pending' || task.state === 'failed') &&
      isJsonEquivalent(task.input, nextReworkInput) &&
      matchesReviewMetadata(task, {
        action: 'request_changes',
        feedback: payload.feedback,
        preferredAgentId: payload.preferred_agent_id ?? undefined,
        preferredWorkerId: payload.preferred_worker_id ?? undefined,
      })
    ) {
      return this.deps.toTaskResponse(task);
    }

    const lifecyclePolicy = readPersistedLifecyclePolicy(task.metadata);
    const nextReworkCount = Number(task.rework_count ?? 0) + 1;
    const maxReworkCount = lifecyclePolicy?.rework?.max_cycles ?? 10;

    if (nextReworkCount > maxReworkCount) {
      return this.applyStateTransition(identity, taskId, 'failed', {
        expectedStates: [
          'awaiting_approval',
          'output_pending_assessment',
          'completed',
          'failed',
          'cancelled',
        ],
        clearAssignment: true,
        clearLifecycleControlMetadata: true,
        reworkIncrement: true,
        metadataPatch: {
          assessment_feedback: payload.feedback,
          assessment_action: 'request_changes',
          assessment_updated_at: new Date().toISOString(),
          max_rework_exceeded_at: new Date().toISOString(),
          ...(latestAssessmentRequest
            ? {
                last_applied_assessment_request_handoff_id: latestAssessmentRequest.handoff_id,
                last_applied_assessment_request_task_id: latestAssessmentRequest.assessment_task_id,
              }
            : {}),
          ...(payload.preferred_agent_id ? { preferred_agent_id: payload.preferred_agent_id } : {}),
          ...(payload.preferred_worker_id
            ? { preferred_worker_id: payload.preferred_worker_id }
            : {}),
        },
        error: {
          category: 'max_rework_exceeded',
          message: payload.feedback,
          recoverable: false,
        },
        afterUpdate: async (updatedTask, client) => {
          await this.deps.eventService.emit(
            {
              tenantId: identity.tenantId,
              type: 'task.max_rework_exceeded',
              entityType: 'task',
              entityId: taskId,
              actorType: identity.scope,
              actorId: identity.keyPrefix,
              data: {
                rework_count: updatedTask.rework_count,
                max_rework_count: maxReworkCount,
              },
            },
            client,
          );
          await this.logGovernanceTransition(
            identity.tenantId,
            'task.max_rework_exceeded',
            updatedTask,
            {
              event_type: 'task.max_rework_exceeded',
              rework_count: updatedTask.rework_count ?? null,
              max_rework_count: maxReworkCount,
            },
            client,
          );
          await this.maybeCreateEscalationTask(
            identity,
            updatedTask,
            lifecyclePolicy,
            {
              category: 'max_rework_exceeded',
              retryable: false,
              recoverable: false,
            },
            client,
          );
        },
        reason: 'max_rework_exceeded',
      }, client);
    }

    return this.applyStateTransition(identity, taskId, 'ready', {
      expectedStates: [
        'awaiting_approval',
        'output_pending_assessment',
        'completed',
        'failed',
        'cancelled',
      ],
      clearAssignment: true,
      clearExecutionData: true,
      clearLifecycleControlMetadata: true,
      clearEscalationMetadata: true,
      reworkIncrement: true,
      retryIncrement: true,
      overrideInput: nextReworkInput,
      metadataPatch: {
        ...(nextDescription ? { description: nextDescription } : {}),
        assessment_feedback: payload.feedback,
        assessment_action: 'request_changes',
        assessment_updated_at: new Date().toISOString(),
        ...(latestAssessmentRequest
          ? {
              last_applied_assessment_request_handoff_id: latestAssessmentRequest.handoff_id,
              last_applied_assessment_request_task_id: latestAssessmentRequest.assessment_task_id,
            }
          : {}),
        ...(payload.preferred_agent_id ? { preferred_agent_id: payload.preferred_agent_id } : {}),
        ...(payload.preferred_worker_id
          ? { preferred_worker_id: payload.preferred_worker_id }
          : {}),
      },
      afterUpdate: async (updatedTask, client) => {
        await this.reopenCompletedWorkItemForRework(identity, updatedTask, client);
        await this.clearOpenChildAssessmentWorkItemRouting(identity.tenantId, updatedTask, client);
        await this.deps.workItemContinuityService?.recordAssessmentRequestedChanges(
          identity.tenantId,
          updatedTask,
          client,
        );
      },
      reason: 'assessment_requested_changes',
    }, client);
  }

  private async loadLatestTaskAttemptHandoffCreatedAt(
    tenantId: string,
    task: Record<string, unknown>,
    db?: DatabaseClient,
  ): Promise<Date | null> {
    const taskId = readOptionalText(task.id);
    const taskReworkCount = readInteger(task.rework_count) ?? 0;
    if (!taskId) {
      return null;
    }

    const queryClient = db
      ?? ('query' in this.deps.pool && typeof this.deps.pool.query === 'function'
        ? this.deps.pool
        : await this.deps.pool.connect());
    const ownsClient = db == null && queryClient !== this.deps.pool;

    try {
      const result = await queryClient.query<{ created_at: Date | null }>(
        `SELECT created_at
           FROM task_handoffs
          WHERE tenant_id = $1
            AND task_id = $2
            AND task_rework_count = $3
          ORDER BY sequence DESC, created_at DESC
          LIMIT 1`,
        [tenantId, taskId, taskReworkCount],
      );
      return result.rows[0]?.created_at ?? null;
    } finally {
      if (ownsClient && 'release' in queryClient && typeof queryClient.release === 'function') {
        queryClient.release();
      }
    }
  }

  async skipTask(identity: ApiKeyIdentity, taskId: string, payload: { reason: string }) {
    const task = normalizeTaskRecord(await this.deps.loadTaskOrThrow(identity.tenantId, taskId));
    if (
      task.state === 'completed' &&
      isJsonEquivalent(task.output, { skipped: true, reason: payload.reason }) &&
      matchesReviewMetadata(task, { action: 'skip', feedback: payload.reason })
    ) {
      return this.deps.toTaskResponse(task);
    }

    return this.applyStateTransition(identity, taskId, 'completed', {
      expectedStates: [
        'pending',
        'ready',
        'awaiting_approval',
        'output_pending_assessment',
        'failed',
        'cancelled',
      ],
      clearAssignment: true,
      clearLifecycleControlMetadata: true,
      clearEscalationMetadata: true,
      output: {
        skipped: true,
        reason: payload.reason,
      },
      metadataPatch: {
        assessment_action: 'skip',
        assessment_feedback: payload.reason,
        assessment_updated_at: new Date().toISOString(),
      },
      reason: 'task_skipped',
    });
  }

  async reassignTask(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: { preferred_agent_id?: string; preferred_worker_id?: string; reason: string },
    client?: DatabaseClient,
  ) {
    const task = normalizeTaskRecord(await this.deps.loadTaskOrThrow(identity.tenantId, taskId, client));
    if (
      (task.state === 'ready' || task.state === 'pending') &&
      matchesReviewMetadata(task, {
        action: 'reassign',
        feedback: payload.reason,
        preferredAgentId: payload.preferred_agent_id ?? null,
        preferredWorkerId: payload.preferred_worker_id ?? null,
      })
    ) {
      return this.deps.toTaskResponse(task);
    }

    if (
      (task.state === 'claimed' || task.state === 'in_progress') &&
      typeof task.assigned_worker_id === 'string' &&
      this.deps.queueWorkerCancelSignal
    ) {
      await this.deps.queueWorkerCancelSignal(
        identity,
        task.assigned_worker_id,
        taskId,
        'manual_cancel',
        new Date(),
      );
    }

    return this.applyStateTransition(identity, taskId, 'ready', {
      expectedStates: [
        'pending',
        'ready',
        'claimed',
        'in_progress',
        'awaiting_approval',
        'output_pending_assessment',
        'failed',
        'cancelled',
      ],
      clearAssignment: true,
      clearExecutionData: task.state === 'output_pending_assessment' || task.state === 'failed',
      clearLifecycleControlMetadata: true,
      clearEscalationMetadata: true,
      metadataPatch: {
        preferred_agent_id: payload.preferred_agent_id ?? null,
        preferred_worker_id: payload.preferred_worker_id ?? null,
        assessment_action: 'reassign',
        assessment_feedback: payload.reason,
        assessment_updated_at: new Date().toISOString(),
      },
      reason: 'task_reassigned',
    }, client);
  }

  async escalateTask(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: {
      reason: string;
      escalation_target?: string;
      context?: Record<string, unknown>;
      recommendation?: string;
      blocking_task_id?: string;
      urgency?: 'info' | 'important' | 'critical';
    },
    client?: DatabaseClient,
  ) {
    const task = normalizeTaskRecord(await this.deps.loadTaskOrThrow(identity.tenantId, taskId, client));
    if (isCancelledOrCompletedTask(task)) {
      return this.deps.toTaskResponse(task);
    }
    if (
      task.state === 'escalated'
      && hasMatchingManualEscalation(task, payload)
    ) {
      return this.deps.toTaskResponse(task);
    }
    const existingEscalations = Array.isArray(asRecord(task.metadata).escalations)
      ? (asRecord(task.metadata).escalations as unknown[])
      : [];

    return this.applyStateTransition(identity, taskId, 'escalated', {
      expectedStates: ['claimed', 'in_progress'],
      clearAssignment: true,
      clearLifecycleControlMetadata: true,
      metadataPatch: {
        escalations: [
          ...existingEscalations,
          {
            reason: payload.reason,
            target: payload.escalation_target ?? null,
            context: payload.context ?? null,
            recommendation: payload.recommendation ?? null,
            blocking_task_id: payload.blocking_task_id ?? null,
            urgency: payload.urgency ?? null,
            escalated_at: new Date().toISOString(),
          },
        ],
        escalation_reason: payload.reason,
        escalation_target: payload.escalation_target ?? 'human',
        escalation_context_packet: payload.context ?? null,
        escalation_recommendation: payload.recommendation ?? null,
        escalation_blocking_task_id: payload.blocking_task_id ?? null,
        escalation_urgency: payload.urgency ?? null,
        escalation_awaiting_human: true,
        assessment_action: 'escalate',
        assessment_feedback: payload.reason,
        assessment_updated_at: new Date().toISOString(),
      },
      afterUpdate: async (_updatedTask, client) => {
        await this.maybeOpenTaskWorkItemEscalation(identity.tenantId, task, payload.reason, client);
        await this.enqueuePlaybookActivationIfNeeded(identity, task, 'task.escalated', {
          task_id: taskId,
          task_role: task.role ?? null,
          task_title: task.title ?? null,
          work_item_id: task.work_item_id ?? null,
          stage_name: task.stage_name ?? null,
          escalation_target: payload.escalation_target ?? 'human',
          escalation_reason: payload.reason,
          escalation_context_packet: payload.context ?? null,
          escalation_recommendation: payload.recommendation ?? null,
          escalation_blocking_task_id: payload.blocking_task_id ?? null,
          escalation_urgency: payload.urgency ?? null,
        }, client);
        await this.deps.eventService.emit(
          {
            tenantId: identity.tenantId,
            type: 'task.escalated',
            entityType: 'task',
            entityId: taskId,
            actorType: identity.scope,
            actorId: identity.keyPrefix,
            data: {
              reason: payload.reason,
              escalation_target: payload.escalation_target ?? 'human',
              context: payload.context ?? null,
              recommendation: payload.recommendation ?? null,
              blocking_task_id: payload.blocking_task_id ?? null,
              urgency: payload.urgency ?? null,
            },
          },
          client,
        );
        await this.logGovernanceTransition(
          identity.tenantId,
          'task.escalation.manual',
          task,
          {
            event_type: 'task.escalated',
            escalation_target: payload.escalation_target ?? 'human',
            escalation_reason: payload.reason,
            context: payload.context ?? null,
            recommendation: payload.recommendation ?? null,
            blocking_task_id: payload.blocking_task_id ?? null,
            urgency: payload.urgency ?? null,
          },
          client,
        );
      },
      reason: 'task_escalated',
    }, client);
  }

  async overrideTaskOutput(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: { output: unknown; reason: string },
  ) {
    const task = normalizeTaskRecord(await this.deps.loadTaskOrThrow(identity.tenantId, taskId));
    if (
      task.state === 'completed' &&
      isJsonEquivalent(task.output, payload.output) &&
      matchesReviewMetadata(task, { action: 'override_output', feedback: payload.reason })
    ) {
      return this.deps.toTaskResponse(task);
    }

    return this.applyStateTransition(identity, taskId, 'completed', {
      expectedStates: ['output_pending_assessment', 'failed', 'cancelled', 'completed'],
      clearAssignment: true,
      clearLifecycleControlMetadata: true,
      clearEscalationMetadata: true,
      output: payload.output,
      metadataPatch: {
        assessment_action: 'override_output',
        assessment_feedback: payload.reason,
        assessment_updated_at: new Date().toISOString(),
      },
      reason: 'task_output_overridden',
    });
  }

  async respondToEscalation(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: { instructions: string; context?: Record<string, unknown> },
  ) {
    const task = normalizeTaskRecord(await this.deps.loadTaskOrThrow(identity.tenantId, taskId));
    const metadata = asRecord(task.metadata);
    const escalationTaskId =
      typeof metadata.escalation_task_id === 'string' ? metadata.escalation_task_id : null;
    if (!escalationTaskId) {
      throw new ConflictError('Task does not have a pending escalation task');
    }

    const escalationTask = normalizeTaskRecord(
      await this.deps.loadTaskOrThrow(identity.tenantId, escalationTaskId),
    );
    const existingEscalationResponse = asRecord(asRecord(escalationTask.input).human_escalation_response);
    if (
      existingEscalationResponse.instructions === payload.instructions &&
      isJsonEquivalent(existingEscalationResponse.context ?? {}, payload.context ?? {}) &&
      typeof asRecord(escalationTask.metadata).human_escalation_response_at === 'string'
    ) {
      return this.deps.toTaskResponse(escalationTask);
    }

    const nextInput = {
      ...asRecord(escalationTask.input),
      human_escalation_response: {
        instructions: payload.instructions,
        context: payload.context ?? {},
        responded_at: new Date().toISOString(),
        responded_by: identity.keyPrefix,
      },
    };

    const client = await this.deps.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE tasks
            SET input = $3::jsonb,
                metadata = metadata || $4::jsonb,
                updated_at = now()
          WHERE tenant_id = $1
            AND id = $2`,
        [
          identity.tenantId,
          escalationTaskId,
          nextInput,
          {
            human_escalation_response_at: new Date().toISOString(),
          },
        ],
      );
      await this.deps.eventService.emit(
        {
          tenantId: identity.tenantId,
          type: 'task.escalation_response_recorded',
          entityType: 'task',
          entityId: taskId,
          actorType: identity.scope,
          actorId: identity.keyPrefix,
          data: {
            escalation_task_id: escalationTaskId,
          },
        },
        client,
      );
      await this.logGovernanceTransition(
        identity.tenantId,
        'task.escalation.response_recorded',
        task,
        {
          event_type: 'task.escalation_response_recorded',
          escalation_task_id: escalationTaskId,
        },
        client,
      );
      await client.query('COMMIT');
      return this.deps.toTaskResponse(
        normalizeTaskRecord(await this.deps.loadTaskOrThrow(identity.tenantId, escalationTaskId)),
      );
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async agentEscalate(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: {
      reason: string;
      context_summary?: string;
      work_so_far?: string;
    },
  ) {
    const task = normalizeTaskRecord(await this.deps.loadTaskOrThrow(identity.tenantId, taskId));
    if (isCancelledOrCompletedTask(task)) {
      return this.deps.toTaskResponse(task);
    }
    const roleName = typeof task.role === 'string' ? task.role : '';

    if (!this.deps.getRoleByName) {
      throw new ConflictError('Escalation is not configured: role lookup unavailable');
    }

    const roleDef = await this.deps.getRoleByName(identity.tenantId, roleName);
    const isOrchestratorTask = task.is_orchestrator_task === true;
    const escalationTarget = roleDef?.escalation_target
      ?? (isOrchestratorTask ? DEFAULT_ORCHESTRATOR_ESCALATION_TARGET : null);
    if (!escalationTarget) {
      throw new ConflictError(`Escalation not configured for role '${roleName}'`);
    }
    if (hasMatchingAgentEscalation(task, escalationTarget, payload)) {
      return this.deps.toTaskResponse(task);
    }

    const metadata = asRecord(task.metadata);
    const currentDepth = typeof metadata.escalation_depth === 'number' ? metadata.escalation_depth : 0;
    const maxDepth = roleDef?.max_escalation_depth ?? DEFAULT_ORCHESTRATOR_MAX_ESCALATION_DEPTH;
    if (hasMatchingAgentEscalationDepthFailure(task, currentDepth, maxDepth)) {
      return this.deps.toTaskResponse(task);
    }

    if (currentDepth >= maxDepth) {
      return this.applyStateTransition(identity, taskId, 'failed', {
        expectedStates: ['in_progress'],
        clearAssignment: true,
        clearLifecycleControlMetadata: true,
        error: {
          category: 'escalation_depth_exceeded',
          message: `Escalation depth ${currentDepth} exceeds maximum ${maxDepth}`,
          recoverable: false,
        },
        metadataPatch: {
          escalation_depth: currentDepth,
          escalation_max_depth: maxDepth,
        },
        afterUpdate: async (updatedTask, client) => {
          await this.deps.eventService.emit(
            {
              tenantId: identity.tenantId,
              type: 'task.escalation_depth_exceeded',
              entityType: 'task',
              entityId: taskId,
              actorType: identity.scope,
              actorId: identity.keyPrefix,
              data: {
                depth: currentDepth,
                max_depth: maxDepth,
              },
            },
            client,
          );
        },
        reason: 'escalation_depth_exceeded',
      });
    }

    if (escalationTarget === 'human') {
      return this.applyStateTransition(identity, taskId, 'escalated', {
        expectedStates: ['in_progress'],
        clearAssignment: true,
        clearLifecycleControlMetadata: true,
        metadataPatch: {
          escalation_reason: payload.reason,
          escalation_context: payload.context_summary ?? null,
          escalation_work_so_far: payload.work_so_far ?? null,
          escalation_target: 'human',
          escalation_depth: currentDepth + 1,
          escalation_awaiting_human: true,
      },
      afterUpdate: async (_updatedTask, client) => {
        await this.maybeOpenTaskWorkItemEscalation(identity.tenantId, task, payload.reason, client);
        await this.enqueuePlaybookActivationIfNeeded(identity, task, 'task.agent_escalated', {
          task_id: taskId,
            task_role: task.role ?? null,
            task_title: task.title ?? null,
            work_item_id: task.work_item_id ?? null,
            stage_name: task.stage_name ?? null,
            escalation_target: 'human',
            escalation_reason: payload.reason,
            escalation_context: payload.context_summary ?? null,
          }, client);
          await this.deps.eventService.emit(
            {
              tenantId: identity.tenantId,
              type: 'task.agent_escalated',
              entityType: 'task',
              entityId: taskId,
              actorType: identity.scope,
              actorId: identity.keyPrefix,
              data: {
                reason: payload.reason,
                context_summary: payload.context_summary ?? null,
                source_role: roleName,
                escalation_target: 'human',
                escalation_depth: currentDepth + 1,
              },
            },
            client,
          );
          await this.logGovernanceTransition(
            identity.tenantId,
            'task.escalation.agent',
            task,
            {
              event_type: 'task.agent_escalated',
              escalation_target: 'human',
              escalation_reason: payload.reason,
              context_summary: payload.context_summary ?? null,
              source_role: roleName,
              escalation_depth: currentDepth + 1,
            },
            client,
          );
        },
        reason: 'agent_escalated',
      });
    }

    return this.applyStateTransition(identity, taskId, 'escalated', {
      expectedStates: ['in_progress'],
      clearAssignment: true,
      clearLifecycleControlMetadata: true,
      metadataPatch: {
        escalation_reason: payload.reason,
        escalation_context: payload.context_summary ?? null,
        escalation_work_so_far: payload.work_so_far ?? null,
        escalation_target: escalationTarget,
        escalation_depth: currentDepth + 1,
      },
      afterUpdate: async (updatedTask, client) => {
        await this.maybeOpenTaskWorkItemEscalation(identity.tenantId, task, payload.reason, client);
        await this.enqueuePlaybookActivationIfNeeded(identity, task, 'task.agent_escalated', {
          task_id: taskId,
          task_role: task.role ?? null,
          task_title: task.title ?? null,
          work_item_id: task.work_item_id ?? null,
          stage_name: task.stage_name ?? null,
          escalation_target: escalationTarget,
          escalation_reason: payload.reason,
          escalation_context: payload.context_summary ?? null,
        }, client);
        const escalationTask = await this.createEscalationTaskForRole(
          identity,
          updatedTask,
          escalationTarget,
          {
            reason: payload.reason,
            context_summary: payload.context_summary,
            work_so_far: payload.work_so_far,
          },
          currentDepth + 1,
          client,
        );

        await client.query(
          `UPDATE tasks SET metadata = metadata || $3::jsonb WHERE tenant_id = $1 AND id = $2`,
          [identity.tenantId, taskId, { escalation_task_id: escalationTask.id }],
        );

        await this.deps.eventService.emit(
          {
            tenantId: identity.tenantId,
            type: 'task.agent_escalated',
            entityType: 'task',
            entityId: taskId,
            actorType: identity.scope,
            actorId: identity.keyPrefix,
            data: {
              reason: payload.reason,
              context_summary: payload.context_summary ?? null,
              source_role: roleName,
              escalation_target: escalationTarget,
              escalation_depth: currentDepth + 1,
            },
          },
          client,
        );
        await this.logGovernanceTransition(
          identity.tenantId,
          'task.escalation.agent',
          task,
          {
            event_type: 'task.agent_escalated',
            escalation_target: escalationTarget,
            escalation_reason: payload.reason,
            context_summary: payload.context_summary ?? null,
            source_role: roleName,
            escalation_depth: currentDepth + 1,
          },
          client,
        );
        await this.deps.eventService.emit(
          {
            tenantId: identity.tenantId,
            type: 'task.escalation_task_created',
            entityType: 'task',
            entityId: taskId,
            actorType: identity.scope,
            actorId: identity.keyPrefix,
            data: {
              escalation_task_id: escalationTask.id,
              target_role: escalationTarget,
              source_task_id: taskId,
              depth: currentDepth + 1,
            },
          },
          client,
        );
        await this.logGovernanceTransition(
          identity.tenantId,
          'task.escalation.task_created',
          task,
          {
            event_type: 'task.escalation_task_created',
            escalation_task_id: escalationTask.id,
            target_role: escalationTarget,
            source_task_id: taskId,
            depth: currentDepth + 1,
          },
          client,
        );
      },
      reason: 'agent_escalated',
    });
  }

  async resolveEscalation(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: {
      instructions: string;
      context?: Record<string, unknown>;
    },
  ) {
    const currentTask = normalizeTaskRecord(await this.deps.loadTaskOrThrow(identity.tenantId, taskId));
    const existingResolution = asRecord(asRecord(currentTask.input).escalation_resolution);
    if (
      currentTask.state === 'ready' &&
      existingResolution.instructions === payload.instructions &&
      isJsonEquivalent(existingResolution.context ?? {}, payload.context ?? {})
    ) {
      return this.deps.toTaskResponse(currentTask);
    }

    if (currentTask.state !== 'escalated') {
      throw new ConflictError('Task is not awaiting escalation');
    }

    const client = await this.deps.pool.connect();
    try {
      await client.query('BEGIN');
      const task = normalizeTaskRecord(await this.deps.loadTaskOrThrow(identity.tenantId, taskId, client));
      if (task.state !== 'escalated') {
        throw new ConflictError('Task is not awaiting escalation');
      }

      const currentInput = asRecord(task.input);
      const nextInput = {
        ...currentInput,
        escalation_resolution: {
          resolved_by: 'human',
          instructions: payload.instructions,
          context: payload.context ?? {},
          resolved_at: new Date().toISOString(),
          resolved_by_user: identity.keyPrefix,
        },
      };
      const hasCurrentAttemptHandoff =
        (await this.loadLatestTaskAttemptHandoffCreatedAt(identity.tenantId, task, client)) !== null;
      const nextState: TaskState = hasCurrentAttemptHandoff ? 'completed' : 'ready';

      const result = await this.applyStateTransition(identity, taskId, nextState, {
        expectedStates: ['escalated'],
        clearAssignment: true,
        clearExecutionData: !hasCurrentAttemptHandoff,
        clearLifecycleControlMetadata: true,
        overrideInput: nextInput,
        metadataPatch: {
          escalation_awaiting_human: null,
        },
        afterUpdate: async (_updatedTask, updateClient) => {
          await this.maybeResolveTaskWorkItemEscalation(
            identity.tenantId,
            task,
            'unblock_subject',
            payload.instructions,
            identity.ownerType,
            identity.keyPrefix,
            updateClient,
          );
          await this.enqueuePlaybookActivationIfNeeded(identity, task, 'task.escalation_resolved', {
            task_id: taskId,
            task_role: task.role ?? null,
            task_title: task.title ?? null,
            work_item_id: task.work_item_id ?? null,
            stage_name: task.stage_name ?? null,
            resolved_by: 'human',
            resolution_preview: payload.instructions.slice(0, 200),
          }, updateClient);
          await this.deps.eventService.emit(
            {
              tenantId: identity.tenantId,
              type: 'task.escalation_resolved',
              entityType: 'task',
              entityId: taskId,
              actorType: identity.scope,
              actorId: identity.keyPrefix,
              data: {
                resolved_by: 'human',
                resolution_preview: payload.instructions.slice(0, 200),
              },
            },
            updateClient,
          );
        },
        reason: 'escalation_resolved',
      }, client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async enqueuePlaybookActivationIfNeeded(
    identity: ApiKeyIdentity,
    task: Record<string, unknown>,
    eventType: string,
    payload: Record<string, unknown>,
    client: DatabaseClient,
  ): Promise<void> {
    if (
      task.is_orchestrator_task ||
      typeof task.workflow_id !== 'string'
    ) {
      return;
    }

    await enqueueAndDispatchImmediatePlaybookActivation(
      client,
      this.deps.eventService,
      this.deps.activationDispatchService,
      {
      tenantId: identity.tenantId,
      workflowId: task.workflow_id,
      requestId: `${eventType}:${String(task.id)}:${new Date().toISOString()}`,
      reason: eventType,
      eventType,
      payload,
      actorType: 'system',
      actorId: 'task_lifecycle_service',
      },
    );
  }

  private async maybeResolveEscalationSource(
    identity: ApiKeyIdentity,
    completedTask: Record<string, unknown>,
    client: DatabaseClient,
  ): Promise<void> {
    const metadata = asRecord(completedTask.metadata);
    const sourceTaskId = metadata.escalation_source_task_id;
    if (typeof sourceTaskId !== 'string') return;

    const sourceTaskRes = await client.query(
      'SELECT * FROM tasks WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
      [identity.tenantId, sourceTaskId],
    );
    if (!sourceTaskRes.rowCount) return;

    const sourceTask = normalizeTaskRecord(sourceTaskRes.rows[0] as Record<string, unknown>);
    if (sourceTask.state !== 'escalated') return;

    const currentInput = asRecord(sourceTask.input);
    const nextInput = {
      ...currentInput,
      escalation_resolution: {
        resolved_by_role: completedTask.role,
        resolved_by_task_id: completedTask.id,
        instructions: completedTask.output,
        resolved_at: new Date().toISOString(),
      },
    };
    const reopenedState = await this.resolveNextState(
      identity.tenantId,
      sourceTask,
      'ready',
      client,
    );

    await client.query(
      `UPDATE tasks SET state = $4::task_state, state_changed_at = now(), input = $3::jsonb,
       assigned_agent_id = NULL, assigned_worker_id = NULL, claimed_at = NULL, started_at = NULL,
       output = NULL, error = NULL, metrics = NULL, git_info = NULL
       WHERE tenant_id = $1 AND id = $2`,
      [identity.tenantId, sourceTaskId, nextInput, toStoredTaskState(reopenedState)],
    );
    await this.maybeResolveTaskWorkItemEscalation(
      identity.tenantId,
      sourceTask,
      'unblock_subject',
      null,
      'task',
      String(completedTask.id),
      client,
    );

    await this.deps.eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'task.state_changed',
        entityType: 'task',
        entityId: sourceTaskId,
        actorType: 'system',
        actorId: 'smart_escalation',
        data: {
          from_state: 'escalated',
          to_state: reopenedState,
          reason: 'escalation_resolved',
        },
      },
      client,
    );

    await this.deps.eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'task.escalation_resolved',
        entityType: 'task',
        entityId: sourceTaskId,
        actorType: 'system',
        actorId: 'smart_escalation',
        data: {
          resolved_by: completedTask.role,
          escalation_task_id: completedTask.id,
          resolution_preview: typeof completedTask.output === 'string'
            ? completedTask.output.slice(0, 200)
            : JSON.stringify(completedTask.output).slice(0, 200),
        },
      },
      client,
    );
  }

  private async maybeOpenTaskWorkItemEscalation(
    tenantId: string,
    task: Record<string, unknown>,
    reason: string,
    client: DatabaseClient,
  ): Promise<void> {
    const workflowId = readOptionalText(task.workflow_id);
    const workItemId = readOptionalText(task.work_item_id);
    const taskId = readOptionalText(task.id);
    if (!workflowId || !workItemId || !taskId) {
      return;
    }

    const linkage = readAssessmentSubjectLinkage(task.input, task.metadata);
    await openWorkItemEscalation(client, {
      tenantId,
      workflowId,
      workItemId,
      subjectRef: {
        kind: 'task',
        task_id: taskId,
        work_item_id: workItemId,
      },
      subjectRevision: linkage.subjectRevision,
      reason,
      createdByTaskId: taskId,
    });
  }

  private async maybeResolveTaskWorkItemEscalation(
    tenantId: string,
    task: Record<string, unknown>,
    resolutionAction: 'dismiss' | 'unblock_subject' | 'reopen_subject',
    feedback: string | null,
    resolvedByType: string,
    resolvedById: string,
    client: DatabaseClient,
  ): Promise<void> {
    const workflowId = readOptionalText(task.workflow_id);
    const workItemId = readOptionalText(task.work_item_id);
    if (!workflowId || !workItemId) {
      return;
    }

    const openEscalation = await loadOpenWorkItemEscalation(client, tenantId, workflowId, workItemId);
    if (!openEscalation) {
      return;
    }

    await resolveWorkItemEscalation(client, {
      tenantId,
      workflowId,
      workItemId,
      escalationId: openEscalation.id,
      resolutionAction,
      feedback,
      resolvedByType,
      resolvedById,
    });
  }

  private async createEscalationTaskForRole(
    identity: ApiKeyIdentity,
    sourceTask: Record<string, unknown>,
    targetRole: string,
    escalationContext: {
      reason: string;
      context_summary?: string;
      work_so_far?: string;
    },
    depth: number,
    client: DatabaseClient,
  ): Promise<Record<string, unknown>> {
    const title = `Escalation: ${String(sourceTask.title ?? 'task')}`;
    const initialState = await this.resolveCreatedSpecialistTaskState(
      identity.tenantId,
      {
        workflow_id: (sourceTask.workflow_id as string | null | undefined) ?? null,
        work_item_id: (sourceTask.work_item_id as string | null | undefined) ?? null,
        is_orchestrator_task: false,
      },
      client,
    );
    const input = {
      escalation: true,
      source_task_id: sourceTask.id,
      source_task_title: sourceTask.title,
      source_task_role: sourceTask.role,
      reason: escalationContext.reason,
      context_summary: escalationContext.context_summary ?? null,
      work_so_far: escalationContext.work_so_far ?? null,
      original_instructions: asRecord(sourceTask.input).instructions ?? null,
    };
    const metadata = {
      escalation_source_task_id: sourceTask.id,
      escalation_depth: depth,
    };

    const escalationInsert = await client.query(
      `INSERT INTO tasks (
         tenant_id, workflow_id, work_item_id, workspace_id, title, role, stage_name, priority, state, depends_on,
         input, context, role_config, environment,
         resource_bindings, timeout_minutes, token_budget, cost_cap_usd, auto_retry, max_retries, metadata
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,'high',$8::task_state,$9::uuid[],$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
       )
       RETURNING *`,
      [
        identity.tenantId,
        sourceTask.workflow_id ?? null,
        sourceTask.work_item_id ?? null,
        sourceTask.workspace_id ?? null,
        title,
        targetRole,
        sourceTask.stage_name ?? null,
        initialState,
        [],
        input,
        { escalation: true },
        null,
        null,
        [],
        await this.resolveInheritedTaskTimeoutMinutes(
          identity.tenantId,
          sourceTask.timeout_minutes,
          client,
        ),
        null,
        null,
        false,
        0,
        metadata,
      ],
    );

    const escalationTask = escalationInsert.rows[0] as Record<string, unknown>;

    await this.deps.eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'task.created',
        entityType: 'task',
        entityId: String(escalationTask.id),
        actorType: 'system',
        actorId: 'smart_escalation',
        data: { state: initialState },
      },
      client,
    );

    return escalationTask;
  }

  private async maybeCreateEscalationTask(
    identity: ApiKeyIdentity,
    task: Record<string, unknown>,
    lifecyclePolicy: LifecyclePolicy | undefined,
    failure: FailureClassification,
    client: DatabaseClient,
  ) {
    const escalation = lifecyclePolicy?.escalation;
    if (!escalation || !escalation.enabled) {
      return;
    }
    if (asRecord(task.metadata).escalation_source_task_id) {
      return;
    }
    if (asRecord(task.metadata).escalation_status === 'pending') {
      return;
    }

    const escalationTaskInput = buildEscalationTaskInput(task, escalation, failure);
    const initialState = await this.resolveCreatedSpecialistTaskState(
      identity.tenantId,
      {
        workflow_id: (escalationTaskInput.workflow_id as string | null | undefined) ?? null,
        work_item_id: (escalationTaskInput.work_item_id as string | null | undefined) ?? null,
        is_orchestrator_task: false,
      },
      client,
    );
    const escalationInsert = await client.query(
      `INSERT INTO tasks (
         tenant_id, workflow_id, work_item_id, workspace_id, title, role, stage_name, priority, state, depends_on,
         input, context, role_config, environment,
         resource_bindings, timeout_minutes, token_budget, cost_cap_usd, auto_retry, max_retries, metadata
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9::task_state,$10::uuid[],$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
       )
       RETURNING *`,
      [
        identity.tenantId,
        escalationTaskInput.workflow_id ?? null,
        escalationTaskInput.work_item_id ?? null,
        escalationTaskInput.workspace_id ?? null,
        escalationTaskInput.title,
        escalationTaskInput.role ?? null,
        escalationTaskInput.stage_name ?? null,
        escalationTaskInput.priority ?? 'normal',
        initialState,
        [],
        escalationTaskInput.input ?? {},
        escalationTaskInput.context ?? {},
        escalationTaskInput.role_config ?? null,
        null,
        [],
        await this.resolveInheritedTaskTimeoutMinutes(
          identity.tenantId,
          task.timeout_minutes,
          client,
        ),
        null,
        null,
        false,
        0,
        escalationTaskInput.metadata ?? {},
      ],
    );
    const escalationTask = escalationInsert.rows[0] as Record<string, unknown>;

    await this.deps.eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'task.created',
        entityType: 'task',
        entityId: String(escalationTask.id),
        actorType: 'system',
        actorId: 'lifecycle_policy',
        data: { state: initialState },
      },
      client,
    );

    await client.query(
      `UPDATE tasks
         SET metadata = metadata || $3::jsonb
       WHERE tenant_id = $1 AND id = $2`,
      [
        identity.tenantId,
        task.id,
        {
          escalation_status: 'pending',
          escalation_task_id: escalationTask.id,
        },
      ],
    );

    await this.deps.eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'task.escalated',
        entityType: 'task',
        entityId: String(task.id),
        actorType: 'system',
        actorId: 'lifecycle_policy',
        data: {
          escalation_task_id: escalationTask.id,
          failure,
          role: escalation.role,
        },
      },
      client,
    );
    await this.deps.eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'task.escalation',
        entityType: 'task',
        entityId: String(task.id),
        actorType: 'system',
        actorId: 'lifecycle_policy',
        data: {
          escalation_task_id: escalationTask.id,
          failure,
          role: escalation.role,
        },
      },
      client,
    );
    await this.logGovernanceTransition(
      identity.tenantId,
      'task.escalation.policy',
      task,
      {
        event_type: 'task.escalation',
        escalation_task_id: escalationTask.id,
        failure,
        role: escalation.role,
      },
      client,
    );
  }

  private async resolveInheritedTaskTimeoutMinutes(
    tenantId: string,
    explicitValue: unknown,
    client: DatabaseClient,
  ): Promise<number> {
    const directValue = readPositiveInteger(explicitValue);
    if (directValue !== null) {
      return directValue;
    }

    if (
      typeof this.deps.defaultTaskTimeoutMinutes === 'number'
      && Number.isInteger(this.deps.defaultTaskTimeoutMinutes)
      && this.deps.defaultTaskTimeoutMinutes > 0
    ) {
      return this.deps.defaultTaskTimeoutMinutes;
    }

    return readRequiredPositiveIntegerRuntimeDefault(
      client,
      tenantId,
      TASK_DEFAULT_TIMEOUT_MINUTES_RUNTIME_KEY,
    );
  }
}

function isAssessmentTask(task: Record<string, unknown>) {
  if (readTaskKind(task) === 'assessment') {
    return true;
  }

  return readAssessmentSubjectLinkage(task.input, task.metadata).subjectTaskId !== null;
}

interface FailureClassification {
  category: string;
  retryable: boolean;
  recoverable: boolean;
}

interface RetryPlan {
  shouldRetry: boolean;
  backoffSeconds: number;
  retryAvailableAt: Date | null;
  policy?: RetryPolicy;
}

function classifyFailure(error: Record<string, unknown>): FailureClassification {
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

function buildRetryPlan(
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

function buildEscalationTaskInput(
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

function isFailTaskReplay(task: Record<string, unknown>, error: Record<string, unknown>): boolean {
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

interface OperatorReportingContract {
  mode: 'standard' | 'enhanced';
  executionContextId: string;
  sourceKind: 'orchestrator' | 'specialist';
  turnUpdatesRequired: boolean;
  milestoneBriefsRequired: boolean;
  operatorUpdateRequestIdPrefix: string;
  operatorBriefRequestIdPrefix: string;
}

async function readOperatorReportingContract(
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

function normalizeReportingMode(value: string | null | undefined): 'standard' | 'enhanced' {
  return value === 'standard' ? 'standard' : 'enhanced';
}

async function hasOperatorBriefForExecutionContext(
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

function buildMissingMilestoneBriefMessage(contract: OperatorReportingContract): string {
  return `This task reached a meaningful completion or handoff checkpoint without a required record_operator_brief for execution context ${contract.executionContextId}. Emit one milestone record_operator_brief with source_kind ${contract.sourceKind}, payload.short_brief.headline, and payload.detailed_brief_json.{headline,status_kind,summary} before retrying completion. Use request_id values starting with ${contract.operatorBriefRequestIdPrefix}.`;
}

function releasesParallelismSlot(previousState: TaskState, nextState: TaskState) {
  return (
    ACTIVE_PARALLELISM_SLOT_STATES.includes(previousState) &&
    !ACTIVE_PARALLELISM_SLOT_STATES.includes(nextState)
  );
}

function resolveReopenColumnId(input: {
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

function shouldReopenWorkItemForRework(
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

function hasPendingWorkflowCancel(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return false;
  }

  const value = (metadata as Record<string, unknown>).cancel_requested_at;
  return typeof value === 'string' && value.trim().length > 0;
}

interface WorkflowActivationTransition {
  requestId: string;
  reason: string;
  eventType: string;
  payload: Record<string, unknown>;
}

function buildWorkflowActivationForTaskTransition(
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

function resolveWorkflowActivationTransitionReason(
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
