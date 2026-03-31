import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabaseClient } from '../db/database.js';
import type { LogService } from '../logging/log-service.js';
import { maybeAutoCloseCompletedPlannedPredecessorWorkItem } from './planned-work-item-auto-close.js';
import type { EventService } from './event/event-service.js';
import type { WorkItemContinuityService } from './work-item-continuity-service.js';
import { enqueueAndDispatchImmediateWorkflowActivation } from './workflow-immediate-activation.js';
import type { ImmediateWorkflowActivationDispatcher } from './workflow-immediate-activation.js';
import type { PlaybookTaskParallelismService } from './playbook-task-parallelism-service.js';
import { applyDependentTaskCompletionSideEffects } from './task-completion-side-effects/dependency-resolution.js';
import {
  maybeApplyExplicitAssessmentOutcomeAction,
  maybeRejectSubjectTask,
  maybeRequestSubjectTaskChanges,
} from './task-completion-side-effects/assessment-actions.js';
import {
  applyTaskCompletionContinuityEvent,
  maybeResolveAssessmentSubject,
  resolveTaskCompletionContinuityEvent,
} from './task-completion-side-effects/assessment-resolution.js';
import { maybeAutoCloseApprovedOngoingWorkItem } from './task-completion-side-effects/workflow-closure.js';
import {
  asOptionalString,
  asRecord,
  validateOutputSchema,
} from './task-completion-side-effects/shared.js';
import type { SubjectTaskChangeService } from './task-completion-side-effects/shared.js';
import { loadLatestTaskAttemptHandoffOutcome } from './task-completion-side-effects/assessment-resolution.js';

export { validateOutputSchema };

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
  await applyDependentTaskCompletionSideEffects(
    eventService,
    parallelismService,
    identity,
    completedTaskId,
    client,
  );

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
