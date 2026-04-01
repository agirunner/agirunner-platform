import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseClient } from '../../db/database.js';
import type { LogService } from '../../logging/execution/log-service.js';
import { logTaskGovernanceTransition } from '../../logging/workflow-events/task-governance-log.js';
import { blockedColumnId } from '../../orchestration/playbook-model.js';
import type { EventService } from '../event/event-service.js';
import { blockWorkflowWorkItem } from '../work-item-service/work-item-blocking.js';
import { openWorkItemEscalation } from '../work-item-service/work-item-escalations.js';
import { terminateWorkflowBranch } from '../workflow-operations/workflow-branch-service.js';
import { resolveAssessmentOutcomeAction } from '../playbook/playbook-governance-policy.js';
import {
  AssessmentBranchTerminationContext,
  AssessmentEscalationContext,
  AssessmentExplicitOutcomeContext,
  loadWorkflowDefinition,
} from './assessment-actions-context.js';
import {
  asOptionalString,
  readAssessmentResolutionFeedback,
  readBranchId,
  readRequestChangesFeedback,
  readSubjectRevision,
  resolveExplicitAssessmentOutcomeAction,
  resolveAssessmentResolutionGate,
} from './shared.js';
import {
  loadLatestTaskAttemptHandoffOutcome,
  loadSubjectTaskCandidates,
} from './assessment-resolution.js';
import type { SubjectTaskChangeService } from './shared.js';
export async function maybeRequestSubjectTaskChanges(
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
export async function maybeApplyExplicitAssessmentOutcomeAction(
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
  const decisionState = latestHandoffOutcome?.resolution === 'blocked' || latestHandoffOutcome?.resolution === 'rejected'
    ? latestHandoffOutcome.resolution
    : null;
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
export async function maybeRejectSubjectTask(
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
