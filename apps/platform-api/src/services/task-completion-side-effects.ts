import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabaseClient } from '../db/database.js';
import type { LogService } from '../logging/log-service.js';
import { logTaskGovernanceTransition } from '../logging/task-governance-log.js';
import type { TaskState } from '../orchestration/task-state-machine.js';
import { registerTaskOutputDocuments } from './document-reference-service.js';
import { EventService } from './event-service.js';
import { PlaybookTaskParallelismService } from './playbook-task-parallelism-service.js';
import { maybeAutoCloseCompletedPlannedPredecessorWorkItem } from './planned-work-item-auto-close.js';
import type {
  WorkItemCompletionOutcome,
  WorkItemContinuityService,
} from './work-item-continuity-service.js';
import type { ImmediateWorkflowActivationDispatcher } from './workflow-immediate-activation.js';
import { enqueueAndDispatchImmediateWorkflowActivation } from './workflow-immediate-activation.js';

interface ReviewedTaskCandidateLookup {
  result: { rows: Record<string, unknown>[]; rowCount: number };
  resolutionSource: 'explicit_task' | 'same_work_item' | 'parent_work_item' | 'none';
  explicitReviewedTaskId: string | null;
  parentWorkItemId: string | null;
}

interface ReviewedTaskCandidateOptions {
  allowCompletedExplicitTask?: boolean;
}

type TaskCompletionContinuityEvent = 'task_completed' | 'review_rejected';

interface TaskAttemptHandoffOutcome {
  completion: string | null;
  resolution: string | null;
  reviewOutcome: string | null;
  summary: string | null;
}

interface ReviewTaskChangeService {
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
      & Partial<Pick<WorkItemContinuityService, 'recordReviewRejected'>>
    )
    | undefined,
  identity: ApiKeyIdentity,
  task: Record<string, unknown>,
  client: DatabaseClient,
  activationDispatchService?: ImmediateWorkflowActivationDispatcher,
  logService?: LogService,
  reviewTaskChangeService?: ReviewTaskChangeService,
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
    `SELECT id, workflow_id, work_item_id, state, is_orchestrator_task, depends_on, requires_approval FROM tasks
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

    const nextState: TaskState = dependent.requires_approval
      ? 'awaiting_approval'
      : (await shouldQueueDependentTask(
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
    const reviewReworkApplied =
      continuityEvent === 'review_rejected'
        ? await maybeRequestReviewedTaskChanges(
            reviewTaskChangeService,
            eventService,
            identity,
            task,
            client,
            logService,
          )
        : false;
    const continuityResult = reviewReworkApplied
      ? null
      : await applyTaskCompletionContinuityEvent(
          workItemContinuityService,
          identity.tenantId,
          task,
          continuityEvent,
          client,
        );
    if (continuityEvent === 'task_completed') {
      await maybeResolveReviewedOutput(
        eventService,
        identity,
        task,
        continuityResult ?? null,
        client,
        logService,
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
    if (!reviewReworkApplied) {
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

async function maybeRequestReviewedTaskChanges(
  reviewTaskChangeService: ReviewTaskChangeService | undefined,
  eventService: EventService,
  identity: ApiKeyIdentity,
  completedTask: Record<string, unknown>,
  client: DatabaseClient,
  logService?: LogService,
) {
  if (!reviewTaskChangeService) {
    return false;
  }

  const resolutionGate = resolveReviewResolutionGate(completedTask, null);
  if (!resolutionGate.shouldAttempt) {
    return false;
  }

  const workflowId = asOptionalString(completedTask.workflow_id);
  const workItemId = asOptionalString(completedTask.work_item_id);
  const reviewTaskId = asOptionalString(completedTask.id);
  if (!workflowId || !workItemId || !reviewTaskId) {
    return false;
  }

  const candidates = await loadReviewedTaskCandidates(
    client,
    identity.tenantId,
    workflowId,
    workItemId,
    reviewTaskId,
    completedTask,
    { allowCompletedExplicitTask: true },
  );
  if (candidates.result.rowCount !== 1) {
    return false;
  }

  const reviewedTaskId = asOptionalString(candidates.result.rows[0]?.id);
  if (!reviewedTaskId) {
    return false;
  }

  const latestHandoffOutcome = await loadLatestTaskAttemptHandoffOutcome(
    client,
    identity.tenantId,
    completedTask,
  );
  const feedback = readReviewRequestChangesFeedback(completedTask, latestHandoffOutcome);
  await reviewTaskChangeService.requestTaskChanges(
    identity,
    reviewedTaskId,
    { feedback },
    client,
  );

  const payload = {
    event_type: 'task.review_rework_applied',
    workflow_id: workflowId,
    review_task_id: reviewTaskId,
    review_task_work_item_id: workItemId,
    reviewed_task_id: reviewedTaskId,
    resolution_source: candidates.resolutionSource,
    resolution_gate: resolutionGate.reason,
    explicit_reviewed_task_id: candidates.explicitReviewedTaskId,
    parent_work_item_id: candidates.parentWorkItemId,
  };
  await eventService.emit(
    {
      tenantId: identity.tenantId,
      type: 'task.review_rework_applied',
      entityType: 'task',
      entityId: reviewTaskId,
      actorType: 'system',
      actorId: 'review_resolver',
      data: payload,
    },
    client,
  );
  await logTaskGovernanceTransition(logService, {
    tenantId: identity.tenantId,
    operation: 'task.review_rework.applied',
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
  if (!isReviewTaskCandidate(completedTask)) {
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
    && readsReviewRequestChangesOutcome(completedTask, latestHandoffOutcome)
  ) {
    return 'review_rejected';
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
      & Partial<Pick<WorkItemContinuityService, 'recordReviewRejected'>>
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

  if (event === 'review_rejected') {
    return workItemContinuityService?.recordReviewRejected?.(
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

async function maybeResolveReviewedOutput(
  eventService: EventService,
  identity: ApiKeyIdentity,
  completedTask: Record<string, unknown>,
  continuityResult: WorkItemCompletionOutcome | null,
  client: DatabaseClient,
  logService?: LogService,
) {
  const resolutionGate = resolveReviewResolutionGate(completedTask, continuityResult);
  if (!resolutionGate.shouldAttempt) {
    const reviewTaskId = asOptionalString(completedTask.id);
    if (reviewTaskId) {
      const skipPayload = {
        event_type: 'task.review_resolution_skipped',
        reason: 'not_review_candidate',
        resolution_gate: resolutionGate.reason,
        role: asOptionalString(completedTask.role),
        task_type: asOptionalString(asRecord(completedTask.metadata).task_type),
        explicit_reviewed_task_id: readReviewedTaskId(completedTask),
        matched_rule_type: continuityResult?.matchedRuleType ?? null,
        satisfied_review_expectation: continuityResult?.satisfiedReviewExpectation ?? false,
      };
      await eventService.emit(
        {
          tenantId: identity.tenantId,
          type: 'task.review_resolution_skipped',
          entityType: 'task',
          entityId: reviewTaskId,
          actorType: 'system',
          actorId: 'review_resolver',
          data: skipPayload,
        },
        client,
      );
      await logTaskGovernanceTransition(logService, {
        tenantId: identity.tenantId,
        operation: 'task.review_resolution.skipped',
        executor: client,
        task: completedTask,
        payload: skipPayload,
      });
    }
    return;
  }

  const workflowId = asOptionalString(completedTask.workflow_id);
  const workItemId = asOptionalString(completedTask.work_item_id);
  const reviewTaskId = asOptionalString(completedTask.id);
  if (!workflowId || !workItemId || !reviewTaskId) {
    return;
  }

  const candidates = await loadReviewedTaskCandidates(
    client,
    identity.tenantId,
    workflowId,
    workItemId,
    reviewTaskId,
    completedTask,
  );

  if (candidates.result.rowCount !== 1) {
    const skipPayload = {
      event_type: 'task.review_resolution_skipped',
      workflow_id: workflowId,
      work_item_id: workItemId,
      candidate_count: candidates.result.rowCount,
      review_task_work_item_id: workItemId,
      resolution_source: candidates.resolutionSource,
      resolution_gate: resolutionGate.reason,
      explicit_reviewed_task_id: candidates.explicitReviewedTaskId,
      parent_work_item_id: candidates.parentWorkItemId,
    };
    await eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'task.review_resolution_skipped',
        entityType: 'task',
        entityId: reviewTaskId,
        actorType: 'system',
        actorId: 'review_resolver',
        data: skipPayload,
      },
      client,
    );
    await logTaskGovernanceTransition(logService, {
      tenantId: identity.tenantId,
      operation: 'task.review_resolution.skipped',
      executor: client,
      task: completedTask,
      payload: skipPayload,
    });
    return;
  }

  const reviewedTask = candidates.result.rows[0];
  const reviewedTaskId = asOptionalString(reviewedTask.id);
  const reviewedWorkItemId = asOptionalString(reviewedTask.work_item_id);
  if (!reviewedTaskId) {
    return;
  }
  if (!reviewedWorkItemId) {
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
        AND state = 'output_pending_review'
      RETURNING *`,
    [
      identity.tenantId,
      workflowId,
      reviewedWorkItemId,
      reviewedTaskId,
      {
        review_action: 'approve_output',
        review_updated_at: new Date().toISOString(),
        review_resolved_by_task_id: reviewTaskId,
      },
    ],
  );
  if (!updated.rowCount) {
    const skipPayload = {
      event_type: 'task.review_resolution_skipped',
      workflow_id: workflowId,
      work_item_id: workItemId,
      candidate_count: 1,
      reason: 'candidate_state_changed',
      candidate_task_id: reviewedTaskId,
    };
    await eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'task.review_resolution_skipped',
        entityType: 'task',
        entityId: reviewTaskId,
        actorType: 'system',
        actorId: 'review_resolver',
        data: skipPayload,
      },
      client,
    );
    await logTaskGovernanceTransition(logService, {
      tenantId: identity.tenantId,
      operation: 'task.review_resolution.skipped',
      executor: client,
      task: completedTask,
      payload: skipPayload,
    });
    return;
  }

  const approvedTask = updated.rows[0];
  await registerTaskOutputDocuments(client, identity.tenantId, approvedTask, approvedTask.output);
  const appliedPayload = {
    event_type: 'task.review_resolution_applied',
    workflow_id: workflowId,
    review_task_id: reviewTaskId,
    review_task_work_item_id: workItemId,
    reviewed_task_id: reviewedTaskId,
    reviewed_work_item_id: reviewedWorkItemId,
    resolution_source: candidates.resolutionSource,
    resolution_gate: resolutionGate.reason,
    explicit_reviewed_task_id: candidates.explicitReviewedTaskId,
    parent_work_item_id: candidates.parentWorkItemId,
  };
  await eventService.emit(
    {
      tenantId: identity.tenantId,
      type: 'task.review_resolution_applied',
      entityType: 'task',
      entityId: reviewTaskId,
      actorType: 'system',
      actorId: 'review_resolver',
      data: appliedPayload,
    },
    client,
  );
  await maybeAutoCloseCompletedPlannedPredecessorWorkItem(
    eventService,
    identity,
    workflowId,
    reviewedWorkItemId,
    client,
  );
  await eventService.emit(
    {
      tenantId: identity.tenantId,
      type: 'task.state_changed',
      entityType: 'task',
      entityId: reviewedTaskId,
      actorType: 'system',
      actorId: 'review_resolver',
      data: {
        from_state: 'output_pending_review',
        to_state: 'completed',
        reason: 'output_review_approved',
        review_task_id: reviewTaskId,
      },
    },
    client,
  );
  await logTaskGovernanceTransition(logService, {
    tenantId: identity.tenantId,
    operation: 'task.review_resolution.applied',
    executor: client,
    task: completedTask,
    payload: appliedPayload,
  });
}

async function loadReviewedTaskCandidates(
  client: DatabaseClient,
  tenantId: string,
  workflowId: string,
  workItemId: string,
  reviewTaskId: string,
  completedTask: Record<string, unknown>,
  options?: ReviewedTaskCandidateOptions,
): Promise<ReviewedTaskCandidateLookup> {
  const explicitReviewedTaskId = readReviewedTaskId(completedTask);
  if (explicitReviewedTaskId) {
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
          [tenantId, workflowId, explicitReviewedTaskId, ['output_pending_review', 'completed'], reviewTaskId],
        )
      : await client.query<Record<string, unknown>>(
          `SELECT *
             FROM tasks
            WHERE tenant_id = $1
              AND workflow_id = $2
              AND id = $3
              AND state = 'output_pending_review'
              AND id <> $4
            LIMIT 1`,
          [tenantId, workflowId, explicitReviewedTaskId, reviewTaskId],
        );
    if ((exactMatch.rowCount ?? 0) > 0) {
      return {
        result: {
          rows: exactMatch.rows as Record<string, unknown>[],
          rowCount: exactMatch.rowCount ?? 0,
        },
        resolutionSource: 'explicit_task',
        explicitReviewedTaskId,
        parentWorkItemId: null,
      };
    }
  }

  const localMatches = await client.query<Record<string, unknown>>(
    `SELECT *
       FROM tasks
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND work_item_id = $3
        AND state = 'output_pending_review'
        AND id <> $4
      ORDER BY created_at DESC`,
    [tenantId, workflowId, workItemId, reviewTaskId],
  );
  if ((localMatches.rowCount ?? 0) > 0) {
    return {
      result: {
        rows: localMatches.rows as Record<string, unknown>[],
        rowCount: localMatches.rowCount ?? 0,
      },
      resolutionSource: 'same_work_item',
      explicitReviewedTaskId,
      parentWorkItemId: null,
    };
  }

  const parentWorkItemId = await loadParentWorkItemId(
    client,
    tenantId,
    workflowId,
    workItemId,
  );
  if (!parentWorkItemId) {
    return {
      result: {
        rows: localMatches.rows as Record<string, unknown>[],
        rowCount: localMatches.rowCount ?? 0,
      },
      resolutionSource: 'none',
      explicitReviewedTaskId,
      parentWorkItemId: null,
    };
  }

  const parentMatches = await client.query<Record<string, unknown>>(
    `SELECT *
       FROM tasks
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND work_item_id = $3
        AND state = 'output_pending_review'
        AND id <> $4
      ORDER BY created_at DESC`,
    [tenantId, workflowId, parentWorkItemId, reviewTaskId],
  );
  return {
    result: {
      rows: parentMatches.rows as Record<string, unknown>[],
      rowCount: parentMatches.rowCount ?? 0,
    },
    resolutionSource: (parentMatches.rowCount ?? 0) > 0 ? 'parent_work_item' : 'none',
    explicitReviewedTaskId,
    parentWorkItemId,
  };
}

function readReviewedTaskId(completedTask: Record<string, unknown>) {
  const input = asRecord(completedTask.input);
  return (
    asOptionalString(input.developer_task_id)
    ?? asOptionalString(input.reviewed_task_id)
    ?? asOptionalString(input.target_task_id)
  );
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

  const result = await client.query<{ completion: string | null; resolution: string | null; review_outcome: string | null }>(
    `SELECT completion,
            resolution,
            role_data->>'review_outcome' AS review_outcome,
            summary
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
    resolution: normalizeReviewOutcome(row.resolution),
    reviewOutcome: asOptionalString(row.review_outcome),
    summary: asOptionalString((row as { summary?: string | null }).summary),
  } satisfies TaskAttemptHandoffOutcome;
}

function readReviewRequestChangesFeedback(
  completedTask: Record<string, unknown>,
  latestHandoffOutcome: TaskAttemptHandoffOutcome | null,
) {
  return (
    asOptionalString(latestHandoffOutcome?.summary)
    ?? asOptionalString(asRecord(completedTask.output).review_feedback)
    ?? asOptionalString(asRecord(completedTask.output).summary)
    ?? 'Reviewer requested changes.'
  );
}

function readsReviewRequestChangesOutcome(
  completedTask: Record<string, unknown>,
  latestHandoffOutcome: TaskAttemptHandoffOutcome,
) {
  if (latestHandoffOutcome.resolution === 'request_changes') {
    return true;
  }

  const handoffReviewOutcome = normalizeReviewOutcome(latestHandoffOutcome.reviewOutcome);
  if (handoffReviewOutcome === 'request_changes') {
    return true;
  }

  const output = asRecord(completedTask.output);
  return (
    normalizeReviewOutcome(output.review_outcome) === 'request_changes'
    || normalizeReviewOutcome(output.verdict) === 'request_changes'
  );
}

function normalizeReviewOutcome(value: unknown) {
  const normalized = asOptionalString(value)?.toLowerCase();
  return normalized === 'approved' || normalized === 'request_changes' ? normalized : null;
}

async function loadParentWorkItemId(
  client: DatabaseClient,
  tenantId: string,
  workflowId: string,
  workItemId: string,
) {
  const result = await client.query<{ parent_work_item_id: string | null }>(
    `SELECT parent_work_item_id
       FROM workflow_work_items
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3
      LIMIT 1`,
    [tenantId, workflowId, workItemId],
  );
  return asOptionalString(result.rows[0]?.parent_work_item_id);
}

function resolveReviewResolutionGate(
  completedTask: Record<string, unknown>,
  continuityResult: WorkItemCompletionOutcome | null,
) {
  if (continuityResult?.satisfiedReviewExpectation) {
    return { shouldAttempt: true, reason: 'continuity_expectation' } as const;
  }

  if (readReviewedTaskId(completedTask)) {
    return { shouldAttempt: true, reason: 'explicit_reviewed_task_id' } as const;
  }

  const reviewTaskReason = readReviewTaskReason(completedTask);
  if (reviewTaskReason) {
    return { shouldAttempt: true, reason: reviewTaskReason } as const;
  }

  return { shouldAttempt: false, reason: 'not_review_candidate' } as const;
}

function isReviewTaskCandidate(completedTask: Record<string, unknown>) {
  return readReviewTaskReason(completedTask) !== null || readReviewedTaskId(completedTask) !== null;
}

function readReviewTaskReason(completedTask: Record<string, unknown>) {
  const role = asOptionalString(completedTask.role);
  if (role === 'reviewer') {
    return 'reviewer_role' as const;
  }

  const taskType = asOptionalString(asRecord(completedTask.metadata).task_type);
  if (taskType === 'review') {
    return 'review_task_type' as const;
  }

  return null;
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

function readInteger(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}
