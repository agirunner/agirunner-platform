import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabaseClient } from '../db/database.js';
import type { LogService } from '../logging/log-service.js';
import { logTaskGovernanceTransition } from '../logging/task-governance-log.js';
import { blockedColumnId, parsePlaybookDefinition } from '../orchestration/playbook-model.js';
import type { TaskState } from '../orchestration/task-state-machine.js';
import { registerTaskOutputDocuments } from './document-reference-service.js';
import { EventService } from './event-service.js';
import {
  readAssessmentSubjectLinkage,
  readWorkflowTaskKind,
} from './assessment-subject-service.js';
import { resolveAssessmentOutcomeAction } from './playbook-governance-policy.js';
import { PlaybookTaskParallelismService } from './playbook-task-parallelism-service.js';
import { maybeAutoCloseCompletedPlannedPredecessorWorkItem } from './planned-work-item-auto-close.js';
import { blockWorkflowWorkItem } from './work-item-blocking.js';
import { terminateWorkflowBranch } from './workflow-branch-service.js';
import { openWorkItemEscalation } from './work-item-escalations.js';
import type {
  WorkItemCompletionOutcome,
  WorkItemContinuityService,
} from './work-item-continuity-service.js';
import type { ImmediateWorkflowActivationDispatcher } from './workflow-immediate-activation.js';
import { enqueueAndDispatchImmediateWorkflowActivation } from './workflow-immediate-activation.js';

interface SubjectTaskCandidateLookup {
  result: { rows: Record<string, unknown>[]; rowCount: number };
  resolutionSource: 'explicit_subject_task_id' | 'none';
  explicitSubjectTaskId: string | null;
}

interface SubjectTaskCandidateOptions {
  allowCompletedExplicitTask?: boolean;
}

type TaskCompletionContinuityEvent = 'task_completed' | 'assessment_requested_changes';

interface TaskAttemptHandoffOutcome {
  completion: string | null;
  resolution: string | null;
  summary: string | null;
  outcome_action_applied: string | null;
}

interface OngoingWorkflowClosureContextRow {
  lifecycle: string | null;
  definition: unknown;
}

interface OngoingWorkItemClosureCandidateRow {
  stage_name: string | null;
  column_id: string;
  completed_at: Date | null;
  blocked_state: string | null;
  escalation_status: string | null;
  next_expected_actor: string | null;
  next_expected_action: string | null;
}

interface SubjectTaskChangeService {
  requestTaskChanges: (
    identity: ApiKeyIdentity,
    taskId: string,
    payload: {
      feedback: string;
      override_input?: Record<string, unknown>;
      preferred_agent_id?: string;
      preferred_worker_id?: string;
    },
    client?: DatabaseClient,
  ) => Promise<Record<string, unknown>>;
  rejectTask?: (
    identity: ApiKeyIdentity,
    taskId: string,
    payload: {
      feedback: string;
      record_continuity?: boolean;
    },
    client?: DatabaseClient,
  ) => Promise<Record<string, unknown>>;
}

export function validateOutputSchema(output: unknown, schema: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (!schema || typeof schema !== 'object') {
    return errors;
  }

  const requiredFields = schema.required as string[] | undefined;
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;

  if (!output || typeof output !== 'object') {
    errors.push('Output must be an object');
    return errors;
  }

  const outputRecord = output as Record<string, unknown>;

  if (requiredFields) {
    for (const field of requiredFields) {
      if (!(field in outputRecord)) {
        errors.push(`Missing required field: ${field}`);
      }
    }
  }

  if (properties) {
    for (const [key, propSchema] of Object.entries(properties)) {
      if (key in outputRecord && propSchema.type) {
        const value = outputRecord[key];
        const expectedType = propSchema.type as string;
        if (expectedType === 'string' && typeof value !== 'string') {
          errors.push(`Field ${key} must be a string`);
        } else if (expectedType === 'number' && typeof value !== 'number') {
          errors.push(`Field ${key} must be a number`);
        } else if (expectedType === 'boolean' && typeof value !== 'boolean') {
          errors.push(`Field ${key} must be a boolean`);
        } else if (expectedType === 'array' && !Array.isArray(value)) {
          errors.push(`Field ${key} must be an array`);
        } else if (expectedType === 'object' && (typeof value !== 'object' || value === null || Array.isArray(value))) {
          errors.push(`Field ${key} must be an object`);
        }
      }
    }
  }

  return errors;
}

export async function applyTaskCompletionSideEffects(
  eventService: EventService,
  parallelismService: PlaybookTaskParallelismService | undefined,
  workItemContinuityService:
    | (
      Pick<WorkItemContinuityService, 'recordTaskCompleted'>
      & Partial<Pick<WorkItemContinuityService, 'recordAssessmentRequestedChanges'>>
    )
    | undefined,
  identity: ApiKeyIdentity,
  task: Record<string, unknown>,
  client: DatabaseClient,
  activationDispatchService?: ImmediateWorkflowActivationDispatcher,
  logService?: LogService,
  reviewTaskChangeService?: SubjectTaskChangeService,
) {
  const outputSchema = asRecord((task.metadata as Record<string, unknown> | null)?.output_schema);
  if (Object.keys(outputSchema).length > 0 && task.output) {
    const validationErrors = validateOutputSchema(task.output, outputSchema);
    if (validationErrors.length > 0) {
      await eventService.emit(
        {
          tenantId: identity.tenantId,
          type: 'task.output_validation_failed',
          entityType: 'task',
          entityId: task.id as string,
          actorType: 'system',
          actorId: 'schema_validator',
          data: { errors: validationErrors },
        },
        client,
      );
    }
  }

  const completedTaskId = task.id as string;
  const dependents = await client.query(
    `SELECT id, workflow_id, work_item_id, state, is_orchestrator_task, depends_on FROM tasks
     WHERE tenant_id = $1 AND state = 'pending' AND $2 = ANY(depends_on)`,
    [identity.tenantId, completedTaskId],
  );

  for (const dependent of dependents.rows) {
    const unfinishedDeps = await client.query(
      "SELECT 1 FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND state <> 'completed' LIMIT 1",
      [identity.tenantId, dependent.depends_on],
    );
    if (unfinishedDeps.rowCount) {
      continue;
    }

    const nextState: TaskState = (await shouldQueueDependentTask(
      parallelismService,
      identity.tenantId,
      dependent as Record<string, unknown>,
      client,
    ))
      ? 'pending'
      : 'ready';
    await client.query('UPDATE tasks SET state = $3, state_changed_at = now() WHERE tenant_id = $1 AND id = $2', [
      identity.tenantId,
      dependent.id,
      nextState,
    ]);

    await eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'task.state_changed',
        entityType: 'task',
        entityId: dependent.id as string,
        actorType: 'system',
        actorId: 'dependency_resolver',
        data: { from_state: 'pending', to_state: nextState },
      },
      client,
    );
  }

  if (!task.workflow_id) {
    return;
  }

  if (task.is_orchestrator_task) {
    return;
  }

  const workflowResult = await client.query(
    'SELECT playbook_id FROM workflows WHERE tenant_id = $1 AND id = $2',
    [identity.tenantId, task.workflow_id],
  );
  if (workflowResult.rows[0]?.playbook_id) {
    const continuityEvent = await resolveTaskCompletionContinuityEvent(
      client,
      identity.tenantId,
      task,
    );
    const assessmentReworkApplied =
      continuityEvent === 'assessment_requested_changes'
        ? await maybeRequestSubjectTaskChanges(
            reviewTaskChangeService,
            eventService,
            identity,
            task,
            client,
            logService,
          )
        : false;
    const explicitOutcomeApplied =
      continuityEvent === 'task_completed'
        ? await maybeApplyExplicitAssessmentOutcomeAction(
            eventService,
            identity,
            task,
            client,
            logService,
          )
        : false;
    const assessmentRejectionApplied =
      continuityEvent === 'task_completed' && !explicitOutcomeApplied
        ? await maybeRejectSubjectTask(
            reviewTaskChangeService,
            eventService,
            identity,
            task,
            client,
            logService,
          )
        : false;
    const continuityResult = assessmentReworkApplied
      ? null
      : await applyTaskCompletionContinuityEvent(
          workItemContinuityService,
          identity.tenantId,
          task,
          continuityEvent,
          client,
        );
    if (continuityEvent === 'task_completed') {
      if (!assessmentRejectionApplied && !explicitOutcomeApplied) {
        await maybeResolveAssessmentSubject(
          eventService,
          identity,
          task,
          continuityResult ?? null,
          client,
          logService,
        );
      }
      await maybeAutoCloseApprovedOngoingWorkItem(
        eventService,
        identity,
        task,
        client,
      );
    }
    await maybeAutoCloseCompletedPlannedPredecessorWorkItem(
      eventService,
      identity,
      String(task.workflow_id),
      asOptionalString(task.work_item_id),
      client,
    );
    const latestHandoffOutcome = await loadLatestTaskAttemptHandoffOutcome(
      client,
      identity.tenantId,
      task,
    );
    if (!assessmentReworkApplied) {
      if (!latestHandoffOutcome) {
        await enqueueAndDispatchImmediateWorkflowActivation(
          client,
          eventService,
          activationDispatchService,
          {
            tenantId: identity.tenantId,
            workflowId: String(task.workflow_id),
            requestId: `task-completed:${task.id}:${String(task.updated_at ?? task.completed_at ?? '')}`,
            reason: 'task.completed',
            eventType: 'task.completed',
            payload: {
              task_id: task.id,
              task_role: task.role ?? null,
              task_title: task.title ?? null,
              work_item_id: task.work_item_id ?? null,
              stage_name: task.stage_name ?? null,
            },
            actorType: 'system',
            actorId: 'task_completion_side_effects',
          },
        );
      }
    }
    return;
  }
}

async function maybeRequestSubjectTaskChanges(
  reviewTaskChangeService: SubjectTaskChangeService | undefined,
  eventService: EventService,
  identity: ApiKeyIdentity,
  completedTask: Record<string, unknown>,
  client: DatabaseClient,
  logService?: LogService,
) {
  if (!reviewTaskChangeService) {
    return false;
  }

  const resolutionGate = resolveAssessmentResolutionGate(completedTask, null);
  if (!resolutionGate.shouldAttempt) {
    return false;
  }

  const workflowId = asOptionalString(completedTask.workflow_id);
  const workItemId = asOptionalString(completedTask.work_item_id);
  const assessmentTaskId = asOptionalString(completedTask.id);
  if (!workflowId || !workItemId || !assessmentTaskId) {
    return false;
  }

  const candidates = await loadSubjectTaskCandidates(
    client,
    identity.tenantId,
    workflowId,
    workItemId,
    assessmentTaskId,
    completedTask,
    { allowCompletedExplicitTask: true },
  );
  if (candidates.result.rowCount !== 1) {
    return false;
  }

  const subjectTaskId = asOptionalString(candidates.result.rows[0]?.id);
  if (!subjectTaskId) {
    return false;
  }

  const latestHandoffOutcome = await loadLatestTaskAttemptHandoffOutcome(
    client,
    identity.tenantId,
    completedTask,
  );
  const feedback = readRequestChangesFeedback(completedTask, latestHandoffOutcome);
  await reviewTaskChangeService.requestTaskChanges(
    identity,
    subjectTaskId,
    { feedback },
    client,
  );

  const payload = {
    event_type: 'task.assessment_rework_applied',
    workflow_id: workflowId,
    assessment_task_id: assessmentTaskId,
    assessment_task_work_item_id: workItemId,
    subject_task_id: subjectTaskId,
    resolution_source: candidates.resolutionSource,
    resolution_gate: resolutionGate.reason,
    explicit_subject_task_id: candidates.explicitSubjectTaskId,
  };
  await eventService.emit(
    {
      tenantId: identity.tenantId,
      type: 'task.assessment_rework_applied',
      entityType: 'task',
      entityId: assessmentTaskId,
      actorType: 'system',
      actorId: 'assessment_resolver',
      data: payload,
    },
    client,
  );
  await logTaskGovernanceTransition(logService, {
    tenantId: identity.tenantId,
    operation: 'task.assessment_rework.applied',
    executor: client,
    task: completedTask,
    payload,
  });

  return true;
}

async function maybeApplyExplicitAssessmentOutcomeAction(
  eventService: EventService,
  identity: ApiKeyIdentity,
  completedTask: Record<string, unknown>,
  client: DatabaseClient,
  logService?: LogService,
) {
  const resolutionGate = resolveAssessmentResolutionGate(completedTask, null);
  if (!resolutionGate.shouldAttempt) {
    return false;
  }

  const latestHandoffOutcome = await loadLatestTaskAttemptHandoffOutcome(
    client,
    identity.tenantId,
    completedTask,
  );
  const decisionState = normalizeAssessmentOutcome(latestHandoffOutcome?.resolution);
  if (decisionState !== 'blocked' && decisionState !== 'rejected') {
    return false;
  }

  const workflowId = asOptionalString(completedTask.workflow_id);
  const workItemId = asOptionalString(completedTask.work_item_id);
  const assessmentTaskId = asOptionalString(completedTask.id);
  if (!workflowId || !workItemId || !assessmentTaskId) {
    return false;
  }
  const definition = await loadWorkflowDefinition(client, identity.tenantId, workflowId);
  if (!definition) {
    return false;
  }

  const candidates = await loadSubjectTaskCandidates(
    client,
    identity.tenantId,
    workflowId,
    workItemId,
    assessmentTaskId,
    completedTask,
    { allowCompletedExplicitTask: true },
  );
  if (candidates.result.rowCount !== 1) {
    return false;
  }

  const subjectTask = candidates.result.rows[0];
  const subjectWorkItemId = asOptionalString(subjectTask.work_item_id);
  const subjectRole = asOptionalString(subjectTask.role);
  const assessorRole = asOptionalString(completedTask.role);
  const outcomeAction = resolveExplicitAssessmentOutcomeAction(latestHandoffOutcome)
    ?? resolveAssessmentOutcomeAction({
      definition,
      subjectRole,
      assessorRole,
      checkpointName: asOptionalString(completedTask.stage_name),
      decisionState,
    });
  if (!outcomeAction || !subjectWorkItemId) {
    return false;
  }

  const feedback = readAssessmentResolutionFeedback(
    completedTask,
    latestHandoffOutcome,
    decisionState === 'blocked'
      ? 'Assessment blocked the subject output.'
      : 'Assessment rejected the subject output.',
  );
  const authoredBlockedColumnId = blockedColumnId(definition);
  if (outcomeAction.action === 'block_subject') {
    await applyAssessmentBlockSubjectAction(client, {
      tenantId: identity.tenantId,
      workflowId,
      assessmentTaskId,
      assessmentWorkItemId: workItemId,
      subjectTaskId: asOptionalString(subjectTask.id),
      subjectWorkItemId,
      decisionState,
      feedback,
      blockedColumnId: authoredBlockedColumnId,
      resolutionSource: candidates.resolutionSource,
      resolutionGate: resolutionGate.reason,
      explicitSubjectTaskId: candidates.explicitSubjectTaskId,
      eventService,
      logService,
      completedTask,
    });
    return true;
  }
  if (outcomeAction.action === 'escalate') {
    await applyAssessmentEscalationAction(client, {
      tenantId: identity.tenantId,
      workflowId,
      assessmentTaskId,
      assessmentWorkItemId: workItemId,
      subjectTaskId: asOptionalString(subjectTask.id),
      subjectWorkItemId,
      subjectRevision: readSubjectRevision(completedTask),
      decisionState,
      feedback,
      resolutionSource: candidates.resolutionSource,
      resolutionGate: resolutionGate.reason,
      explicitSubjectTaskId: candidates.explicitSubjectTaskId,
      eventService,
      logService,
      completedTask,
    });
    return true;
  }
  if (outcomeAction.action === 'terminate_branch') {
    const branchId = readBranchId(completedTask) ?? readBranchId(subjectTask);
    if (!branchId) {
      return false;
    }
    await applyAssessmentBranchTerminationAction(client, {
      tenantId: identity.tenantId,
      workflowId,
      assessmentTaskId,
      assessmentWorkItemId: workItemId,
      subjectTaskId: asOptionalString(subjectTask.id),
      subjectWorkItemId,
      branchId,
      decisionState,
      feedback,
      resolutionSource: candidates.resolutionSource,
      resolutionGate: resolutionGate.reason,
      explicitSubjectTaskId: candidates.explicitSubjectTaskId,
      eventService,
      logService,
      completedTask,
    });
    return true;
  }

  return false;
}

interface AssessmentExplicitOutcomeContext {
  tenantId: string;
  workflowId: string;
  assessmentTaskId: string;
  assessmentWorkItemId: string;
  subjectTaskId: string | null;
  subjectWorkItemId: string;
  decisionState: 'blocked' | 'rejected';
  feedback: string;
  blockedColumnId?: string | null;
  resolutionSource: string;
  resolutionGate: string;
  explicitSubjectTaskId: string | null;
  eventService: EventService;
  logService?: LogService;
  completedTask: Record<string, unknown>;
}

interface AssessmentEscalationContext extends AssessmentExplicitOutcomeContext {
  subjectRevision: number | null;
}

interface AssessmentBranchTerminationContext extends AssessmentExplicitOutcomeContext {
  branchId: string;
}

async function applyAssessmentBlockSubjectAction(
  client: DatabaseClient,
  context: AssessmentExplicitOutcomeContext,
) {
  await blockWorkflowWorkItem(client, {
    tenantId: context.tenantId,
    workflowId: context.workflowId,
    workItemId: context.subjectWorkItemId,
    reason: context.feedback,
    blockedColumnId: context.blockedColumnId,
  });

  const payload = {
    event_type: 'task.assessment_block_applied',
    workflow_id: context.workflowId,
    assessment_task_id: context.assessmentTaskId,
    assessment_task_work_item_id: context.assessmentWorkItemId,
    subject_task_id: context.subjectTaskId,
    subject_work_item_id: context.subjectWorkItemId,
    decision_state: context.decisionState,
    outcome_action: 'block_subject',
    resolution_source: context.resolutionSource,
    resolution_gate: context.resolutionGate,
    explicit_subject_task_id: context.explicitSubjectTaskId,
  };
  await context.eventService.emit(
    {
      tenantId: context.tenantId,
      type: 'task.assessment_block_applied',
      entityType: 'task',
      entityId: context.assessmentTaskId,
      actorType: 'system',
      actorId: 'assessment_resolver',
      data: payload,
    },
    client,
  );
  await logTaskGovernanceTransition(context.logService, {
    tenantId: context.tenantId,
    operation: 'task.assessment_block.applied',
    executor: client,
    task: context.completedTask,
    payload,
  });
}

async function applyAssessmentEscalationAction(
  client: DatabaseClient,
  context: AssessmentEscalationContext,
) {
  await openWorkItemEscalation(client, {
    tenantId: context.tenantId,
    workflowId: context.workflowId,
    workItemId: context.subjectWorkItemId,
    subjectRef: {
      kind: 'task',
      task_id: context.subjectTaskId,
      work_item_id: context.subjectWorkItemId,
    },
    subjectRevision: context.subjectRevision,
    reason: context.feedback,
    createdByTaskId: context.assessmentTaskId,
  });

  const payload = {
    event_type: 'task.assessment_escalated',
    workflow_id: context.workflowId,
    assessment_task_id: context.assessmentTaskId,
    assessment_task_work_item_id: context.assessmentWorkItemId,
    subject_task_id: context.subjectTaskId,
    subject_work_item_id: context.subjectWorkItemId,
    decision_state: context.decisionState,
    outcome_action: 'escalate',
    resolution_source: context.resolutionSource,
    resolution_gate: context.resolutionGate,
    explicit_subject_task_id: context.explicitSubjectTaskId,
  };
  await context.eventService.emit(
    {
      tenantId: context.tenantId,
      type: 'task.assessment_escalated',
      entityType: 'task',
      entityId: context.assessmentTaskId,
      actorType: 'system',
      actorId: 'assessment_resolver',
      data: payload,
    },
    client,
  );
  await logTaskGovernanceTransition(context.logService, {
    tenantId: context.tenantId,
    operation: 'task.assessment_escalated.applied',
    executor: client,
    task: context.completedTask,
    payload,
  });
}

async function applyAssessmentBranchTerminationAction(
  client: DatabaseClient,
  context: AssessmentBranchTerminationContext,
) {
  await terminateWorkflowBranch(client, {
    tenantId: context.tenantId,
    workflowId: context.workflowId,
    branchId: context.branchId,
    terminatedByType: 'task',
    terminatedById: context.assessmentTaskId,
    terminationReason: context.feedback,
  });

  const payload = {
    event_type: 'task.assessment_branch_terminated',
    workflow_id: context.workflowId,
    assessment_task_id: context.assessmentTaskId,
    assessment_task_work_item_id: context.assessmentWorkItemId,
    subject_task_id: context.subjectTaskId,
    subject_work_item_id: context.subjectWorkItemId,
    branch_id: context.branchId,
    decision_state: context.decisionState,
    outcome_action: 'terminate_branch',
    resolution_source: context.resolutionSource,
    resolution_gate: context.resolutionGate,
    explicit_subject_task_id: context.explicitSubjectTaskId,
  };
  await context.eventService.emit(
    {
      tenantId: context.tenantId,
      type: 'task.assessment_branch_terminated',
      entityType: 'task',
      entityId: context.assessmentTaskId,
      actorType: 'system',
      actorId: 'assessment_resolver',
      data: payload,
    },
    client,
  );
  await logTaskGovernanceTransition(context.logService, {
    tenantId: context.tenantId,
    operation: 'task.assessment_branch_terminated.applied',
    executor: client,
    task: context.completedTask,
    payload,
  });
}

async function loadWorkflowDefinition(
  client: DatabaseClient,
  tenantId: string,
  workflowId: string,
) {
  const result = await client.query<{ definition: unknown }>(
    `SELECT p.definition
       FROM workflows w
       JOIN playbooks p
         ON p.tenant_id = w.tenant_id
        AND p.id = w.playbook_id
      WHERE w.tenant_id = $1
        AND w.id = $2
      LIMIT 1`,
    [tenantId, workflowId],
  );
  const definition = result.rows[0]?.definition;
  return definition ? parsePlaybookDefinition(definition) : null;
}

async function maybeRejectSubjectTask(
  reviewTaskChangeService: SubjectTaskChangeService | undefined,
  eventService: EventService,
  identity: ApiKeyIdentity,
  completedTask: Record<string, unknown>,
  client: DatabaseClient,
  logService?: LogService,
) {
  if (!reviewTaskChangeService?.rejectTask) {
    return false;
  }

  const resolutionGate = resolveAssessmentResolutionGate(completedTask, null);
  if (!resolutionGate.shouldAttempt) {
    return false;
  }

  const workflowId = asOptionalString(completedTask.workflow_id);
  const workItemId = asOptionalString(completedTask.work_item_id);
  const assessmentTaskId = asOptionalString(completedTask.id);
  if (!workflowId || !workItemId || !assessmentTaskId) {
    return false;
  }

  const latestHandoffOutcome = await loadLatestTaskAttemptHandoffOutcome(
    client,
    identity.tenantId,
    completedTask,
  );
  if (latestHandoffOutcome?.resolution !== 'rejected') {
    return false;
  }

  const candidates = await loadSubjectTaskCandidates(
    client,
    identity.tenantId,
    workflowId,
    workItemId,
    assessmentTaskId,
    completedTask,
    { allowCompletedExplicitTask: true },
  );
  if (candidates.result.rowCount !== 1) {
    return false;
  }

  const subjectTaskId = asOptionalString(candidates.result.rows[0]?.id);
  if (!subjectTaskId) {
    return false;
  }

  const feedback = readAssessmentResolutionFeedback(
    completedTask,
    latestHandoffOutcome,
    'Assessment rejected the subject output.',
  );
  await reviewTaskChangeService.rejectTask(
    identity,
    subjectTaskId,
    {
      feedback,
      record_continuity: false,
    },
    client,
  );

  const payload = {
    event_type: 'task.assessment_rejection_applied',
    workflow_id: workflowId,
    assessment_task_id: assessmentTaskId,
    assessment_task_work_item_id: workItemId,
    subject_task_id: subjectTaskId,
    resolution_source: candidates.resolutionSource,
    resolution_gate: resolutionGate.reason,
    explicit_subject_task_id: candidates.explicitSubjectTaskId,
  };
  await eventService.emit(
    {
      tenantId: identity.tenantId,
      type: 'task.assessment_rejection_applied',
      entityType: 'task',
      entityId: assessmentTaskId,
      actorType: 'system',
      actorId: 'assessment_resolver',
      data: payload,
    },
    client,
  );
  await logTaskGovernanceTransition(logService, {
    tenantId: identity.tenantId,
    operation: 'task.assessment_rejection.applied',
    executor: client,
    task: completedTask,
    payload,
  });

  return true;
}

async function resolveTaskCompletionContinuityEvent(
  client: DatabaseClient,
  tenantId: string,
  completedTask: Record<string, unknown>,
): Promise<TaskCompletionContinuityEvent | null> {
  if (!isAssessmentTaskCandidate(completedTask)) {
    return 'task_completed';
  }

  const latestHandoffOutcome = await loadLatestTaskAttemptHandoffOutcome(
    client,
    tenantId,
    completedTask,
  );
  if (!latestHandoffOutcome) {
    return 'task_completed';
  }

  if (
    latestHandoffOutcome.completion === 'full'
    && readsAssessmentRequestChangesOutcome(completedTask, latestHandoffOutcome)
  ) {
    return 'assessment_requested_changes';
  }

  if (latestHandoffOutcome.completion === 'full') {
    return 'task_completed';
  }

  return null;
}

async function applyTaskCompletionContinuityEvent(
  workItemContinuityService:
    | (
      Pick<WorkItemContinuityService, 'recordTaskCompleted'>
      & Partial<Pick<WorkItemContinuityService, 'recordAssessmentRequestedChanges'>>
    )
    | undefined,
  tenantId: string,
  task: Record<string, unknown>,
  event: TaskCompletionContinuityEvent | null,
  client: DatabaseClient,
) {
  if (!event) {
    return null;
  }

  if (event === 'assessment_requested_changes') {
    return workItemContinuityService?.recordAssessmentRequestedChanges?.(
      tenantId,
      task,
      client,
    ) ?? null;
  }

  return workItemContinuityService?.recordTaskCompleted(
    tenantId,
    task,
    client,
  ) ?? null;
}

async function maybeResolveAssessmentSubject(
  eventService: EventService,
  identity: ApiKeyIdentity,
  completedTask: Record<string, unknown>,
  continuityResult: WorkItemCompletionOutcome | null,
  client: DatabaseClient,
  logService?: LogService,
) {
  const resolutionGate = resolveAssessmentResolutionGate(completedTask, continuityResult);
  if (!resolutionGate.shouldAttempt) {
    const assessmentTaskId = asOptionalString(completedTask.id);
    if (assessmentTaskId) {
      const skipPayload = {
        event_type: 'task.assessment_resolution_skipped',
        reason: resolutionGate.reason,
        resolution_gate: resolutionGate.reason,
        role: asOptionalString(completedTask.role),
        task_type: asOptionalString(asRecord(completedTask.metadata).task_type),
        explicit_subject_task_id: readSubjectTaskId(completedTask),
        matched_rule_type: continuityResult?.matchedRuleType ?? null,
        satisfied_assessment_expectation: continuityResult?.satisfiedAssessmentExpectation ?? false,
      };
      await eventService.emit(
        {
          tenantId: identity.tenantId,
          type: 'task.assessment_resolution_skipped',
          entityType: 'task',
          entityId: assessmentTaskId,
          actorType: 'system',
          actorId: 'assessment_resolver',
          data: skipPayload,
        },
        client,
      );
      await logTaskGovernanceTransition(logService, {
        tenantId: identity.tenantId,
        operation: 'task.assessment_resolution.skipped',
        executor: client,
        task: completedTask,
        payload: skipPayload,
      });
    }
    return;
  }

  const workflowId = asOptionalString(completedTask.workflow_id);
  const workItemId = asOptionalString(completedTask.work_item_id);
  const assessmentTaskId = asOptionalString(completedTask.id);
  if (!workflowId || !workItemId || !assessmentTaskId) {
    return;
  }

  const latestHandoffOutcome = await loadLatestTaskAttemptHandoffOutcome(
    client,
    identity.tenantId,
    completedTask,
  );
  if (!readsAssessmentApprovedOutcome(completedTask, latestHandoffOutcome)) {
    const skipPayload = {
      event_type: 'task.assessment_resolution_skipped',
      workflow_id: workflowId,
      work_item_id: workItemId,
      reason: 'resolution_not_approved',
      resolution_gate: resolutionGate.reason,
      explicit_subject_task_id: readSubjectTaskId(completedTask),
      resolution: latestHandoffOutcome?.resolution ?? null,
    };
    await eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'task.assessment_resolution_skipped',
        entityType: 'task',
        entityId: assessmentTaskId,
        actorType: 'system',
        actorId: 'assessment_resolver',
        data: skipPayload,
      },
      client,
    );
    await logTaskGovernanceTransition(logService, {
      tenantId: identity.tenantId,
      operation: 'task.assessment_resolution.skipped',
      executor: client,
      task: completedTask,
      payload: skipPayload,
    });
    return;
  }

  const candidates = await loadSubjectTaskCandidates(
    client,
    identity.tenantId,
    workflowId,
    workItemId,
    assessmentTaskId,
    completedTask,
  );

  if (candidates.result.rowCount !== 1) {
    const skipPayload = {
      event_type: 'task.assessment_resolution_skipped',
      workflow_id: workflowId,
      work_item_id: workItemId,
      candidate_count: candidates.result.rowCount,
      assessment_task_work_item_id: workItemId,
      resolution_source: candidates.resolutionSource,
      resolution_gate: resolutionGate.reason,
      explicit_subject_task_id: candidates.explicitSubjectTaskId,
    };
    await eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'task.assessment_resolution_skipped',
        entityType: 'task',
        entityId: assessmentTaskId,
        actorType: 'system',
        actorId: 'assessment_resolver',
        data: skipPayload,
      },
      client,
    );
    await logTaskGovernanceTransition(logService, {
      tenantId: identity.tenantId,
      operation: 'task.assessment_resolution.skipped',
      executor: client,
      task: completedTask,
      payload: skipPayload,
    });
    return;
  }

  const subjectTask = candidates.result.rows[0];
  const subjectTaskId = asOptionalString(subjectTask.id);
  const subjectWorkItemId = asOptionalString(subjectTask.work_item_id);
  if (!subjectTaskId) {
    return;
  }
  if (!subjectWorkItemId) {
    return;
  }

  const updated = await client.query<Record<string, unknown>>(
    `UPDATE tasks
        SET state = 'completed',
            state_changed_at = now(),
            completed_at = COALESCE(completed_at, now()),
            error = NULL,
            metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb,
            updated_at = now()
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND work_item_id = $3
        AND id = $4
        AND state = 'output_pending_assessment'
      RETURNING *`,
    [
      identity.tenantId,
      workflowId,
      subjectWorkItemId,
      subjectTaskId,
      {
        assessment_action: 'approved',
        assessment_updated_at: new Date().toISOString(),
        assessment_resolved_by_task_id: assessmentTaskId,
      },
    ],
  );
  if (!updated.rowCount) {
    const skipPayload = {
      event_type: 'task.assessment_resolution_skipped',
      workflow_id: workflowId,
      work_item_id: workItemId,
      candidate_count: 1,
      reason: 'candidate_state_changed',
      candidate_task_id: subjectTaskId,
    };
    await eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'task.assessment_resolution_skipped',
        entityType: 'task',
        entityId: assessmentTaskId,
        actorType: 'system',
        actorId: 'assessment_resolver',
        data: skipPayload,
      },
      client,
    );
    await logTaskGovernanceTransition(logService, {
      tenantId: identity.tenantId,
      operation: 'task.assessment_resolution.skipped',
      executor: client,
      task: completedTask,
      payload: skipPayload,
    });
    return;
  }

  const approvedTask = updated.rows[0];
  await registerTaskOutputDocuments(client, identity.tenantId, approvedTask, approvedTask.output);
  const appliedPayload = {
    event_type: 'task.assessment_resolution_applied',
    workflow_id: workflowId,
    assessment_task_id: assessmentTaskId,
    assessment_task_work_item_id: workItemId,
    subject_task_id: subjectTaskId,
    subject_work_item_id: subjectWorkItemId,
    resolution_source: candidates.resolutionSource,
    resolution_gate: resolutionGate.reason,
    explicit_subject_task_id: candidates.explicitSubjectTaskId,
  };
  await eventService.emit(
    {
      tenantId: identity.tenantId,
      type: 'task.assessment_resolution_applied',
      entityType: 'task',
      entityId: assessmentTaskId,
      actorType: 'system',
      actorId: 'assessment_resolver',
      data: appliedPayload,
    },
    client,
  );
  await maybeAutoCloseCompletedPlannedPredecessorWorkItem(
    eventService,
    identity,
    workflowId,
    subjectWorkItemId,
    client,
  );
  await eventService.emit(
    {
      tenantId: identity.tenantId,
      type: 'task.state_changed',
      entityType: 'task',
      entityId: subjectTaskId,
      actorType: 'system',
      actorId: 'assessment_resolver',
      data: {
        from_state: 'output_pending_assessment',
        to_state: 'completed',
        reason: 'assessment_approved',
        assessment_task_id: assessmentTaskId,
      },
    },
    client,
  );
  await logTaskGovernanceTransition(logService, {
    tenantId: identity.tenantId,
    operation: 'task.assessment_resolution.applied',
    executor: client,
    task: completedTask,
    payload: appliedPayload,
  });
}

async function maybeAutoCloseApprovedOngoingWorkItem(
  eventService: EventService,
  identity: ApiKeyIdentity,
  completedTask: Record<string, unknown>,
  client: DatabaseClient,
) {
  if (readWorkflowTaskKind(completedTask.metadata, Boolean(completedTask.is_orchestrator_task)) !== 'assessment') {
    return false;
  }

  const workflowId = asOptionalString(completedTask.workflow_id);
  const workItemId = asOptionalString(completedTask.work_item_id);
  if (!workflowId || !workItemId) {
    return false;
  }

  const latestHandoffOutcome = await loadLatestTaskAttemptHandoffOutcome(
    client,
    identity.tenantId,
    completedTask,
  );
  if (
    latestHandoffOutcome?.completion !== 'full'
    || latestHandoffOutcome.resolution !== 'approved'
  ) {
    return false;
  }

  const workflow = await loadOngoingWorkflowClosureContext(
    client,
    identity.tenantId,
    workflowId,
  );
  if (!workflow || workflow.lifecycle !== 'ongoing') {
    return false;
  }

  const workItem = await loadOngoingWorkItemClosureCandidate(
    client,
    identity.tenantId,
    workflowId,
    workItemId,
  );
  if (
    !workItem
    || workItem.completed_at
    || workItem.blocked_state === 'blocked'
    || workItem.escalation_status === 'open'
    || workItem.next_expected_actor
    || workItem.next_expected_action
  ) {
    return false;
  }

  const openTaskCount = await countNonTerminalWorkItemTasksForClosure(
    client,
    identity.tenantId,
    workflowId,
    workItemId,
  );
  if (openTaskCount > 0) {
    return false;
  }

  const terminalColumnId =
    parsePlaybookDefinition(workflow.definition).board.columns.find((column) => column.is_terminal)?.id
    ?? workItem.column_id;
  const completedAt = new Date();
  const updateResult = await client.query<{ id: string }>(
    `UPDATE workflow_work_items
        SET column_id = $4,
            completed_at = COALESCE(completed_at, $5),
            next_expected_actor = NULL,
            next_expected_action = NULL,
            metadata = COALESCE(metadata, '{}'::jsonb) - 'orchestrator_finish_state',
            updated_at = now()
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3
        AND completed_at IS NULL
    RETURNING id`,
    [identity.tenantId, workflowId, workItemId, terminalColumnId, completedAt],
  );
  if (!updateResult.rowCount) {
    return false;
  }

  const eventData = {
    workflow_id: workflowId,
    work_item_id: workItemId,
    stage_name: workItem.stage_name,
    previous_column_id: workItem.column_id,
    column_id: terminalColumnId,
    completed_at: completedAt.toISOString(),
  };
  await eventService.emit(
    {
      tenantId: identity.tenantId,
      type: 'work_item.updated',
      entityType: 'work_item',
      entityId: workItemId,
      actorType: 'system',
      actorId: 'task_completion_side_effects',
      data: eventData,
    },
    client,
  );
  if (terminalColumnId !== workItem.column_id) {
    await eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'work_item.moved',
        entityType: 'work_item',
        entityId: workItemId,
        actorType: 'system',
        actorId: 'task_completion_side_effects',
        data: eventData,
      },
      client,
    );
  }
  await eventService.emit(
    {
      tenantId: identity.tenantId,
      type: 'work_item.completed',
      entityType: 'work_item',
      entityId: workItemId,
      actorType: 'system',
      actorId: 'task_completion_side_effects',
      data: eventData,
    },
    client,
  );
  return true;
}

async function loadSubjectTaskCandidates(
  client: DatabaseClient,
  tenantId: string,
  workflowId: string,
  _workItemId: string,
  assessmentTaskId: string,
  completedTask: Record<string, unknown>,
  options?: SubjectTaskCandidateOptions,
): Promise<SubjectTaskCandidateLookup> {
  const explicitSubjectTaskId = readSubjectTaskId(completedTask);
  if (explicitSubjectTaskId) {
    const exactMatch = options?.allowCompletedExplicitTask
      ? await client.query<Record<string, unknown>>(
          `SELECT *
             FROM tasks
            WHERE tenant_id = $1
              AND workflow_id = $2
              AND id = $3
              AND state = ANY($4::task_state[])
              AND id <> $5
            LIMIT 1`,
          [tenantId, workflowId, explicitSubjectTaskId, ['output_pending_assessment', 'completed'], assessmentTaskId],
        )
      : await client.query<Record<string, unknown>>(
          `SELECT *
             FROM tasks
            WHERE tenant_id = $1
              AND workflow_id = $2
              AND id = $3
              AND state = 'output_pending_assessment'
              AND id <> $4
            LIMIT 1`,
          [tenantId, workflowId, explicitSubjectTaskId, assessmentTaskId],
        );
    if ((exactMatch.rowCount ?? 0) > 0) {
      return {
        result: {
          rows: exactMatch.rows as Record<string, unknown>[],
          rowCount: exactMatch.rowCount ?? 0,
        },
        resolutionSource: 'explicit_subject_task_id',
        explicitSubjectTaskId,
      };
    }
  }

  return {
    result: {
      rows: [],
      rowCount: 0,
    },
    resolutionSource: 'none',
    explicitSubjectTaskId,
  };
}

function readSubjectTaskId(completedTask: Record<string, unknown>) {
  return readAssessmentSubjectLinkage(completedTask.input, completedTask.metadata).subjectTaskId;
}

function readSubjectRevision(completedTask: Record<string, unknown>) {
  return readAssessmentSubjectLinkage(completedTask.input, completedTask.metadata).subjectRevision;
}

async function loadLatestTaskAttemptHandoffOutcome(
  client: DatabaseClient,
  tenantId: string,
  completedTask: Record<string, unknown>,
) {
  const taskId = asOptionalString(completedTask.id);
  const taskReworkCount = readInteger(completedTask.rework_count) ?? 0;
  if (!taskId) {
    return null;
  }

  const result = await client.query<{
    completion: string | null;
    resolution: string | null;
    summary: string | null;
    outcome_action_applied: string | null;
  }>(
    `SELECT completion,
            resolution,
            summary,
            outcome_action_applied
       FROM task_handoffs
      WHERE tenant_id = $1
        AND task_id = $2
        AND task_rework_count = $3
      ORDER BY sequence DESC, created_at DESC
      LIMIT 1`,
    [tenantId, taskId, taskReworkCount],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    completion: asOptionalString(row.completion),
    resolution: normalizeAssessmentOutcome(row.resolution),
    summary: asOptionalString((row as { summary?: string | null }).summary),
    outcome_action_applied: asOptionalString((row as { outcome_action_applied?: string | null }).outcome_action_applied),
  } satisfies TaskAttemptHandoffOutcome;
}

async function loadOngoingWorkflowClosureContext(
  client: DatabaseClient,
  tenantId: string,
  workflowId: string,
) {
  const result = await client.query<OngoingWorkflowClosureContextRow>(
    `SELECT w.lifecycle, p.definition
       FROM workflows w
       JOIN playbooks p
         ON p.tenant_id = w.tenant_id
        AND p.id = w.playbook_id
      WHERE w.tenant_id = $1
        AND w.id = $2
      FOR UPDATE OF w`,
    [tenantId, workflowId],
  );
  return result.rows[0] ?? null;
}

async function loadOngoingWorkItemClosureCandidate(
  client: DatabaseClient,
  tenantId: string,
  workflowId: string,
  workItemId: string,
) {
  const result = await client.query<OngoingWorkItemClosureCandidateRow>(
    `SELECT wi.stage_name,
            wi.column_id,
            wi.completed_at,
            wi.blocked_state,
            wi.escalation_status,
            wi.next_expected_actor,
            wi.next_expected_action
       FROM workflow_work_items wi
      WHERE wi.tenant_id = $1
        AND wi.workflow_id = $2
        AND wi.id = $3
      FOR UPDATE OF wi`,
    [tenantId, workflowId, workItemId],
  );
  return result.rows[0] ?? null;
}

async function countNonTerminalWorkItemTasksForClosure(
  client: DatabaseClient,
  tenantId: string,
  workflowId: string,
  workItemId: string,
) {
  const result = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM tasks
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND work_item_id = $3
        AND state NOT IN ('completed', 'failed', 'cancelled')`,
    [tenantId, workflowId, workItemId],
  );
  return result.rows[0]?.count ?? 0;
}

function resolveExplicitAssessmentOutcomeAction(latestHandoffOutcome: TaskAttemptHandoffOutcome | null) {
  const action = asOptionalString(latestHandoffOutcome?.outcome_action_applied);
  if (!action) {
    return null;
  }
  if (action === 'block_subject' || action === 'escalate' || action === 'terminate_branch') {
    return { action };
  }
  return null;
}

function readRequestChangesFeedback(
  completedTask: Record<string, unknown>,
  latestHandoffOutcome: TaskAttemptHandoffOutcome | null,
) {
  return readAssessmentResolutionFeedback(
    completedTask,
    latestHandoffOutcome,
    'Assessment requested changes.',
  );
}

function readAssessmentResolutionFeedback(
  completedTask: Record<string, unknown>,
  latestHandoffOutcome: TaskAttemptHandoffOutcome | null,
  fallback: string,
) {
  return (
    asOptionalString(latestHandoffOutcome?.summary)
    ?? asOptionalString(asRecord(completedTask.output).assessment_feedback)
    ?? asOptionalString(asRecord(completedTask.output).summary)
    ?? fallback
  );
}

function readsAssessmentRequestChangesOutcome(
  completedTask: Record<string, unknown>,
  latestHandoffOutcome: TaskAttemptHandoffOutcome,
) {
  if (latestHandoffOutcome.resolution === 'request_changes') {
    return true;
  }

  const output = asRecord(completedTask.output);
  return (
    normalizeAssessmentOutcome(output.resolution) === 'request_changes'
    || normalizeAssessmentOutcome(output.verdict) === 'request_changes'
  );
}

function readsAssessmentApprovedOutcome(
  completedTask: Record<string, unknown>,
  latestHandoffOutcome: TaskAttemptHandoffOutcome | null,
) {
  if (latestHandoffOutcome?.resolution === 'approved') {
    return true;
  }

  const output = asRecord(completedTask.output);
  return (
    normalizeAssessmentOutcome(output.resolution) === 'approved'
    || normalizeAssessmentOutcome(output.verdict) === 'approved'
  );
}

function normalizeAssessmentOutcome(value: unknown) {
  const normalized = asOptionalString(value)?.toLowerCase();
  return normalized === 'approved'
    || normalized === 'request_changes'
    || normalized === 'rejected'
    || normalized === 'blocked'
    ? normalized
    : null;
}

function resolveAssessmentResolutionGate(
  completedTask: Record<string, unknown>,
  continuityResult: WorkItemCompletionOutcome | null,
) {
  if (!isAssessmentTaskCandidate(completedTask)) {
    return { shouldAttempt: false, reason: 'not_assessment_candidate' } as const;
  }

  if (!readSubjectTaskId(completedTask)) {
    return { shouldAttempt: false, reason: 'missing_subject_task_id' } as const;
  }

  if (continuityResult?.satisfiedAssessmentExpectation) {
    return { shouldAttempt: true, reason: 'continuity_expectation' } as const;
  }

  return { shouldAttempt: true, reason: 'explicit_subject_task_id' } as const;
}

function isAssessmentTaskCandidate(completedTask: Record<string, unknown>) {
  return readWorkflowTaskKind(completedTask.metadata, Boolean(completedTask.is_orchestrator_task)) === 'assessment';
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

async function shouldQueueDependentTask(
  parallelismService: PlaybookTaskParallelismService | undefined,
  tenantId: string,
  dependent: Record<string, unknown>,
  client: DatabaseClient,
) {
  if (!parallelismService) {
    return false;
  }
  return parallelismService.shouldQueueForCapacity(
    tenantId,
    {
      taskId: String(dependent.id),
      workflowId: (dependent.workflow_id as string | null | undefined) ?? null,
      workItemId: (dependent.work_item_id as string | null | undefined) ?? null,
      isOrchestratorTask: Boolean(dependent.is_orchestrator_task),
      currentState: dependent.state as TaskState,
    },
    client,
  );
}

function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readBranchId(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const direct = asOptionalString(record.branch_id);
  if (direct) {
    return direct;
  }
  const metadata = asRecord(record.metadata);
  return asOptionalString(metadata.branch_id);
}

function readInteger(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}
