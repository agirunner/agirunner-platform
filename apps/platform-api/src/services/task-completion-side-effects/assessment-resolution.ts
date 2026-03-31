import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseClient } from '../../db/database.js';
import type { LogService } from '../../logging/log-service.js';
import { logTaskGovernanceTransition } from '../../logging/task-governance-log.js';
import { registerTaskOutputDocuments } from '../document-reference/document-reference-service.js';
import type { EventService } from '../event-service.js';
import type {
  SubjectTaskCandidateLookup,
  SubjectTaskCandidateOptions,
  TaskAttemptHandoffOutcome,
  TaskCompletionContinuityEvent,
  WorkItemCompletionOutcome,
} from './shared.js';
import {
  asOptionalString,
  asRecord,
  isAssessmentTaskCandidate,
  normalizeAssessmentOutcome,
  readSubjectTaskId,
  readsAssessmentApprovedOutcome,
  readsAssessmentRequestChangesOutcome,
  resolveAssessmentResolutionGate,
} from './shared.js';
import type { WorkItemContinuityService } from '../work-item-continuity-service.js';

export async function resolveTaskCompletionContinuityEvent(
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

export async function applyTaskCompletionContinuityEvent(
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

export async function maybeResolveAssessmentSubject(
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

export async function loadSubjectTaskCandidates(
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

export async function loadLatestTaskAttemptHandoffOutcome(
  client: DatabaseClient,
  tenantId: string,
  completedTask: Record<string, unknown>,
): Promise<TaskAttemptHandoffOutcome | null> {
  const taskId = asOptionalString(completedTask.id);
  const taskReworkCount = typeof completedTask.rework_count === 'number' && Number.isInteger(completedTask.rework_count)
    ? completedTask.rework_count
    : 0;
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
  };
}
